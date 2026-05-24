"""
GCP setup script for DemoSage.
Runs all gcloud commands needed to provision the project from scratch.

Usage:
    python scripts/setup_gcp.py

Prerequisites:
    - gcloud CLI installed and authenticated (gcloud auth login)
    - Billing account linked (must be done manually in GCP console)
    - .env file populated with at minimum: GCP_PROJECT_ID, GCP_REGION, DB_PASSWORD

What this script provisions:
    1. Creates the GCP project
    2. Links to billing (reminder — must be done manually)
    3. Enables required APIs
    4. Creates service account + key
    5. Provisions Cloud SQL (PostgreSQL 15, db-f1-micro)
    6. Creates database + user + enables pgvector
    7. Creates GCS bucket
    8. Creates Cloud Tasks queue
"""

import os
from pathlib import Path
import subprocess
import sys

from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "demosage")
REGION = os.getenv("GCP_REGION", "us-central1")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_INSTANCE = "demosage-db"
DB_NAME = "demosage"
DB_USER = "demosage_user"
GCS_BUCKET = os.getenv("GCS_BUCKET", "cs2-demosage")
TASKS_QUEUE = os.getenv("CLOUD_TASKS_QUEUE", "demosage-scan-queue")
PUBSUB_TOPIC = "demo-uploaded"
PUBSUB_SUBSCRIPTION = "demo-uploaded-scout-push"
SA_NAME = "demosage-dev"
KEY_PATH = Path("infra/gcp-key.json")


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a shell command, printing it first.

    Uses shell=True on all platforms so Windows can resolve gcloud.cmd,
    kubectl.cmd and other .cmd wrappers that subprocess can't find directly.
    """
    cmd_str = " ".join(cmd)
    print(f"\n$ {cmd_str}")
    return subprocess.run(cmd_str, check=check, capture_output=False, shell=True)


def main() -> None:
    if not DB_PASSWORD:
        print("ERROR: DB_PASSWORD must be set in .env before running setup.")
        sys.exit(1)

    print("=" * 60)
    print("DemoSage — GCP Project Setup")
    print("=" * 60)

    # --- 1. Create project ---
    print("\n[1/8] Creating GCP project...")
    run(["gcloud", "projects", "create", PROJECT_ID, "--name=DemoSage"], check=False)
    run(["gcloud", "config", "set", "project", PROJECT_ID])

    # --- 2. Billing reminder ---
    print("\n[2/8] ** Billing must be linked manually:")
    print(f"      -> https://console.cloud.google.com/billing/linkedaccount?project={PROJECT_ID}")
    input("      Press Enter once billing is linked...")

    # --- 3. Enable APIs ---
    print("\n[3/8] Enabling required APIs...")
    run(
        [
            "gcloud",
            "services",
            "enable",
            "sqladmin.googleapis.com",
            "storage.googleapis.com",
            "cloudtasks.googleapis.com",
            "run.googleapis.com",
            "aiplatform.googleapis.com",
            "cloudbuild.googleapis.com",
            "artifactregistry.googleapis.com",  # Required for gcr.io / docker push
            "secretmanager.googleapis.com",  # Required for Cloud Run --set-secrets
        ]
    )

    # --- 4. Service account ---
    print("\n[4/8] Creating service account...")
    run(
        ["gcloud", "iam", "service-accounts", "create", SA_NAME, "--display-name=DemoSage Dev"],
        check=False,
    )
    run(
        [
            "gcloud",
            "projects",
            "add-iam-policy-binding",
            PROJECT_ID,
            f"--member=serviceAccount:{SA_NAME}@{PROJECT_ID}.iam.gserviceaccount.com",
            "--role=roles/editor",
        ]
    )
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "gcloud",
            "iam",
            "service-accounts",
            "keys",
            "create",
            str(KEY_PATH),
            f"--iam-account={SA_NAME}@{PROJECT_ID}.iam.gserviceaccount.com",
        ]
    )
    print("\n      [OK] Key written to " + str(KEY_PATH))
    print("      ** Make sure infra/gcp-key.json is in .gitignore (it is by default)")

    # --- 5. Cloud SQL ---
    print("\n[5/8] Provisioning Cloud SQL (this takes ~5 minutes)...")
    run(
        [
            "gcloud",
            "sql",
            "instances",
            "create",
            DB_INSTANCE,
            "--database-version=POSTGRES_15",
            "--tier=db-f1-micro",  # shared-core — cheapest tier (~$7/mo)
            f"--region={REGION}",
            "--storage-size=10",  # 10 GB HDD minimum
            f"--project={PROJECT_ID}",
        ]
    )
    run(["gcloud", "sql", "databases", "create", DB_NAME, f"--instance={DB_INSTANCE}"])
    run(
        [
            "gcloud",
            "sql",
            "users",
            "create",
            DB_USER,
            f"--instance={DB_INSTANCE}",
            f"--password={DB_PASSWORD}",
        ]
    )

    # --- 6. pgvector extension ---
    print("\n[6/8] Enabling pgvector extension...")
    print("      Connect to Cloud SQL and run:")
    print(f"      gcloud sql connect {DB_INSTANCE} --user={DB_USER} --database={DB_NAME}")
    print("      Then execute: CREATE EXTENSION IF NOT EXISTS vector;")
    print("      (Script cannot do this automatically — requires interactive psql)")

    # --- 7. GCS bucket ---
    print("\n[7/8] Creating GCS bucket...")
    run(
        [
            "gcloud",
            "storage",
            "buckets",
            "create",
            f"gs://{GCS_BUCKET}",
            f"--location={REGION.upper().replace('-', '_')}",
            "--uniform-bucket-level-access",
        ],
        check=False,
    )

    # --- 8. Cloud Tasks queue ---
    print("\n[8/9] Creating Cloud Tasks queue...")
    run(
        [
            "gcloud",
            "tasks",
            "queues",
            "create",
            TASKS_QUEUE,
            f"--location={REGION}",
        ],
        check=False,
    )

    # --- 9. GCS → Pub/Sub → Scout pipeline ---
    print("\n[9/9] Setting up GCS → Pub/Sub → Scout trigger pipeline...")

    # Enable Pub/Sub API
    run(
        ["gcloud", "services", "enable", "pubsub.googleapis.com", f"--project={PROJECT_ID}"],
        check=False,
    )

    # Create Pub/Sub topic
    run(
        [
            "gcloud",
            "pubsub",
            "topics",
            "create",
            PUBSUB_TOPIC,
            f"--project={PROJECT_ID}",
        ],
        check=False,
    )

    # Grant GCS permission to publish to the topic
    # (GCS uses a dedicated service account: service-{project_number}@gs-project-accounts.iam.gserviceaccount.com)
    print("  NOTE: GCS Pub/Sub notification requires the GCS service account to have")
    print("  pubsub.publisher on the topic. Run after getting your project number:")
    print(f"    gcloud projects describe {PROJECT_ID} --format='value(projectNumber)'")
    print(f"    Then: gcloud pubsub topics add-iam-policy-binding {PUBSUB_TOPIC} \\")
    print(
        "      --member='serviceAccount:service-NUMBER@gs-project-accounts.iam.gserviceaccount.com' \\"
    )

    print("      --role='roles/pubsub.publisher'")

    # GCS bucket notification (finalize = object created)
    # Requires the Pub/Sub topic and GCS publisher permission to be set first
    run(
        [
            "gcloud",
            "storage",
            "buckets",
            "notifications",
            "create",
            f"gs://{GCS_BUCKET}",
            f"--topic={PUBSUB_TOPIC}",
            "--event-types=OBJECT_FINALIZE",
            "--object-prefix=demos/raw/",
            f"--project={PROJECT_ID}",
        ],
        check=False,
    )

    print("  Pub/Sub push subscription must be created after Scout is deployed.")
    print("  Run this after getting your Scout Cloud Run URL:")
    print(f"    gcloud pubsub subscriptions create {PUBSUB_SUBSCRIPTION} \\")
    print(f"      --topic={PUBSUB_TOPIC} \\")
    print("      --push-endpoint=SCOUT_URL/internal/scout/parse-from-gcs \\")
    print("      --push-auth-service-account=demosage-dev@PROJECT.iam.gserviceaccount.com \\")
    print(f"      --project={PROJECT_ID}")

    print("\n" + "=" * 60)
    print("[OK] GCP setup complete!")
    print("\nNext steps:")
    print("  1. Copy .env.example to .env and fill in:")
    print(f"     GCP_PROJECT_ID={PROJECT_ID}")
    print(f"     GCP_REGION={REGION}")
    print(f"     GCS_BUCKET={GCS_BUCKET}")
    print(f"     PUBSUB_TOPIC={PUBSUB_TOPIC}")
    print(
        f"     DATABASE_URL=postgresql://{DB_USER}:<password>@/demosage?host=/cloudsql/{PROJECT_ID}:{REGION}:{DB_INSTANCE}"
    )
    print("  2. Enable pgvector (see step 6 above)")
    print("  3. Create the Pub/Sub push subscription (see step 9 above — needs Scout URL)")
    print("  4. Run: python scripts/run_local.py --help")
    print("=" * 60)


if __name__ == "__main__":
    main()
