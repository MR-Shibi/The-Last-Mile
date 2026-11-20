"""Deterministic generator for 50 synthetic registry citizens with deliberate dirty data:
spelling variants (Muhammad / Mohammad / Muhammed / Mohd), missing fields, and duplicate entries.
All names, CNICs and phone numbers are synthetic."""
import hashlib
import random

from app.services.cnic import make_cnic

FEMALE_FIRST = ["Shazia", "Rukhsana", "Nasreen", "Parveen", "Saima", "Kulsoom", "Zubaida", "Razia",
                "Fatima", "Amina", "Naseem", "Bushra", "Sughra", "Hajra", "Rabia", "Tahira"]
MALE_FIRST = ["Muhammad", "Ahmed", "Ali", "Imran", "Bilal", "Hassan", "Usman", "Tariq", "Javed", "Nadeem"]
FAMILY = ["Khan", "Bibi", "Hussain", "Ansari", "Qureshi", "Memon", "Baloch", "Shah", "Abbasi", "Soomro",
          "Chandio", "Malik", "Butt", "Jatoi"]
MUHAMMAD_VARIANTS = ["Muhammad", "Mohammad", "Muhammed", "Mohd"]
DISTRICTS = {"Sindh": ["Karachi South", "Hyderabad", "Sukkur", "Larkana", "Thatta"],
             "Punjab": ["Lahore", "Multan", "Faisalabad", "Bahawalpur", "Rawalpindi"]}


def qr_for(cnic: str, salt: str = "") -> str:
    return "QR-" + hashlib.sha256(f"{cnic}{salt}".encode()).hexdigest()[:16].upper()


def build_registry(n: int = 50, seed: int = 2026) -> list[dict]:
    rng = random.Random(seed)
    rows: list[dict] = []
    base_count = n - 8  # remaining 8 are deliberate dirty duplicates/variants
    for i in range(base_count):
        province = "Sindh" if i % 2 == 0 else "Punjab"
        female = i % 3 != 2
        father_variant = MUHAMMAD_VARIANTS[i % 4]
        if female:
            name = f"{rng.choice(FEMALE_FIRST)} {rng.choice(FAMILY)}"
        else:
            name = f"{MUHAMMAD_VARIANTS[i % 4]} {rng.choice(MALE_FIRST[1:])}"
        father = f"{father_variant} {rng.choice(MALE_FIRST[1:])} {rng.choice(FAMILY)}"
        cnic = make_cnic(rng, province)
        row = {
            "cnic": cnic,
            "full_name": name,
            "father_name": father,
            "dob": f"{rng.randint(1955, 2004)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
            "gender": "F" if female else "M",
            "province": province,
            "district": rng.choice(DISTRICTS[province]),
            "marital_status": rng.choice(["widowed", "widowed", "married", "single"]) if female else rng.choice(["married", "single"]),
            "monthly_income": rng.choice([8000, 12000, 15000, 18000, 22000, 26000, 29500, 31000, 45000, 60000]),
            "phone": f"0300-{rng.randint(1000000, 9999999)}",
            "qr_code": qr_for(cnic),
            "data_quality_note": "clean",
        }
        # Missing-field dirty data
        if i % 9 == 4:
            row["father_name"] = None
            row["data_quality_note"] = "missing_father_name"
        if i % 11 == 7:
            row["monthly_income"] = None
            row["data_quality_note"] = "missing_income"
        rows.append(row)

    # Duplicate person entered twice under a spelling variant (same CNIC)
    for j, src_idx in enumerate([0, 3, 6, 9]):
        src = dict(rows[src_idx])
        parts = (src["father_name"] or "Muhammad Ali Khan").split(" ", 1)
        variant = MUHAMMAD_VARIANTS[(MUHAMMAD_VARIANTS.index(parts[0]) + 1) % 4] if parts[0] in MUHAMMAD_VARIANTS else "Mohammad"
        src["father_name"] = f"{variant} {parts[1] if len(parts) > 1 else ''}".strip()
        src["qr_code"] = qr_for(src["cnic"], f"dup{j}")
        src["data_quality_note"] = "duplicate_spelling_variant"
        rows.append(src)
    # Exact duplicates (double data-entry)
    for src_idx in (12, 15):
        dup = dict(rows[src_idx])
        dup["qr_code"] = qr_for(dup["cnic"], "exactdup")
        dup["data_quality_note"] = "exact_duplicate"
        rows.append(dup)
    # Same phone shared by different people (shared-phone household)
    for src_idx, tgt_idx in ((1, 2), (4, 5)):
        rec = dict(rows[tgt_idx])
        rec["cnic"] = make_cnic(rng, rec["province"])
        rec["full_name"] = rec["full_name"] + " (sister)"
        rec["phone"] = rows[src_idx]["phone"]
        rec["qr_code"] = qr_for(rec["cnic"])
        rec["data_quality_note"] = "shared_phone"
        rows.append(rec)
    return rows[:n]
