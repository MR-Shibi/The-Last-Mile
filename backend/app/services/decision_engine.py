"""Mathematical, cost-gated decision engine. NEVER auto-rejects.

Asymmetric costs (units = one officer review):
    Wrong Approval = 20, Wrong Block = 5, Human Review = 1, Slow Proof Delay = 0.5

Threshold derivation (also embedded in every trace):
  * AUTO_RECOMMEND vs ESCALATE_HUMAN: auto-recommending has expected cost (1-p)*20; a human review
    costs 1. Auto is cheaper iff (1-p)*20 < 1  <=>  p > 1 - 1/20 = 0.95.
  * ASK_MORE_PROOF vs ESCALATE_HUMAN: asking costs the delay (0.5) plus, if the extra proof does not
    resolve it, a review and a second delay: 0.5 + (1-p)*(1 + 0.5). That beats escalation (1) iff
    (1-p) < 1/3  <=>  p > 0.667; we round up to 0.70 for a safety margin.
  * Below 0.70 a human decides. Only a human officer may ever reject.
"""
import hashlib
import json

COSTS = {"wrong_approval": 20.0, "wrong_block": 5.0, "human_review": 1.0, "slow_proof": 0.5}
AUTO_THRESHOLD = 1 - COSTS["human_review"] / COSTS["wrong_approval"]  # 0.95
ASK_THRESHOLD = 0.70
SPELLING_CONFLICT_BAND = (0.72, 0.89)
WEIGHTS = {"rule_score": 0.35, "identity_match_score": 0.30, "document_score": 0.20, "anomaly_inverse": 0.15}
MIN_GUARD_MARGIN = 0.15
ENGINE_VERSION = "lastmile-decision-2.0"

AUTO_RECOMMEND = "AUTO_RECOMMEND"
ASK_MORE_PROOF = "ASK_MORE_PROOF"
ESCALATE_HUMAN = "ESCALATE_HUMAN"
ENGINE_ROUTES = (AUTO_RECOMMEND, ASK_MORE_PROOF, ESCALATE_HUMAN)

# Flags that always force a human ("I am not sure") handoff.
ESCALATION_FLAGS = {"hard_rule_failed", "tamper_suspected", "qr_mismatch", "duplicate_cnic", "duplicate_document",
                    "duplicate_registry_record", "dpi_timeout", "prompt_injection", "not_in_registry",
                    "negative_income", "document_identity_mismatch", "identity_mismatch", "vision_engine_failure"}
# Gaps the citizen can fix themselves (retake photo, fill a field).
FIXABLE_FLAGS = {"missing_field", "blurry_photo", "glare_photo", "dark_photo", "low_ocr", "document_missing",
                 "invalid_cnic_format"}
# Soft anomaly flags block AUTO but do not by themselves force escalation.
SOFT_ANOMALY_FLAGS = {"statistical_outlier", "forensic_signal"}


def composite_probability(rule_score: float, identity_match_score: float, document_score: float,
                          anomaly_score: float) -> dict:
    comps = {
        "rule_score": float(rule_score),
        "identity_match_score": float(identity_match_score),
        "document_score": float(document_score),
        "anomaly_inverse": 1.0 - float(anomaly_score),
    }
    weighted = sum(WEIGHTS[k] * comps[k] for k in WEIGHTS)
    weakest_key = min(comps, key=comps.get)
    guard = comps[weakest_key] + MIN_GUARD_MARGIN
    p = min(weighted, guard)
    return {"p": round(max(0.0, min(1.0, p)), 4), "weighted_mean": round(weighted, 4),
            "min_guard_cap": round(guard, 4), "min_guard_applied": guard < weighted,
            "weakest_component": weakest_key, "components": {k: round(v, 4) for k, v in comps.items()}}


def expected_costs(p: float) -> dict:
    return {
        AUTO_RECOMMEND: round((1 - p) * COSTS["wrong_approval"], 4),
        ASK_MORE_PROOF: round(COSTS["slow_proof"] + (1 - p) * (COSTS["human_review"] + COSTS["slow_proof"]), 4),
        ESCALATE_HUMAN: COSTS["human_review"],
    }


def route(p: float, hard_pass: bool = True, flags: list[str] | set[str] = (), name_scores: list[float] = ()) -> dict:
    """Pure routing function. Returns {route, reasons}. Never returns a rejection."""
    flags = set(flags)
    reasons: list[str] = []
    if not hard_pass and "missing_field" not in flags:
        flags.add("hard_rule_failed")
    conflict = [s for s in name_scores if s is not None and SPELLING_CONFLICT_BAND[0] <= s <= SPELLING_CONFLICT_BAND[1]]
    if conflict:
        flags.add("name_spelling_conflict")

    esc = sorted(flags & ESCALATION_FLAGS)
    if esc:
        return {"route": ESCALATE_HUMAN, "reasons": esc, "flags": sorted(flags)}
    fix = sorted(flags & FIXABLE_FLAGS)
    if fix:
        return {"route": ASK_MORE_PROOF, "reasons": fix, "flags": sorted(flags)}
    if "name_spelling_conflict" in flags:
        return {"route": ESCALATE_HUMAN, "reasons": ["name_spelling_conflict"], "flags": sorted(flags)}
    if p >= AUTO_THRESHOLD and hard_pass and not (flags & SOFT_ANOMALY_FLAGS):
        return {"route": AUTO_RECOMMEND, "reasons": ["high_confidence_all_checks_passed"], "flags": sorted(flags)}
    if p >= ASK_THRESHOLD:
        reasons = sorted(flags & SOFT_ANOMALY_FLAGS) or ["moderate_confidence"]
        return {"route": ASK_MORE_PROOF, "reasons": reasons, "flags": sorted(flags)}
    return {"route": ESCALATE_HUMAN, "reasons": ["low_confidence"], "flags": sorted(flags)}


# ----------------------------------------------------------------- explanations
REASON_TEXT = {
    "high_confidence_all_checks_passed": ("All checks matched official records.", "تمام معلومات سرکاری ریکارڈ سے مل گئیں۔"),
    "moderate_confidence": ("A few details need one more proof.", "کچھ معلومات کے لیے ایک اور ثبوت چاہیے۔"),
    "statistical_outlier": ("Some answers look unusual, so please confirm them.", "کچھ جوابات غیر معمولی لگ رہے ہیں، براہ کرم تصدیق کریں۔"),
    "missing_field": ("Some required information is missing.", "کچھ ضروری معلومات موجود نہیں ہیں۔"),
    "blurry_photo": ("Your CNIC photo is blurry. Please take it again in good light.", "آپ کے شناختی کارڈ کی تصویر دھندلی ہے۔ براہ کرم روشنی میں دوبارہ کھینچیں۔"),
    "glare_photo": ("Your CNIC photo has glare. Please retake it without flash.", "تصویر پر چمک ہے۔ بغیر فلیش کے دوبارہ تصویر لیں۔"),
    "dark_photo": ("Your CNIC photo is too dark. Please retake it in daylight.", "تصویر بہت تاریک ہے۔ دن کی روشنی میں دوبارہ لیں۔"),
    "low_ocr": ("We could not read your CNIC clearly. Please retake the photo.", "ہم آپ کا شناختی کارڈ صاف نہیں پڑھ سکے۔ دوبارہ تصویر لیں۔"),
    "document_missing": ("Please add a photo of your CNIC.", "براہ کرم اپنے شناختی کارڈ کی تصویر شامل کریں۔"),
    "invalid_cnic_format": ("The CNIC number does not look right. Please check it.", "شناختی کارڈ نمبر درست نہیں لگتا۔ براہ کرم دوبارہ چیک کریں۔"),
    "hard_rule_failed": ("Your application did not meet a scheme condition.", "آپ کی درخواست اسکیم کی ایک شرط پر پوری نہیں اتری۔"),
    "tamper_suspected": ("Your document needs to be checked by an officer.", "آپ کے دستاویز کی جانچ افسر کرے گا۔"),
    "qr_mismatch": ("The CNIC QR code did not match records.", "شناختی کارڈ کا QR کوڈ ریکارڈ سے نہیں ملا۔"),
    "duplicate_cnic": ("This CNIC already has another application.", "اس شناختی کارڈ پر پہلے سے ایک اور درخواست موجود ہے۔"),
    "duplicate_document": ("This document photo was already used in another claim.", "یہ تصویر پہلے کسی اور درخواست میں استعمال ہو چکی ہے۔"),
    "duplicate_registry_record": ("Official records have more than one entry for you.", "سرکاری ریکارڈ میں آپ کے ایک سے زیادہ اندراج ہیں۔"),
    "dpi_timeout": ("The identity service is slow right now.", "شناختی نظام اس وقت سست ہے۔"),
    "prompt_injection": ("Your submission contained unusual instructions.", "آپ کی درخواست میں غیر معمولی ہدایات تھیں۔"),
    "not_in_registry": ("We could not find this CNIC in official records.", "یہ شناختی کارڈ سرکاری ریکارڈ میں نہیں ملا۔"),
    "negative_income": ("The income amount looks incorrect.", "آمدنی کی رقم درست نہیں لگتی۔"),
    "name_spelling_conflict": ("Your name is spelled differently in official records.", "سرکاری ریکارڈ میں آپ کے نام کی ہجے مختلف ہے۔"),
    "document_identity_mismatch": ("The CNIC on the photo does not match the number you gave.", "تصویر والا شناختی کارڈ نمبر آپ کے بتائے گئے نمبر سے نہیں ملتا۔"),
    "identity_mismatch": ("The name does not match the official record for this CNIC.", "یہ نام اس شناختی کارڈ کے سرکاری ریکارڈ سے نہیں ملتا۔"),
    "forensic_signal": ("Your photo shows signs of editing. Please send a fresh, unedited photo.", "تصویر میں تبدیلی کے آثار ہیں۔ براہ کرم نئی، اصل تصویر بھیجیں۔"),
    "vision_engine_failure": ("We could not check your photo right now, so an officer will look at it.", "ہم ابھی آپ کی تصویر جانچ نہیں سکے، اس لیے ایک افسر اسے دیکھے گا۔"),
    "low_confidence": ("We are not sure about some details.", "ہمیں کچھ معلومات کے بارے میں یقین نہیں ہے۔"),
}

ROUTE_TEXT = {
    AUTO_RECOMMEND: ("An officer will confirm your payment with one tap.", "ایک افسر ایک کلک سے آپ کی ادائیگی کی تصدیق کرے گا۔"),
    ASK_MORE_PROOF: ("Please send the extra proof so we can continue.", "براہ کرم اضافی ثبوت بھیجیں تاکہ ہم آگے بڑھ سکیں۔"),
    ESCALATE_HUMAN: ("We are not sure, so a real officer will check your case. You have not been rejected.",
                     "ہمیں یقین نہیں، اس لیے ایک افسر آپ کا کیس خود دیکھے گا۔ آپ کی درخواست مسترد نہیں ہوئی۔"),
}


def explain(route_name: str, reasons: list[str]) -> tuple[str, str]:
    """Two short sentences (first reason + what happens next), English and Urdu."""
    first = reasons[0] if reasons else "low_confidence"
    en1, ur1 = REASON_TEXT.get(first, REASON_TEXT["low_confidence"])
    en2, ur2 = ROUTE_TEXT[route_name]
    return f"{en1} {en2}", f"{ur1} {ur2}"


def inputs_hash(obj: dict) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()


def decide(*, rule_eval: dict, identity: dict, document: dict, anomaly: dict, extra_flags: list[str] = (),
           facts: dict | None = None) -> dict:
    """Combine sub-scores into a routed, explained decision (pure; no DB)."""
    flags = set(extra_flags) | set(identity.get("flags", [])) | set(document.get("flags", [])) | set(anomaly.get("flags", []))
    if rule_eval["missing_fields"]:
        flags.add("missing_field")
    comp = composite_probability(rule_eval["rule_score"], identity["identity_match_score"],
                                 document["document_score"], anomaly["anomaly_score"])
    r = route(comp["p"], rule_eval["hard_pass"], flags, identity.get("name_scores", []))
    en, ur = explain(r["route"], r["reasons"])
    trace = {
        "engine_version": ENGINE_VERSION,
        "model_version": {"engine": ENGINE_VERSION, "anomaly": anomaly.get("model_version"),
                          "name_matcher": identity.get("matcher_version"), "vision": document.get("vision_version")},
        "p": comp["p"],
        "composite": comp,
        "weights": WEIGHTS,
        "thresholds": {"auto": AUTO_THRESHOLD, "ask": ASK_THRESHOLD, "spelling_conflict_band": SPELLING_CONFLICT_BAND},
        "costs": COSTS,
        "expected_costs": expected_costs(comp["p"]),
        "route": r["route"],
        "reasons": r["reasons"],
        "flags": r["flags"],
        "rules": {"hard": rule_eval["hard"], "soft": rule_eval["soft"], "missing_fields": rule_eval["missing_fields"]},
        "identity": {k: v for k, v in identity.items() if k not in ("record",)},
        "document": document,
        "anomaly": anomaly,
        "inputs_hash": inputs_hash(facts or {}),
        "never_auto_reject": True,
    }
    return {"route": r["route"], "probability": comp["p"], "reason_user_en": en, "reason_user_ur": ur, "trace": trace}
