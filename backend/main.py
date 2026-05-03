"""
main.py - Thin orchestrator. Imports routers, registers middleware, and runs startup.
Business logic lives in routers/ and services/.
"""
import logging
import os
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.future import select

import database
import models
import tasks
from routers import auth, contacts, products, purchases, reports, sales, settings
from security import get_password_hash

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("stockpro.api")

app = FastAPI(
    title="StockPro API",
    version="1.0.0",
    description="Stock Management & Billing System - Production API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(contacts.router)
app.include_router(purchases.router)
app.include_router(sales.router)
app.include_router(reports.router)
app.include_router(settings.router)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    platform_request_id = request.headers.get("Rndr-Id")
    request.state.request_id = request_id
    request.state.platform_request_id = platform_request_id
    started_at = time.perf_counter()

    response = await call_next(request)

    duration_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_complete request_id=%s render_request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
        request_id,
        platform_request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError):
    request_id = getattr(request.state, "request_id", "unknown")
    platform_request_id = getattr(request.state, "platform_request_id", None)
    logger.exception(
        "database_error request_id=%s render_request_id=%s method=%s path=%s",
        request_id,
        platform_request_id,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database unavailable. Please try again shortly.",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    platform_request_id = getattr(request.state, "platform_request_id", None)
    logger.exception(
        "unhandled_error request_id=%s render_request_id=%s method=%s path=%s",
        request_id,
        platform_request_id,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error. Share the reference ID if this repeats.",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


@app.on_event("startup")
async def startup():
    active_database_url = await database.verify_database_connection()
    print(f"[startup] Connected to {database.mask_database_url(active_database_url)}")

    # Start the auto-archiving background task
    import asyncio

    asyncio.create_task(tasks.auto_archive_products())

    # Create tables if they don't exist (dev convenience; prod uses Alembic)
    async with database.engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    # Seed default admin user from .env if no users exist
    async with database.SessionLocal() as session:
        result = await session.execute(select(models.User).limit(1))
        if not result.scalar_one_or_none():
            admin_user = os.getenv("ADMIN_USERNAME", "admin")
            admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
            session.add(
                models.User(
                    username=admin_user,
                    password_hash=get_password_hash(admin_pass),
                    role="admin",
                    must_change_password=True,
                )
            )
            await session.commit()

    # Seed default feature flags if missing
    async with database.SessionLocal() as session:
        flags = [
            {
                "feature_name": "barcode_scanning",
                "enabled": True,
                "description": "Barcode scan auto-add in POS",
            },
            {
                "feature_name": "expiry_tracking",
                "enabled": True,
                "description": "Expiring stock dashboard widget",
            },
            {
                "feature_name": "credit_notes",
                "enabled": False,
                "description": "GST invoice cancellation via credit notes",
            },
            {
                "feature_name": "multi_store",
                "enabled": False,
                "description": "Multi-store inventory (future)",
            },
            {
                "feature_name": "stock_adjustments",
                "enabled": True,
                "description": "Manual stock correction workflow",
            },
        ]
        for flag in flags:
            existing = await session.execute(
                select(models.FeatureFlag).where(
                    models.FeatureFlag.feature_name == flag["feature_name"]
                )
            )
            if not existing.scalar_one_or_none():
                session.add(models.FeatureFlag(**flag))
        await session.commit()


@app.get("/")
def health():
    return {"status": "ok", "api_version": "v1", "message": "StockPro API running"}


@app.get("/health/db")
async def database_health():
    await database.check_database_health()
    return {
        "status": "ok",
        "database": database.mask_database_url(database.ACTIVE_DATABASE_URL),
    }
