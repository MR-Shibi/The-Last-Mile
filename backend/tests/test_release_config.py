"""Release hardening: DB URL normalisation for hosted Postgres and CORS origin handling."""
import pytest

from app.core.config import Settings, normalize_database_url


@pytest.mark.parametrize("raw,expected", [
    ("postgres://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
    ("postgresql://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
    ("postgresql+psycopg://u@h/db", "postgresql+psycopg://u@h/db"),
    ("sqlite:///./lastmile.db", "sqlite:///./lastmile.db"),
    ("  postgres://u@h/db  ", "postgresql+psycopg://u@h/db"),
])
def test_database_url_normalisation(raw, expected):
    assert normalize_database_url(raw) == expected
    assert Settings(database_url=raw).database_url == expected


def test_allowed_origins_include_defaults_and_frontend_url():
    s = Settings(frontend_url="https://last-mile.vercel.app/, https://demo.example.org", cors_origins="http://localhost:5173")
    assert s.allowed_origins[:2] == ["http://localhost:3000", "http://127.0.0.1:3000"]
    assert "https://last-mile.vercel.app" in s.allowed_origins  # trailing slash stripped
    assert "https://demo.example.org" in s.allowed_origins and "http://localhost:5173" in s.allowed_origins
    assert len(s.allowed_origins) == len(set(s.allowed_origins))


@pytest.mark.parametrize("origin,allowed", [("http://localhost:3000", True), ("http://127.0.0.1:3000", True),
                                            ("https://evil.example.com", False)])
def test_cors_preflight(client, origin, allowed):
    r = client.options("/scam/check", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "content-type,authorization"})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed
