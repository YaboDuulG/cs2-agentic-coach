import asyncio
import logging
import re
from typing import List
import uuid

from bs4 import BeautifulSoup

try:
    from playwright.async_api import async_playwright
except ImportError:
    raise RuntimeError("playwright is required for the HLTV Crawler. Run: pip install playwright")

from agents.state import MatchState

logger = logging.getLogger("hltv_crawler")
logger.setLevel(logging.INFO)

class HLTVCrawler:
    """
    Modernized HLTV Crawler using async Playwright for Cloudflare evasion,
    rate-limiting, and clean HTML parsing. Connects directly to LangGraph MatchState.
    """
    def __init__(self, base_url: str = "https://www.hltv.org", max_concurrent: int = 2):
        self.base_url = base_url
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def fetch_page(self, context, url: str) -> str:
        async with self.semaphore:
            logger.info(f"Fetching {url}")
            page = await context.new_page()
            try:
                # Add human-like delays for rate limiting
                await asyncio.sleep(2)
                await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                # Wait to ensure Cloudflare challenge passes if present
                await page.wait_for_timeout(3000)
                content = await page.content()
                return content
            except Exception as e:
                logger.error(f"Failed to fetch {url}: {e}")
                return ""
            finally:
                await page.close()

    async def crawl_recent_matches(self, limit: int = 5) -> List[MatchState]:
        """
        Crawls recent HLTV results and maps the extracted demo matches
        directly into the LangGraph MatchState schema.
        """
        states: List[MatchState] = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            try:
                results_url = f"{self.base_url}/results"
                html = await self.fetch_page(context, results_url)
                if not html:
                    return states

                soup = BeautifulSoup(html, "html.parser")
                match_links = []
                for a in soup.select(".results-all a.a-reset"):
                    href = a.get("href")
                    if href:
                        match_links.append(self.base_url + href)

                match_urls = match_links[:limit]

                for url in match_urls:
                    match_html = await self.fetch_page(context, url)
                    if not match_html:
                        continue

                    match_soup = BeautifulSoup(match_html, "html.parser")

                    # Parse Match ID from URL
                    match_id_match = re.search(r'/matches/(\d+)/', url)
                    hltv_id = match_id_match.group(1) if match_id_match else str(uuid.uuid4())

                    # Parse Map
                    map_el = match_soup.select_one(".mapname")
                    map_name = map_el.text.strip().lower() if map_el else "de_dust2"
                    if not map_name.startswith("de_"):
                        map_name = "de_" + map_name

                    # Parse Demo Link
                    demo_el = match_soup.select_one("a[href*='/download/demo/']")
                    if not demo_el:
                        logger.warning(f"No demo link found for {url}")
                        continue

                    demo_url = demo_el.get("href")
                    if demo_url and not demo_url.startswith("http"):
                        demo_url = self.base_url + demo_url

                    # Generate standard MatchState schema payload
                    match_state: MatchState = {
                        "match_id": f"hltv-{hltv_id}-{map_name.replace('de_', '')}",
                        "user_query": f"Analyze pro match on {map_name}",
                        "session_id": str(uuid.uuid4()),
                        "intent": "tactical_analysis",
                        "active_agents": [],
                        "errors": [],
                        "hallucination_flags": [],
                    }
                    # We can store the demo_url in scout_output temporarily or just yield the state
                    # for the orchestrator queue.

                    logger.info(f"Generated MatchState for {match_state['match_id']}")
                    states.append(match_state)

            finally:
                await browser.close()

        return states

if __name__ == "__main__":
    crawler = HLTVCrawler()
    results = asyncio.run(crawler.crawl_recent_matches(limit=2))
    print(results)
