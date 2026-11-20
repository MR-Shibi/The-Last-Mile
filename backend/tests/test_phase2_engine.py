"""HARD GATE 2 — versioned rules, Digital Twin, cost-gated decision engine, explainability."""
import itertools

import pytest
from sqlalchemy import func, select

from app.models import Decision, MockRegistry, RuleVersion
from app.services.decision_engine import (ASK_MORE_PROOF, ASK_THRESHOLD, AUTO_RECOMMEND, AUTO_THRESHOLD,
                                          ENGINE_ROUTES, ESCALATE_HUMAN, composite_probability, expected_costs,
                                          route)

GOOD_DOC = {"ocr_confidence": 0.97, "quality_score": 0.97, "forgery_score": 0.01}
_used: set[str] = set()


def clean_record(db) -> MockRegistry:
    """A clean, unique-CNIC widow from the synthetic registry not used by another test yet."""
    dup = select(MockRegistry.cnic).group_by(MockRegistry.cnic).having(func.count(MockRegistry.id) > 1)
    rows = db.execute(select(MockRegistry).where(MockRegistry.data_quality_note == "clean",
                                                 MockRegistry.father_name.is_not(None),
                                                 MockRegistry.cnic.not_in(dup))
                      .order_by(MockRegistry.id)).scalars().all()
    for r in rows:
        if r.cnic not in _used:
            _used.add(r.cnic)
            return r
    raise RuntimeError("ran out of clean registry rows")


def application(rec: MockRegistry, **over) -> dict:
    base = {"full_name": rec.full_name, "father_name": rec.father_name, "cnic": rec.cnic, "dob": rec.dob,
            "province": "Sindh", "monthly_income": 15000, "is_widow": True, "dependents": 2,
            "receives_other_grant": False, "document": dict(GOOD_DOC)}
    base.update(over)
    return base


def widow_scheme(client, h) -> int:
    return next(s["id"] for s in client.get("/schemes", headers=h).json() if s["code"] == "widow-relief")


def submit(client, auth, data: dict, user: str = "sindh.citizen") -> dict:
    h = auth(user)
    r = client.post("/cases", headers=h, json={"scheme_id": widow_scheme(client, h), "data": data})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def _officer_consent(client, auth):
    client.post("/consents", headers=auth("sindh.citizen"), json={"scope": "identity"})
    client.post("/consents", headers=auth("sindh.citizen"), json={"scope": "income"})


# ---------------------------------------------------------------- pure routing math
def test_threshold_derivation_from_costs():
    assert AUTO_THRESHOLD == pytest.approx(0.95)
    assert ASK_THRESHOLD == 0.70
    # At p=0.95 auto and human review break even; above it auto is cheaper
    c = expected_costs(0.95)
    assert c[AUTO_RECOMMEND] == pytest.approx(c[ESCALATE_HUMAN])
    assert expected_costs(0.97)[AUTO_RECOMMEND] < 1 < expected_costs(0.90)[AUTO_RECOMMEND]
    # Asking for more proof beats escalation above ~0.667 (rounded to 0.70)
    assert expected_costs(0.70)[ASK_MORE_PROOF] < 1 < expected_costs(0.60)[ASK_MORE_PROOF]


@pytest.mark.parametrize("p,expected", [
    (0.97, AUTO_RECOMMEND), (0.95, AUTO_RECOMMEND), (0.9499, ASK_MORE_PROOF), (0.82, ASK_MORE_PROOF),
    (0.70, ASK_MORE_PROOF), (0.6999, ESCALATE_HUMAN), (0.55, ESCALATE_HUMAN), (0.0, ESCALATE_HUMAN),
])
def test_boundary_routing(p, expected):
    assert route(p, hard_pass=True, flags=[])["route"] == expected


def test_failed_hard_rule_escalates_even_at_high_p():
    r = route(0.99, hard_pass=False, flags=[])
    assert r["route"] == ESCALATE_HUMAN and "hard_rule_failed" in r["reasons"]


@pytest.mark.parametrize("flag", ["tamper_suspected", "duplicate_cnic", "dpi_timeout", "prompt_injection", "qr_mismatch"])
def test_red_flags_force_escalation(flag):
    assert route(0.99, True, [flag])["route"] == ESCALATE_HUMAN


def test_fixable_gap_asks_for_proof_and_spelling_conflict_escalates():
    assert route(0.99, True, ["blurry_photo"])["route"] == ASK_MORE_PROOF
    assert route(0.40, True, ["missing_field"])["route"] == ASK_MORE_PROOF
    r = route(0.99, True, [], name_scores=[0.85, 1.0])
    assert r["route"] == ESCALATE_HUMAN and r["reasons"] == ["name_spelling_conflict"]
    assert route(0.99, True, [], name_scores=[0.95, 0.99])["route"] == AUTO_RECOMMEND
    assert route(0.99, True, ["statistical_outlier"])["route"] == ASK_MORE_PROOF  # anomaly blocks AUTO


def test_never_auto_reject_exhaustive():
    flags = ["tamper_suspected", "blurry_photo", "missing_field", "statistical_outlier", "dpi_timeout"]
    combos = [list(c) for n in range(3) for c in itertools.combinations(flags, n)]
    for p in [i / 20 for i in range(21)]:
        for hp in (True, False):
            for fl in combos:
                assert route(p, hp, fl)["route"] in ENGINE_ROUTES


def test_min_guard_prevents_averaging_away_a_red_flag():
    c = composite_probability(rule_score=1.0, identity_match_score=1.0, document_score=0.1, anomaly_score=0.0)
    assert c["weighted_mean"] > 0.8
    assert c["p"] == pytest.approx(0.25) and c["min_guard_applied"] and c["weakest_component"] == "document_score"
    clean = composite_probability(1.0, 1.0, 0.93, 0.0)
    assert clean["p"] >= 0.95 and not clean["min_guard_applied"]


# ---------------------------------------------------------------- end-to-end engine
def test_e2e_auto_recommend_with_two_layer_explanation(client, auth, db):
    case = submit(client, auth, application(clean_record(db)))
    d = case["decision"]
    assert d["route"] == AUTO_RECOMMEND, d
    assert d["probability"] >= 0.95
    assert d["reason_user_en"].count(".") >= 2 and d["reason_user_ur"].count("۔") >= 2
    trace = client.get(f"/decisions/{d['id']}/trace", headers=auth("sindh.officer")).json()["trace"]
    for key in ("rule_version_id", "model_version", "inputs_hash", "flags", "composite", "expected_costs"):
        assert key in trace, key
    assert set(trace["composite"]["components"]) == {"rule_score", "identity_match_score", "document_score", "anomaly_inverse"}
    assert len(trace["inputs_hash"]) == 64 and trace["never_auto_reject"] is True


def test_e2e_blurry_photo_asks_more_proof(client, auth, db):
    doc = {"ocr_confidence": 0.9, "quality_score": 0.3, "forgery_score": 0.0}
    d = submit(client, auth, application(clean_record(db), document=doc))["decision"]
    assert d["route"] == ASK_MORE_PROOF and "blurry" in d["reason_user_en"].lower()


def test_e2e_hard_rule_failure_escalates_never_rejects(client, auth, db):
    case = submit(client, auth, application(clean_record(db), monthly_income=60000))
    assert case["decision"]["route"] == ESCALATE_HUMAN
    assert case["status"] == ESCALATE_HUMAN
    assert "not been rejected" in case["decision"]["reason_user_en"]


def test_e2e_missing_field_asks_more_proof(client, auth, db):
    data = application(clean_record(db))
    data.pop("monthly_income")
    assert submit(client, auth, data)["decision"]["route"] == ASK_MORE_PROOF


def test_e2e_nadra_timeout_escalates(client, auth, db):
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"nadra_timeout": True})
    d = submit(client, auth, application(clean_record(db)))["decision"]
    assert d["route"] == ESCALATE_HUMAN
    trace = client.get(f"/decisions/{d['id']}/trace", headers=auth("sindh.officer")).json()["trace"]
    assert "dpi_timeout" in trace["flags"]


def test_e2e_force_low_ocr_asks_more_proof(client, auth, db):
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"force_low_ocr": True})
    d = submit(client, auth, application(clean_record(db)))["decision"]
    assert d["route"] == ASK_MORE_PROOF and "read" in d["reason_user_en"].lower()


def test_e2e_tampered_document_and_unknown_cnic_escalate(client, auth, db):
    d1 = submit(client, auth, application(clean_record(db), document={**GOOD_DOC, "forgery_score": 0.8}))["decision"]
    assert d1["route"] == ESCALATE_HUMAN
    d2 = submit(client, auth, application(clean_record(db), cnic="42101-0000000-0"))["decision"]
    assert d2["route"] in (ESCALATE_HUMAN, ASK_MORE_PROOF)  # not in registry or invalid synthetic checksum


def test_e2e_duplicate_cnic_across_citizens_escalates(client, auth, db):
    rec = clean_record(db)
    first = submit(client, auth, application(rec), user="sindh.citizen")["decision"]
    assert first["route"] == AUTO_RECOMMEND
    client.post("/consents", headers=auth("sindh.family04"), json={"scope": "identity"})
    second = submit(client, auth, application(rec), user="sindh.family04")["decision"]
    assert second["route"] == ESCALATE_HUMAN
    trace = client.get(f"/decisions/{second['id']}/trace", headers=auth("sindh.officer")).json()["trace"]
    assert "duplicate_cnic" in trace["flags"]


# ---------------------------------------------------------------- versioning + digital twin
def test_rule_versioning_and_digital_twin(client, auth, db):
    h_admin = auth("sindh.admin")
    sid = widow_scheme(client, h_admin)
    v_before = client.get(f"/rules/{sid}", headers=h_admin).json()
    v1 = v_before["active"]
    assert v1["version"] >= 1

    # Old case under v1: income 32,000 fails the 30,000 cap -> escalated
    old = submit(client, auth, application(clean_record(db), monthly_income=32000))
    old_dec = old["decision"]
    assert old_dec["route"] == ESCALATE_HUMAN and old_dec["rule_version_id"] == v1["id"]

    # Digital Twin: candidate raises the cap to 35,000
    candidate = {**v1["rules_json"]}
    candidate["hard"] = [({**r, "value": 35000} if r["id"] == "income_cap" else r) for r in v1["rules_json"]["hard"]]
    n_dec = db.execute(select(func.count(Decision.id))).scalar()
    n_rv = db.execute(select(func.count(RuleVersion.id))).scalar()
    sim = client.post("/rules/simulate", headers=h_admin, json={"scheme_id": sid, "rules_json": candidate}).json()
    db.expire_all()
    assert db.execute(select(func.count(Decision.id))).scalar() == n_dec  # no decisions written
    assert db.execute(select(func.count(RuleVersion.id))).scalar() == n_rv  # no rule version written
    assert sim["mutated_db"] is False
    assert old["id"] in sim["changed_case_ids"]
    assert sim["projected_escalated"] < sim["baseline_escalated"]
    assert sim["projected_approved"] > sim["baseline_approved"]
    assert sim["synthetic_cases"] == 40 and sim["real_cases"] >= 1
    # Synthetic incomes 31k..35k (5 widows minus non-widows) flip; 36k+ must not
    flipped_syn = {c for c in sim["changed_case_ids"] if isinstance(c, str)}
    assert flipped_syn and all(10000 + (int(c[4:]) - 1) * 1000 <= 35000 for c in flipped_syn)

    # Publish v2 -> takes effect immediately, no redeploy
    v2 = client.post(f"/rules/{sid}/publish", headers=h_admin, json={"rules_json": candidate, "notes": "raise cap"}).json()
    assert v2["version"] == v1["version"] + 1 and v2["is_active"]
    new = submit(client, auth, application(clean_record(db), monthly_income=32000))
    assert new["decision"]["rule_version_id"] == v2["id"]
    assert new["decision"]["route"] == AUTO_RECOMMEND

    # The old decision's trace still reports v1 forever
    t_old = client.get(f"/decisions/{old_dec['id']}/trace", headers=auth("sindh.officer")).json()
    assert t_old["rule_version_id"] == v1["id"] and t_old["trace"]["rule_version"] == v1["version"]
    t_new = client.get(f"/decisions/{new['decision']['id']}/trace", headers=auth("sindh.officer")).json()
    assert t_new["trace"]["rule_version"] == v2["version"]
    history = client.get(f"/rules/{sid}", headers=h_admin).json()["versions"]
    assert [v["version"] for v in history][:2] == [v2["version"], v1["version"]]
    assert sum(v["is_active"] for v in history) == 1


def test_rule_validation_and_publish_rbac(client, auth):
    sid = widow_scheme(client, auth("sindh.admin"))
    bad = {"hard": [{"id": "x", "field": "age", "op": "DROP TABLE", "value": 1}]}
    assert client.post(f"/rules/{sid}/publish", headers=auth("sindh.admin"), json={"rules_json": bad}).status_code == 422
    ok = {"hard": [], "soft": []}
    for who in ("sindh.officer", "sindh.citizen", "sindh.auditor", "punjab.admin"):
        assert client.post(f"/rules/{sid}/publish", headers=auth(who), json={"rules_json": ok}).status_code == 403
        assert client.post("/rules/simulate", headers=auth(who), json={"scheme_id": sid, "rules_json": ok}).status_code == 403


# ---------------------------------------------------------------- human guardrails
def test_officer_reject_requires_reason_and_disburse_guardrail(client, auth, db):
    h = auth("sindh.officer")
    esc = submit(client, auth, application(clean_record(db), monthly_income=90000))
    assert client.post(f"/cases/{esc['id']}/disburse", headers=h).status_code == 409  # not payable
    assert client.post(f"/cases/{esc['id']}/officer-action", headers=h, json={"action": "reject"}).status_code == 422
    rej = client.post(f"/cases/{esc['id']}/officer-action", headers=h,
                      json={"action": "reject", "reason": "Income far above cap per salary slip"})
    assert rej.status_code == 200 and rej.json()["route"] == "OFFICER_REJECTED" and rej.json()["decided_by"].startswith("officer:")

    auto = submit(client, auth, application(clean_record(db)))
    assert auto["decision"]["route"] == AUTO_RECOMMEND and auto["status"] == AUTO_RECOMMEND  # recommended, not paid
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"raast_error": True})
    assert client.post(f"/cases/{auto['id']}/disburse", headers=h).status_code == 502
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"raast_error": False})
    paid = client.post(f"/cases/{auto['id']}/disburse", headers=h)
    assert paid.status_code == 200 and paid.json()["status"] == "PAID"
    assert client.post(f"/cases/{auto['id']}/disburse", headers=h).status_code == 409  # no double payment


def test_trace_access_control(client, auth, db):
    d = submit(client, auth, application(clean_record(db)))["decision"]
    assert client.get(f"/decisions/{d['id']}/trace", headers=auth("sindh.auditor")).status_code == 200
    assert client.get(f"/decisions/{d['id']}/trace", headers=auth("punjab.officer")).status_code == 403
    assert client.get(f"/decisions/{d['id']}/trace", headers=auth("punjab.auditor")).status_code == 403
    assert client.get(f"/decisions/{d['id']}/trace", headers=auth("sindh.family02")).status_code == 403
