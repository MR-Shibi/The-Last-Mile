"""Offline-first outbox sync. Each event carries a client_event_id idempotency key; replays return
the stored result instead of creating duplicates. One bad event never fails the whole batch."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.cases import CaseIn, create_case_record, latest_decision
from app.api.consents import ConsentIn, grant_consent
from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import require_roles
from app.models import Role, SyncQueue, User

router = APIRouter(tags=["sync"])


class SyncEvent(BaseModel):
    client_event_id: str = Field(min_length=8, max_length=80)
    kind: Literal["case_submit", "consent_grant", "draft", "voice_transcript"]
    payload: dict = Field(default_factory=dict)


class SyncIn(BaseModel):
    events: list[SyncEvent] = Field(max_length=200)


def _apply(db: Session, user: User, ev: SyncEvent) -> dict:
    if ev.kind == "case_submit":
        body = CaseIn(**{**ev.payload, "client_event_id": ev.client_event_id})
        case, created = create_case_record(db, user, body)
        return {"case_id": case.id, "receipt_pin": case.receipt_pin, "created": created,
                "decision": latest_decision(db, case.id)}
    if ev.kind == "consent_grant":
        return grant_consent(ConsentIn(**ev.payload), user, db)
    # drafts / voice transcripts are acknowledged (kept client-side); nothing citizen-visible changes
    return {"acknowledged": True}


@router.post("/sync")
def sync(body: SyncIn, user: User = Depends(require_roles(Role.CITIZEN, Role.HELPER)), db: Session = Depends(get_db)) -> dict:
    results = []
    for ev in body.events:
        existing = db.execute(select(SyncQueue).where(SyncQueue.client_event_id == ev.client_event_id)).scalar()
        if existing:
            if existing.user_id != user.id:
                results.append({"client_event_id": ev.client_event_id, "status": "conflict",
                                "error": "idempotency key belongs to another user"})
            else:
                results.append({"client_event_id": ev.client_event_id, "status": "duplicate", "result": existing.result})
            continue
        try:
            result = _apply(db, user, ev)
            status_ = "applied"
        except (HTTPException, ValidationError, TypeError) as e:
            db.rollback()
            detail = e.detail if isinstance(e, HTTPException) else str(e)[:300]
            results.append({"client_event_id": ev.client_event_id, "status": "error", "error": detail})
            continue
        try:
            db.add(SyncQueue(tenant_id=user.tenant_id, user_id=user.id, client_event_id=ev.client_event_id,
                             kind=ev.kind, payload=ev.payload, status="APPLIED", result=result))
            db.commit()
        except IntegrityError:  # concurrent replay of the same key
            db.rollback()
            status_ = "duplicate"
        results.append({"client_event_id": ev.client_event_id, "status": status_, "result": result})
    write_audit(db, "sync.batch", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                payload={"events": len(body.events), "applied": sum(r["status"] == "applied" for r in results),
                         "duplicates": sum(r["status"] == "duplicate" for r in results)})
    return {"results": results, "applied": sum(r["status"] == "applied" for r in results),
            "duplicates": sum(r["status"] == "duplicate" for r in results),
            "errors": sum(r["status"] in ("error", "conflict") for r in results)}
