from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import ensure_same_tenant, require_roles
from app.models import Role, RuleVersion, Scheme, User
from app.services.digital_twin import simulate
from app.services.rules_engine import publish_rule_version

router = APIRouter(prefix="/rules", tags=["rules"])


class PublishIn(BaseModel):
    rules_json: dict
    notes: str = Field(default="", max_length=500)


class SimulateIn(BaseModel):
    scheme_id: int
    rules_json: dict
    include_synthetic: bool = True


def _scheme(db: Session, user: User, scheme_id: int) -> Scheme:
    s = db.get(Scheme, scheme_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheme not found")
    ensure_same_tenant(db, user, s.tenant_id, "scheme", s.id)
    return s


def rv_out(rv: RuleVersion) -> dict:
    return {"id": rv.id, "scheme_id": rv.scheme_id, "version": rv.version, "is_active": rv.is_active,
            "rules_json": rv.rules_json, "notes": rv.notes, "published_by": rv.published_by,
            "created_at": rv.created_at.isoformat()}


@router.get("/{scheme_id}")
def list_versions(scheme_id: int, user: User = Depends(require_roles(Role.ADMIN, Role.OFFICER, Role.AUDITOR)),
                  db: Session = Depends(get_db)) -> dict:
    s = _scheme(db, user, scheme_id)
    rows = db.execute(select(RuleVersion).where(RuleVersion.scheme_id == s.id).order_by(RuleVersion.version.desc())).scalars().all()
    return {"scheme_id": s.id, "active": next((rv_out(r) for r in rows if r.is_active), None),
            "versions": [rv_out(r) for r in rows]}


@router.post("/{scheme_id}/publish", status_code=201)
def publish(scheme_id: int, body: PublishIn, user: User = Depends(require_roles(Role.ADMIN)),
            db: Session = Depends(get_db)) -> dict:
    s = _scheme(db, user, scheme_id)
    rv = publish_rule_version(db, s, body.rules_json, user.id, body.notes)
    write_audit(db, "rules.published", tenant_id=s.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="rule_version", resource_id=rv.id,
                payload={"scheme_id": s.id, "version": rv.version, "notes": body.notes}, commit=False)
    db.commit()
    return rv_out(rv)


@router.post("/simulate")
def simulate_rules(body: SimulateIn, user: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)) -> dict:
    s = _scheme(db, user, body.scheme_id)
    result = simulate(db, s, body.rules_json, include_synthetic=body.include_synthetic)
    db.rollback()  # belt and braces: the simulator never writes
    write_audit(db, "rules.simulated", tenant_id=s.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="scheme", resource_id=s.id,
                payload={"changed": len(result["changed_case_ids"]), "total": result["total_cases"]})
    return result
