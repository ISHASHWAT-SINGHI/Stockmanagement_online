import asyncio
import os
import ssl
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load the backend-local .env no matter which directory uvicorn is started from.
load_dotenv(Path(__file__).with_name(".env"))

DB_CONNECT_RETRIES = int(os.getenv("DB_CONNECT_RETRIES", "3"))
DB_CONNECT_RETRY_DELAY_SECONDS = float(os.getenv("DB_CONNECT_RETRY_DELAY_SECONDS", "2"))


def normalize_database_url(database_url: str) -> str:
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add the exact Supabase connection string from the dashboard."
        )

    database_url = database_url.strip()
    if database_url.startswith("postgres://"):
        database_url = "postgresql://" + database_url[len("postgres://"):]

    if "postgresql" in database_url and "asyncpg" not in database_url:
        parts = database_url.split("://", 1)
        database_url = "postgresql+asyncpg://" + parts[1]

    parsed = make_url(database_url)
    if parsed.drivername == "postgresql+asyncpg" and parsed.port == 6543:
        query = dict(parsed.query)
        query.setdefault("prepared_statement_cache_size", "0")
        database_url = parsed.set(query=query).render_as_string(hide_password=False)

    return database_url


def mask_database_url(database_url: str) -> str:
    return make_url(database_url).render_as_string(hide_password=True)


def derive_supabase_direct_url(database_url: str) -> str | None:
    parsed = make_url(database_url)
    host = parsed.host or ""
    username = parsed.username or ""

    if not host.endswith(".pooler.supabase.com") or not username.startswith("postgres."):
        return None

    project_ref = username.split(".", 1)[1]
    direct_url = parsed.set(
        username="postgres",
        host=f"db.{project_ref}.supabase.co",
        port=5432,
        query={k: v for k, v in parsed.query.items() if k != "prepared_statement_cache_size"},
    )
    return direct_url.render_as_string(hide_password=False)


def get_candidate_database_urls() -> list[str]:
    primary_url = normalize_database_url(os.getenv("DATABASE_URL", ""))
    candidates = [primary_url]

    fallback_url = os.getenv("DATABASE_FALLBACK_URL")
    if fallback_url:
        candidates.append(normalize_database_url(fallback_url))

    derived_direct_url = derive_supabase_direct_url(primary_url)
    if derived_direct_url:
        candidates.append(normalize_database_url(derived_direct_url))

    deduped_candidates = []
    for candidate in candidates:
        if candidate not in deduped_candidates:
            deduped_candidates.append(candidate)
    return deduped_candidates


def get_engine_args(database_url: str) -> dict:
    parsed = make_url(database_url)
    if parsed.drivername.startswith("postgresql"):
        return {
            "connect_args": {
                "ssl": "require",
                "timeout": 30,
                "command_timeout": 60,
                "server_settings": {"application_name": "stockpro-api"},
            },
            "pool_pre_ping": True,
            "pool_recycle": 280,
            "pool_size": 3,
            "max_overflow": 5,
            "pool_timeout": 30,
        }
    raise RuntimeError("This application is configured for online PostgreSQL only.")


def build_engine(database_url: str):
    database_url = normalize_database_url(database_url)
    return create_async_engine(database_url, **get_engine_args(database_url))


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", ""))
ACTIVE_DATABASE_URL = DATABASE_URL
engine = build_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def configure_database(database_url: str) -> None:
    global ACTIVE_DATABASE_URL, engine
    database_url = normalize_database_url(database_url)
    if database_url == ACTIVE_DATABASE_URL:
        return
    await engine.dispose()
    engine = build_engine(database_url)
    SessionLocal.configure(bind=engine)
    ACTIVE_DATABASE_URL = database_url


async def verify_database_connection() -> str:
    errors = []

    for candidate_url in get_candidate_database_urls():
        await configure_database(candidate_url)
        for attempt in range(1, DB_CONNECT_RETRIES + 1):
            try:
                async with engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
                return candidate_url
            except Exception as exc:
                if attempt == DB_CONNECT_RETRIES:
                    errors.append(f"{mask_database_url(candidate_url)} -> {exc}")
                if attempt < DB_CONNECT_RETRIES:
                    await asyncio.sleep(DB_CONNECT_RETRY_DELAY_SECONDS)

    raise RuntimeError(
        "Could not connect to the configured online database. "
        f"Failures: {'; '.join(errors)}"
    )


async def check_database_health() -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))

async def get_db():
    async with SessionLocal() as db:
        try:
            yield db
        finally:
            await db.close()

