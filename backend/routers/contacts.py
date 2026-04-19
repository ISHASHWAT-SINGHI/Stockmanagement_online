"""routers/contacts.py — Suppliers and Customers endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

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


@router.post("/suppliers", response_model=schemas.SupplierResponse)
async def create_supplier(supplier: schemas.SupplierCreate, db: AsyncSession = Depends(get_db)):
    db_supplier = models.Supplier(**supplier.model_dump())
    db.add(db_supplier)
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


@router.post("/customers", response_model=schemas.CustomerResponse)
async def create_customer(customer: schemas.CustomerCreate, db: AsyncSession = Depends(get_db)):
    try:
        db_customer = models.Customer(**customer.model_dump())
        db.add(db_customer)
        await db.flush()
        
        ledger = models.CustomerLedger(customer_id=db_customer.id)
        db.add(ledger)
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
async def get_customer_ledger(customer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.CustomerLedger).where(models.CustomerLedger.customer_id == customer_id)
    )
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found for this customer")
    return ledger
