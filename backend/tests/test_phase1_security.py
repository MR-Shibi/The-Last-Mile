"""HARD GATE 1 — RBAC, tenant isolation, revocable consent, hash-chained audit, API keys,
rate limiting and mock DPI fault injection."""
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.core.audit import verify_rows
from app.models import AuditLog, MockRegistry

BACKEND = Path(__file__).resolve().parents[1]


def scheme_id(client, headers) -> int:
    schemes = client.get("/schemes", headers=headers).json()
    return next(s["id"] for s in schemes if s["code"] == "widow-relief")


def new_case(client, auth, username: str, **data) -> dict:
    h = auth(username)
    payload = {"full_name": "Shazia Bibi", "cnic": "42101-1234567-1", "monthly_income": 15000,
               "province": "Sindh", "age": 41, "is_widow": True, **data}
    r = client.post("/cases", headers=h, json={"scheme_id": scheme_id(client, h), "data": payload})
    assert r.status_code == 201, r.text
    return r.json()


def grant(client, auth, username: str, scope: str) -> dict:
    r = client.post("/consents", headers=auth(username), json={"scope": scope})
    assert r.status_code == 201, r.text
    return r.json()


def audit_actions(client, auth) -> list[str]:
    return [row["action"] for row in client.get("/audit/logs?limit=1000", headers=auth("sindh.auditor")).json()]


# ---------------------------------------------------------------- auth basics
def test_login_refresh_and_me(client):
    r = client.post("/auth/login", json={"username": "sindh.officer", "password": "Demo@1234"})
    assert r.status_code == 200
    tok = r.json()
    assert tok["role"] == "department_officer"
    r2 = client.post("/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    assert r2.status_code == 200 and r2.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {r2.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["username"] == "sindh.officer"
    # A refresh token can't be used as an access token and vice versa
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {tok['refresh_token']}"}).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": tok["access_token"]}).status_code == 401


def test_bad_credentials_and_missing_token(client):
    assert client.post("/auth/login", json={"username": "sindh.officer", "password": "nope"}).status_code == 401
    assert client.get("/cases").status_code == 401
    assert client.get("/cases", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_all_five_roles_seeded(client, auth):
    roles = {client.get("/auth/me", headers=auth(f"sindh.{r}")).json()["role"]
             for r in ("citizen", "helper", "officer", "admin", "auditor")}
    assert roles == {"citizen", "community_helper", "department_officer", "platform_admin", "auditor"}


# ---------------------------------------------------------------- IDOR / tenant isolation
def test_cross_tenant_idor_returns_403(client, auth):
    case = new_case(client, auth, "sindh.citizen")
    grant(client, auth, "sindh.citizen", "identity")
    # Same-tenant officer can read (consent active)
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).status_code == 200
    # Every other-tenant role is blocked with 403
    for who in ("punjab.officer", "punjab.helper", "punjab.admin", "punjab.citizen", "punjab.auditor"):
        r = client.get(f"/cases/{case['id']}", headers=auth(who))
        assert r.status_code == 403, (who, r.status_code, r.text)
    # Other-tenant officer's list never contains it
    ids = [c["id"] for c in client.get("/cases", headers=auth("punjab.officer")).json()]
    assert case["id"] not in ids
    assert "tenant.idor_blocked" in audit_actions(client, auth)


def test_same_tenant_citizen_to_citizen_idor_returns_403(client, auth):
    case = new_case(client, auth, "sindh.citizen")
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.family03")).status_code == 403


def test_cross_tenant_scheme_submission_blocked(client, auth):
    punjab_scheme = scheme_id(client, auth("punjab.citizen"))
    r = client.post("/cases", headers=auth("sindh.citizen"), json={"scheme_id": punjab_scheme, "data": {}})
    assert r.status_code == 403


# ---------------------------------------------------------------- auditor read-only
@pytest.mark.parametrize("method,path,body", [
    ("POST", "/cases", {"scheme_id": 1, "data": {}}),
    ("POST", "/consents", {"scope": "identity"}),
    ("DELETE", "/consents/1", None),
    ("POST", "/admin/faults", {"nadra_timeout": True}),
    ("POST", "/admin/api-keys", {"name": "x", "scopes": ["schemes:read"]}),
    ("POST", "/mock/identity/verify", {"cnic": "42101-1234567-1", "full_name": "x"}),
    ("PUT", "/cases/1", {"status": "APPROVED"}),
    ("DELETE", "/cases/1", None),
    ("PATCH", "/audit/logs", {}),
])
def test_auditor_any_write_returns_403(client, auth, method, path, body):
    r = client.request(method, path, headers=auth("sindh.auditor"), json=body)
    assert r.status_code == 403, (method, path, r.status_code, r.text)


def test_auditor_can_read(client, auth):
    h = auth("sindh.auditor")
    assert client.get("/audit/logs", headers=h).status_code == 200
    assert client.get("/audit/verify-chain", headers=h).status_code == 200
    assert client.get("/admin/faults", headers=h).status_code == 200


def test_role_escalation_blocked(client, auth):
    for who in ("sindh.citizen", "sindh.helper", "sindh.officer"):
        assert client.post("/admin/faults", headers=auth(who), json={"nadra_timeout": True}).status_code == 403
        assert client.get("/audit/verify-chain", headers=auth(who)).status_code == 403
    # Officers cannot submit cases on someone's behalf; citizens cannot initiate payments
    assert client.post("/cases", headers=auth("sindh.officer"), json={"scheme_id": 1, "data": {}}).status_code == 403
    assert client.post("/mock/payment/initiate", headers=auth("sindh.citizen"),
                       json={"case_id": 1, "amount_pkr": 25000}).status_code == 403


# ---------------------------------------------------------------- consent gate (the core story)
def test_consent_default_off_blocks_officer_and_helper(client, auth, seeded):
    fam = seeded["tenants"]["sindh-spd"]["families"][4]  # family05: never granted anything
    case = new_case(client, auth, fam["username"])
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).status_code == 403
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.helper")).status_code == 403
    listed = {c["id"]: c for c in client.get("/cases", headers=auth("sindh.officer")).json()}
    assert listed[case["id"]]["locked"] is True and "data" not in listed[case["id"]]


def test_consent_revocation_is_immediate_and_audited(client, auth, seeded):
    fam = seeded["tenants"]["sindh-spd"]["families"][0]["username"]  # sindh.family01, linked to helper
    case = new_case(client, auth, fam)
    c_identity = grant(client, auth, fam, "identity")
    c_helper = grant(client, auth, fam, "helper_access")

    # Consent active -> officer and helper reads succeed
    r_off = client.get(f"/cases/{case['id']}", headers=auth("sindh.officer"))
    r_help = client.get(f"/cases/{case['id']}", headers=auth("sindh.helper"))
    assert r_off.status_code == 200 and r_off.json()["data"]["full_name"] == "Shazia Bibi"
    assert r_help.status_code == 200

    # Citizen withdraws -> very next read is 403
    assert client.delete(f"/consents/{c_identity['id']}", headers=auth(fam)).json()["active"] is False
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).status_code == 403
    assert client.delete(f"/consents/{c_helper['id']}", headers=auth(fam)).status_code == 200
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.helper")).status_code == 403

    # Audit log records the grant, the read, the revocation and the denial
    logs = client.get("/audit/logs?limit=1000", headers=auth("sindh.auditor")).json()
    revoked = [l for l in logs if l["action"] == "consent.revoked" and l["resource_id"] in (str(c_identity["id"]), str(c_helper["id"]))]
    denied = [l for l in logs if l["action"] == "consent.access_denied" and l["resource_id"] == str(case["id"])]
    granted_reads = [l for l in logs if l["action"] == "consent.access_granted" and l["resource_id"] == str(case["id"])]
    assert len(revoked) == 2
    assert {d["actor_role"] for d in denied} >= {"department_officer", "community_helper"}
    assert len(granted_reads) >= 2

    chain = client.get("/audit/verify-chain", headers=auth("sindh.auditor")).json()
    assert chain["valid"] is True and chain["verified_count"] > 0

    # Re-granting restores access (consent is revocable *and* re-grantable)
    grant(client, auth, fam, "identity")
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).status_code == 200


def test_field_level_redaction_without_income_consent(client, auth):
    fam = "sindh.family02"
    case = new_case(client, auth, fam, monthly_income=12000)
    grant(client, auth, fam, "identity")
    data = client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).json()["data"]
    assert data["full_name"] == "Shazia Bibi"
    assert "REDACTED" in str(data["monthly_income"])
    grant(client, auth, fam, "income")
    assert client.get(f"/cases/{case['id']}", headers=auth("sindh.officer")).json()["data"]["monthly_income"] == 12000
    # Admin oversight view is fully redacted, never raw PII
    admin_view = client.get(f"/cases/{case['id']}", headers=auth("sindh.admin")).json()["data"]
    assert all("REDACTED" in str(v) for v in admin_view.values())


def test_only_owner_can_revoke(client, auth):
    c = grant(client, auth, "sindh.family03", "identity")
    assert client.delete(f"/consents/{c['id']}", headers=auth("sindh.citizen")).status_code == 403
    assert client.delete(f"/consents/{c['id']}", headers=auth("punjab.citizen")).status_code == 403


def test_helper_family_pin_and_linking(client, auth, seeded):
    fams = seeded["tenants"]["sindh-spd"]["families"]
    fam = fams[3]
    h = auth("sindh.helper")
    bad = client.post("/consents", headers=h, json={"scope": "helper_access", "citizen_user_id": fam["user_id"],
                                                     "family_pin": "0000"})
    assert bad.status_code == 403
    ok = client.post("/consents", headers=h, json={"scope": "helper_access", "citizen_user_id": fam["user_id"],
                                                    "family_pin": fam["pin"]})
    assert ok.status_code == 201 and ok.json()["granted_via"] == "helper_pin"
    # Helper cannot act for a citizen who is not linked to them (sindh.citizen is not a family)
    citizen_id = seeded["tenants"]["sindh-spd"]["users"]["citizen"]["id"]
    r = client.post("/cases", headers=h, json={"scheme_id": scheme_id(client, h), "citizen_user_id": citizen_id, "data": {}})
    assert r.status_code == 403


# ---------------------------------------------------------------- audit chain
def test_audit_chain_detects_tampering(db):
    rows = [
        {c: getattr(r, c) for c in ("id", "tenant_id", "actor_user_id", "actor_role", "action", "resource_type",
                                    "resource_id", "payload", "ts", "prev_hash", "row_hash")}
        for r in db.execute(select(AuditLog).order_by(AuditLog.id)).scalars()
    ]
    assert len(rows) > 5
    assert verify_rows(rows)["valid"] is True
    tampered = [dict(r) for r in rows]
    tampered[2]["payload"] = {"forged": True}
    res = verify_rows(tampered)
    assert res["valid"] is False and res["broken_at"] == rows[2]["id"]
    deleted = rows[:3] + rows[4:]
    assert verify_rows(deleted)["valid"] is False


def test_audit_log_is_append_only_at_db_level(db):
    with pytest.raises(Exception, match="append-only"):
        db.execute(text("UPDATE audit_logs SET action='x' WHERE id=1"))
    db.rollback()
    with pytest.raises(Exception, match="append-only"):
        db.execute(text("DELETE FROM audit_logs WHERE id=1"))
    db.rollback()


# ---------------------------------------------------------------- API keys + rate limiting
def test_api_key_scopes_and_rate_limit_429(client, auth):
    r = client.post("/admin/api-keys", headers=auth("sindh.admin"),
                    json={"name": "partner-ngo", "scopes": ["schemes:read"], "rate_capacity": 3, "rate_refill_per_sec": 0})
    assert r.status_code == 201
    key = r.json()["api_key"]
    listed = client.get("/admin/api-keys", headers=auth("sindh.admin")).json()
    assert all("api_key" not in k and "key_hash" not in k for k in listed)  # raw/hashed key never returned again

    assert client.get("/public/schemes").status_code == 401
    assert client.get("/public/schemes", headers={"X-API-Key": "lmk_wrong"}).status_code == 401
    codes = [client.get("/public/schemes", headers={"X-API-Key": key}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r429 = client.get("/public/schemes", headers={"X-API-Key": key})
    assert r429.status_code == 429 and "Retry-After" in r429.headers


def test_api_key_wrong_scope_403(client, auth):
    key = client.post("/admin/api-keys", headers=auth("sindh.admin"),
                      json={"name": "scam-only", "scopes": ["scam:check"]}).json()["api_key"]
    assert client.get("/public/schemes", headers={"X-API-Key": key}).status_code == 403


# ---------------------------------------------------------------- mock DPI + fault injection
def test_mock_registry_seeded_with_dirty_data(db):
    assert db.execute(select(func.count(MockRegistry.id))).scalar() == 50
    names = " ".join(n or "" for n in db.execute(select(MockRegistry.father_name)).scalars())
    for variant in ("Muhammad", "Mohammad", "Muhammed"):
        assert variant in names
    notes = set(db.execute(select(MockRegistry.data_quality_note)).scalars())
    assert {"missing_father_name", "missing_income", "duplicate_spelling_variant", "exact_duplicate"} <= notes
    dup_cnics = db.execute(select(MockRegistry.cnic).group_by(MockRegistry.cnic)
                           .having(func.count(MockRegistry.id) > 1)).scalars().all()
    assert len(dup_cnics) >= 4


def test_identity_verify_and_nadra_timeout_fault(client, auth, db):
    rec = db.execute(select(MockRegistry).where(MockRegistry.data_quality_note == "clean")).scalars().first()
    body = {"cnic": rec.cnic, "full_name": rec.full_name, "father_name": rec.father_name}
    h = auth("sindh.officer")
    ok = client.post("/mock/identity/verify", headers=h, json=body)
    assert ok.status_code == 200 and ok.json()["found"] and ok.json()["checksum_valid"]
    assert ok.json()["matches"][0]["name_score"] == 1.0

    assert client.post("/admin/faults", headers=auth("sindh.admin"), json={"nadra_timeout": True}).json()["nadra_timeout"]
    t = client.post("/mock/identity/verify", headers=h, json=body)
    assert t.status_code == 504 and t.json()["error"] == "NADRA_TIMEOUT" and t.json()["fallback"] == "ESCALATE_HUMAN"

    client.post("/admin/faults", headers=auth("sindh.admin"), json={"nadra_timeout": False})
    assert client.post("/mock/identity/verify", headers=h, json=body).status_code == 200


def test_payment_and_raast_error_fault(client, auth):
    h = auth("sindh.officer")
    ok = client.post("/mock/payment/initiate", headers=h, json={"case_id": 1, "amount_pkr": 25000})
    assert ok.status_code == 200 and ok.json()["txn_id"].startswith("RAAST-SIM-")
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"raast_error": True})
    err = client.post("/mock/payment/initiate", headers=h, json={"case_id": 1, "amount_pkr": 25000})
    assert err.status_code == 502 and err.json()["error"] == "RAAST_ERROR"


def test_force_low_ocr_fault_and_qr_lookup(client, auth, db):
    h = auth("sindh.officer")
    assert client.post("/mock/ocr/extract", headers=h, json={}).json()["ocr_confidence"] > 0.9
    client.post("/admin/faults", headers=auth("sindh.admin"), json={"force_low_ocr": True})
    low = client.post("/mock/ocr/extract", headers=h, json={}).json()
    assert low["ocr_confidence"] < 0.5 and low["fallback"] == "ASK_MORE_PROOF"
    state = client.get("/admin/faults", headers=auth("sindh.admin")).json()
    assert state == {"nadra_timeout": False, "raast_error": False, "force_low_ocr": True}

    qr = db.execute(select(MockRegistry.qr_code)).scalars().first()
    assert client.get(f"/mock/registry/qr/{qr}", headers=h).json()["valid"] is True
    assert client.get("/mock/registry/qr/QR-FORGED000000", headers=h).status_code == 404


def test_unknown_fault_rejected(client, auth):
    r = client.post("/admin/faults", headers=auth("sindh.admin"), json={"delete_everything": True})
    assert r.status_code == 200 and "delete_everything" not in r.json()  # extra fields ignored, state unchanged


# ---------------------------------------------------------------- migrations + seed script
def test_alembic_migration_creates_all_tables(tmp_path):
    url = f"sqlite:///{(tmp_path / 'mig.db').as_posix()}"
    alembic = Path(sys.executable).with_name("alembic.exe" if sys.platform == "win32" else "alembic")
    res = subprocess.run([str(alembic), "-x", f"url={url}", "upgrade", "head"], cwd=BACKEND,
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    from sqlalchemy import create_engine, inspect
    tables = set(inspect(create_engine(url)).get_table_names())
    expected = {"tenants", "users", "helper_links", "schemes", "rule_versions", "cases", "case_fields", "documents",
                "decisions", "consents", "audit_logs", "scam_reports", "api_keys", "sync_queue", "mock_registry"}
    assert expected <= tables
    from sqlalchemy import inspect as insp
    eng = create_engine(url)
    for t in expected - {"mock_registry"}:
        if t == "tenants":
            continue
        cols = {c["name"] for c in insp(eng).get_columns(t)}
        assert "tenant_id" in cols, f"{t} missing tenant_id"


def test_seed_script_runs_with_40_families(tmp_path):
    env = {**__import__("os").environ, "DATABASE_URL": f"sqlite:///{(tmp_path / 's.db').as_posix()}", "BCRYPT_ROUNDS": "4"}
    res = subprocess.run([sys.executable, "scripts/seed_demo.py", "--families", "40"], cwd=BACKEND, env=env,
                         capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0, res.stderr
    import json
    out = json.loads(res.stdout)
    assert len(out["tenants"]["sindh-spd"]["families"]) == 40
    assert set(out["tenants"]) == {"sindh-spd", "punjab-relief"}


def test_idempotent_case_submission(client, auth):
    h = auth("sindh.citizen")
    eid = f"evt-{uuid.uuid4()}"
    body = {"scheme_id": scheme_id(client, h), "data": {"full_name": "X"}, "client_event_id": eid}
    a = client.post("/cases", headers=h, json=body).json()
    b = client.post("/cases", headers=h, json=body).json()
    assert a["id"] == b["id"] and b["idempotent_replay"] is True
