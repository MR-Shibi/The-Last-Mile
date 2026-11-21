"""Document ingestion: vision analysis + DB-backed cross-checks (hash reuse, registry QR,
OCR-vs-claimed identity, prompt-injection in OCR text), then persisted as a Document row."""
from rapidfuzz.distance import Levenshtein
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ml.scam_shield import detect_injection
from app.ml.vision import analyze_document
from app.models import Case, CaseField, ConsentScope, Document, MockRegistry
from app.services.cnic import normalize_cnic


def cross_check(db: Session, analysis: dict, claimed: dict, case: Case | None, owner_user_id: int | None = None) -> dict:
    """`owner_user_id` identifies whose photo this is when there is no case yet (live pre-submit check),
    so a citizen re-using HER OWN earlier photo (e.g. for a second scheme) is not called a duplicate."""
    owner = case.citizen_user_id if case is not None else owner_user_id
    flags = list(analysis["flags"])
    checks: dict = {}

    # 1) Same image reused by a different citizen's claim
    q = select(Document, Case).join(Case, Document.case_id == Case.id).where(Document.sha256 == analysis["sha256"])
    reused = [(d, c) for d, c in db.execute(q).all() if owner is None or c.citizen_user_id != owner]
    checks["hash_reused_by_other_claims"] = len(reused)
    if reused:
        flags.append("duplicate_document")

    # 2) QR cross-checked against the registry rail
    claimed_cnic = normalize_cnic(claimed.get("cnic"))
    qr_status = "absent"
    for code in analysis["qr_codes"]:
        rec = db.execute(select(MockRegistry).where(MockRegistry.qr_code == code)).scalar()
        if rec is None:
            qr_status = "not_in_registry"
        elif claimed_cnic and rec.cnic != claimed_cnic:
            qr_status = "belongs_to_other_cnic"
        else:
            qr_status = "valid"
            break
    checks["qr_status"] = qr_status
    if qr_status in ("not_in_registry", "belongs_to_other_cnic"):
        flags.append("qr_mismatch")

    # 3) OCR'd CNIC vs claimed CNIC (tolerate one OCR digit slip)
    ocr_cnic = analysis["ocr"].get("cnic")
    if ocr_cnic and claimed_cnic:
        dist = Levenshtein.distance(ocr_cnic.replace("-", ""), claimed_cnic.replace("-", ""))
        checks["ocr_cnic_distance"] = dist
        if dist > 1:
            flags.append("document_identity_mismatch")

    # 4) Untrusted OCR text may carry injected instructions
    inj = detect_injection(" ".join(analysis["ocr"].get("raw_lines", [])))
    checks["ocr_injection"] = inj["matches"]
    if inj["injection"]:
        flags.append("prompt_injection")

    if analysis["forgery"]["forgery_score"] >= 0.6:
        flags.append("tamper_suspected")
    return {"flags": sorted(set(flags)), "checks": checks}


def ingest_document(db: Session, case: Case, data: bytes, kind: str = "cnic_front") -> tuple[Document, dict]:
    analysis = analyze_document(data)
    xc = cross_check(db, analysis, case.data or {}, case)
    doc = Document(tenant_id=case.tenant_id, case_id=case.id, kind=kind, sha256=analysis["sha256"],
                   ocr_confidence=analysis["ocr"]["ocr_confidence"], quality_score=analysis["quality"]["quality_score"],
                   forgery_score=analysis["forgery"]["forgery_score"],
                   meta={"flags": xc["flags"], "checks": xc["checks"], "quality": analysis["quality"],
                         "forgery": analysis["forgery"], "qr_codes": analysis["qr_codes"],
                         "ocr": {k: v for k, v in analysis["ocr"].items() if k != "raw_lines"},
                         "vision_version": analysis["vision_version"]})
    db.add(doc)
    db.flush()
    ocr = analysis["ocr"]
    for key in ("full_name", "father_name", "cnic", "dob"):
        if ocr.get(key):
            db.add(CaseField(tenant_id=case.tenant_id, case_id=case.id, key=key, value=str(ocr[key]), source="ocr",
                             confidence=ocr["ocr_confidence"], consent_scope=ConsentScope.DOCUMENTS))
    analysis["flags"] = xc["flags"]
    analysis["checks"] = xc["checks"]
    return doc, analysis
