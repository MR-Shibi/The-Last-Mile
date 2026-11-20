"""Application settings. SQLite is the default for instant local tests; set
DATABASE_URL to the docker-compose Postgres URL for production-like runs."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "The Last Mile: AI on Public Rails"
    environment: str = "dev"
    database_url: str = "sqlite:///./lastmile.db"
    jwt_secret: str = "dev-only-change-me-synthetic-prototype"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_minutes: int = 60 * 24 * 7
    rate_limit_capacity: int = 20
    rate_limit_refill_per_sec: float = 5.0
    cors_origins: str = "http://localhost:3000"
    prototype_banner: str = "PROTOTYPE — Simulated DPI & Synthetic Data Only"


@lru_cache
def get_settings() -> Settings:
    return Settings()
