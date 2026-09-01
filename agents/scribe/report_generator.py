"""
The Scribe — Report Generator
==============================
Consumes the final MatchState (scout stats, rag context, tactician analysis)
and generates evidence-grounded reports:

    1. Per-round flash calls, each fed only that round's data + the evidence
       items whose rounds include it.
    2. One schema-constrained synthesis call producing findings that cite
       evidence IDs in square brackets ([F1], [B2], [P3]).
    3. One verification flash call that drops findings whose cited evidence
       does not support the claim (the drop count is the grounding metric).
    4. Legacy report keys rendered from the verified findings so the frontend
       keeps working unchanged; the raw findings/summary ride along.
"""

import asyncio
import json
import logging
import os
from typing import Any

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global LLM concurrency gate
# ---------------------------------------------------------------------------
# generate_reports drives a fresh event loop per call (asyncio.run), and
# asyncio primitives cannot cross loops — so the module-level state is a
# per-loop registry rather than a single Semaphore instance.
_LLM_SEMAPHORES: dict[int, asyncio.Semaphore] = {}


def _llm_semaphore() -> asyncio.Semaphore:
    """Return the shared semaphore for the running event loop (created lazily)."""
    loop = asyncio.get_running_loop()
    sem = _LLM_SEMAPHORES.get(id(loop))
    if sem is None:
        sem = asyncio.Semaphore(int(os.environ.get("SCRIBE_LLM_CONCURRENCY", "8")))
        _LLM_SEMAPHORES[id(loop)] = sem
    return sem


async def _gated_generate(client: genai.Client, **kwargs) -> Any:
    """Every generate_content call goes through the concurrency gate."""
    async with _llm_semaphore():
        return await client.aio.models.generate_content(**kwargs)


# ---------------------------------------------------------------------------
# Output schemas (enforced via response_schema, not just requested)
# ---------------------------------------------------------------------------

from agents.scribe.modes import FINDING_CATEGORIES, MODE_SPEC, AnalysisMode, derive_mode

_FINDING_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "claim": types.Schema(type=types.Type.STRING),
        "evidence_ids": types.Schema(
            type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)
        ),
        "rounds": types.Schema(type=types.Type.ARRAY, items=types.Schema(type=types.Type.INTEGER)),
        "severity": types.Schema(type=types.Type.STRING, enum=["high", "medium", "low"]),
        "category": types.Schema(type=types.Type.STRING, enum=FINDING_CATEGORIES),
        "drill": types.Schema(type=types.Type.STRING),
        "audience": types.Schema(type=types.Type.STRING),
    },
    required=["claim", "evidence_ids", "severity", "category", "drill", "audience"],
)

_REPORT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "findings": types.Schema(type=types.Type.ARRAY, items=_FINDING_SCHEMA),
        "summary": types.Schema(type=types.Type.STRING),
    },
    required=["findings", "summary"],
)

_VERDICT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "verdicts": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "index": types.Schema(type=types.Type.INTEGER),
                    "supported": types.Schema(type=types.Type.BOOLEAN),
                },
                required=["index", "supported"],
            ),
        ),
    },
    required=["verdicts"],
)


# ---------------------------------------------------------------------------
# Evidence / playbook trimming helpers
# ---------------------------------------------------------------------------


def _evidence_for_round(evidence_pack: dict, round_num: int) -> dict:
    """Only the evidence items whose IDs touch this round (baselines are round-agnostic)."""
    facts = [f for f in evidence_pack.get("facts", []) if round_num in (f.get("rounds") or [])]
    examples = [
        p for p in evidence_pack.get("pro_examples", []) if p.get("round_ref") == round_num
    ]
    return {
        "facts": facts,
        "baselines": evidence_pack.get("baselines", []),
        "pro_examples": examples,
    }


def _trim_playbook(map_playbook: dict) -> dict | str:
    """Shrink the playbook for round prompts: keep per-site keys, truncate long values."""
    if not map_playbook:
        return {}
    full = json.dumps(map_playbook)
    if len(full) <= 1200:
        return map_playbook
    trimmed: dict[str, Any] = {}
    for key, val in map_playbook.items():
        val_txt = json.dumps(val)
        trimmed[key] = val if len(val_txt) <= 200 else val_txt[:200] + "..."
    return trimmed


# ---------------------------------------------------------------------------
# Stage 1 — per-round flash analysis
# ---------------------------------------------------------------------------


async def analyze_round_flash(
    client: genai.Client,
    round_num: int,
    round_data: dict,
    playbook_summary: dict | str,
    round_evidence: dict,
) -> str:
    """Low-latency round analysis: only this round's data + its evidence items."""
    prompt = f"""
    You are an elite CS2 tactical analyst. Analyze this specific round.
    Map playbook (summary): {json.dumps(playbook_summary)}
    Evidence for this round (cite IDs like [F1] where relevant): {json.dumps(round_evidence)}

    Round Data: {json.dumps(round_data)}

    Return a concise, tactical 2-3 sentence summary of what happened in this round, focusing on positioning, utility usage, and critical errors.
    Only describe events present in the round data or evidence above — do not speculate.
    """
    try:
        response = await _gated_generate(client, model="gemini-2.5-flash", contents=prompt)
        return f"Round {round_num}: {response.text}"
    except Exception as e:
        logger.error(f"Round {round_num} analysis failed: {e}")
        return f"Round {round_num}: Analysis failed."


# ---------------------------------------------------------------------------
# Stage 2 — schema-constrained synthesis
# ---------------------------------------------------------------------------


async def _synthesize_findings(
    client: genai.Client,
    scout_out: dict,
    evidence_pack: dict,
    round_summaries: list[str],
    mode: AnalysisMode,
) -> dict:
    """Full evidence pack + round summaries + grounding contract → findings JSON."""
    from db.config import get_config  # noqa: PLC0415

    user_team = scout_out.get("uploader_team_label") or scout_out.get("user_team")
    user_notes = scout_out.get("user_notes")
    uploader_steam_id = scout_out.get("uploader_steam_id")
    is_recon = scout_out.get("is_recon", False)

    scribe_base = get_config("prompt_scribe_base", "You are an elite CS2 coach.")
    focus_prompt_template = get_config("prompt_focus_instruction", "Focus on {user_team}.")
    recon_prompt = get_config("prompt_recon_instruction", "Focus on recon scan.")
    contract = get_config("prompt_evidence_contract_v1")
    mode_instruction = MODE_SPEC[mode]["focus_instruction"]

    focus_instruction = (
        recon_prompt
        if is_recon
        else focus_prompt_template.format(user_team=user_team, uploader_steam_id=uploader_steam_id)
        if user_team
        else ""
    )
    notes_instruction = f"\nCRITICAL COACH NOTES: {user_notes}\n" if user_notes else ""

    synthesis_prompt = f"""
    {scribe_base}
    {mode_instruction}
    {focus_instruction}
    {notes_instruction}

    EVIDENCE PACK (the only permissible source of claims — cite these IDs):
    {json.dumps(evidence_pack)}

    ROUND-BY-ROUND SUMMARIES from the parallel analysts:
    {" ".join(round_summaries)}

    {contract}

    The uploader is {uploader_steam_id or "unknown"}. Generate the coaching findings now.
    """

    response = await _gated_generate(
        client,
        model="gemini-2.5-pro",
        contents=synthesis_prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_REPORT_SCHEMA,
            temperature=0.2,
        ),
    )
    return json.loads(response.text)


# ---------------------------------------------------------------------------
# Stage 3 — verification pass
# ---------------------------------------------------------------------------


async def _verify_findings(
    client: genai.Client, findings: list[dict], evidence_pack: dict
) -> list[dict]:
    """One flash call: do the cited IDs actually support each claim? Drop the ones that don't."""
    if not findings:
        return findings

    from db.config import get_config  # noqa: PLC0415

    evidence_by_id = {
        item["id"]: item
        for section in ("facts", "baselines", "pro_examples")
        for item in evidence_pack.get(section, [])
        if item.get("id")
    }
    payload = []
    for idx, f in enumerate(findings):
        cited = {eid: evidence_by_id.get(eid) for eid in f.get("evidence_ids", [])}
        payload.append({"index": idx, "claim": f.get("claim", ""), "cited_evidence": cited})

    verifier_base = get_config("prompt_verification_instruction_v1")
    prompt = f"""
    {verifier_base}

    Findings to verify:
    {json.dumps(payload)}

    Answer for every finding index: supported true or false.
    """
    try:
        response = await _gated_generate(
            client,
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_VERDICT_SCHEMA,
                temperature=0.0,
            ),
        )
        verdicts = json.loads(response.text).get("verdicts", [])
    except Exception as e:
        logger.error(f"Verification pass failed, keeping all findings: {e}")
        return findings

    unsupported = {v.get("index") for v in verdicts if not v.get("supported", False)}
    kept = [f for i, f in enumerate(findings) if i not in unsupported]
    dropped = len(findings) - len(kept)
    if dropped:
        logger.warning(
            f"[Scribe] Verification dropped {dropped}/{len(findings)} unsupported findings."
        )
    return kept


# ---------------------------------------------------------------------------
# Stage 4 — render legacy report keys from the verified findings
# ---------------------------------------------------------------------------

_NO_FINDINGS_MSG = "No evidence-backed findings for this section."


def _format_finding_md(finding: dict) -> str:
    """One finding → markdown bullet with citation brackets, rounds, and drill."""
    ids = finding.get("evidence_ids") or []
    claim = (finding.get("claim") or "").strip()
    if ids and not any(f"[{eid}]" in claim for eid in ids):
        claim = f"{claim} [{', '.join(ids)}]"
    lines = [f"- **{(finding.get('severity') or 'medium').capitalize()}**: {claim}"]
    rounds = finding.get("rounds") or []
    if rounds:
        lines.append(f"  - Rounds: {', '.join(str(r) for r in rounds)}")
    if finding.get("drill"):
        lines.append(f"  - Drill: {finding['drill']}")
    return "\n".join(lines)


def _render_section(title: str, items: list[dict]) -> str:
    """Docstring for _render_section."""
    if not items:
        return f"### {title}\n{_NO_FINDINGS_MSG}"
    return f"### {title}\n" + "\n".join(_format_finding_md(f) for f in items)


def _render_legacy_reports(findings: list[dict], summary: str) -> dict[str, Any]:
    """Build the legacy report keys the frontend expects from the verified findings."""
    individual = [f for f in findings if f.get("audience") == "individual"]
    team = [f for f in findings if f.get("audience") == "team"]
    players: dict[str, list[dict]] = {}
    for f in findings:
        audience = f.get("audience") or ""
        if audience.startswith("player:"):
            players.setdefault(audience.split(":", 1)[1], []).append(f)

    team_md = _render_section("Team Report", team)
    coach_items = [f for f in findings if f.get("severity") == "high"] or findings
    coach_md = f"### Coach Report\n{summary}".rstrip()
    if coach_items:
        coach_md += "\n\n" + "\n".join(_format_finding_md(f) for f in coach_items)

    return {
        "individual_report": _render_section("Individual Report", individual),
        "team_report": team_md,
        "player_reports": {
            name: _render_section(f"{name} — Player Report", items)
            for name, items in players.items()
        },
        "strat_card": team_md,
        "coach_report": coach_md,
        "findings": findings,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# Stage 5 — the Coaching Report Schema payload (report_v2)
# ---------------------------------------------------------------------------


def _match_score(tactical_analysis: dict) -> int:
    """
    Deterministic 0-100 score: average of every 0..1 *_score / *_rate metric
    the tactician produced. The LLM never grades — numbers stay measured.
    """
    values: list[float] = []
    for section in (tactical_analysis or {}).values():
        if not isinstance(section, dict):
            continue
        for key, val in section.items():
            if (
                isinstance(val, (int, float))
                and not isinstance(val, bool)
                and (key.endswith("_score") or key.endswith("_rate"))
                and 0.0 <= float(val) <= 1.0
            ):
                values.append(float(val))
    if not values:
        return 50
    return round(sum(values) / len(values) * 100)


def _grade(score: int) -> str:
    """Docstring for _grade."""
    for threshold, letter in ((85, "A"), (70, "B"), (55, "C"), (40, "D")):
        if score >= threshold:
            return letter
    return "F"


def _benchmark_text(finding: dict, evidence_by_id: dict) -> str:
    """Compose the grounded benchmark string from the finding's cited B*/P* items."""
    parts: list[str] = []
    for eid in finding.get("evidence_ids") or []:
        item = evidence_by_id.get(eid)
        if not item:
            continue
        if eid.startswith("B"):
            detail = item.get("detail") or item.get("metric") or ""
            value = item.get("value")
            unit = item.get("unit") or ""
            src = item.get("source") or "pro baseline"
            parts.append(f"[{eid}] {detail}: {value} {unit} ({src})".strip())
        elif eid.startswith("P"):
            ref = item.get("pro_match_id")
            detail = (item.get("detail") or "")[:160]
            parts.append(f"[{eid}] {detail}" + (f" (pro match {ref})" if ref else ""))
    return " | ".join(parts)


def _build_report_v2(
    mode: AnalysisMode,
    findings: list[dict],
    summary: str,
    tactical_analysis: dict,
    evidence_pack: dict,
) -> dict[str, Any]:
    """The Coaching Report Schema payload. Ticks and benchmarks are joined
    deterministically from evidence — never generated by the model."""
    evidence_by_id = {
        item["id"]: item
        for section in ("facts", "baselines", "pro_examples")
        for item in evidence_pack.get(section, [])
        if item.get("id")
    }
    # JSON round-trips stringify int keys; accept both.
    raw_ticks = evidence_pack.get("round_ticks") or {}
    round_ticks = {int(k): v for k, v in raw_ticks.items()}

    key_findings = []
    for f in findings:
        rounds = f.get("rounds") or []
        first_round = rounds[0] if rounds else None
        key_findings.append(
            {
                "round": first_round,
                "rounds": rounds,
                "tick": round_ticks.get(first_round) if first_round is not None else None,
                "category": f.get("category") or "POSITIONING",
                "severity": (f.get("severity") or "medium").upper(),
                "observation": f.get("claim") or "",
                "evidence_ids": f.get("evidence_ids") or [],
                "grounded_pro_benchmark": _benchmark_text(f, evidence_by_id),
                "actionable_drill": f.get("drill") or "",
                "audience": f.get("audience") or "",
            }
        )

    score = _match_score(tactical_analysis)
    headline = (summary.split(". ")[0].strip() + ".") if summary else "Match analyzed."
    return {
        "mode": mode.value,
        "summary": {"score": score, "grade": _grade(score), "headline": headline},
        "key_findings": key_findings,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def async_generate_reports(
    match_id: str,
    scout_out: dict,
    rag_context: list,
    tactical_analysis: dict,
    map_playbook: dict,
    evidence_pack: dict,
) -> dict[str, Any]:
    """Run the round-flash wave, synthesis, verification, and legacy rendering."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for report generation.")
        return _stub_reports()

    client = genai.Client(api_key=api_key)

    # 1. Group data by round
    rounds_data = {}
    if "round_history" in scout_out:
        for r in scout_out["round_history"]:
            rn = r["round_num"]
            rounds_data[rn] = {"summary": r}

    # 2. Stage 1: parallel round calls — each sees only its own data + evidence
    playbook_summary = _trim_playbook(map_playbook)
    tasks = [
        analyze_round_flash(
            client, rn, r_data, playbook_summary, _evidence_for_round(evidence_pack, rn)
        )
        for rn, r_data in rounds_data.items()
    ]
    round_summaries = list(await asyncio.gather(*tasks))

    # 3. Stage 2 + 3: mode-aware synthesis, then verification of cited evidence
    mode = derive_mode(scout_out)
    try:
        synthesis = await _synthesize_findings(
            client, scout_out, evidence_pack, round_summaries, mode
        )
    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        return _stub_reports()

    findings = synthesis.get("findings") or []
    summary = synthesis.get("summary") or ""
    findings = await _verify_findings(client, findings, evidence_pack)

    # 4. Stage 4 + 5: legacy keys + the Coaching Report Schema payload.
    # The FULL report is cached; tier redaction happens at read time in the
    # API (services/billing), so an upgrade unlocks instantly.
    report = _render_legacy_reports(findings, summary)
    report["report_v2"] = _build_report_v2(
        mode, findings, summary, tactical_analysis, evidence_pack
    )
    return report


def generate_reports(
    match_id: str, scout_out: dict, rag_context: list, tactical_analysis: dict
) -> dict[str, Any]:
    """Synchronous wrapper for LangGraph."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No Gemini API key found for report generation.")
        return _stub_reports()

    # Fetch map playbook + build the evidence pack from the DB
    from agents.scribe.evidence import build_evidence_pack  # noqa: PLC0415
    from db.database import SessionLocal  # noqa: PLC0415
    from db.models import MapPlaybook  # noqa: PLC0415

    map_playbook = {}
    evidence_pack: dict[str, Any] = {"facts": [], "baselines": [], "pro_examples": []}
    map_name = scout_out.get("map_name", "unknown")
    db = SessionLocal()
    try:
        pb = db.query(MapPlaybook).filter_by(map_name=f"de_{map_name}").first()
        if not pb:
            pb = db.query(MapPlaybook).filter_by(map_name=map_name).first()
        if pb:
            map_playbook = json.loads(pb.playbook_json)
    except Exception as e:
        logger.warning(f"Could not load map playbook: {e}")
    try:
        evidence_pack = build_evidence_pack(
            db, match_id, scout_out, tactical_analysis, rag_context
        )
    except Exception as e:
        logger.error(f"Evidence pack build failed, proceeding ungrounded: {e}")
    finally:
        db.close()

    return asyncio.run(
        async_generate_reports(
            match_id, scout_out, rag_context, tactical_analysis, map_playbook, evidence_pack
        )
    )


def _stub_reports() -> dict[str, Any]:
    """Docstring for _stub_reports."""
    return {
        "individual_report": "### Individual Report\nAI coaching requires GEMINI_API_KEY.",
        "team_report": "### Team Report\nAI coaching requires GEMINI_API_KEY.",
        "player_reports": {},
        "strat_card": "### Strat Card\nAI coaching requires GEMINI_API_KEY.",
        "coach_report": "### Coach Report\nAI coaching requires GEMINI_API_KEY.",
        "findings": [],
        "summary": "",
        "report_v2": None,
    }
