"""Seed the demo database.

Usage (from backend/):  python scripts/seed_demo.py [--families 40]
Creates 2 tenants, accounts for all 5 roles per tenant (password Demo@1234), a community helper
linked to N families (default 5, max 40), schemes with v1 rules and the 50-row mock registry.
PROTOTYPE — Simulated DPI & Synthetic Data Only.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import SessionLocal, init_db  # noqa: E402
from app.services.seed import seed  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--families", type=int, default=5, help="families linked to each helper (1-40)")
    args = ap.parse_args()
    init_db()
    with SessionLocal() as db:
        out = seed(db, families=args.families)
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
