"""
Free Local HLTV Scraper
=======================
Uses async Playwright to spin up a headless browser,
bypass Cloudflare, and scrape recent match demo download URLs asynchronously.

Prerequisites:
    pip install playwright
    playwright install chromium

Usage:
    python services/hltv_watcher/free_scraper.py
"""

import asyncio
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

try:
    from playwright.async_api import async_playwright
except ImportError:
    logger.error(
        "Playwright not installed. Please run: pip install playwright && playwright install"
    )
    sys.exit(1)


async def scrape_recent_matches(limit: int = 5) -> list[dict]:
    """Uses async Playwright to scrape the latest completed match results and demo links."""
    logger.info("Starting async Playwright browser...")
    results = []

    async with async_playwright() as p:
        # Launch browser with standard user-agent and headers to bypass simple detection
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            logger.info("Navigating to HLTV results page...")
            await page.goto("https://www.hltv.org/results", wait_until="domcontentloaded", timeout=60000)

            # Wait for results elements to appear
            await page.wait_for_selector(".results-all", timeout=15000)

            # Get recent match links
            match_links = await page.locator(".results-all a.a-reset").evaluate_all(
                "nodes => nodes.map(n => n.href)"
            )

            # Take only the latest K links
            match_urls = match_links[:limit]
            logger.info(f"Found {len(match_urls)} recent match URLs to inspect.")

            for url in match_urls:
                try:
                    logger.info(f"Visiting match page: {url}")
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)

                    # Parse Match ID from URL
                    match_id = url.split("/matches/")[-1].split("/")[0]

                    # Parse Map
                    map_el = page.locator(".mapname").first
                    count = await map_el.count()
                    if count > 0:
                        map_name = (await map_el.text_content()).strip().lower()
                    else:
                        map_name = "de_dust2"
                    
                    if not map_name.startswith("de_"):
                        map_name = "de_" + map_name

                    # Find the "GOTV Demo" download link
                    demo_link_el = page.locator("a[href*='/download/demo/']")
                    count_demo = await demo_link_el.count()
                    if count_demo == 0:
                        logger.warning(
                            f"No demo download link found for match {match_id}. Skipping."
                        )
                        continue

                    demo_url = await demo_link_el.first.get_attribute("href")
                    if demo_url and not demo_url.startswith("http"):
                        demo_url = "https://www.hltv.org" + demo_url

                    logger.info(f"Extracted Match {match_id} | Map: {map_name} | Demo URL: {demo_url}")
                    results.append({
                        "match_id": f"hltv-{match_id}-{map_name.replace('de_', '')}",
                        "map_name": map_name,
                        "demo_url": demo_url
                    })
                    
                    # Polite rate limiting
                    await asyncio.sleep(2)
                except Exception as e:
                    logger.error(f"Failed to process match page {url}: {e}")

        except Exception as e:
            logger.error(f"Failed to scrape HLTV results: {e}")
        finally:
            await browser.close()

    return results

if __name__ == "__main__":
    matches = asyncio.run(scrape_recent_matches(limit=3))
    print(matches)
                    )
                    results.append(
                        {"match_id": f"hltv-{match_id}", "map_name": map_name, "demo_url": demo_url}
                    )
                except Exception as ex:
                    logger.error(f"Failed parsing match URL {url}: {ex}")
                    continue

        except Exception as e:
            logger.error(f"Error scraping HLTV results: {e}")
        finally:
            browser.close()

    return results


def main():
    """Docstring for main."""
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
                logger.info(
                    f"[Local Mode] Registering match {match_id} using public placeholder demo."
                )
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
                gcs_demo_uri=gcs_demo_uri,
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
