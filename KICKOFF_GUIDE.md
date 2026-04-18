# 🚀 Kickoff Guide — First Match Upload
> Get from zero to a parsed CS2 demo with viewable JSON output. This covers Phase 0 + Phase 1 of the roadmap.

**Goal:** Upload one `.dem` file → have it parsed by the Scout → see structured JSON output in Cloud SQL.

**Time estimate:** ~3–4 hours (most of it is GCP setup, not code)

---

## Prerequisites

Install these before starting:

- [ ] [Python 3.12+](https://www.python.org/downloads/)
- [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Scout container)
- [ ] [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install)
- [ ] [Git](https://git-scm.com/)
- [ ] A CS2 `.dem` file (download one from a FACEIT match via your match room page)

---

## Step 1 — GCP Project Setup (20 min)

### 1.1 Create the project
```bash
gcloud projects create chinghis-scan --name="Chinghis Scan"
gcloud config set project chinghis-scan
```

### 1.2 Link billing
Go to [console.cloud.google.com/billing](https://console.cloud.google.com/billing) and link a billing account to `chinghis-scan`.
> New accounts get $300 free credits — this entire Phase 0+1 costs nothing under that.

### 1.3 Enable required APIs
```bash
gcloud services enable \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  cloudtasks.googleapis.com \
  run.googleapis.com \
  aiplatform.googleapis.com
```

### 1.4 Create a service account for local dev
```bash
gcloud iam service-accounts create chinghis-dev \
  --display-name="Chinghis Scan Dev"

gcloud projects add-iam-policy-binding chinghis-scan \
  --member="serviceAccount:chinghis-dev@chinghis-scan.iam.gserviceaccount.com" \
  --role="roles/editor"

gcloud iam service-accounts keys create ./infra/gcp-key.json \
  --iam-account=chinghis-dev@chinghis-scan.iam.gserviceaccount.com
```

Add to your `.env`:
```env
GOOGLE_APPLICATION_CREDENTIALS=./infra/gcp-key.json
GCP_PROJECT_ID=chinghis-scan
GCP_REGION=us-central1
```

> ⚠️ Add `infra/gcp-key.json` to `.gitignore` immediately.

---

## Step 2 — Cloud SQL Database (20 min)

### 2.1 Create the instance
```bash
gcloud sql instances create chinghis-db \
  --database-version=POSTGRES_15 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=HDD \
  --storage-size=10GB
```
> `db-f1-micro` is the cheapest shared-core instance (~$7–10/mo).

### 2.2 Create database and user
```bash
gcloud sql databases create chinghis --instance=chinghis-db

gcloud sql users create chinghis_user \
  --instance=chinghis-db \
  --password=YOUR_SECURE_PASSWORD
```

### 2.3 Enable pgvector extension
Connect to the instance:
```bash
gcloud sql connect chinghis-db --user=chinghis_user --database=chinghis
```

Then run:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2.4 Add connection string to `.env`
```env
DATABASE_URL=postgresql://chinghis_user:YOUR_PASSWORD@/chinghis?host=/cloudsql/chinghis-scan:us-central1:chinghis-db
DATABASE_URL_LOCAL=postgresql://chinghis_user:YOUR_PASSWORD@localhost:5432/chinghis
```

---

## Step 3 — GCS Bucket for File Storage (5 min)

```bash
gcloud storage buckets create gs://cs2-chinghis-scan \
  --location=US-CENTRAL1 \
  --uniform-bucket-level-access
```

Add to `.env`:
```env
GCS_BUCKET=cs2-chinghis-scan
```

---

## Step 4 — Monorepo Scaffold (15 min)

Create this structure:
```
cs2-agentic-coach/
├── agents/               # LangGraph agent definitions
├── services/
│   └── scout/            # Demo parser service
│       ├── Dockerfile
│       ├── parse_demo.py
│       └── requirements.txt
├── api/                  # FastAPI app
│   ├── main.py
│   └── routes/
│       └── upload.py
├── infra/
│   ├── gcp-key.json      # gitignored
│   └── docker-compose.local.yml
├── frontend/             # Next.js (later)
├── .env
├── .gitignore
└── requirements.txt
```

Run:
```bash
mkdir -p agents services/scout api/routes infra frontend
touch services/scout/Dockerfile services/scout/parse_demo.py
touch api/main.py api/routes/upload.py
touch .env infra/docker-compose.local.yml
```

`.gitignore` — add these:
```
infra/gcp-key.json
.env
__pycache__/
*.pyc
.venv/
```

---

## Step 5 — The Scout (Demo Parser) (45 min)

### 5.1 Scout requirements
`services/scout/requirements.txt`:
```
awpy==2.0.0
demoparser2
google-cloud-storage
psycopg2-binary
python-dotenv
```

### 5.2 Scout Dockerfile
`services/scout/Dockerfile`:
```dockerfile
FROM python:3.12-slim

# awpy requires these system deps
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY parse_demo.py .
CMD ["python", "parse_demo.py"]
```

### 5.3 Scout parse script
`services/scout/parse_demo.py`:
```python
import os
import json
import argparse
from awpy import Demo
from google.cloud import storage

def parse_demo(dem_path: str) -> dict:
    """Parse a CS2 demo file and return structured event data."""
    print(f"Parsing: {dem_path}")
    demo = Demo(dem_path)

    output = {
        "metadata": {
            "map": demo.header.get("map_name", "unknown"),
            "tickrate": demo.header.get("tickrate", 64),
            "total_rounds": len(demo.rounds) if demo.rounds is not None else 0,
        },
        "kills": [],
        "grenades": [],
        "rounds": [],
    }

    # Kill events
    if demo.kills is not None:
        for _, row in demo.kills.iterrows():
            output["kills"].append({
                "round": int(row.get("round", 0)),
                "tick": int(row.get("tick", 0)),
                "attacker": row.get("attackerName", ""),
                "victim": row.get("victimName", ""),
                "weapon": row.get("weapon", ""),
                "headshot": bool(row.get("headshot", False)),
                "attacker_x": float(row.get("attackerX", 0)),
                "attacker_y": float(row.get("attackerY", 0)),
                "victim_x": float(row.get("victimX", 0)),
                "victim_y": float(row.get("victimY", 0)),
            })

    # Grenade events
    if demo.grenades is not None:
        for _, row in demo.grenades.iterrows():
            output["grenades"].append({
                "round": int(row.get("round", 0)),
                "thrower": row.get("throwerName", ""),
                "type": row.get("grenadeType", ""),
                "throw_x": float(row.get("throwerX", 0)),
                "throw_y": float(row.get("throwerY", 0)),
            })

    # Round metadata
    if demo.rounds is not None:
        for _, row in demo.rounds.iterrows():
            output["rounds"].append({
                "round_num": int(row.get("roundNum", 0)),
                "winner_side": row.get("winnerSide", ""),
                "reason": row.get("reason", ""),
                "ct_eq_val": int(row.get("ctEqVal", 0)),
                "t_eq_val": int(row.get("tEqVal", 0)),
            })

    return output


def upload_to_gcs(data: dict, match_id: str):
    """Upload parsed JSON output to GCS."""
    bucket_name = os.environ["GCS_BUCKET"]
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(f"parsed/{match_id}/scout_output.json")
    blob.upload_from_string(
        json.dumps(data, indent=2),
        content_type="application/json"
    )
    print(f"Uploaded to gs://{bucket_name}/parsed/{match_id}/scout_output.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", required=True, help="Path to .dem file")
    parser.add_argument("--match-id", required=True, help="Unique match identifier")
    parser.add_argument("--upload", action="store_true", help="Upload result to GCS")
    args = parser.parse_args()

    result = parse_demo(args.demo)

    # Always write locally
    out_path = f"/tmp/{args.match_id}_scout.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Saved locally: {out_path}")
    print(f"  Rounds: {result['metadata']['total_rounds']}")
    print(f"  Kills:  {len(result['kills'])}")
    print(f"  Grenades: {len(result['grenades'])}")

    if args.upload:
        upload_to_gcs(result, args.match_id)
```

### 5.4 Build the Scout image
```bash
cd services/scout
docker build -t chinghis-scout .
```

---

## Step 6 — Parse Your First Demo (10 min)

Place your `.dem` file somewhere accessible, then run:

```bash
docker run --rm \
  -v /path/to/your/match.dem:/demo/match.dem \
  -v $(pwd)/infra/gcp-key.json:/app/gcp-key.json \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json \
  -e GCS_BUCKET=cs2-chinghis-scan \
  chinghis-scout \
  python parse_demo.py --demo /demo/match.dem --match-id match-001 --upload
```

**On Windows (PowerShell):**
```powershell
docker run --rm `
  -v C:\path\to\match.dem:/demo/match.dem `
  -v ${PWD}\infra\gcp-key.json:/app/gcp-key.json `
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-key.json `
  -e GCS_BUCKET=cs2-chinghis-scan `
  chinghis-scout `
  python parse_demo.py --demo /demo/match.dem --match-id match-001 --upload
```

You should see output like:
```
Parsing: /demo/match.dem
Saved locally: /tmp/match-001_scout.json
  Rounds: 24
  Kills:  312
  Grenades: 187
Uploaded to gs://cs2-chinghis-scan/parsed/match-001/scout_output.json
```

---

## Step 7 — Verify Output

### Check GCS
```bash
gcloud storage ls gs://cs2-chinghis-scan/parsed/match-001/
gcloud storage cat gs://cs2-chinghis-scan/parsed/match-001/scout_output.json | head -50
```

### Or view in browser
Go to [console.cloud.google.com/storage](https://console.cloud.google.com/storage) → `cs2-chinghis-scan` bucket → `parsed/match-001/`

---

## ✅ Milestone Reached

At this point you have:
- ✅ GCP project configured with Cloud SQL + GCS
- ✅ Scout Docker image parsing real CS2 demo data
- ✅ Structured kill/grenade/round JSON stored in GCS
- ✅ Foundation for every other agent to build on

**Next step:** Build the FastAPI upload endpoint so demos can be submitted via HTTP instead of Docker CLI, then wire the Scout output to the Tactician agent for analysis.

---

## Troubleshooting

| Problem | Fix |
| :--- | :--- |
| `awpy` parse fails / empty output | Ensure demo is CS2 format (not CSGO). FACEIT demos work; old MM demos may not. |
| Docker can't find demo file | Use absolute paths with `-v`. On Windows use full `C:\...` path. |
| GCS upload denied | Check `gcp-key.json` is mounted correctly and service account has `Storage Object Admin` role. |
| `module not found: demoparser2` | Rebuild Docker image after updating `requirements.txt`. |
| Cloud SQL connection refused | For local testing, output to `/tmp` only and skip `--upload` flag until GCS is confirmed working. |
