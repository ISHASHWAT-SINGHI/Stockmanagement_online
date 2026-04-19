"""routers/purchases.py — Purchase invoice endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["purchases"], dependencies=[Depends(get_current_user)])


@router.get("/purchase-invoices", response_model=List[schemas.PurchaseInvoiceResponse])
async def get_purchase_invoices(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.PurchaseInvoice)
        .where(models.PurchaseInvoice.is_deleted == False)
        .offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.post("/purchase-invoices", response_model=schemas.PurchaseInvoiceResponse)
async def create_purchase_invoice(invoice: schemas.PurchaseInvoiceCreate, db: AsyncSession = Depends(get_db)):
    items_data = invoice.items
    invoice_dict = invoice.model_dump(exclude={"items"})

    try:
        db_invoice = models.PurchaseInvoice(**invoice_dict)
        db.add(db_invoice)
        await db.flush()

        for item in items_data:
            db_item = models.PurchaseItem(**item.model_dump(), invoice_id=db_invoice.id)
            db.add(db_item)

            db_batch = models.StockBatch(
                product_id=item.product_id,
                purchase_invoice_id=db_invoice.id,
                purchase_price=item.unit_price,
                gst_percentage=item.gst_percent,
                initial_quantity=item.quantity,
                available_quantity=item.quantity,
                purchase_date=invoice.invoice_date,
            )
            db.add(db_batch)

            prod_result = await db.execute(select(models.Product).where(models.Product.id == item.product_id))
            product = prod_result.scalar_one_or_none()
            if product:
                product.current_stock += item.quantity

            db.add(models.StockLedger(
                product_id=item.product_id,
                transaction_type="PURCHASE",
                quantity=item.quantity,
                reference_id=db_invoice.id,
            ))

        await db.commit()
    except Exception as e:
        await db.rollback()
        raise e

    await db.refresh(db_invoice)
    return db_invoice


from sqlalchemy.orm import selectinload

@router.get("/purchase-invoices/{invoice_id}", response_model=schemas.PurchaseInvoiceDetailResponse)
async def get_purchase_invoice(invoice_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.PurchaseInvoice)
        .options(selectinload(models.PurchaseInvoice.purchase_items))
        .where(models.PurchaseInvoice.id == invoice_id)
    )
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice
