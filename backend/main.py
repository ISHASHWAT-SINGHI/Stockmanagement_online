"""
main.py - Thin orchestrator. Imports routers, registers middleware, and runs startup.
Business logic lives in routers/ and services/.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.future import select

import database
import models
import tasks
from routers import auth, contacts, products, purchases, reports, sales, settings
from security import get_password_hash

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
)

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(contacts.router)
app.include_router(purchases.router)
app.include_router(sales.router)
app.include_router(reports.router)
app.include_router(settings.router)


@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request, exc):
    return JSONResponse(
        status_code=503,
        content={"detail": "Database unavailable. Please try again shortly."},
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
