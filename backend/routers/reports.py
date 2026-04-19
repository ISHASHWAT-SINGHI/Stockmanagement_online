"""routers/reports.py — Reporting endpoints (stub for Phase 2 Task 5)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

import models
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1/reports", tags=["reports"], dependencies=[Depends(get_current_user)])


@router.get("/summary")
async def dashboard_summary(db: AsyncSession = Depends(get_db)):
    """Quick stats for the dashboard."""
    products = await db.execute(select(func.count(models.Product.id)).where(models.Product.is_deleted == False))
    customers = await db.execute(select(func.count(models.Customer.id)).where(models.Customer.is_deleted == False))
    sales = await db.execute(select(func.count(models.SalesBill.id)).where(models.SalesBill.is_deleted == False))
    purchases = await db.execute(select(func.count(models.PurchaseInvoice.id)).where(models.PurchaseInvoice.is_deleted == False))
    revenue = await db.execute(
        select(func.coalesce(func.sum(models.SalesBill.grand_total), 0))
        .where(models.SalesBill.is_deleted == False)
    )
    return {
        "products": products.scalar(),
        "customers": customers.scalar(),
        "sales": sales.scalar(),
        "purchases": purchases.scalar(),
        "total_revenue": revenue.scalar(),
    }
