from pathlib import Path
import sys

REPO_ROOT = Path(__file__).parent.parent.resolve()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

from sqlalchemy import select

from db.database import SessionLocal
from db.models import PracticeServer


def check_db():
    db = SessionLocal()
    try:
        stmt = select(PracticeServer).order_by(PracticeServer.created_at.desc())
        servers = db.execute(stmt).scalars().all()
        print(f"Found {len(servers)} servers in DB:")
        for s in servers:
            print(f"- ID: {s.id}")
            print(f"  Team ID: {s.team_id}")
            print(f"  Vultr ID: {s.vultr_instance_id}")
            print(f"  Status: {s.status}")
            print(f"  IP: {s.ip_address}")
            print(f"  Created: {s.created_at}")
            print("-" * 40)
    finally:
        db.close()


if __name__ == "__main__":
    check_db()
