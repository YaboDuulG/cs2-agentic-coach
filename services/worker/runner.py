"""
Worker loop — claims jobs from the DB queue and runs them.

One process handles both kinds: parse jobs run inline (they're mostly waiting
on the Go parser), coach jobs run in a bounded thread pool so the LLM fan-out
is capped per worker (COACH_CONCURRENCY). Scale by running more replicas;
SKIP LOCKED claiming makes that safe.

Run: python -m services.worker
"""

from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import logging
import os
import socket
import threading
import time
import uuid

from db.database import SessionLocal, engine
from db.jobs import claim_next_job, complete_job, fail_job, requeue_stuck_jobs
from db.models import Base, Job, JobKind, Match, MatchStatus

logger = logging.getLogger("worker")

POLL_INTERVAL_SECONDS = float(os.environ.get("WORKER_POLL_INTERVAL", "2"))
COACH_CONCURRENCY = int(os.environ.get("COACH_CONCURRENCY", "4"))
STUCK_SWEEP_EVERY = 30  # claim iterations between stuck-job sweeps


class _HealthHandler(BaseHTTPRequestHandler):
    """Docstring for _HealthHandler."""

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler API
        """Docstring for do_GET."""
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):  # silence per-request access logs
        """Docstring for log_message."""


def _start_health_server() -> None:
    """
    Cloud Run services must listen on $PORT to pass the startup probe, even
    though this process is a queue poller, not an HTTP app. Serves 200 on
    every path from a daemon thread. Skipped when PORT is unset (local runs).
    """
    port = os.environ.get("PORT")
    if not port:
        return
    server = ThreadingHTTPServer(("0.0.0.0", int(port)), _HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True, name="health").start()
    logger.info(f"Health server listening on :{port}")


def _worker_id() -> str:
    """Docstring for _worker_id."""
    return f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def _run_parse(job_id: int, match_id: str) -> None:
    """Docstring for _run_parse."""
    from services.worker.parse_handler import handle_parse_job  # noqa: PLC0415

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        try:
            handle_parse_job(db, match_id)
            complete_job(db, job)
        except Exception as e:
            logger.exception(f"Parse job {job_id} failed for match {match_id}")
            db.rollback()
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if match is not None and job is not None and job.attempts >= job.max_attempts:
                match.status = MatchStatus.FAILED
                match.error_message = str(e)[:2000]
                db.commit()
            if job is not None:
                fail_job(db, job, str(e))


def _run_coach(job_id: int, match_id: str) -> None:
    """Docstring for _run_coach."""
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        try:
            from agents.khan import analyse_match  # noqa: PLC0415

            analyse_match(match_id)
            complete_job(db, job)
        except Exception as e:
            logger.exception(f"Coach job {job_id} failed for match {match_id}")
            db.rollback()
            if job is not None:
                fail_job(db, job, str(e))


def main() -> None:
    """Docstring for main."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    worker_id = _worker_id()
    _start_health_server()
    Base.metadata.create_all(engine)  # no-op when tables exist
    logger.info(f"Worker {worker_id} starting (coach concurrency {COACH_CONCURRENCY})")

    coach_pool = ThreadPoolExecutor(max_workers=COACH_CONCURRENCY, thread_name_prefix="coach")
    iterations = 0

    while True:
        iterations += 1
        claimed_any = False

        with SessionLocal() as db:
            if iterations % STUCK_SWEEP_EVERY == 0:
                requeue_stuck_jobs(db)

            parse_job = claim_next_job(db, JobKind.PARSE, worker_id)
            if parse_job is not None:
                claimed_any = True
                job_id, match_id = parse_job.id, parse_job.match_id

        if claimed_any:
            _run_parse(job_id, match_id)

        with SessionLocal() as db:
            coach_job = claim_next_job(db, JobKind.COACH, worker_id)
            if coach_job is not None:
                claimed_any = True
                coach_pool.submit(_run_coach, coach_job.id, coach_job.match_id)

        # Drain one Discord sync-outbox item per loop (module 3): HTTP
        # handlers only insert; a Discord outage never blocks a response.
        claimed_any = _drain_outbox(worker_id) or claimed_any

        if not claimed_any:
            time.sleep(POLL_INTERVAL_SECONDS)


def _drain_outbox(worker_id: str) -> bool:
    """Docstring for _drain_outbox."""
    from db.outbox import claim_next, complete, fail  # noqa: PLC0415

    with SessionLocal() as db:
        item = claim_next(db, worker_id)
        if item is None:
            return False
        try:
            from services.discord_bot.sync import process_outbox_item  # noqa: PLC0415

            process_outbox_item(db, item)
            complete(db, item)
        except Exception as e:
            logger.exception(f"Outbox item {item.id} ({item.kind}) failed")
            db.rollback()
            fail(db, item, str(e))
    return True


if __name__ == "__main__":
    main()
