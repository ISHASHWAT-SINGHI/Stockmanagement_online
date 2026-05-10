"""routers/contacts.py — Suppliers and Customers endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from accounting import ensure_customer_ledger, ensure_supplier_ledger, sync_customer_ledger, sync_supplier_ledger
import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["contacts"], dependencies=[Depends(get_current_user)])


# ─── Suppliers ───────────────────────────────────────────────────────────────

@router.get("/suppliers", response_model=List[schemas.SupplierResponse])
async def get_suppliers(skip: int = 0, limit: int = 200, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.is_deleted == False).offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.get("/suppliers/ledger-overview", response_model=schemas.SupplierLedgerOverviewResponse)
async def get_supplier_ledger_overview(
    search: str | None = Query(default=None),
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    filters = [models.Supplier.is_deleted == False]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                models.Supplier.company_name.ilike(pattern),
                models.Supplier.phone.ilike(pattern),
                models.Supplier.gst_number.ilike(pattern),
            )
        )

    rows_result = await db.execute(
        select(
            models.Supplier.id,
            models.Supplier.company_name,
            models.Supplier.phone,
            models.Supplier.gst_number,
            func.coalesce(models.SupplierLedger.total_purchases, 0),
            func.coalesce(models.SupplierLedger.total_paid, 0),
            func.coalesce(models.SupplierLedger.total_returns, 0),
            func.coalesce(models.SupplierLedger.outstanding_balance, 0),
        )
        .outerjoin(models.SupplierLedger, models.SupplierLedger.supplier_id == models.Supplier.id)
        .where(*filters)
        .order_by(models.Supplier.company_name.asc(), models.Supplier.id.asc())
        .offset(skip)
        .limit(limit)
    )

    total_result = await db.execute(
        select(
            func.count(models.Supplier.id),
            func.coalesce(func.sum(models.SupplierLedger.outstanding_balance), 0),
        )
        .select_from(models.Supplier)
        .outerjoin(models.SupplierLedger, models.SupplierLedger.supplier_id == models.Supplier.id)
        .where(*filters)
    )
    total_suppliers, total_outstanding_payable = total_result.one()

    items = [
        {
            "supplier_id": supplier_id,
            "company_name": company_name,
            "phone": phone,
            "gst_number": gst_number,
            "total_purchases": total_purchases,
            "total_paid": total_paid,
            "total_returns": total_returns,
            "outstanding_balance": outstanding_balance,
        }
        for (
            supplier_id,
            company_name,
            phone,
            gst_number,
            total_purchases,
            total_paid,
            total_returns,
            outstanding_balance,
        ) in rows_result.all()
    ]

    return {
        "items": items,
        "total_outstanding_payable": total_outstanding_payable,
        "total_suppliers": total_suppliers,
    }


@router.post("/suppliers", response_model=schemas.SupplierResponse)
async def create_supplier(supplier: schemas.SupplierCreate, db: AsyncSession = Depends(get_db)):
    db_supplier = models.Supplier(**supplier.model_dump())
    db.add(db_supplier)
    await db.flush()
    await ensure_supplier_ledger(db, db_supplier.id)
    await db.commit()
    await db.refresh(db_supplier)
    return db_supplier


@router.get("/suppliers/{supplier_id}", response_model=schemas.SupplierResponse)
async def get_supplier(supplier_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id, models.Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierResponse)
async def update_supplier(supplier_id: int, supplier: schemas.SupplierCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id, models.Supplier.is_deleted == False)
    )
    db_supplier = result.scalar_one_or_none()
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for key, value in supplier.model_dump().items():
        setattr(db_supplier, key, value)
    await db.commit()
    await db.refresh(db_supplier)
    return db_supplier


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id, models.Supplier.is_deleted == False)
    )
    db_supplier = result.scalar_one_or_none()
    if not db_supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    db_supplier.is_deleted = True
    await db.commit()
    return {"detail": "Supplier deleted"}


# ─── Customers ───────────────────────────────────────────────────────────────

@router.get("/customers", response_model=List[schemas.CustomerResponse])
async def get_customers(skip: int = 0, limit: int = 200, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Customer).where(models.Customer.is_deleted == False).offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.get("/customers/ledger-overview", response_model=schemas.CustomerLedgerOverviewResponse)
async def get_customer_ledger_overview(
    search: str | None = Query(default=None),
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    filters = [models.Customer.is_deleted == False]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                models.Customer.name.ilike(pattern),
                models.Customer.phone.ilike(pattern),
                models.Customer.gst_number.ilike(pattern),
            )
        )

    rows_result = await db.execute(
        select(
            models.Customer.id,
            models.Customer.name,
            models.Customer.phone,
            models.Customer.gst_number,
            func.coalesce(models.CustomerLedger.total_credit, 0),
            func.coalesce(models.CustomerLedger.total_billed, 0),
            func.coalesce(models.CustomerLedger.total_paid, 0),
            func.coalesce(models.CustomerLedger.total_credit_notes, 0),
            func.coalesce(models.CustomerLedger.outstanding_balance, 0),
        )
        .outerjoin(models.CustomerLedger, models.CustomerLedger.customer_id == models.Customer.id)
        .where(*filters)
        .order_by(models.Customer.name.asc(), models.Customer.id.asc())
        .offset(skip)
        .limit(limit)
    )

    total_result = await db.execute(
        select(
            func.count(models.Customer.id),
            func.coalesce(func.sum(models.CustomerLedger.outstanding_balance), 0),
        )
        .select_from(models.Customer)
        .outerjoin(models.CustomerLedger, models.CustomerLedger.customer_id == models.Customer.id)
        .where(*filters)
    )
    total_customers, total_outstanding_receivable = total_result.one()

    items = [
        {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "phone": phone,
            "gst_number": gst_number,
            "total_credit": total_credit,
            "total_billed": total_billed,
            "total_paid": total_paid,
            "total_credit_notes": total_credit_notes,
            "outstanding_balance": outstanding_balance,
        }
        for (
            customer_id,
            customer_name,
            phone,
            gst_number,
            total_credit,
            total_billed,
            total_paid,
            total_credit_notes,
            outstanding_balance,
        ) in rows_result.all()
    ]

    return {
        "items": items,
        "total_outstanding_receivable": total_outstanding_receivable,
        "total_customers": total_customers,
    }


@router.post("/customers", response_model=schemas.CustomerResponse)
async def create_customer(customer: schemas.CustomerCreate, db: AsyncSession = Depends(get_db)):
    try:
        db_customer = models.Customer(**customer.model_dump())
        db.add(db_customer)
        await db.flush()
        
        await ensure_customer_ledger(db, db_customer.id)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise e
        
    await db.refresh(db_customer)
    return db_customer


@router.get("/customers/{customer_id}", response_model=schemas.CustomerResponse)
async def get_customer(customer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Customer).where(models.Customer.id == customer_id, models.Customer.is_deleted == False)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.put("/customers/{customer_id}", response_model=schemas.CustomerResponse)
async def update_customer(customer_id: int, customer: schemas.CustomerCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Customer).where(models.Customer.id == customer_id, models.Customer.is_deleted == False)
    )
    db_customer = result.scalar_one_or_none()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    for key, value in customer.model_dump().items():
        setattr(db_customer, key, value)
    await db.commit()
    await db.refresh(db_customer)
    return db_customer


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Customer).where(models.Customer.id == customer_id, models.Customer.is_deleted == False)
    )
    db_customer = result.scalar_one_or_none()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db_customer.is_deleted = True
    await db.commit()
    return {"detail": "Customer deleted"}


@router.get("/customers/{customer_id}/ledger", response_model=schemas.CustomerLedgerResponse)
async def get_customer_ledger(
    customer_id: int,
    history_limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    customer_result = await db.execute(
        select(models.Customer).where(
            models.Customer.id == customer_id,
            models.Customer.is_deleted == False,
        )
    )
    customer = customer_result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    await sync_customer_ledger(db, customer_id)
    result = await db.execute(
        select(models.CustomerLedger).where(models.CustomerLedger.customer_id == customer_id)
    )
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found for this customer")

    bills_result = await db.execute(
        select(models.SalesBill)
        .where(
            models.SalesBill.customer_id == customer_id,
            models.SalesBill.is_deleted == False,
        )
        .order_by(models.SalesBill.bill_date.desc(), models.SalesBill.id.desc())
        .limit(history_limit)
    )
    payments_result = await db.execute(
        select(models.PaymentTransaction)
        .where(models.PaymentTransaction.customer_id == customer_id)
        .order_by(models.PaymentTransaction.payment_date.desc(), models.PaymentTransaction.id.desc())
        .limit(history_limit)
    )
    credit_notes_result = await db.execute(
        select(models.CreditNote)
        .where(models.CreditNote.customer_id == customer_id)
        .order_by(models.CreditNote.credit_date.desc(), models.CreditNote.id.desc())
        .limit(history_limit)
    )
    sales_returns_result = await db.execute(
        select(models.SalesReturn)
        .where(models.SalesReturn.customer_id == customer_id)
        .order_by(models.SalesReturn.return_date.desc(), models.SalesReturn.id.desc())
        .limit(history_limit)
    )

    return {
        **schemas.CustomerLedgerResponse.model_validate(ledger).model_dump(),
        "bills": bills_result.scalars().all(),
        "payments": payments_result.scalars().all(),
        "credit_notes": credit_notes_result.scalars().all(),
        "sales_returns": sales_returns_result.scalars().all(),
    }


@router.get("/suppliers/{supplier_id}/ledger", response_model=schemas.SupplierLedgerResponse)
async def get_supplier_ledger(
    supplier_id: int,
    history_limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    supplier_result = await db.execute(
        select(models.Supplier).where(
            models.Supplier.id == supplier_id,
            models.Supplier.is_deleted == False,
        )
    )
    supplier = supplier_result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    await sync_supplier_ledger(db, supplier_id)
    result = await db.execute(
        select(models.SupplierLedger).where(models.SupplierLedger.supplier_id == supplier_id)
    )
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found for this supplier")

    invoices_result = await db.execute(
        select(models.PurchaseInvoice)
        .where(
            models.PurchaseInvoice.supplier_id == supplier_id,
            models.PurchaseInvoice.is_deleted == False,
        )
        .order_by(models.PurchaseInvoice.invoice_date.desc(), models.PurchaseInvoice.id.desc())
        .limit(history_limit)
    )
    payments_result = await db.execute(
        select(models.SupplierPaymentTransaction)
        .where(models.SupplierPaymentTransaction.supplier_id == supplier_id)
        .order_by(models.SupplierPaymentTransaction.payment_date.desc(), models.SupplierPaymentTransaction.id.desc())
        .limit(history_limit)
    )
    stock_returns_result = await db.execute(
        select(models.SupplierStockReturn)
        .where(models.SupplierStockReturn.supplier_id == supplier_id)
        .order_by(models.SupplierStockReturn.return_date.desc(), models.SupplierStockReturn.id.desc())
        .limit(history_limit)
    )

    return {
        **schemas.SupplierLedgerResponse.model_validate(ledger).model_dump(),
        "invoices": invoices_result.scalars().all(),
        "payments": payments_result.scalars().all(),
        "stock_returns": stock_returns_result.scalars().all(),
    }

