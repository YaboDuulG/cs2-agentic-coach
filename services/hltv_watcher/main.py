"""
DemoSage — HLTV Scraper Watcher Service
========================================
Runs nightly/scheduled to fetch new pro matches from HLTV via Apify,
downloads demos, uploads them to GCS, and inserts pending match records.

Usage:
    python services/hltv_watcher/main.py --mode scheduled
    python services/hltv_watcher/main.py --mode manual
"""

import argparse
import json
import logging
import os
import sys
import tempfile
import time
from pathlib import Path
import requests

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("hltv_watcher")

# Ensure project root is in path
REPO_ROOT = Path(__file__).parent.parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

from db.database import SessionLocal
from db.models import Match, MatchStatus

MOCK_PRO_MATCHES = [
    {
        "match_id": "hltv-mock-match-999",
        "map_name": "de_dust2",
        "team_a": "Natus Vincere",
        "team_b": "FaZe Clan",
        "demo_url": "https://storage.googleapis.com/cs2-demosage-public/demos/de_dust2_test.dem"
    }
]

def _get_gcs_client():
    from google.cloud import storage
    return storage.Client()

def upload_to_gcs(file_path: Path, gcs_path: str) -> str:
    """Upload a file to Google Cloud Storage and return gs:// URI."""
    bucket_name = os.environ.get("GCS_BUCKET", "").strip()
    if not bucket_name:
        raise ValueError("GCS_BUCKET environment variable is not set.")
    
    client = _get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(gcs_path)
    blob.upload_from_filename(str(file_path))
    return f"gs://{bucket_name}/{gcs_path}"

def extract_demo_file(archive_path: Path, extract_dir: Path) -> Path | None:
    """Extracts .dem file from .rar, .zip, or .gz archive."""
    suffix = archive_path.suffix.lower()
    
    if suffix == ".dem":
        return archive_path
        
    if suffix == ".zip":
        import zipfile
        with zipfile.ZipFile(archive_path, 'r') as zip_ref:
            for file_info in zip_ref.infolist():
                if file_info.filename.endswith(".dem"):
                    zip_ref.extract(file_info, extract_dir)
                    return extract_dir / file_info.filename
                    
    elif suffix == ".rar":
        import subprocess
        # Try system 'unrar'
        try:
            subprocess.run(["unrar", "x", "-o+", str(archive_path), str(extract_dir)], check=True, stdout=subprocess.DEVNULL)
            for p in extract_dir.glob("**/*.dem"):
                return p
        except Exception:
            try:
                # Fallback to 7z
                subprocess.run(["7z", "x", f"-o{extract_dir}", str(archive_path), "-y"], check=True, stdout=subprocess.DEVNULL)
                for p in extract_dir.glob("**/*.dem"):
                    return p
            except Exception as e:
                logger.warning(f"Could not extract rar file via unrar or 7z: {e}")
                
    elif suffix == ".gz":
        import gzip
        out_path = extract_dir / archive_path.stem
        with gzip.open(archive_path, 'rb') as f_in:
            with open(out_path, 'wb') as f_out:
                import shutil
                shutil.copyfileobj(f_in, f_out)
        if out_path.exists():
            return out_path
            
    return None

def process_match_demo(match_id: str, demo_url: str) -> str | None:
    """Downloads, extracts, and uploads demo to GCS. Returns GCS URI."""
    logger.info(f"Downloading demo from: {demo_url}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        
        # Download archive
        r = requests.get(demo_url, stream=True)
        r.raise_for_status()
        
        # Extract filename from headers or URL
        filename = "match.dem"
        if "content-disposition" in r.headers:
            cd = r.headers["content-disposition"]
            import re
            filenames = re.findall("filename=(.+)", cd)
            if filenames:
                filename = filenames[0].strip('"')
        else:
            filename = demo_url.split("/")[-1].split("?")[0] or filename
            
        archive_path = temp_dir_path / filename
        with open(archive_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
                
        # Extract
        logger.info(f"Extracting demo from: {filename}")
        dem_file_path = extract_demo_file(archive_path, temp_dir_path)
        if not dem_file_path or not dem_file_path.exists():
            logger.error("Failed to extract .dem file from archive.")
            return None
            
        # Upload
        gcs_path = f"demos/raw/{match_id}/{dem_file_path.name}"
        logger.info(f"Uploading {dem_file_path.name} to GCS...")
        gcs_uri = upload_to_gcs(dem_file_path, gcs_path)
        return gcs_uri

def fetch_apify_matches(api_token: str, actor_id: str) -> list[dict]:
    """Call Apify API to run HLTV scraper actor and get results."""
    logger.info(f"Triggering Apify HLTV actor: {actor_id}")
    
    run_url = f"https://api.apify.com/v2/acts/{actor_id}/runs?token={api_token}"
    # Standard actor config parameters (e.g. limit to last 5 matches)
    res = requests.post(run_url, json={"maxMatches": 5})
    res.raise_for_status()
    run_data = res.json()["data"]
    run_id = run_data["id"]
    
    logger.info(f"Apify run initiated. Run ID: {run_id}. Polling for completion...")
    
    status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={api_token}"
    for attempt in range(30):  # Wait up to 5 minutes
        status_res = requests.get(status_url)
        status_res.raise_for_status()
        run_status = status_res.json()["data"]["status"]
        logger.info(f"Apify Status: {run_status} (attempt {attempt + 1}/30)")
        if run_status == "SUCCEEDED":
            break
        elif run_status in ("FAILED", "ABORTED", "TIMED-OUT"):
            raise RuntimeError(f"Apify actor run failed with status: {run_status}")
        time.sleep(10)
    else:
        raise TimeoutError("Apify actor run timed out after 5 minutes.")
        
    dataset_url = f"https://api.apify.com/v2/actor-runs/{run_id}/dataset/items?token={api_token}"
    dataset_res = requests.get(dataset_url)
    dataset_res.raise_for_status()
    items = dataset_res.json()
    return items

def main(args: list[str] | None = None):
    parser = argparse.ArgumentParser(description="DemoSage HLTV Watcher & Crawler")
    parser.add_argument("--mode", choices=["scheduled", "manual"], default="scheduled", help="Ingestion run mode")
    parsed_args = parser.parse_args(args)

    api_token = os.environ.get("APIFY_API_TOKEN")
    actor_id = os.environ.get("APIFY_HLTV_ACTOR_ID")
    gcs_bucket = os.environ.get("GCS_BUCKET")
    
    db = SessionLocal()
    new_matches_count = 0
    
    try:
        if not api_token or not actor_id:
            logger.warning("APIFY_API_TOKEN or APIFY_HLTV_ACTOR_ID is missing. Falling back to MOCK mode.")
            matches_to_process = MOCK_PRO_MATCHES
            mock_mode = True
        else:
            try:
                matches_to_process = fetch_apify_matches(api_token, actor_id)
                mock_mode = False
            except Exception as e:
                logger.error(f"Failed to fetch matches from Apify: {e}. Falling back to MOCK mode.")
                matches_to_process = MOCK_PRO_MATCHES
                mock_mode = True

        for m in matches_to_process:
            # Normalize keys
            match_id = str(m.get("match_id") or m.get("id") or m.get("matchId"))
            map_name = m.get("map_name") or m.get("map") or "de_dust2"
            demo_url = m.get("demo_url") or m.get("demoUrl")
            
            if not match_id or not demo_url:
                logger.warning(f"Skipping malformed scraped match item: {m}")
                continue
                
            # Check if match already exists
            existing = db.query(Match).filter(Match.match_id == match_id).first()
            if existing:
                logger.info(f"Match {match_id} already exists in DB. Skipping.")
                continue
                
            # Process demo
            if mock_mode or not gcs_bucket:
                logger.info(f"[MOCK] Registering match {match_id} without actual download/upload.")
                # For mock testing, register with public demo URL or placeholder
                gcs_demo_uri = "gs://cs2-demosage-public/demos/de_dust2_test.dem"
            else:
                try:
                    gcs_demo_uri = process_match_demo(match_id, demo_url)
                except Exception as e:
                    logger.error(f"Failed to download/upload demo for match {match_id}: {e}")
                    continue
                    
            if not gcs_demo_uri:
                continue

            # Create pending match record
            match_record = Match(
                match_id=match_id,
                map_name=map_name,
                status=MatchStatus.PENDING,
                demo_filename=demo_url.split("/")[-1].split("?")[0] or f"{match_id}.dem",
                gcs_demo_uri=gcs_demo_uri
            )
            db.add(match_record)
            new_matches_count += 1
            logger.info(f"Registered new pending match {match_id} | Map: {map_name}")
            
        db.commit()
        logger.info(f"HLTV watcher completed. Registered {new_matches_count} new match(es).")
        
        # Write to GITHUB_OUTPUT for github actions step linking
        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a") as f:
                f.write(f"new_matches={new_matches_count}\n")
                
    finally:
        db.close()

if __name__ == "__main__":
    main()
