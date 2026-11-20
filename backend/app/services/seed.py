"""Idempotent demo seed: 2 tenants, all 5 roles per tenant, a community helper linked to N
families (default 5, up to 40), schemes with v1 rules, and the 50-row mock registry."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (Consent, ConsentScope, HelperLink, MockRegistry, Role, RuleVersion, Scheme,
                        Tenant, User)
from app.services.mock_registry_data import build_registry

DEMO_PASSWORD = "Demo@1234"

TENANTS = [
    {"code": "sindh-spd", "name": "Sindh Social Protection", "province": "Sindh", "prefix": "sindh"},
    {"code": "punjab-relief", "name": "Punjab Relief Dept", "province": "Punjab", "prefix": "punjab"},
]

WIDOW_RULES_V1 = {
    "hard": [
        {"id": "age_min", "field": "age", "op": ">=", "value": 18, "label": "Applicant is 18 or older"},
        {"id": "province", "field": "province", "op": "in", "value": ["Sindh", "Punjab"], "label": "Lives in Sindh or Punjab"},
        {"id": "income_cap", "field": "monthly_income", "op": "<=", "value": 30000, "label": "Monthly household income at most Rs 30,000"},
        {"id": "widow", "field": "is_widow", "op": "==", "value": True, "label": "Applicant is a widow"},
    ],
    "soft": [
        {"id": "dependents", "field": "dependents", "op": ">=", "value": 1, "weight": 0.6, "label": "Has at least one dependent"},
        {"id": "no_other_grant", "field": "receives_other_grant", "op": "==", "value": False, "weight": 0.4, "label": "Not already receiving another cash grant"},
    ],
}

SCHEMES = [
    {"code": "widow-relief", "name_en": "Widow Relief Grant", "name_ur": "بیوہ امدادی گرانٹ",
     "description_en": "Quarterly cash support for widows in low-income households.",
     "description_ur": "کم آمدنی والے گھرانوں کی بیوہ خواتین کے لیے سہ ماہی نقد امداد۔",
     "amount_pkr": 25000, "icon": "heart", "rules": WIDOW_RULES_V1},
    {"code": "flood-relief", "name_en": "Flood Recovery Support", "name_ur": "سیلاب بحالی امداد",
     "description_en": "One-time support for flood-affected households.",
     "description_ur": "سیلاب سے متاثرہ گھرانوں کے لیے ایک بار کی امداد۔",
     "amount_pkr": 15000, "icon": "home",
     "rules": {"hard": [
         {"id": "age_min", "field": "age", "op": ">=", "value": 18, "label": "Applicant is 18 or older"},
         {"id": "income_cap", "field": "monthly_income", "op": "<=", "value": 40000, "label": "Monthly income at most Rs 40,000"},
         {"id": "flood_zone", "field": "flood_affected", "op": "==", "value": True, "label": "Lives in a notified flood-affected area"},
     ], "soft": []}},
]


def family_pin(i: int) -> str:
    return f"{1000 + i * 7:04d}"[-4:]


def _user(db: Session, tenant: Tenant, username: str, role: str, full_name: str, **kw) -> User:
    u = db.execute(select(User).where(User.username == username)).scalar()
    if u:
        return u
    u = User(tenant_id=tenant.id, username=username, password_hash=hash_password(DEMO_PASSWORD), role=role,
             full_name=full_name, **kw)
    db.add(u)
    db.flush()
    return u


def seed_registry(db: Session) -> int:
    if db.execute(select(func.count(MockRegistry.id))).scalar():
        return 0
    rows = build_registry(50)
    db.add_all(MockRegistry(**r) for r in rows)
    db.flush()
    return len(rows)


def seed(db: Session, families: int = 5) -> dict:
    families = max(1, min(40, families))
    seed_registry(db)
    registry = db.execute(select(MockRegistry).order_by(MockRegistry.id)).scalars().all()
    out: dict = {"tenants": {}}
    for t in TENANTS:
        tenant = db.execute(select(Tenant).where(Tenant.code == t["code"])).scalar()
        if not tenant:
            tenant = Tenant(code=t["code"], name=t["name"], province=t["province"])
            db.add(tenant)
            db.flush()
        p = t["prefix"]
        prov_rows = [r for r in registry if r.province == t["province"] and r.gender == "F"]
        widow = prov_rows[0]
        users = {
            Role.CITIZEN: _user(db, tenant, f"{p}.citizen", Role.CITIZEN, widow.full_name, cnic=widow.cnic, phone=widow.phone),
            Role.HELPER: _user(db, tenant, f"{p}.helper", Role.HELPER, f"{t['province']} Community Helper"),
            Role.OFFICER: _user(db, tenant, f"{p}.officer", Role.OFFICER, f"{t['province']} Department Officer"),
            Role.ADMIN: _user(db, tenant, f"{p}.admin", Role.ADMIN, f"{t['province']} Platform Admin"),
            Role.AUDITOR: _user(db, tenant, f"{p}.auditor", Role.AUDITOR, f"{t['province']} Auditor"),
        }
        # Schemes + rule v1
        for s in SCHEMES:
            scheme = db.execute(select(Scheme).where(Scheme.tenant_id == tenant.id, Scheme.code == s["code"])).scalar()
            if not scheme:
                scheme = Scheme(tenant_id=tenant.id, code=s["code"], name_en=s["name_en"], name_ur=s["name_ur"],
                                description_en=s["description_en"], description_ur=s["description_ur"],
                                amount_pkr=s["amount_pkr"], icon=s["icon"])
                db.add(scheme)
                db.flush()
                db.add(RuleVersion(tenant_id=tenant.id, scheme_id=scheme.id, version=1, rules_json=s["rules"],
                                   notes="Initial policy", published_by=users[Role.ADMIN].id))
        # Helper families (shared phone) — synthetic registry-backed citizens
        fam_pool = [r for r in registry if r.province == t["province"]]
        fam_out = []
        for i in range(families):
            rec = fam_pool[(i + 1) % len(fam_pool)]
            fam = _user(db, tenant, f"{p}.family{i + 1:02d}", Role.CITIZEN, rec.full_name, cnic=rec.cnic, phone=rec.phone)
            link = db.execute(select(HelperLink).where(HelperLink.helper_user_id == users[Role.HELPER].id,
                                                       HelperLink.citizen_user_id == fam.id)).scalar()
            if not link:
                db.add(HelperLink(tenant_id=tenant.id, helper_user_id=users[Role.HELPER].id, citizen_user_id=fam.id,
                                  family_pin_hash=hash_password(family_pin(i + 1))))
            fam_out.append({"username": fam.username, "user_id": fam.id, "pin": family_pin(i + 1)})
        out["tenants"][t["code"]] = {"tenant_id": tenant.id,
                                     "users": {r: {"id": u.id, "username": u.username} for r, u in users.items()},
                                     "families": fam_out}
    db.commit()
    out["password"] = DEMO_PASSWORD
    return out


def grant(db: Session, citizen: User, scope: str, via: str = "self") -> Consent:
    c = Consent(tenant_id=citizen.tenant_id, citizen_user_id=citizen.id, scope=scope, active=True, granted_via=via)
    db.add(c)
    db.commit()
    return c


__all__ = ["seed", "grant", "DEMO_PASSWORD", "family_pin", "ConsentScope"]
