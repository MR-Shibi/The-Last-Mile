"""Audit appends take a transaction-scoped Postgres advisory lock (prevents concurrent chain forks)."""
from types import SimpleNamespace

from app.core import audit


class _FakeSession:
    def __init__(self, dialect: str):
        self._bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.sql: list[str] = []

    def get_bind(self):
        return self._bind

    def execute(self, stmt, params=None):  # noqa: ANN001
        self.sql.append(str(stmt))
        return SimpleNamespace(scalar=lambda: None)


def test_postgres_append_takes_advisory_xact_lock():
    s = _FakeSession("postgresql")
    audit._lock_chain_for_transaction(s)
    assert s.sql == ["SELECT pg_advisory_xact_lock(:k)"]


def test_sqlite_append_does_not_issue_pg_lock():
    s = _FakeSession("sqlite")
    audit._lock_chain_for_transaction(s)
    assert s.sql == []
