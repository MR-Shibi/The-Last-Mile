from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    eng = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    return eng


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Database-level enforcement that audit_logs is append-only (defence in depth on top of
# the ORM guard in app/core/audit.py).
AUDIT_TRIGGER_DDL = {
    "sqlite": [
        "CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs "
        "BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;",
        "CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs "
        "BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;",
    ],
    "postgresql": [
        "CREATE OR REPLACE FUNCTION audit_logs_block() RETURNS trigger AS $fn$ "
        "BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $fn$ LANGUAGE plpgsql;",
        "DROP TRIGGER IF EXISTS audit_logs_no_mutate ON audit_logs;",
        "CREATE TRIGGER audit_logs_no_mutate BEFORE UPDATE OR DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_block();",
    ],
}


def install_audit_triggers(connection) -> None:  # noqa: ANN001
    for stmt in AUDIT_TRIGGER_DDL.get(connection.dialect.name, []):
        connection.execute(text(stmt))


def init_db() -> None:
    """create_all + append-only triggers (used by tests and the demo seed; Alembic is
    the production migration path and produces the same schema)."""
    import app.models  # noqa: F401  (register models)

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        install_audit_triggers(conn)
