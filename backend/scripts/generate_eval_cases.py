"""Generate the ~540-case, 13-family synthetic edge-case suite -> backend/eval/cases.json.

Usage (from backend/): python scripts/generate_eval_cases.py
Deterministic (fixed seeds). Cases are declarative specs; scripts/run_eval.py executes them through
the real API + engine on an isolated database. All data is synthetic.
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.cnic import check_digit  # noqa: E402
from app.services.mock_registry_data import build_registry  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "eval" / "cases.json"
PER_FAMILY = 42
GOOD_DOC = {"ocr_confidence": 0.96, "quality_score": 0.97, "forgery_score": 0.0}
AUTO, ASK, ESC = "AUTO_RECOMMEND", "ASK_MORE_PROOF", "ESCALATE_HUMAN"
MUHAMMAD = ["Muhammad", "Mohammad", "Muhammed", "Mohd", "Mohammed"]

rng = random.Random(540)
REGISTRY = build_registry(50)
_counts: dict[str, int] = {}
for r in REGISTRY:
    _counts[r["cnic"]] = _counts.get(r["cnic"], 0) + 1
CLEAN = [r for r in REGISTRY if r["data_quality_note"] == "clean" and r["father_name"] and _counts[r["cnic"]] == 1]
DUP_REG = [r for r in REGISTRY if _counts[r["cnic"]] > 1]


def app_data(rec: dict, **over) -> dict:
    d = {"full_name": rec["full_name"], "father_name": rec["father_name"], "cnic": rec["cnic"], "dob": "1980-05-05",
         "province": "Sindh", "monthly_income": 15000, "is_widow": True, "dependents": 2,
         "receives_other_grant": False, "document": dict(GOOD_DOC)}
    d.update(over)
    return {k: v for k, v in d.items() if v is not None or k in over}


def engine_case(fam: str, i: int, rec: dict, data: dict, routes: list[str], should_approve: bool, note: str,
                as_other: bool = False, image: dict | None = None, prior: dict | None = None) -> dict:
    return {"id": f"{fam}-{i:03d}", "family": fam, "kind": "engine", "owner_cnic": rec["cnic"], "as_other": as_other,
            "data": data, "image": image, "prior": prior, "expect": {"routes": routes},
            "truth": {"should_approve": should_approve}, "note": note}


def pick(i: int) -> dict:
    return CLEAN[i % len(CLEAN)]


# ----------------------------------------------------------------- 1 name variants
def f01() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        rec = pick(i)
        father = rec["father_name"]
        first = father.split()[0]
        if i < 30:
            mode = i % 5
            if mode == 0 and first in MUHAMMAD:
                father = father.replace(first, MUHAMMAD[(MUHAMMAD.index(first) + 1 + i) % len(MUHAMMAD)], 1)
                note = "Muhammad-family spelling variant in father name"
            elif mode == 1:
                full = f"Mst. {rec['full_name']}"
                out.append(engine_case("01_name_variants", i, rec, app_data(rec, full_name=full), [AUTO], True, "title prefix Mst."))
                continue
            elif mode == 2:
                full = f"  {rec['full_name'].upper()} "
                out.append(engine_case("01_name_variants", i, rec, app_data(rec, full_name=full), [AUTO], True, "case/whitespace noise"))
                continue
            elif mode == 3:
                father = f"Haji {father}"
                note = "title Haji in father name"
            else:
                father = father.replace("a", "aa", 1)
                note = "vowel-doubling transliteration"
            out.append(engine_case("01_name_variants", i, rec, app_data(rec, father_name=father), [AUTO, ESC], True, note))
        else:
            impostor = rng.choice(["Kulsoom Jatoi", "Rabia Soomro", "Tahira Butt", "Sughra Chandio", "Hajra Abbasi"])
            if impostor.split()[0] in rec["full_name"]:
                impostor = "Zubaida Malik"
            out.append(engine_case("01_name_variants", i, rec, app_data(rec, full_name=impostor, father_name="Imran Ali"),
                                   [ESC], False, "impostor: different person using this CNIC"))
    return out


# ----------------------------------------------------------------- 2 duplicate people
def f02() -> list[dict]:
    out = []
    for i in range(PER_FAMILY - 6):
        rec = pick(i)
        out.append(engine_case("02_duplicates", i, rec, app_data(rec), [ESC], False,
                               "same CNIC submitted by a second account (e.g. two helpers)", as_other=True,
                               prior={"by": "owner"}))
    for j, rec in enumerate(DUP_REG[:6]):
        out.append(engine_case("02_duplicates", PER_FAMILY - 6 + j, rec, app_data(rec), [ESC], False,
                               f"registry holds duplicate records ({rec['data_quality_note']})"))
    return out


# ----------------------------------------------------------------- 3 missing data
def f03() -> list[dict]:
    out = []
    drops = [("monthly_income", "blank income"), ("is_widow", "marital status not answered"),
             ("dob", "no age / date of birth"), ("province", "province missing")]
    for i in range(PER_FAMILY):
        rec = pick(i)
        key, note = drops[i % len(drops)]
        over = {key: None}
        if key == "dob":
            over["age"] = None
        data = app_data(rec, **over)
        data = {k: v for k, v in data.items() if v is not None}
        out.append(engine_case("03_missing_data", i, rec, data, [ASK], True, note))
    return out


# ----------------------------------------------------------------- 4 wrong data
def f04() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        rec = pick(i)
        m = i % 6
        if m == 0:
            d = rec["cnic"].replace("-", "")
            bad = d[:12] + str((int(check_digit(d[:12])) + 3) % 10)
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, cnic=f"{bad[:5]}-{bad[5:12]}-{bad[12]}"), [ASK], True, "CNIC typo (synthetic checksum fails)"))
        elif m == 1:
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, monthly_income=-5000), [ESC], False, "negative income"))
        elif m == 2:
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, dob=None, age=15), [ESC], False, "under-age applicant"))
        elif m == 3:
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, province="Balochistan"), [ESC], False, "province outside scheme"))
        elif m == 4:
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, monthly_income=90000), [ESC], False, "income far above cap"))
        else:
            out.append(engine_case("04_wrong_data", i, rec, app_data(rec, cnic="42101-12345"), [ASK], True, "CNIC too short"))
    return out


# ----------------------------------------------------------------- 5 bad photos (+ clean controls)
def f05() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        rec = pick(i)
        data = app_data(rec)
        data.pop("document")
        if i < 34:
            m = i % 3
            img = {"blur": 9 + (i % 8) * 2} if m == 0 else ({"glare": True} if m == 1 else {"brightness": 0.2 + (i % 4) * 0.04})
            note = "blurry" if m == 0 else ("glare" if m == 1 else "too dark")
            out.append(engine_case("05_bad_photos", i, rec, data, [ASK], True, f"{note} CNIC photo", image={**img, "qr": "registry"}))
        elif i % 2 == 0:
            out.append(engine_case("05_bad_photos", i, rec, data, [AUTO], True, "clean control photo with valid QR",
                                   image={"qr": "registry", "noise_seed": 500 + i}))
        else:  # genuine applicant with an old, worn card: lands in the 0.95-0.98 band
            worn = {"ocr_confidence": 0.92 - (i % 4) * 0.01, "quality_score": 0.90, "forgery_score": 0.0}
            out.append(engine_case("05_bad_photos", i, rec, app_data(rec, document=worn), [AUTO], True,
                                   "genuine applicant, worn but readable card (p in 0.95-0.98)"))
    return out


# ----------------------------------------------------------------- 6 forged documents (+ subtle + clean)
def f06() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        rec = pick(i)
        data = app_data(rec)
        data.pop("document")
        m = i % 7
        if m == 0:
            out.append(engine_case("06_forged_docs", i, rec, data, [ESC], False, "QR not in registry", image={"qr": "QR-FORGED%04d" % i}))
        elif m == 1:
            out.append(engine_case("06_forged_docs", i, rec, data, [ESC], False, "QR belongs to another person", image={"qr": "other"}))
        elif m == 2:
            out.append(engine_case("06_forged_docs", i, rec, data, [ESC], False, "edited in Photoshop (metadata)",
                                   image={"qr": "registry", "software": "Adobe Photoshop 25.0", "noise_seed": i}))
        elif m == 3:
            out.append(engine_case("06_forged_docs", i, rec, data, [ESC], False, "card shows a different CNIC",
                                   image={"qr": None, "card_cnic": pick(i + 5)["cnic"], "noise_seed": i}))
        elif m == 4:
            out.append(engine_case("06_forged_docs", i, rec, data, [ESC], False, "image already used in another person's claim",
                                   image={"qr": "registry", "noise_seed": 900 + i, "reuse_from_other": True}))
        elif m == 5:
            # subtle forgery that slips under the tamper threshold: only the threshold protects us
            forg = 0.10 if i % 2 else 0.20
            out.append(engine_case("06_forged_docs", i, rec, app_data(rec, document={"ocr_confidence": 0.96, "quality_score": 0.95, "forgery_score": forg}),
                                   [ASK, ESC], False, f"subtle edit (forgery_score {forg}) below tamper flag"))
        else:
            out.append(engine_case("06_forged_docs", i, rec, data, [AUTO], True, "clean control card", image={"qr": "registry", "noise_seed": 700 + i}))
    return out


# ----------------------------------------------------------------- 7 scam messages (held-out phrasings)
SCAM_HELDOUT = [
    "Dear {n}, BISP ki taraf se {a} rupay aap ke naam. Wasooli se pehle {f} rupay service charges is number pe bhejain {num}",
    "Assalam o Alaikum! Ehsaas program: aap ka {a} ka cheque tayyar. Jaldi {f} fee JazzCash karo {num} warna cancel",
    "ALERT: Govt relief of Rs {a} pending. Confirm your OTP to agent on {num} within 1 hour.",
    "Benazir card holder! Aap ki raqam {a} block hai. Unblock ke liye {link} pe CNIC aur PIN likhein",
    "Your Sindh flood grant Rs {a} is approved. Pay Rs {f} stamp duty to Easypaisa {num} to release funds today.",
    "Mubarakbad! Qurandazi mein {a} jeetay. Inaam lene ke liye {f} rupay advance bhejein {num}",
    "BISP 8171: aap ka naam list mein shamil. Registration fee {f} rupay {num} pe send karein",
    "حکومت پاکستان: آپ کی {a} روپے کی امداد رکی ہوئی ہے۔ {f} روپے فیس بھیج کر فوراً حاصل کریں {num}",
    "مبارک ہو! احساس پروگرام میں آپ کا نام آیا ہے۔ {link} پر شناختی کارڈ اور پن درج کریں",
    "Relief update: verify account at {link} or lose your Rs {a} payment tonight",
    "Last chance {n}! Send {f} via JazzCash to {num} and receive Rs {a} government support",
    "Free ration + {a} cash! Bas apna ATM card number aur PIN {num} pe SMS karein",
    "Prime Minister relief fund: you are eligible for Rs {a}. Processing fee Rs {f} payable to {num}",
]
LEGIT_HELDOUT = [
    "8171: Mohtarma, aap ki agli qist {a} rupay campsite par tayyar hai. Asal shanakhti card sath layen. Koi charges nahi.",
    "8171: Your quarterly payment of Rs {a} can be collected from the partner bank. Bring your original CNIC. No fee.",
    "Sindh Social Protection: Your application {ref} is being reviewed by an officer. You do not need to pay anything.",
    "8171: آپ کی قسط {a} روپے تیار ہے۔ قریبی کیمپ سائٹ پر اصل شناختی کارڈ کے ساتھ جائیں۔ کوئی فیس نہیں۔",
    "8171: Biometric tasdeeq zaroori hai. Asal CNIC ke sath payment point par jayen. Yeh service muft hai.",
    "Punjab Relief Dept: Case {ref} received. Track status with your 6-digit receipt PIN in the app. No charges apply.",
    "8171: Survey results are sent only from 8171. Never share your PIN. Toll free helpline 0800-26477.",
    "8171: Payment schedule ka elaan: is mahine ki 15 tareekh se adaigi shuru. Kisi ko paisay na dein.",
]


def f07() -> list[dict]:
    out, r = [], random.Random(77)
    for i in range(PER_FAMILY):
        scam = i < 26
        t = (SCAM_HELDOUT if scam else LEGIT_HELDOUT)[i % (len(SCAM_HELDOUT) if scam else len(LEGIT_HELDOUT))]
        text = t.format(n=r.choice(["Shazia", "Amina", "baji"]), a=r.choice(["25,000", "12000", "9500"]), f=r.choice(["600", "1200", "350"]),
                        num=r.choice(["0302-5551212", "0346-5559090"]), link=r.choice(["bisp-help.online", "tinyurl.com/relief26"]),
                        ref=f"LM-{r.randint(10000, 99999)}")
        out.append({"id": f"07_scam_messages-{i:03d}", "family": "07_scam_messages", "kind": "scam", "text": text,
                    "truth": {"scam": scam},
                    "expect": {"verdicts": ["SCAM", "UNCERTAIN_HUMAN_REVIEW"] if scam else ["LIKELY_SAFE", "UNCERTAIN_HUMAN_REVIEW"]},
                    "note": "held-out phrasing (not in training templates)"})
    return out


# ----------------------------------------------------------------- 8 weak network
def f08() -> list[dict]:
    modes = [("replay_batch", "same batch sent twice after a dropped ACK"), ("partial_payload", "truncated payload (no scheme_id)"),
             ("dup_in_batch", "same key twice inside one batch"), ("replay_then_post", "outbox replay then direct POST with same key")]
    return [{"id": f"08_weak_network-{i:03d}", "family": "08_weak_network", "kind": "sync", "mode": modes[i % 4][0],
             "expect": {"cases_created": 0 if modes[i % 4][0] == "partial_payload" else 1}, "note": modes[i % 4][1]}
            for i in range(PER_FAMILY)]


# ----------------------------------------------------------------- 9 low literacy / speech noise
SPEECH = [
    ("meri aamdani pandrah hazar hai", 15000, False), ("bees hazar", 20000, False), ("پچیس ہزار", 25000, False),
    ("۱۲۰۰۰", 12000, False), ("12 hazar rupay", 12000, False), ("das hazar paanch sau", 10500, False),
    ("ek lakh", 100000, False), ("teen bachay", 3, False), ("umar chalees saal", 40, False), ("eighteen thousand", 18000, False),
    ("do teen hazar", None, True), ("shayad bees hazar", None, True), ("taqreeban pandrah hazar", None, True),
    ("chaar paanch hazar", None, True),
]


def f09() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        text, value, amb = SPEECH[i % len(SPEECH)]
        if i >= len(SPEECH) and not amb:
            text = text + (" hai ji" if i % 2 else " ")
        out.append({"id": f"09_speech_noise-{i:03d}", "family": "09_speech_noise", "kind": "stt", "transcript": text,
                    "field": "monthly_income", "expect": {"value": value, "ambiguous": amb}, "note": "noisy spoken number"})
    return out


# ----------------------------------------------------------------- 10 rule changes
def f10() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        income = 28000 + i * 200  # 28,000 .. 36,200
        rec = pick(i)
        out.append({"id": f"10_rule_changes-{i:03d}", "family": "10_rule_changes", "kind": "rule_change", "owner_cnic": rec["cnic"],
                    "data": app_data(rec, monthly_income=income),
                    "expect": {"v1": AUTO if income <= 30000 else ESC, "v2": AUTO if income <= 35000 else ESC},
                    "note": f"income {income} across v1 cap 30k -> v2 cap 35k"})
    return out


# ----------------------------------------------------------------- 11 consent edge cases
def f11() -> list[dict]:
    modes = [("officer_no_consent", 403), ("officer_with_consent", 200), ("revoked_mid_flow", 403), ("helper_unlinked", 403),
             ("helper_linked_no_consent", 403), ("helper_with_consent", 200), ("regrant_after_revoke", 200)]
    return [{"id": f"11_consent-{i:03d}", "family": "11_consent", "kind": "consent", "mode": modes[i % 7][0],
             "expect": {"status": modes[i % 7][1]}, "note": modes[i % 7][0].replace("_", " ")} for i in range(PER_FAMILY)]


# ----------------------------------------------------------------- 12 security attacks
def f12() -> list[dict]:
    modes = [("idor_cross_tenant", 403), ("auditor_post", 403), ("auditor_put", 403), ("citizen_admin_faults", 403),
             ("forged_jwt", 401), ("officer_publish_rules", 403), ("sqli_in_name", 201), ("prompt_injection_sms", "BLOCKED_PROMPT_INJECTION"),
             ("prompt_injection_ocr", "ESCALATE_HUMAN"), ("api_key_rate_limit", 429), ("voice_path_traversal", 404),
             ("helper_wrong_family_pin", 403), ("citizen_reads_other_citizen", 403), ("cross_tenant_scheme_submit", 403)]
    return [{"id": f"12_security-{i:03d}", "family": "12_security", "kind": "security", "mode": modes[i % 14][0],
             "expect": {"outcome": modes[i % 14][1]}, "note": modes[i % 14][0].replace("_", " ")} for i in range(PER_FAMILY)]


# ----------------------------------------------------------------- 13 AI / rail failures
def f13() -> list[dict]:
    out = []
    for i in range(PER_FAMILY):
        rec = pick(i)
        m = i % 3
        fault = ["nadra_timeout", "force_low_ocr", "raast_error"][m]
        expect = {"nadra_timeout": {"route": ESC}, "force_low_ocr": {"route": ASK}, "raast_error": {"disburse_status": 502, "status_after": AUTO}}[fault]
        out.append({"id": f"13_ai_failures-{i:03d}", "family": "13_ai_failures", "kind": "fault", "fault": fault, "owner_cnic": rec["cnic"],
                    "data": app_data(rec), "expect": expect, "truth": {"should_approve": True},
                    "note": f"{fault} injected -> graceful human/proof fallback"})
    return out


def main() -> None:
    cases = [c for f in (f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, f12, f13) for c in f()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"version": 1, "count": len(cases), "cases": cases}, ensure_ascii=False, indent=1), encoding="utf-8")
    fams: dict[str, int] = {}
    for c in cases:
        fams[c["family"]] = fams.get(c["family"], 0) + 1
    print(json.dumps({"count": len(cases), "families": fams, "out": str(OUT)}, indent=2))


if __name__ == "__main__":
    main()
