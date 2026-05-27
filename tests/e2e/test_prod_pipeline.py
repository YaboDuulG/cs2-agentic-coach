import os
import sys
import time

import requests


def run_e2e_test(api_url: str, demo_path: str, user_id: str):
    print(f"Starting E2E test against {api_url}")
    print(f"Target demo: {demo_path}")

    if not os.path.exists(demo_path):
        print(f"ERROR: Demo file not found at {demo_path}")
        sys.exit(1)

    file_size = os.path.getsize(demo_path)
    filename = os.path.basename(demo_path)

    # 1. Presign Upload URL
    print("\n[1/4] Requesting presigned URL...")
    headers = {"x-clerk-user-id": user_id, "Content-Type": "application/json"}
    presign_res = requests.post(
        f"{api_url}/api/upload/presign",
        headers=headers,
        json={"filename": filename, "size_bytes": file_size},
    )

    if not presign_res.ok:
        print(f"ERROR: Presign failed with {presign_res.status_code}")
        print(presign_res.text)
        sys.exit(1)

    data = presign_res.json()
    match_id = data["match_id"]
    upload_url = data["upload_url"]
    print(f"SUCCESS: Match ID {match_id}")

    # 2. Upload to GCS
    print("\n[2/4] Uploading to GCS...")
    with open(demo_path, "rb") as f:
        upload_res = requests.put(
            upload_url, headers={"Content-Type": "application/octet-stream"}, data=f
        )

    if not upload_res.ok:
        print(f"ERROR: GCS Upload failed with {upload_res.status_code}")
        sys.exit(1)
    print("SUCCESS: Demo uploaded.")

    # 3. Poll for parsing completion
    print("\n[3/4] Polling for parse completion (Scout)...")
    max_retries = 60  # 60 * 5s = 5 minutes

    for i in range(max_retries):
        time.sleep(5)
        status_res = requests.get(f"{api_url}/api/jobs/{match_id}?user_id={user_id}")
        if not status_res.ok:
            continue

        status_data = status_res.json()
        status = status_data.get("status")
        sys.stdout.write(f"\rStatus: {status} ({i * 5}s)       ")
        sys.stdout.flush()

        if status == "failed":
            print(f"\nERROR: Parse failed! {status_data.get('error')}")
            sys.exit(1)

        if status == "done":
            print(f"\nSUCCESS: Parse complete. Total rounds: {status_data.get('total_rounds')}")
            break
    else:
        print("\nERROR: Timeout waiting for parse to complete.")
        sys.exit(1)

    # 4. Poll for Great Khan Coaching Notes
    print("\n[4/4] Polling for AI Coaching Notes (Great Khan)...")
    for i in range(12):  # 12 * 5s = 60 seconds for AI
        time.sleep(5)
        coach_res = requests.get(f"{api_url}/api/coaching/{match_id}?user_id={user_id}")
        if not coach_res.ok:
            continue

        coach_data = coach_res.json()
        if coach_data.get("status") == "ready":
            coaching = coach_data.get("coaching", {})
            print("\nSUCCESS: AI Coaching Generated!")
            print(f"Summary: {coaching.get('summary')}")
            break

        sys.stdout.write(f"\rCoaching status: {coach_data.get('status')} ({i * 5}s)       ")
        sys.stdout.flush()
    else:
        print("\nERROR: Timeout waiting for Great Khan coaching.")
        sys.exit(1)

    print("\n🎉 E2E Pipeline Test Passed Successfully!")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True, help="Base URL of the live API")
    parser.add_argument("--demo", required=True, help="Path to the local .dem file")
    parser.add_argument("--user-id", default="e2e-test-user", help="Mock user ID")
    args = parser.parse_args()

    run_e2e_test(args.api_url, args.demo, args.user_id)
