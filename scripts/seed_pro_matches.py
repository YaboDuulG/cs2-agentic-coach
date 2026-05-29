"""
Initial Seeding Script for Pro Matches
=======================================
Scrapes HLTV results for the 6 target teams from the last 6 months,
downloads the match demos, parses them via Scout, writes them to the DB,
and indexes their summaries and rounds in the RAG knowledge base.

Usage:
    # Run normal seeding (requires Playwright and Chromium)
    python scripts/seed_pro_matches.py --limit-per-team 2

    # Run mock seeding using local DemolitionNuke.dem file for local testing
    python scripts/seed_pro_matches.py --mock --mock-demo demos/DemolitionNuke.dem
"""

import argparse
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import sys
import tempfile
import time

from dotenv import load_dotenv
import requests

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed_pro_matches")

# Add project root to path
REPO_ROOT = Path(__file__).parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.database import SessionLocal
from db.models import Match
from scripts.update_knowledge_base import ingest_match
from services.hltv_watcher.main import extract_demo_file, upload_to_gcs
from services.scout.parse_demo import parse_demo, write_to_db

TARGET_TEAMS = {
    "9565": "Vitality",
    "4608": "Natus Vincere",
    "7020": "Team Spirit",
    "11259": "Team Falcons",
    "8297": "FURIA Esports",
    "6248": "The MongolZ",
}


def scrape_team_matches(page, team_id: str, team_name: str, limit_per_team: int) -> list[dict]:
    """Scrape recent completed matches for a team from the last 6 months."""
    url = f"https://www.hltv.org/results?team={team_id}"
    logger.info(f"Navigating to results page for {team_name} (ID: {team_id}): {url}")

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector(".results-all", timeout=20000)
    except Exception as e:
        logger.error(f"Failed to load results page for {team_name}: {e}")
        return []

    # Get match result links
    match_links = page.locator(".results-all a.a-reset").evaluate_all(
        "nodes => nodes.map(n => n.href)"
    )
    logger.info(f"Found {len(match_links)} match URLs on results page for {team_name}.")

    six_months_ago_ms = int((time.time() - (6 * 30 * 24 * 3600)) * 1000)
    valid_matches = []

    for m_url in match_links:
        if len(valid_matches) >= limit_per_team:
            break

        try:
            # Parse Match ID from URL (e.g. /matches/2370012/astralis-vs-vitality)
            match_id = m_url.split("/matches/")[-1].split("/")[0]

            # Check if we already have this match in the database
            db = SessionLocal()
            try:
                # Bo3 matches are parsed as hltv-{match_id}-{map_name}
                existing = db.query(Match).filter(Match.match_id.like(f"hltv-{match_id}-%")).first()
                if existing:
                    logger.info(f"Match {match_id} already exists in DB. Skipping.")
                    continue
            finally:
                db.close()

            logger.info(f"Visiting match page: {m_url}")
            page.goto(m_url, wait_until="domcontentloaded", timeout=30000)

            # Check date limit
            date_el = page.locator(".date")
            if date_el.count() == 0:
                logger.warning(f"No date found for match {match_id}. Skipping.")
                continue

            unix_time_str = date_el.first.get_attribute("data-unix")
            if not unix_time_str:
                continue

            unix_time = int(unix_time_str)
            if unix_time < six_months_ago_ms:
                logger.info(f"Match {match_id} is older than 6 months. Stopping search for {team_name}.")
                break

            # Parse Team Names
            t1_el = page.locator(".team1-gradient .teamName")
            t2_el = page.locator(".team2-gradient .teamName")
            if t1_el.count() == 0 or t2_el.count() == 0:
                logger.warning(f"Could not parse team names for match {match_id}. Skipping.")
                continue

            team1 = t1_el.first.text_content().strip()
            team2 = t2_el.first.text_content().strip()

            # Parse Event Name
            event_el = page.locator(".event")
            event_name = "Pro Tournament"
            if event_el.count() > 0:
                event_name = event_el.first.text_content().strip()

            # Parse Year
            year = datetime.fromtimestamp(unix_time / 1000, tz=timezone.utc).year

            # Format match name
            match_name = f"{team1} vs {team2} ({event_name} - {year})"

            # Find demo download link
            demo_link_el = page.locator("a[href*='/download/demo/']")
            if demo_link_el.count() == 0:
                logger.warning(f"No demo download link found for {match_name}. Skipping.")
                continue

            demo_url = demo_link_el.first.get_attribute("href")
            if demo_url and not demo_url.startswith("http"):
                demo_url = "https://www.hltv.org" + demo_url

            valid_matches.append({
                "match_id": match_id,
                "match_name": match_name,
                "demo_url": demo_url
            })
            logger.info(f"Valid match found: {match_name} | Demo URL: {demo_url}")

        except Exception as ex:
            logger.error(f"Error processing match page {m_url}: {ex}")
            continue

    return valid_matches


def download_and_process_match(match: dict, api_key: str):
    """Download demo zip/rar archive, extract .dem files, parse and index them."""
    match_id = match["match_id"]
    match_name = match["match_name"]
    demo_url = match["demo_url"]

    logger.info(f"Downloading demo for {match_name}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        try:
            r = requests.get(demo_url, headers=headers, stream=True, timeout=60)
            r.raise_for_status()
        except Exception as e:
            logger.error(f"Failed to download demo from {demo_url}: {e}")
            return

        # Get filename
        filename = "demo.zip"
        if "content-disposition" in r.headers:
            import re
            cd = r.headers["content-disposition"]
            filenames = re.findall("filename=(.+)", cd)
            if filenames:
                filename = filenames[0].strip('"')
        else:
            filename = demo_url.split("/")[-1].split("?")[0] or filename

        archive_path = temp_dir_path / filename
        with open(archive_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

        logger.info(f"Extracting demos from {filename}...")
        dem_files = []

        # Extract
        suffix = archive_path.suffix.lower()
        if suffix == ".dem":
            dem_files.append(archive_path)
        else:
            # Try zip, rar, gz extraction
            extract_demo_file(archive_path, temp_dir_path)
            dem_files = list(temp_dir_path.glob("**/*.dem"))

        if not dem_files:
            logger.error(f"No .dem files found in archive for match {match_id}.")
            return

        logger.info(f"Found {len(dem_files)} map demo(s) to parse.")

        for dem_file in dem_files:
            try:
                logger.info(f"Parsing demo: {dem_file.name}")
                # Parse demo file
                parsed_data = parse_demo(str(dem_file))
                map_name = parsed_data.get("metadata", {}).get("map", "unknown")

                # Build a unique match ID per map
                map_match_id = f"hltv-{match_id}-{map_name}"

                # Write parsed demo to database
                logger.info(f"Saving parsed data to DB for {map_match_id}...")
                write_to_db(parsed_data, map_match_id, match_name=match_name)

                # Upload to GCS if configured
                gcs_bucket = os.environ.get("GCS_BUCKET")
                if gcs_bucket:
                    try:
                        gcs_path = f"demos/raw/{map_match_id}/{dem_file.name}"
                        logger.info(f"Uploading {dem_file.name} to GCS...")
                        gcs_uri = upload_to_gcs(dem_file, gcs_path)

                        # Update match record with GCS URI
                        db = SessionLocal()
                        try:
                            match_record = db.get(Match, map_match_id)
                            if match_record:
                                match_record.gcs_demo_uri = gcs_uri
                                db.commit()
                        finally:
                            db.close()
                    except Exception as gcs_err:
                        logger.error(f"Failed to upload demo to GCS: {gcs_err}")

                # Index in RAG knowledge base
                logger.info(f"Generating RAG embeddings for {map_match_id}...")
                db = SessionLocal()
                try:
                    ingest_match(db, map_match_id, api_key)
                finally:
                    db.close()

            except Exception as parse_err:
                logger.error(f"Error parsing/indexing demo {dem_file.name}: {parse_err}")
                continue


def main():
    parser = argparse.ArgumentParser(description="DemoSage HLTV Pro Seeding Script")
    parser.add_argument("--limit-per-team", type=int, default=3, help="Max matches to scrape per team")
    parser.add_argument("--mock", action="store_true", help="Run in mock mode using a local demo file")
    parser.add_argument("--mock-demo", type=str, default="demos/DemolitionNuke.dem", help="Path to local demo file for mock mode")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured.")
        sys.exit(1)

    if args.mock:
        # Mock mode execution
        logger.info("Executing initial seeding in MOCK mode...")
        mock_demo_path = Path(args.mock_demo)
        if not mock_demo_path.exists():
            logger.error(f"Mock demo file not found: {mock_demo_path}")
            sys.exit(1)

        mock_match = {
            "match_id": "mock-vitality-spirit",
            "match_name": "Vitality vs Spirit (IEM Rio - 2026)",
            "demo_url": ""  # local file
        }

        # Parse local demo file
        try:
            logger.info(f"Parsing mock demo file: {mock_demo_path}")
            parsed_data = parse_demo(str(mock_demo_path))
            map_name = parsed_data.get("metadata", {}).get("map", "de_nuke")

            map_match_id = f"hltv-{mock_match['match_id']}-{map_name}"

            # Write to database
            logger.info("Writing parsed mock data to DB...")
            write_to_db(parsed_data, map_match_id, match_name=mock_match["match_name"])

            # Index in RAG knowledge base
            logger.info("Generating RAG embeddings for mock match...")
            db = SessionLocal()
            try:
                ingest_match(db, map_match_id, api_key)
            finally:
                db.close()

            logger.info("Mock seeding successfully completed.")
        except Exception as ex:
            logger.error(f"Failed mock seeding: {ex}")
            sys.exit(1)

        return

    # Normal mode: Playwright scraping
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("Playwright not installed. Playwright is required for normal mode.")
        sys.exit(1)

    logger.info("Starting Playwright browser...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        scraped_matches = []
        for team_id, team_name in TARGET_TEAMS.items():
            logger.info(f"=== Scraping matches for team: {team_name} ===")
            matches = scrape_team_matches(page, team_id, team_name, args.limit_per_team)
            scraped_matches.extend(matches)

        browser.close()

    logger.info(f"Total unique matches scraped across all teams: {len(scraped_matches)}")

    # Process all matches
    for idx, match in enumerate(scraped_matches):
        logger.info(f"=== Processing Match {idx + 1}/{len(scraped_matches)}: {match['match_name']} ===")
        download_and_process_match(match, api_key)

    logger.info("HLTV seeding completed.")


if __name__ == "__main__":
    main()
