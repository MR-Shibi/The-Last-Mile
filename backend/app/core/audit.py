"""Append-only, SHA-256 hash-chained audit log.

row_hash = SHA256( canonical_json(payload_fields) + prev_hash )
The first row chains from GENESIS_HASH. Any edit to any historical row (or deletion/reordering)
breaks every subsequent hash, which /audit/verify-chain detects.
"""
import hashlib
import json
import threading
from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import AuditLog

GENESIS_HASH = "0" * 64
_append_lock = threading.Lock()


def canonical_json(obj) -> str:  # noqa: ANN001
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _hash_fields(row: AuditLog | dict) -> dict:
    get = (lambda k: row[k]) if isinstance(row, dict) else (lambda k: getattr(row, k))
    return {
        "tenant_id": get("tenant_id"),
        "actor_user_id": get("actor_user_id"),
        "actor_role": get("actor_role"),
        "action": get("action"),
        "resource_type": get("resource_type"),
        "resource_id": get("resource_id"),
        "payload": get("payload") or {},
        "ts": get("ts"),
    }


def compute_row_hash(fields: dict, prev_hash: str) -> str:
    return hashlib.sha256((canonical_json(fields) + prev_hash).encode("utf-8")).hexdigest()


def write_audit(
    db: Session,
    action: str,
    *,
    tenant_id: int | None = None,
    actor_user_id: int | None = None,
    actor_role: str | None = None,
    resource_type: str | None = None,
    resource_id: str | int | None = None,
    payload: dict | None = None,
    commit: bool = True,
) -> AuditLog:
    """Append one audit row. Serialised with a process lock so the chain stays linear."""
    with _append_lock:
        last = db.execute(select(AuditLog.row_hash).order_by(AuditLog.id.desc()).limit(1)).scalar()
        prev = last or GENESIS_HASH
        row = AuditLog(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            action=action,
            resource_type=resource_type,
            resource_id=None if resource_id is None else str(resource_id),
            payload=json.loads(canonical_json(payload or {})),
            ts=datetime.now(timezone.utc).isoformat(timespec="microseconds"),
            prev_hash=prev,
        )
        row.row_hash = compute_row_hash(_hash_fields(row), prev)
        db.add(row)
        if commit:
            db.commit()
        else:
            db.flush()
        return row


def verify_rows(rows: Iterable[AuditLog | dict]) -> dict:
    """Recompute the whole chain. Returns {valid, verified_count, broken_at?, reason?}."""
    prev = GENESIS_HASH
    count = 0
    for row in rows:
        get = (lambda k: row[k]) if isinstance(row, dict) else (lambda k: getattr(row, k))  # noqa: B023
        if get("prev_hash") != prev:
            return {"valid": False, "verified_count": count, "broken_at": get("id"),
                    "reason": "prev_hash does not link to previous row (deleted/reordered row)"}
        expected = compute_row_hash(_hash_fields(row), prev)
        if expected != get("row_hash"):
            return {"valid": False, "verified_count": count, "broken_at": get("id"),
                    "reason": "row_hash mismatch (row content was tampered)"}
        prev = get("row_hash")
        count += 1
    return {"valid": True, "verified_count": count, "head_hash": prev}


def verify_chain(db: Session) -> dict:
    rows = db.execute(select(AuditLog).order_by(AuditLog.id.asc())).scalars()
    return verify_rows(rows)


@event.listens_for(AuditLog, "before_update")
def _block_update(*_):  # noqa: ANN002
    raise PermissionError("audit_logs is append-only")


@event.listens_for(AuditLog, "before_delete")
def _block_delete(*_):  # noqa: ANN002
    raise PermissionError("audit_logs is append-only")
