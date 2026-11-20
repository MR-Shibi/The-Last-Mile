"""Application settings. SQLite is the default for instant local tests; set DATABASE_URL to a
PostgreSQL URL (docker-compose, Render, Railway, ...) for production-like runs."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def normalize_database_url(url: str) -> str:
    """Hosting providers hand out `postgres://...` (rejected by SQLAlchemy 2) or bare `postgresql://...`
    (which would pick psycopg2, not installed). Normalise both to the psycopg 3 driver."""
    url = (url or "").strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def split_origins(*values: str) -> list[str]:
    out: list[str] = []
    for v in values:
        for o in (v or "").split(","):
            o = o.strip().rstrip("/")
            if o and o not in out:
                out.append(o)
    return out


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "The Last Mile: AI on Public Rails"
    environment: str = "dev"
    database_url: str = "sqlite:///./lastmile.db"
    auto_create_schema: bool = True  # dev convenience; production runs `alembic upgrade head`
    jwt_secret: str = "dev-only-change-me-synthetic-prototype"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_minutes: int = 60 * 24 * 7
    bcrypt_rounds: int = 10
    rate_limit_capacity: int = 20
    rate_limit_refill_per_sec: float = 5.0
    cors_origins: str = ""      # extra comma-separated origins
    frontend_url: str = ""      # comma-separated deployed frontend origins, e.g. https://last-mile.vercel.app
    cors_origin_regex: str = ""  # optional, e.g. https://.*\.vercel\.app for preview deployments
    prototype_banner: str = "PROTOTYPE — Simulated DPI & Synthetic Data Only"

    @field_validator("database_url")
    @classmethod
    def _normalize_db(cls, v: str) -> str:
        return normalize_database_url(v)

    @property
    def allowed_origins(self) -> list[str]:
        return split_origins(",".join(DEFAULT_ORIGINS), self.cors_origins, self.frontend_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
