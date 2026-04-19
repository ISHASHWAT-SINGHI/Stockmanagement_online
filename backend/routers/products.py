"""routers/products.py — Products, barcodes, and stock endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["products"], dependencies=[Depends(get_current_user)])


# ─── Products ────────────────────────────────────────────────────────────────

@router.get("/products", response_model=List[schemas.ProductResponse])
async def get_products(skip: int = 0, limit: int = 200, include_archived: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(models.Product).where(models.Product.is_deleted == False)
    if not include_archived:
        query = query.where(models.Product.is_archived == False)
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("/products", response_model=schemas.ProductResponse)
async def create_product(product: schemas.ProductCreate, db: AsyncSession = Depends(get_db)):
    db_product = models.Product(**product.model_dump())
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    return db_product


@router.get("/products/{product_id}", response_model=schemas.ProductResponse)
async def get_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Product).where(models.Product.id == product_id, models.Product.is_deleted == False)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.put("/products/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, product: schemas.ProductCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Product).where(models.Product.id == product_id, models.Product.is_deleted == False)
    )
    db_product = result.scalar_one_or_none()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in product.model_dump().items():
        setattr(db_product, key, value)
    await db.commit()
    await db.refresh(db_product)
    return db_product


@router.delete("/products/{product_id}")
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db)):
    """Products cannot be deleted, only archived."""
    raise HTTPException(status_code=400, detail="Products cannot be deleted. Archive them instead.")


@router.post("/products/{product_id}/archive")
async def archive_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id, models.Product.is_deleted == False))
    db_product = result.scalar_one_or_none()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    if db_product.current_stock > 0:
        raise HTTPException(status_code=400, detail="Cannot archive a product with active stock.")
    db_product.is_archived = True
    await db.commit()
    return {"detail": "Product archived"}

@router.post("/products/{product_id}/unarchive")
async def unarchive_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Product).where(models.Product.id == product_id, models.Product.is_deleted == False))
    db_product = result.scalar_one_or_none()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    db_product.is_archived = False
    await db.commit()
    return {"detail": "Product unarchived"}


# ─── Barcodes ────────────────────────────────────────────────────────────────

@router.get("/barcodes", response_model=List[schemas.BarcodeResponse])
async def get_barcodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Barcode))
    return result.scalars().all()


@router.post("/barcodes", response_model=schemas.BarcodeResponse)
async def create_barcode(barcode: schemas.BarcodeCreate, db: AsyncSession = Depends(get_db)):
    db_barcode = models.Barcode(**barcode.model_dump())
    db.add(db_barcode)
    await db.commit()
    await db.refresh(db_barcode)
    return db_barcode


@router.get("/barcodes/{barcode}", response_model=schemas.BarcodeResponse)
async def get_barcode(barcode: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Barcode).where(models.Barcode.barcode == barcode))
    bc = result.scalar_one_or_none()
    if not bc:
        raise HTTPException(status_code=404, detail="Barcode not found")
    return bc


# ─── Stock Batches ────────────────────────────────────────────────────────────

@router.get("/stock-batches", response_model=List[schemas.StockBatchResponse])
async def get_stock_batches(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.StockBatch))
    return result.scalars().all()


@router.get("/stock-batches/product/{product_id}", response_model=List[schemas.StockBatchResponse])
async def get_batches_for_product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.StockBatch)
        .where(models.StockBatch.product_id == product_id, models.StockBatch.available_quantity > 0)
        .order_by(models.StockBatch.purchase_date)
    )
    return result.scalars().all()


# ─── Stock Ledger ─────────────────────────────────────────────────────────────

@router.get("/stock-ledger", response_model=List[schemas.StockLedgerResponse])
async def get_stock_ledger(product_id: int = None, db: AsyncSession = Depends(get_db)):
    query = select(models.StockLedger)
    if product_id:
        query = query.where(models.StockLedger.product_id == product_id)
    result = await db.execute(query)
    return result.scalars().all()


# ─── Stock Adjustments ────────────────────────────────────────────────────────

@router.post("/stock-adjustments", response_model=schemas.StockAdjustmentResponse)
async def create_stock_adjustment(
    adjustment: schemas.StockAdjustmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    try:
        # Validate Product
        prod_result = await db.execute(select(models.Product).where(models.Product.id == adjustment.product_id))
        product = prod_result.scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        # Validate Batch
        batch_result = await db.execute(select(models.StockBatch).where(models.StockBatch.id == adjustment.stock_batch_id))
        batch = batch_result.scalar_one_or_none()
        if not batch:
            raise HTTPException(status_code=404, detail="Stock batch not found")

        if batch.product_id != product.id:
            raise HTTPException(status_code=400, detail="Batch does not belong to this product")

        # Calculate adjustments
        prev_batch_stock = batch.available_quantity
        new_batch_stock = prev_batch_stock + adjustment.quantity

        if new_batch_stock < 0:
            raise HTTPException(status_code=400, detail=f"Cannot reduce stock below zero. Current batch stock: {prev_batch_stock}")

        # Apply changes
        batch.available_quantity = new_batch_stock
        product.current_stock += adjustment.quantity

        # Create Adjustment Record
        db_adj = models.StockAdjustment(
            product_id=product.id,
            stock_batch_id=batch.id,
            adjustment_type=adjustment.adjustment_type,
            quantity=adjustment.quantity,
            reason=adjustment.reason,
            adjusted_by=current_user.username,
            previous_stock=prev_batch_stock,
            new_stock=new_batch_stock
        )
        db.add(db_adj)
        await db.flush()

        # Create Ledger Entry
        db.add(models.StockLedger(
            product_id=product.id,
            transaction_type="ADJUSTMENT",
            quantity=adjustment.quantity,
            reference_id=db_adj.id,
            notes=f"{adjustment.adjustment_type}: {adjustment.reason}" if adjustment.reason else adjustment.adjustment_type
        ))

        await db.commit()
        await db.refresh(db_adj)
        return db_adj

    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise e
