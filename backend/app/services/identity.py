"""Identity match scoring against the (mock) registry: CNIC + fuzzy name + father name."""
from rapidfuzz.distance import JaroWinkler
from sqlalchemy.orm import Session

from app.services import faults
from app.services.cnic import is_valid_cnic, normalize_cnic

MATCHER_VERSION = "rapidfuzz-jw-basic-v1"


def name_similarity(a: str | None, b: str | None) -> float | None:
    """Phase 2 baseline (lower-cased Jaro-Winkler). Replaced by app.ml.name_matcher in Phase 3."""
    try:
        from app.ml.name_matcher import name_similarity as advanced  # noqa: PLC0415
        return advanced(a, b)
    except ImportError:
        pass
    if not a or not b:
        return None
    return JaroWinkler.normalized_similarity(" ".join(a.lower().split()), " ".join(b.lower().split()))


def matcher_version() -> str:
    try:
        from app.ml.name_matcher import MATCHER_VERSION as v  # noqa: PLC0415
        return v
    except ImportError:
        return MATCHER_VERSION


def assess_identity(db: Session, data: dict, *, honour_faults: bool = True) -> dict:
    from app.api.mock_dpi import lookup_identity  # local import avoids a cycle

    base = {"matcher_version": matcher_version(), "name_scores": [], "registry_duplicates": 0}
    if honour_faults and faults.is_active("nadra_timeout"):
        return {**base, "identity_match_score": 0.5, "flags": ["dpi_timeout"], "status": "NADRA_TIMEOUT"}
    raw_cnic = data.get("cnic")
    cnic = normalize_cnic(raw_cnic)
    if not cnic or not is_valid_cnic(cnic):
        return {**base, "identity_match_score": 0.3, "flags": ["invalid_cnic_format"], "status": "INVALID_CNIC"}
    res = lookup_identity(db, cnic, data.get("full_name") or "", data.get("father_name"))
    if not res["found"]:
        return {**base, "identity_match_score": 0.0, "flags": ["not_in_registry"], "status": "NOT_FOUND"}

    best = None
    for m in res["matches"]:
        ns = name_similarity(data.get("full_name"), m["full_name"]) or 0.0
        fs = name_similarity(data.get("father_name"), m["father_name"])
        score = 0.6 * ns + 0.4 * (fs if fs is not None else 0.8)
        cand = {"registry_id": m["registry_id"], "name_score": round(ns, 4),
                "father_score": None if fs is None else round(fs, 4), "score": round(score, 4),
                "registry_name": m["full_name"], "registry_father": m["father_name"],
                "registry_province": m["province"], "registry_marital_status": m["marital_status"],
                "registry_income": m["monthly_income"]}
        if best is None or cand["score"] > best["score"]:
            best = cand
    flags: list[str] = []
    return {**base, "identity_match_score": best["score"], "flags": flags, "status": "FOUND",
            "best_match": best, "registry_duplicates": res["duplicate_records"],
            "name_scores": [s for s in (best["name_score"], best["father_score"]) if s is not None]}
