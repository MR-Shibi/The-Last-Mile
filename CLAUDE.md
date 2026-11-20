# CLAUDE.md — Coder's Cup '26: The Last Mile (AI on Public Rails)

## Mission & Non-Negotiable Rules
1. **Prototype & Synthetic Data Only:** Every screen footer and README must display: *"PROTOTYPE — Simulated DPI & Synthetic Data Only."* Never use real CNICs, phone numbers, or personal data.
2. **Not a Chatbot:** This is a multi-tenant, role-enforced SaaS platform with server-side RBAC, revocable consent middleware, versioned JSON rules, and hash-chained append-only audit logs.
3. **Strict Phase-Gate Execution:** You MUST work strictly one phase at a time. Never start Phase N+1 until Phase N's automated test suite (`pytest` / API checks) runs and passes 100%, and a clean Git commit is created for Phase N.
4. **Never Auto-Reject:** The AI decision engine may `AUTO_RECOMMEND` (`p >= 0.95`), `ASK_MORE_PROOF` (`0.70 <= p < 0.95`), or `ESCALATE_HUMAN` (`p < 0.70` or any hard-rule/anomaly flag). Only a human Department Officer can reject a case.
5. **Server-Side Security:** Enforce JWT + RBAC + `tenant_id` scoping + active `consent` checks in FastAPI dependencies/middleware—never rely on hiding frontend buttons.
6. **Honest Engineering:** Keep models lightweight, fast, and deterministic (`RapidFuzz`, `scikit-learn`, `OpenCV`, `pyzbar`, `Tesseract`, `Pydantic`). Report false-alarm rates honestly on the Evaluation Dashboard.

## Tech Stack
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy / SQLModel, Alembic migrations, PostgreSQL (or SQLite fallback for instant local tests, Postgres for prod), Pydantic v2, `pytest`, `httpx`.
- **AI / Vision / NLP:** `rapidfuzz`, `scikit-learn` (TF-IDF + LogisticRegression for Scam Shield, IsolationForest for anomalies), `opencv-python-headless`, `pyzbar`, `pytesseract` (with graceful mock/fallback if binary missing), `gTTS` / `edge-tts` for Urdu audio generation.
- **Frontend:** Next.js (App Router, TypeScript), Tailwind CSS, IndexedDB (`idb`) for offline outbox queue, `qrcode.react` for Citizen Parchi, Recharts for Evaluation Dashboard.