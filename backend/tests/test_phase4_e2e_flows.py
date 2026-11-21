"""HARD GATE 4 — end-to-end API flows behind the PWA: offline sync idempotency, Helper Mode
consent isolation, immediate revocation, officer queue, Parchi receipts, and the frontend build."""
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, Case

REPO = Path(__file__).resolve().parents[2]


def widow_scheme(client, h) -> int:
    return next(s["id"] for s in client.get("/schemes", headers=h).json() if s["code"] == "widow-relief")


def fam(seeded, i: int) -> dict:
    return seeded["tenants"]["sindh-spd"]["families"][i]


def reset_helper_access(client, auth, username: str) -> None:
    for c in client.get("/consents", headers=auth(username)).json():
        if c["scope"] == "helper_access" and c["active"]:
            client.delete(f"/consents/{c['id']}", headers=auth(username))


def submit_as(client, auth, user: str, citizen_user_id: int | None = None, **data) -> dict:
    h = auth(user)
    body = {"scheme_id": widow_scheme(client, h), "data": {"full_name": "Helper Family", "monthly_income": 9000, **data}}
    if citizen_user_id:
        body["citizen_user_id"] = citizen_user_id
    return client.post("/cases", headers=h, json=body)


# ================================================================= (a) offline sync idempotency
def test_offline_batch_sync_twice_creates_exactly_one_case(client, auth, db):
    h = auth("sindh.citizen")
    sid = widow_scheme(client, h)
    key = f"evt-{uuid.uuid4()}"
    batch = {"events": [
        {"client_event_id": key, "kind": "case_submit",
         "payload": {"scheme_id": sid, "data": {"full_name": "Offline Widow", "monthly_income": 11000}}},
        {"client_event_id": f"evt-{uuid.uuid4()}", "kind": "voice_transcript", "payload": {"text": "pandrah hazar"}},
    ]}
    first = client.post("/sync", headers=h, json=batch).json()
    second = client.post("/sync", headers=h, json=batch).json()
    assert first["applied"] == 2 and first["duplicates"] == 0
    assert second["applied"] == 0 and second["duplicates"] == 2
    case_id = first["results"][0]["result"]["case_id"]
    assert second["results"][0]["result"]["case_id"] == case_id
    db.expire_all()
    assert db.execute(select(func.count(Case.id)).where(Case.client_event_id == key)).scalar() == 1
    # and the same key through the normal endpoint still maps to the same case
    again = client.post("/cases", headers=h, json={"scheme_id": sid, "data": {}, "client_event_id": key}).json()
    assert again["id"] == case_id and again["idempotent_replay"] is True


def test_sync_partial_payload_does_not_fail_batch_and_keys_are_user_bound(client, auth):
    h = auth("sindh.citizen")
    sid = widow_scheme(client, h)
    good, bad = f"evt-{uuid.uuid4()}", f"evt-{uuid.uuid4()}"
    r = client.post("/sync", headers=h, json={"events": [
        {"client_event_id": bad, "kind": "case_submit", "payload": {"data": {"full_name": "no scheme"}}},
        {"client_event_id": good, "kind": "case_submit", "payload": {"scheme_id": sid, "data": {"full_name": "ok"}}},
    ]}).json()
    assert [x["status"] for x in r["results"]] == ["error", "applied"]
    # another user replaying someone else's key is a conflict, never a data leak
    other = client.post("/sync", headers=auth("sindh.family02"), json={"events": [
        {"client_event_id": good, "kind": "case_submit", "payload": {"scheme_id": sid, "data": {}}}]}).json()
    assert other["results"][0]["status"] == "conflict" and "result" not in other["results"][0]
    assert client.post("/sync", headers=auth("sindh.officer"), json={"events": []}).status_code == 403


# ================================================================= (b) helper mode consent isolation
def test_helper_switching_between_two_families_enforces_separate_consents(client, auth, seeded, db):
    fa, fb = fam(seeded, 1), fam(seeded, 2)  # family02, family03
    for f in (fa, fb):
        reset_helper_access(client, auth, f["username"])
    case_a = submit_as(client, auth, fa["username"]).json()
    case_b = submit_as(client, auth, fb["username"]).json()
    h = auth("sindh.helper")

    families = {f["citizen_user_id"]: f for f in client.get("/helper/families", headers=h).json()}
    assert len(families) >= 5
    assert families[fa["user_id"]]["consent"]["helper_access"] is False
    assert families[fa["user_id"]]["cnic_last4"] and len(families[fa["user_id"]]["cnic_last4"]) == 4

    # Wrong PIN never unlocks; correct PIN unlocks but consent is still required to act
    assert client.post(f"/helper/families/{fa['user_id']}/unlock", headers=h, json={"pin": "9999"}).status_code == 403
    u = client.post(f"/helper/families/{fa['user_id']}/unlock", headers=h, json={"pin": fa["pin"]}).json()
    assert u["can_act"] is False
    assert client.get(f"/cases/{case_a['id']}", headers=h).status_code == 403

    # Family A grants helper_access with its own PIN on the shared phone
    g = client.post("/consents", headers=h, json={"scope": "helper_access", "citizen_user_id": fa["user_id"], "family_pin": fa["pin"]})
    assert g.status_code == 201
    assert client.get(f"/cases/{case_a['id']}", headers=h).status_code == 200

    # Switch to family B: A's consent does not carry over
    u2 = client.post(f"/helper/families/{fb['user_id']}/unlock", headers=h,
                     json={"pin": fb["pin"], "from_citizen_user_id": fa["user_id"]}).json()
    assert u2["can_act"] is False
    assert client.get(f"/cases/{case_b['id']}", headers=h).status_code == 403
    assert submit_as(client, auth, "sindh.helper", citizen_user_id=fb["user_id"]).status_code == 403
    # Family A's PIN cannot be used to grant consent for family B
    assert client.post("/consents", headers=h, json={"scope": "helper_access", "citizen_user_id": fb["user_id"],
                                                      "family_pin": fa["pin"]}).status_code == 403
    client.post("/consents", headers=h, json={"scope": "helper_access", "citizen_user_id": fb["user_id"], "family_pin": fb["pin"]})
    assert client.get(f"/cases/{case_b['id']}", headers=h).status_code == 200
    assert submit_as(client, auth, "sindh.helper", citizen_user_id=fb["user_id"]).status_code == 201

    # A withdraws: A locked, B unaffected
    reset_helper_access(client, auth, fa["username"])
    assert client.get(f"/cases/{case_a['id']}", headers=h).status_code == 403
    assert client.get(f"/cases/{case_b['id']}", headers=h).status_code == 200

    db.expire_all()
    switches = db.execute(select(AuditLog).where(AuditLog.action == "helper.family_switch")).scalars().all()
    assert any(s.payload.get("from_citizen_user_id") == fa["user_id"] and s.payload.get("to_citizen_user_id") == fb["user_id"]
               for s in switches)
    assert client.post("/helper/lock", headers=h, json={"citizen_user_id": fb["user_id"]}).json()["locked"]


def test_helper_pin_bruteforce_is_rate_limited(client, auth, seeded):
    f = fam(seeded, 4)
    h = auth("sindh.helper")
    codes = [client.post(f"/helper/families/{f['user_id']}/unlock", headers=h, json={"pin": "0000"}).status_code for _ in range(7)]
    assert codes[:5] == [403] * 5 and 429 in codes[5:]


# ================================================================= (c) revocation hides data immediately
def test_citizen_revocation_hides_data_from_officer_immediately(client, auth, seeded):
    f = fam(seeded, 3)["username"]  # family04
    case = submit_as(client, auth, f, full_name="Revocation Test").json()
    cid = client.post("/consents", headers=auth(f), json={"scope": "identity"}).json()["id"]
    off = auth("sindh.officer")
    assert client.get(f"/officer/cases/{case['id']}/review", headers=off).status_code == 200
    queue = {i["case_id"]: i for i in client.get("/officer/queue", headers=off).json()}
    assert queue[case["id"]]["locked"] is False and queue[case["id"]]["applicant_name"] == "Revocation Test"

    # every active identity consent withdrawn ("Who Has My Data" one-tap switch)
    for c in client.get("/consents", headers=auth(f)).json():
        if c["scope"] == "identity" and c["active"]:
            client.delete(f"/consents/{c['id']}", headers=auth(f))
    assert client.get(f"/officer/cases/{case['id']}/review", headers=off).status_code == 403
    assert client.get(f"/cases/{case['id']}", headers=off).status_code == 403
    queue = {i["case_id"]: i for i in client.get("/officer/queue", headers=off).json()}
    assert queue[case["id"]]["locked"] is True and queue[case["id"]]["applicant_name"] is None
    assert cid


# ================================================================= officer queue + receipts
def test_officer_queue_sorted_by_lowest_confidence_with_diff(client, auth):
    off = auth("sindh.officer")
    client.post("/consents", headers=auth("sindh.citizen"), json={"scope": "identity"})
    submit_as(client, auth, "sindh.citizen", monthly_income=95000)                       # hard-rule fail
    submit_as(client, auth, "sindh.citizen", document={"ocr_confidence": 0.9, "quality_score": 0.3})  # blurry
    q = [i for i in client.get("/officer/queue", headers=off).json() if not i["locked"]]
    assert len(q) >= 2
    probs = [i["probability"] for i in q]
    assert probs == sorted(probs)
    review = client.get(f"/officer/cases/{q[0]['case_id']}/review", headers=off).json()
    assert {"input", "ocr", "registry", "mismatch"} <= set(review["diff"][0])
    assert "trace" in review and review["consent_scopes"]
    assert client.get("/officer/queue", headers=auth("sindh.citizen")).status_code == 403


def test_parchi_receipt_qr_pin_and_public_verify(client, auth):
    case = submit_as(client, auth, "sindh.citizen").json()
    rc = client.get(f"/cases/{case['id']}/receipt", headers=auth("sindh.citizen")).json()
    assert len(rc["pin"]) == 6 and rc["pin"].isdigit()
    assert rc["color"] in {"green", "yellow", "blue"} and rc["status_ur"] and rc["qr"].startswith("LMPARCHI|")
    ok = client.post("/receipts/verify", json={"qr": rc["qr"]}).json()
    assert ok["valid"] and ok["status"] == rc["status"] and "full_name" not in ok  # no PII
    forged = rc["qr"].rsplit("|", 1)[0] + "|deadbeef0000"
    assert client.post("/receipts/verify", json={"qr": forged}).json() == {"valid": False, "reason": "forged_parchi"}
    assert client.post("/receipts/verify", json={"case_id": case["id"], "pin": rc["pin"]}).json()["valid"]
    assert client.post("/receipts/verify", json={"case_id": case["id"], "pin": "000000"}).json()["valid"] is False
    assert client.get(f"/cases/{case['id']}/receipt", headers=auth("sindh.family02")).status_code == 403


# ================================================================= (d) frontend build
def _npm() -> str | None:
    portable = Path(os.environ.get("LOCALAPPDATA", "")) / "nodejs-portable"
    extra = [str(p) for p in portable.glob("node-*")] if portable.exists() else []
    path = os.pathsep.join(extra + [os.environ.get("PATH", "")])
    os.environ["PATH"] = path
    return shutil.which("npm", path=path)


@pytest.mark.timeout(600) if hasattr(pytest.mark, "timeout") else (lambda f: f)
def test_frontend_production_build_has_zero_type_errors():
    npm = _npm()
    assert npm, "npm not found (install Node.js LTS)"
    res = subprocess.run([npm, "run", "build"], cwd=REPO / "frontend", capture_output=True, text=True,
                         encoding="utf-8", errors="replace", timeout=600)
    out = res.stdout + res.stderr
    assert res.returncode == 0, out[-4000:]
    assert "Type error" not in out and "Failed to compile" not in out
    for route in ("/citizen", "/helper", "/scam", "/officer", "/admin", "/auditor", "/eval"):
        assert route in out, f"route {route} missing from build output"


def test_officer_review_lists_documents_and_receipt_carries_officer_reason(client, auth, seeded):
    """Officer sees attached-document metadata; a rejected citizen sees the officer's exact reason."""
    cit = auth("sindh.citizen")
    for scope in ("identity", "income", "documents"):
        client.post("/consents", json={"scope": scope}, headers=cit)
    scheme_id = client.get("/schemes", headers=cit).json()[0]["id"]
    case = client.post("/cases", json={"scheme_id": scheme_id, "data": {"full_name": "Test Person", "cnic": "4210100000001"}},
                       headers=cit).json()
    off = auth("sindh.officer")
    assert any(i["case_id"] == case["id"] for i in client.get("/officer/queue", headers=off).json())
    review = client.get(f"/officer/cases/{case['id']}/review", headers=off).json()
    assert review["documents"] == [] and review["documents_hidden"] is False
    r = client.post(f"/cases/{case['id']}/officer-action", json={"action": "reject", "reason": "Income above limit"}, headers=off)
    assert r.status_code == 200
    rc = client.get(f"/cases/{case['id']}/receipt", headers=cit).json()
    assert rc["status"] == "OFFICER_REJECTED" and rc["officer_reason"] == "Income above limit" and rc["decided_by_officer"]
