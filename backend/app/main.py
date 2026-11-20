from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (admin, ai, audit, auth, cases, consents, decisions, helper, mock_dpi, officer, receipts,
                     rules, schemes, sync)
from app.core.config import get_settings
from app.core.database import init_db
from app.core.middleware import AuditorReadOnlyMiddleware

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_schema:
        init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    description=f"{settings.prototype_banner}. Multi-tenant, consent-gated public-service rails.",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(AuditorReadOnlyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, cases.router, consents.router, audit.router, admin.router, mock_dpi.router, schemes.router,
          rules.router, decisions.router, ai.router, sync.router, helper.router, officer.router,
          receipts.router):
    app.include_router(r)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "notice": settings.prototype_banner}
