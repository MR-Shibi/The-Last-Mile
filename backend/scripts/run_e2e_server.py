"""Start the API for browser E2E tests on a FRESH, freshly-seeded database (never the demo DB).

Usage (from backend/): python scripts/run_e2e_server.py [--port 8000]
Used by frontend/playwright.config.ts as its backend webServer. PROTOTYPE — synthetic data only.
"""
import argparse
import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--families", type=int, default=40)
    args = ap.parse_args()
    db = Path(tempfile.gettempdir()) / "lastmile-e2e.db"
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{db}{suffix}").unlink(missing_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{db.as_posix()}"
    os.environ.setdefault("BCRYPT_ROUNDS", "4")
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)

    import uvicorn  # noqa: PLC0415

    from app.core.database import SessionLocal, init_db  # noqa: PLC0415
    from app.services.seed import seed  # noqa: PLC0415

    init_db()
    with SessionLocal() as s:
        seed(s, families=args.families)
    print(f"E2E database seeded at {db}", flush=True)
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
