"""Live API integration smoke test against a running server.

Usage: python scripts/smoke_api.py [--base http://127.0.0.1:8000]
Requires a freshly seeded DB (python scripts/seed_demo.py). Exits non-zero on any failure.
"""
import argparse
import sys

import httpx

PASSWORD = "Demo@1234"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base
    c = httpx.Client(base_url=base, timeout=10)
    failures: list[str] = []

    def check(name: str, cond: bool, extra: str = "") -> None:
        print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
        if not cond:
            failures.append(name)

    def login(u: str) -> dict:
        r = c.post("/auth/login", json={"username": u, "password": PASSWORD})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    check("health", c.get("/health").json()["status"] == "ok")
    check("openapi docs", c.get("/docs").status_code == 200)
    fam, off, helper, aud, adm = (login(u) for u in ("sindh.family01", "sindh.officer", "sindh.helper",
                                                      "sindh.auditor", "sindh.admin"))
    p_off = login("punjab.officer")
    sid = next(s["id"] for s in c.get("/schemes", headers=fam).json() if s["code"] == "widow-relief")
    case = c.post("/cases", headers=fam, json={"scheme_id": sid, "data": {"full_name": "Smoke Test", "monthly_income": 9000}}).json()
    check("officer blocked before consent", c.get(f"/cases/{case['id']}", headers=off).status_code == 403)
    cid = c.post("/consents", headers=fam, json={"scope": "identity"}).json()["id"]
    c.post("/consents", headers=fam, json={"scope": "helper_access"})
    check("officer reads with consent", c.get(f"/cases/{case['id']}", headers=off).status_code == 200)
    check("helper reads with consent", c.get(f"/cases/{case['id']}", headers=helper).status_code == 200)
    check("cross-tenant IDOR 403", c.get(f"/cases/{case['id']}", headers=p_off).status_code == 403)
    c.delete(f"/consents/{cid}", headers=fam)
    check("officer blocked after revoke", c.get(f"/cases/{case['id']}", headers=off).status_code == 403)
    check("auditor write 403", c.post("/admin/faults", headers=aud, json={"nadra_timeout": True}).status_code == 403)
    c.post("/admin/faults", headers=adm, json={"nadra_timeout": True})
    check("nadra timeout fault 504", c.post("/mock/identity/verify", headers=off,
                                            json={"cnic": "42101-1234567-1", "full_name": "x"}).status_code == 504)
    c.post("/admin/faults", headers=adm, json={"nadra_timeout": False})
    key = c.post("/admin/api-keys", headers=adm, json={"name": "smoke", "scopes": ["schemes:read"],
                                                        "rate_capacity": 2, "rate_refill_per_sec": 0}).json()["api_key"]
    codes = [c.get("/public/schemes", headers={"X-API-Key": key}).status_code for _ in range(3)]
    check("rate limiter 429", codes == [200, 200, 429], str(codes))
    chain = c.get("/audit/verify-chain", headers=aud).json()
    check("audit chain valid", chain["valid"] is True, f"verified_count={chain['verified_count']}")

    print(f"\n{'ALL PASS' if not failures else 'FAILURES: ' + ', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
