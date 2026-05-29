"""
Free Local HLTV Scraper
=======================
Alternative to paid Apify actors. Uses Playwright to spin up a local browser,
bypass Cloudflare, and scrape recent match demo download URLs.

Prerequisites:
    pip install playwright
    playwright install chromium

Usage:
    python services/hltv_watcher/free_scraper.py
"""

import logging
import os
from pathlib import Path
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("free_scraper")

# Ensure project root is in path
REPO_ROOT = Path(__file__).parent.parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.database import SessionLocal
from db.models import Match, MatchStatus

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    logger.error("Playwright not installed. Please run: pip install playwright && playwright install")
    sys.exit(1)


def scrape_recent_matches(limit: int = 5) -> list[dict]:
    """Uses Playwright to scrape the latest completed match results and demo links."""
    logger.info("Starting local Playwright browser...")
    results = []

    with sync_playwright() as p:
        # Launch browser with standard user-agent and headers to bypass simple detection
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        try:
            logger.info("Navigating to HLTV results page...")
            page.goto("https://www.hltv.org/results", wait_until="domcontentloaded", timeout=60000)

            # Wait for results elements to appear
            page.wait_for_selector(".results-all", timeout=15000)

            # Get recent match links
            match_links = page.locator(".results-all a.a-reset").evaluate_all(
                "nodes => nodes.map(n => n.href)"
            )

            # Take only the latest K links
            match_urls = match_links[:limit]
            logger.info(f"Found {len(match_urls)} recent match URLs to inspect.")

            for url in match_urls:
                try:
                    logger.info(f"Visiting match page: {url}")
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)

                    # Parse Match ID from URL (e.g. /matches/2370012/astralis-vs-vitality)
                    match_id = url.split("/matches/")[-1].split("/")[0]

                    # Parse Map
                    # Matches page can list multiple maps. We look for completed maps.
                    map_el = page.locator(".mapname").first
                    map_name = map_el.text_content().strip().lower() if map_el.count() > 0 else "de_dust2"
                    if not map_name.startswith("de_"):
                        map_name = "de_" + map_name

                    # Find the "GOTV Demo" download link
                    demo_link_el = page.locator("a[href*='/download/demo/']")
                    if demo_link_el.count() == 0:
                        logger.warning(f"No demo download link found for match {match_id}. Skipping.")
                        continue

                    demo_url = demo_link_el.first.get_attribute("href")
                    if demo_url and not demo_url.startswith("http"):
                        demo_url = "https://www.hltv.org" + demo_url

                    logger.info(f"Extracted Match {match_id} | Map: {map_name} | Demo URL: {demo_url}")
                    results.append({
                        "match_id": f"hltv-{match_id}",
                        "map_name": map_name,
                        "demo_url": demo_url
                    })
                except Exception as ex:
                    logger.error(f"Failed parsing match URL {url}: {ex}")
                    continue

        except Exception as e:
            logger.error(f"Error scraping HLTV results: {e}")
        finally:
            browser.close()

    return results


def main():
    logger.info("Executing Free Local HLTV Scraper...")
    matches = scrape_recent_matches(limit=3)

    if not matches:
        logger.warning("No matches scraped. Exiting.")
        return

    db = SessionLocal()
    new_matches = 0

    try:
        gcs_bucket = os.environ.get("GCS_BUCKET")
        from services.hltv_watcher.main import process_match_demo  # noqa: PLC0415

        for m in matches:
            match_id = m["match_id"]
            map_name = m["map_name"]
            demo_url = m["demo_url"]

            # Check if match already exists in database
            existing = db.query(Match).filter(Match.match_id == match_id).first()
            if existing:
                logger.info(f"Match {match_id} already exists in DB. Skipping.")
                continue

            # Process / download / upload demo to GCS
            if not gcs_bucket:
                logger.info(f"[Local Mode] Registering match {match_id} using public placeholder demo.")
                gcs_demo_uri = "gs://cs2-demosage-public/demos/de_dust2_test.dem"
            else:
                try:
                    gcs_demo_uri = process_match_demo(match_id, demo_url)
                except Exception as ex:
                    logger.error(f"Failed to process demo for {match_id}: {ex}")
                    continue

            if not gcs_demo_uri:
                continue

            match_record = Match(
                match_id=match_id,
                map_name=map_name,
                status=MatchStatus.PENDING,
                demo_filename=f"{match_id}.dem",
                gcs_demo_uri=gcs_demo_uri
            )
            db.add(match_record)
            new_matches += 1
            logger.info(f"Registered new pending match {match_id} | Map: {map_name}")

        db.commit()
        logger.info(f"Free HLTV scraper completed. Registered {new_matches} new match(es).")

        # Write to GITHUB_OUTPUT for github actions step linking
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a") as f:
                f.write(f"new_matches={new_matches}\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
