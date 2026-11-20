"""Evaluation dashboard API. Results are produced by scripts/run_eval.py on an isolated database;
GET endpoints serve aggregate synthetic metrics (no personal data)."""
import json
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import require_roles
from app.models import Role, User

router = APIRouter(prefix="/eval", tags=["evaluation"])
BACKEND = Path(__file__).resolve().parents[2]
RESULTS = BACKEND / "eval" / "results.json"
CASES = BACKEND / "eval" / "cases.json"


def _load() -> dict:
    if not RESULTS.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No evaluation results yet; run scripts/run_eval.py or POST /eval/run")
    return json.loads(RESULTS.read_text(encoding="utf-8"))


@router.get("/summary")
def summary() -> dict:
    r = _load()
    return {k: v for k, v in r.items() if k != "by_family"} | {
        "families": [{k: f[k] for k in ("family", "total", "passed", "pass_rate")} for f in r["by_family"]]}


@router.get("/by-family")
def by_family() -> list[dict]:
    return _load()["by_family"]


@router.post("/run")
def run(user: User = Depends(require_roles(Role.ADMIN)), db=Depends(get_db)) -> dict:  # noqa: ANN001
    if not CASES.exists():
        subprocess.run([sys.executable, "scripts/generate_eval_cases.py"], cwd=BACKEND, check=True, capture_output=True)
    res = subprocess.run([sys.executable, "scripts/run_eval.py"], cwd=BACKEND, capture_output=True, text=True,
                         encoding="utf-8", errors="replace", timeout=900)
    if res.returncode != 0:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, res.stderr[-1500:])
    out = summary()
    write_audit(db, "eval.run", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                payload={"total": out["total"], "passed": out["passed"], "optimal_threshold": out["optimal_threshold"]})
    return out
