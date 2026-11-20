import os
import sys
import tempfile
from pathlib import Path

# Must be configured before the app (and its engine) is imported.
_TMP = Path(tempfile.mkdtemp(prefix="lastmile-test-"))
# Default: throwaway SQLite. Set TEST_DATABASE_URL (e.g. postgres://user@host:5432/lastmile_test) to run the
# whole suite against PostgreSQL; that database is wiped and recreated at session start.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["AUTO_CREATE_SCHEMA"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services import faults  # noqa: E402
from app.services.seed import DEMO_PASSWORD, seed  # noqa: E402

if os.environ.get("TEST_DATABASE_URL"):
    from sqlalchemy import text

    from app.core.database import engine

    with engine.begin() as _conn:  # fresh schema (DROP SCHEMA also removes the append-only trigger)
        _conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
init_db()
with SessionLocal() as _db:
    SEED = seed(_db, families=5)


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="session")
def seeded() -> dict:
    return SEED


@pytest.fixture(autouse=True)
def _reset_faults():
    faults.reset_faults()
    yield
    faults.reset_faults()


_token_cache: dict[str, str] = {}


@pytest.fixture(scope="session")
def auth(client):
    """auth('sindh.officer') -> Authorization headers (cached per session)."""

    def _auth(username: str) -> dict:
        if username not in _token_cache:
            r = client.post("/auth/login", json={"username": username, "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            _token_cache[username] = r.json()["access_token"]
        return {"Authorization": f"Bearer {_token_cache[username]}"}

    return _auth


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s
