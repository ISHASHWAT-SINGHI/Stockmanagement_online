"""routers/sales.py — Sales bill and payment endpoints."""
from datetime import datetime, time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["sales"], dependencies=[Depends(get_current_user)])


@router.get("/sales", response_model=List[schemas.SalesBillResponse])
async def get_sales(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SalesBill)
        .where(models.SalesBill.is_deleted == False)
        .offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.post("/sales", response_model=schemas.SalesBillResponse)
async def create_sale(bill: schemas.SalesBillCreate, db: AsyncSession = Depends(get_db)):
    items_data = bill.items
    bill_dict = bill.model_dump(exclude={"items"}, exclude_none=True)
    if bill.bill_date is not None:
        bill_dict["bill_date"] = datetime.combine(bill.bill_date, time.min)

    try:
        db_bill = models.SalesBill(**bill_dict)
        db.add(db_bill)
        await db.flush()

        for item in items_data:
            batch_result = await db.execute(
                select(models.StockBatch).where(models.StockBatch.id == item.stock_batch_id)
            )
            batch = batch_result.scalar_one_or_none()
            if not batch:
                raise HTTPException(status_code=404, detail=f"Stock batch {item.stock_batch_id} not found")
            if batch.available_quantity < item.quantity:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock in batch {item.stock_batch_id}. Available: {batch.available_quantity}",
                )
            batch.available_quantity -= item.quantity

            prod_result = await db.execute(select(models.Product).where(models.Product.id == item.product_id))
            product = prod_result.scalar_one_or_none()
            if product:
                product.current_stock -= item.quantity

            db_item = models.SaleItem(**item.model_dump(), bill_id=db_bill.id)
            db.add(db_item)

            db.add(models.StockLedger(
                product_id=item.product_id,
                transaction_type="SALE",
                quantity=-item.quantity,
                reference_id=db_bill.id,
            ))

        if db_bill.customer_id:
            ledger_result = await db.execute(
                select(models.CustomerLedger).where(models.CustomerLedger.customer_id == db_bill.customer_id)
            )
            ledger = ledger_result.scalar_one_or_none()
            if ledger:
                ledger.total_credit += db_bill.grand_total
                ledger.total_paid += db_bill.paid_amount
                ledger.outstanding_balance += db_bill.outstanding_amount

        await db.commit()
    except Exception as e:
        await db.rollback()
        raise e
        

    await db.refresh(db_bill)
    return db_bill


from sqlalchemy.orm import selectinload

@router.get("/sales/{bill_id}", response_model=schemas.SalesBillDetailResponse)
async def get_sale(bill_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SalesBill)
        .options(
            selectinload(models.SalesBill.sales_items).selectinload(models.SaleItem.product),
            selectinload(models.SalesBill.customer),
        )
        .where(models.SalesBill.id == bill_id)
    )
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


# ─── Payments ─────────────────────────────────────────────────────────────────

@router.get("/payments", response_model=List[schemas.PaymentTransactionResponse])
async def get_payments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.PaymentTransaction))
    return result.scalars().all()


@router.post("/payments", response_model=schemas.PaymentTransactionResponse)
async def create_payment(payment: schemas.PaymentTransactionCreate, db: AsyncSession = Depends(get_db)):
    db_payment = models.PaymentTransaction(**payment.model_dump())
    db.add(db_payment)

    bill_result = await db.execute(select(models.SalesBill).where(models.SalesBill.id == payment.bill_id))
    bill = bill_result.scalar_one_or_none()
    if bill:
        bill.paid_amount += payment.amount
        bill.outstanding_amount = max(0, bill.grand_total - bill.paid_amount)
        bill.payment_status = "Paid" if bill.outstanding_amount == 0 else "Partial"

    ledger_result = await db.execute(
        select(models.CustomerLedger).where(models.CustomerLedger.customer_id == payment.customer_id)
    )
    ledger = ledger_result.scalar_one_or_none()
    if ledger:
        ledger.total_paid += payment.amount
        ledger.outstanding_balance = max(0, ledger.outstanding_balance - payment.amount)

    await db.commit()
    await db.refresh(db_payment)
    return db_payment
