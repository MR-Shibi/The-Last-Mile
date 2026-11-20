"""Anomaly scoring: IsolationForest over applicant numeric features + duplicate heuristics.

The forest is trained deterministically (fixed seed) on a synthetic applicant population at first
use, so results are reproducible across runs and machines.
"""
import threading

import numpy as np
from sklearn.ensemble import IsolationForest

MODEL_VERSION = "iforest-v2-seed2026"
_lock = threading.Lock()
_model: dict | None = None


def _population(n: int = 2000, seed: int = 2026) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Broad, roughly uniform income band so eligible incomes near any cap are NOT outliers (v1 bias fix);
    # only implausible values (negative, extreme) stand out.
    income = np.concatenate([rng.uniform(0, 70000, int(n * 0.8)), np.clip(rng.normal(20000, 9000, n - int(n * 0.8)), 0, None)])
    age = rng.uniform(18, 80, n)
    dependents = rng.poisson(2.5, n).clip(0, 10)
    return np.column_stack([income, age, dependents])


def _get_model() -> dict:
    global _model
    with _lock:
        if _model is None:
            X = _population()
            forest = IsolationForest(n_estimators=150, contamination="auto", random_state=2026).fit(X)
            raw = -forest.score_samples(X)
            _model = {"forest": forest, "p50": float(np.percentile(raw, 50)), "p995": float(np.percentile(raw, 99.5))}
        return _model


def isolation_score(monthly_income: float | None, age: float | None, dependents: float | None) -> float:
    """0 = typical applicant, 1 = extreme outlier. Missing values are imputed with population medians."""
    m = _get_model()
    x = np.array([[19000 if monthly_income is None else monthly_income, 45 if age is None else age,
                   2 if dependents is None else dependents]], dtype=float)
    raw = float(-m["forest"].score_samples(x)[0])
    return float(np.clip((raw - m["p50"]) / max(1e-9, m["p995"] - m["p50"]), 0.0, 1.0))


def anomaly_assessment(facts: dict, duplicate_cnic_claims: int, shared_phone_claims: int,
                       registry_duplicates: int) -> dict:
    """Combine the forest with heuristics. Returns score in [0,1] and explicit flags."""
    flags: list[str] = []
    income = facts.get("monthly_income")
    if income is not None and income < 0:
        flags.append("negative_income")
    iso = isolation_score(income, facts.get("age"), facts.get("dependents"))
    if iso >= 0.8:
        flags.append("statistical_outlier")
    if duplicate_cnic_claims > 0:
        flags.append("duplicate_cnic")
    if registry_duplicates > 0:
        flags.append("duplicate_registry_record")
    # A shared phone is normal for helper households, so it only nudges the score and is not a flag.
    heuristic = min(1.0, 0.6 * (duplicate_cnic_claims > 0) + 0.3 * (registry_duplicates > 0)
                    + 0.05 * min(shared_phone_claims, 4) + 0.5 * ("negative_income" in flags))
    score = max(iso, heuristic)
    return {"anomaly_score": round(score, 4), "isolation_score": round(iso, 4), "flags": flags,
            "model_version": MODEL_VERSION}
