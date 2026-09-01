"""
Ingestion cycle — delta monitor → parse → extractor → vectorizer.
==================================================================
run_ingestion_cycle queues newly seen HLTV matches, parses any pending
ProMatch that has a demo (demo_gcs_uri) but no telemetry yet via the Go
parser service (GameStateGate strips warmup/pauses/postgame there too),
stores the ParseResult JSON next to the demo, then ingests every pending
ProMatch with parsed telemetry: loads the ParseResult JSON (GCS lazily;
LOCAL_MODE reads a local path), extracts archetypes, persists ProRound
rows, vectorizes, and stamps ingested_at. A failed match is rolled back
and skipped, never wedging the cycle.

Pro parsing runs inline in this nightly batch rather than through the
user-facing SKIP LOCKED job queue: Job.match_id FKs the user matches
table, volumes are a handful of demos per night, and sequential calls are
kinder to the shared parser service.

Demo *acquisition* (HLTV download → demo_gcs_uri) remains external — the
Apify crawler or manual backfill sets demo_gcs_uri; everything after is
automatic.
"""

from datetime import UTC, datetime
import json
import logging
import os

from db.models import ProMatch, ProRound
from services.rag_engine.delta_monitor import run_delta
from services.rag_engine.extractor import extract_archetypes
from services.rag_engine.vectorizer import vectorize_archetypes

logger = logging.getLogger(__name__)


def _load_parse_result(uri: str) -> dict:
    """Load ParseResult JSON from GCS, or from a local path in LOCAL_MODE."""
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    if uri.startswith("gs://") and not local_mode:
        from google.cloud import storage  # noqa: PLC0415 — heavy dep, absent in CI

        bucket_name, _, blob_name = uri.removeprefix("gs://").partition("/")
        client = storage.Client()
        data = client.bucket(bucket_name).blob(blob_name).download_as_bytes()
        return json.loads(data)
    path = uri.removeprefix("file://")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _persist_rounds(db, pro_match: ProMatch, drafts) -> int:
    """Replace the match's ProRound rows from the drafts' per-round extracts."""
    db.query(ProRound).filter(ProRound.pro_match_id == pro_match.hltv_match_id).delete()
    count = 0
    for draft in drafts:
        for extract in draft.rounds:
            db.add(
                ProRound(
                    pro_match_id=pro_match.hltv_match_id,
                    round_num=extract.round_num,
                    side=extract.side,
                    buy_type=extract.buy_type,
                    round_type=extract.round_type,
                    winner=extract.winner,
                    archetype_label=draft.label,
                    metrics_json=json.dumps(extract.metrics),
                )
            )
            count += 1
    return count


def _store_parse_result(pro_match: ProMatch, result: dict) -> str:
    """Write ParseResult JSON alongside the demo; returns the telemetry URI."""
    local_mode = os.getenv("LOCAL_MODE", "false").lower() == "true"
    payload = json.dumps(result).encode("utf-8")
    if pro_match.demo_gcs_uri.startswith("gs://") and not local_mode:
        from google.cloud import storage  # noqa: PLC0415 — heavy dep, absent in CI

        bucket_name = pro_match.demo_gcs_uri.removeprefix("gs://").partition("/")[0]
        blob_name = f"parsed/pro/{pro_match.hltv_match_id}.json"
        storage.Client().bucket(bucket_name).blob(blob_name).upload_from_string(
            payload, content_type="application/json"
        )
        return f"gs://{bucket_name}/{blob_name}"
    out_dir = os.getenv("PRO_PARSED_DIR", ".")
    path = os.path.join(out_dir, f"pro_{pro_match.hltv_match_id}.json")
    with open(path, "wb") as f:
        f.write(payload)
    return path


def _parse_pending(db) -> tuple[list[str], list[str]]:
    """Parse queued matches that have a demo but no telemetry yet."""
    from services.worker.parse_handler import _call_parser  # noqa: PLC0415 — reuses OIDC auth

    to_parse = (
        db.query(ProMatch)
        .filter(
            ProMatch.ingested_at.is_(None),
            ProMatch.demo_gcs_uri.isnot(None),
            ProMatch.parsed_gcs_uri.is_(None),
        )
        .order_by(ProMatch.hltv_match_id)
        .all()
    )
    parsed: list[str] = []
    failed: list[str] = []
    for pro_match in to_parse:
        try:
            result = _call_parser(pro_match.hltv_match_id, pro_match.demo_gcs_uri)
            if not result.get("rounds"):
                summary = result.get("phase_summary")
                raise RuntimeError(
                    f"no live rounds after phase gating (summary: {json.dumps(summary)})"
                )
            pro_match.parsed_gcs_uri = _store_parse_result(pro_match, result)
            db.commit()
            parsed.append(pro_match.hltv_match_id)
            logger.info(f"[ProParse] {pro_match.hltv_match_id} → {pro_match.parsed_gcs_uri}")
        except Exception as e:
            db.rollback()
            failed.append(pro_match.hltv_match_id)
            logger.error(f"[ProParse] {pro_match.hltv_match_id} failed: {e}")
    return parsed, failed


def run_ingestion_cycle(db, client=None) -> dict:
    """One full cycle. Returns {'queued', 'parsed', 'ingested', 'failed'} lists."""
    queued = run_delta(db, client=client)
    parsed, parse_failed = _parse_pending(db)

    pending = (
        db.query(ProMatch)
        .filter(ProMatch.ingested_at.is_(None), ProMatch.parsed_gcs_uri.isnot(None))
        .order_by(ProMatch.hltv_match_id)
        .all()
    )

    ingested: list[str] = []
    failed: list[str] = []
    for pro_match in pending:
        try:
            parse_result = _load_parse_result(pro_match.parsed_gcs_uri)
            drafts = extract_archetypes(parse_result, pro_match)
            round_count = _persist_rounds(db, pro_match, drafts)
            vectorize_archetypes(db, pro_match, drafts)
            pro_match.ingested_at = datetime.now(UTC)
            db.commit()
            ingested.append(pro_match.hltv_match_id)
            logger.info(
                f"[Ingest] {pro_match.hltv_match_id}: {len(drafts)} archetypes, "
                f"{round_count} pro rounds"
            )
        except Exception as e:
            db.rollback()
            failed.append(pro_match.hltv_match_id)
            logger.error(f"[Ingest] {pro_match.hltv_match_id} failed: {e}")

    failed.extend(parse_failed)
    logger.info(
        f"[Ingest] Cycle done: queued={len(queued)} parsed={len(parsed)} "
        f"ingested={len(ingested)} failed={len(failed)}"
    )
    return {"queued": queued, "parsed": parsed, "ingested": ingested, "failed": failed}
