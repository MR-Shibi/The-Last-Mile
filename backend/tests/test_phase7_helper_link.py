"""Citizen 'my community helper may help me' consent links them to their department's helper (one-time PIN)."""
import re


def test_helper_consent_links_citizen_and_surfaces_new_application(client, auth):
    cit = auth("punjab.citizen")
    r = client.post("/consents", json={"scope": "helper_access"}, headers=cit)
    assert r.status_code == 201
    body = r.json()
    assert re.fullmatch(r"\d{4}", body["helper_pin"]) and body["helper_name"]
    pin = body["helper_pin"]
    # Idempotent: a repeat grant never re-issues or rotates the PIN
    assert "helper_pin" not in client.post("/consents", json={"scope": "helper_access"}, headers=cit).json()

    scheme_id = client.get("/schemes", headers=cit).json()[0]["id"]
    case = client.post("/cases", json={"scheme_id": scheme_id, "data": {"full_name": "Linked Person", "cnic": "3520100000017"}},
                       headers=cit).json()
    citizen_id = case["citizen_user_id"]

    helper = auth("punjab.helper")
    fams = client.get("/helper/families", headers=helper).json()
    assert any(f["citizen_user_id"] == citizen_id and f["consent"]["helper_access"] for f in fams)
    cases = client.get("/cases", headers=helper).json()
    assert any(c["id"] == case["id"] and c.get("citizen_user_id") == citizen_id for c in cases)

    ref = f"LM-{case['tenant_id']:02d}-{case['id']:06d}"
    found = client.get("/helper/lookup", params={"q": ref}, headers=helper).json()
    assert found["citizen_user_id"] == citizen_id and found["case"]["reference"] == ref and found["consent"] is True
    # The helper still needs the citizen's PIN to open the record
    assert client.post(f"/helper/families/{citizen_id}/unlock", json={"pin": "0000" if pin != "0000" else "1111"},
                       headers=helper).status_code == 403
    assert client.post(f"/helper/families/{citizen_id}/unlock", json={"pin": pin}, headers=helper).status_code == 200
    # Another department's helper can't find it
    assert client.get("/helper/lookup", params={"q": ref}, headers=auth("sindh.helper")).status_code == 404


def test_seeded_family_pin_is_never_rotated_by_self_consent(client, auth):
    fam = auth("sindh.family02")
    assert "helper_pin" not in client.post("/consents", json={"scope": "helper_access"}, headers=fam).json()
