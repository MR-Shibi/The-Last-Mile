"""Orchestrates sub-score gathering + decision persistence for a case."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.ml.anomaly import anomaly_assessment
from app.models import Case, Decision, Document, RuleVersion, User
from app.services import faults
from app.services.decision_engine import decide
from app.services.identity import assess_identity
from app.services.cnic import is_valid_cnic, normalize_cnic
from app.services.rules_engine import active_rule_version, evaluate_rules, facts_from_case

VISION_VERSION = "vision-metadata-v1"


def assess_document(db: Session, case: Case | None, data: dict, *, honour_faults: bool = True) -> dict:
    doc = None
    if case is not None and case.id is not None:
        doc = db.execute(select(Document).where(Document.case_id == case.id).order_by(Document.id.desc()).limit(1)).scalar()
    if doc is not None:
        meta = {"ocr_confidence": doc.ocr_confidence, "quality_score": doc.quality_score,
                "forgery_score": doc.forgery_score, "flags": (doc.meta or {}).get("flags", []),
                "vision_version": (doc.meta or {}).get("vision_version", VISION_VERSION), "document_id": doc.id}
    elif isinstance(data.get("document"), dict):
        meta = {"vision_version": VISION_VERSION, **data["document"]}
    else:
        return {"document_score": 0.5, "flags": ["document_missing"], "vision_version": VISION_VERSION}

    ocr = float(meta.get("ocr_confidence", 0.0))
    if honour_faults and faults.is_active("force_low_ocr"):
        ocr = min(ocr, 0.31)
    quality = float(meta.get("quality_score", 0.0))
    forgery = float(meta.get("forgery_score", 0.0))
    flags = list(meta.get("flags", []))
    if ocr < 0.6:
        flags.append("low_ocr")
    if forgery >= 0.6:
        flags.append("tamper_suspected")
    elif forgery >= 0.1:
        flags.append("forensic_signal")  # weak edit signal: never auto-recommend, ask for a fresh photo
    if quality < 0.5 and not {"blurry_photo", "glare_photo", "dark_photo"} & set(flags):
        flags.append("blurry_photo")
    return {"document_score": round(ocr * quality * (1 - forgery), 4), "ocr_confidence": ocr, "quality_score": quality,
            "forgery_score": forgery, "flags": sorted(set(flags)), "vision_version": meta.get("vision_version"),
            "document_id": meta.get("document_id")}


def duplicate_counts(db: Session, case: Case | None, data: dict) -> tuple[int, int]:
    cnic = normalize_cnic(data.get("cnic"))
    citizen_id = case.citizen_user_id if case else None
    dup_cnic = 0
    if cnic and is_valid_cnic(cnic):  # malformed numbers typed by different people are not "duplicates"
        q = select(func.count(func.distinct(Case.citizen_user_id))).where(Case.cnic == cnic)
        if citizen_id is not None:
            q = q.where(Case.citizen_user_id != citizen_id)
        dup_cnic = db.execute(q).scalar() or 0
    shared_phone = 0
    if data.get("phone"):
        q = select(func.count(User.id)).where(User.phone == data["phone"])
        if citizen_id is not None:
            q = q.where(User.id != citizen_id)
        shared_phone = db.execute(q).scalar() or 0
    return dup_cnic, shared_phone


def gather_components(db: Session, case: Case | None, data: dict, *, honour_faults: bool = True) -> dict:
    facts = facts_from_case(data)
    identity = assess_identity(db, data, honour_faults=honour_faults)
    document = assess_document(db, case, data, honour_faults=honour_faults)
    dup_cnic, shared_phone = duplicate_counts(db, case, data)
    anomaly = anomaly_assessment(facts, dup_cnic, shared_phone, identity.get("registry_duplicates", 0))
    extra_flags = list(data.get("_extra_flags", []))  # e.g. prompt_injection from scam/OCR guardrails
    return {"facts": facts, "identity": identity, "document": document, "anomaly": anomaly, "extra_flags": extra_flags}


def decide_with(rules_json: dict, comps: dict) -> dict:
    rule_eval = evaluate_rules(rules_json, comps["facts"])
    return decide(rule_eval=rule_eval, identity=comps["identity"], document=comps["document"],
                  anomaly=comps["anomaly"], extra_flags=comps["extra_flags"], facts=comps["facts"])


def evaluate_case(db: Session, case: Case, *, actor: User | None = None, rule_version: RuleVersion | None = None,
                  commit: bool = True) -> Decision:
    rv = rule_version or active_rule_version(db, case.scheme_id)
    comps = gather_components(db, case, case.data or {})
    result = decide_with(rv.rules_json if rv else {"hard": [], "soft": []}, comps)
    trace = {**result["trace"], "rule_version_id": rv.id if rv else None, "rule_version": rv.version if rv else None,
             "scheme_id": case.scheme_id, "case_id": case.id}
    d = Decision(tenant_id=case.tenant_id, case_id=case.id, rule_version_id=rv.id if rv else None,
                 route=result["route"], probability=result["probability"], reason_user_en=result["reason_user_en"],
                 reason_user_ur=result["reason_user_ur"], trace_json=trace, decided_by="engine")
    db.add(d)
    case.status = result["route"]
    db.flush()
    write_audit(db, "decision.engine", tenant_id=case.tenant_id, actor_user_id=actor.id if actor else None,
                actor_role=actor.role if actor else "system", resource_type="decision", resource_id=d.id,
                payload={"case_id": case.id, "route": d.route, "p": d.probability,
                         "rule_version_id": d.rule_version_id, "inputs_hash": trace["inputs_hash"]}, commit=False)
    if commit:
        db.commit()
    return d
