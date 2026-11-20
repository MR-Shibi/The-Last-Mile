# The Last Mile: AI on Public Rails

> **PROTOTYPE — Simulated DPI & Synthetic Data Only.** No real CNICs, phone numbers or personal data are used anywhere.

A multi-tenant, consent-gated, offline-resilient platform that helps a low-literacy widow apply for public relief by Urdu voice and a CNIC photo, helps a shopkeeper check suspicious "relief payment" SMS messages, and lets a community helper manage up to 40 families on one shared phone.

## Repository layout
| Path | Contents |
|---|---|
| `backend/` | FastAPI app (`app/core`, `app/models`, `app/api`, `app/services`, `app/ml`), `tests/`, `scripts/` |
| `frontend/` | Next.js (App Router, TypeScript, Tailwind) PWA with Urdu RTL support and an IndexedDB offline outbox |
| `docker-compose.yml` | PostgreSQL 16 for production-like runs |

## Quick start
```bash
# Backend (SQLite fallback by default)
python -m venv .venv && .venv/Scripts/pip install -r backend/requirements.txt
cd backend && ../.venv/Scripts/python -m uvicorn app.main:app --reload   # http://localhost:8000/docs
../.venv/Scripts/python -m pytest -v

# Optional Postgres
docker compose up -d db   # then set DATABASE_URL from .env.example

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:3000
```

## Sections to be completed in later phases
Architecture · Test credentials · Real vs. Simulated matrix · Threshold derivation · Limitations
