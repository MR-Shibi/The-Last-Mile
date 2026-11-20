"""Synthetic CNIC helpers.

Real Pakistani CNICs have no public checksum. For this PROTOTYPE the simulated registry uses a
documented *synthetic* rule so "invalid CNIC" edge cases can be generated and detected:
    last digit == (sum of first 12 digits * 7) mod 10
Never use real CNICs with this system.
"""
import random
import re

CNIC_RE = re.compile(r"^\d{5}-\d{7}-\d$")
PROVINCE_PREFIX = {"Punjab": "3", "Sindh": "4", "KP": "1", "Balochistan": "5", "ICT": "6"}


def normalize_cnic(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) != 13:
        return None
    return f"{digits[:5]}-{digits[5:12]}-{digits[12]}"


def check_digit(first12: str) -> str:
    return str((sum(int(c) for c in first12) * 7) % 10)


def is_valid_cnic(raw: str | None) -> bool:
    c = normalize_cnic(raw)
    if not c:
        return False
    d = c.replace("-", "")
    return d[12] == check_digit(d[:12])


def make_cnic(rng: random.Random, province: str = "Sindh") -> str:
    first = PROVINCE_PREFIX.get(province, "4") + "".join(str(rng.randint(0, 9)) for _ in range(11))
    d = first + check_digit(first)
    return f"{d[:5]}-{d[5:12]}-{d[12]}"
