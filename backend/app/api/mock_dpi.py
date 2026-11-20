"""Simulated Digital Public Infrastructure rails (NADRA-style identity, Raast-style payments,
registry QR, OCR). Honour the admin fault-injection switches so graceful human escalation can
be demonstrated live. PROTOTYPE — no real government systems are contacted."""
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models import MockRegistry, Role, User
from app.services import faults
from app.services.cnic import is_valid_cnic, normalize_cnic

router = APIRouter(prefix="/mock", tags=["mock-dpi"])


class IdentityIn(BaseModel):
    cnic: str
    full_name: str
    father_name: str | None = None


class PaymentIn(BaseModel):
    case_id: int
    amount_pkr: int
    cnic: str | None = None


class OcrIn(BaseModel):
    document_hint: str = "cnic_front"


def lookup_identity(db: Session, cnic: str, full_name: str, father_name: str | None) -> dict:
    """Pure registry lookup (no fault handling). Name scoring upgraded by app.ml.name_matcher in Phase 3."""
    norm = normalize_cnic(cnic)
    if not norm:
        return {"found": False, "cnic_format_valid": False, "checksum_valid": False, "matches": []}
    rows = db.execute(select(MockRegistry).where(MockRegistry.cnic == norm)).scalars().all()
    matches = []
    for r in rows:
        name_score = fuzz.token_sort_ratio(full_name.lower(), r.full_name.lower()) / 100
        father_score = (fuzz.token_sort_ratio((father_name or "").lower(), (r.father_name or "").lower()) / 100
                        if father_name and r.father_name else None)
        matches.append({"registry_id": r.id, "full_name": r.full_name, "father_name": r.father_name,
                        "province": r.province, "dob": r.dob, "marital_status": r.marital_status,
                        "monthly_income": r.monthly_income, "name_score": round(name_score, 3),
                        "father_score": None if father_score is None else round(father_score, 3),
                        "data_quality_note": r.data_quality_note})
    return {"found": bool(rows), "cnic_format_valid": True, "checksum_valid": is_valid_cnic(norm),
            "duplicate_records": max(0, len(rows) - 1), "matches": matches}


@router.post("/identity/verify")
def identity_verify(body: IdentityIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if faults.is_active("nadra_timeout"):
        time.sleep(0.05)  # simulated slow upstream; kept short so demos/tests stay snappy
        write_audit(db, "mock.nadra_timeout", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role)
        return JSONResponse(status_code=504, content={"error": "NADRA_TIMEOUT", "retryable": True,
                                                      "detail": "Identity service did not respond (simulated)",
                                                      "fallback": "ESCALATE_HUMAN"})
    return lookup_identity(db, body.cnic, body.full_name, body.father_name)


@router.post("/payment/initiate")
def payment_initiate(body: PaymentIn, user: User = Depends(require_roles(Role.OFFICER)), db: Session = Depends(get_db)):
    if faults.is_active("raast_error"):
        write_audit(db, "mock.raast_error", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                    resource_type="case", resource_id=body.case_id)
        return JSONResponse(status_code=502, content={"error": "RAAST_ERROR", "retryable": True,
                                                      "detail": "Payment switch rejected the request (simulated)",
                                                      "fallback": "QUEUE_FOR_RETRY"})
    txn = "RAAST-SIM-" + secrets.token_hex(6).upper()
    write_audit(db, "mock.payment_initiated", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="case", resource_id=body.case_id, payload={"amount_pkr": body.amount_pkr, "txn": txn})
    return {"status": "INITIATED", "txn_id": txn, "amount_pkr": body.amount_pkr, "simulated": True}


@router.get("/registry/qr/{code}")
def registry_qr(code: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    r = db.execute(select(MockRegistry).where(MockRegistry.qr_code == code)).scalar()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR code not in registry (possible tampering)")
    return {"valid": True, "cnic": r.cnic, "full_name": r.full_name, "father_name": r.father_name, "dob": r.dob}


@router.post("/ocr/extract")
def ocr_extract(body: OcrIn, user: User = Depends(get_current_user)):
    low = faults.is_active("force_low_ocr")
    return {"document": body.document_hint, "ocr_confidence": 0.31 if low else 0.93,
            "forced_low": low, "fallback": "ASK_MORE_PROOF" if low else None}
