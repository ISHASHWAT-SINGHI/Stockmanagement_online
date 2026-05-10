"""routers/products.py — Products, barcodes, and stock endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, asc, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from accounting import DAMAGE_ADJUSTMENT_TYPES, apply_non_sellable_stock_move
import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["products"], dependencies=[Depends(get_current_user)])


# ─── Products ────────────────────────────────────────────────────────────────

@router.get("/products", response_model=List[schemas.ProductResponse])
async def get_products(
    skip: int = 0,
    limit: int = 200,
    include_archived: bool = False,
    search: str | None = Query(default=None),
    brand: str | None = Query(default=None),
    category: str | None = Query(default=None),
    stock_status: str | None = Query(default=None),
    gst_rate: float | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    query = select(models.Product).where(models.Product.is_deleted == False)
    if not include_archived:
        query = query.where(models.Product.is_archived == False)

    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(
            or_(
                models.Product.product_name.ilike(pattern),
                models.Product.brand_name.ilike(pattern),
                models.Product.category.ilike(pattern),
            )
        )

    if brand:
        query = query.where(models.Product.brand_name == brand)

    if category:
        query = query.where(models.Product.category == category)

    if gst_rate is not None:
        query = query.where(models.Product.tax_rate == gst_rate)

    if stock_status == "in_stock":
        query = query.where(models.Product.current_stock > 0)
    elif stock_status == "out_of_stock":
        query = query.where(models.Product.current_stock <= 0)
    elif stock_status == "low_stock":
        query = query.where(
            and_(
                models.Product.current_stock > 0,
                or_(
                    and_(
                        models.Product.min_stock_level.is_not(None),
                        models.Product.min_stock_level > 0,
                        models.Product.current_stock <= models.Product.min_stock_level,
                    ),
                    and_(
                        or_(models.Product.min_stock_level.is_(None), models.Product.min_stock_level <= 0),
                        models.Product.current_stock <= 5,
                    ),
                ),
            )
        )

    sort_options = {
        "name_asc": asc(models.Product.product_name),
        "name_desc": desc(models.Product.product_name),
        "stock_asc": asc(models.Product.current_stock),
        "stock_desc": desc(models.Product.current_stock),
        "price_asc": asc(models.Product.tax_rate),
        "price_desc": desc(models.Product.tax_rate),
        "recently_added": desc(models.Product.created_at),
        "recently_updated": desc(models.Product.updated_at),
    }
    query = query.order_by(sort_options.get(sort_by or "", asc(models.Product.product_name)), asc(models.Product.id))

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


@router.post("/products/bulk-unarchive")
async def bulk_unarchive_products(payload: schemas.ProductBulkUnarchiveRequest, db: AsyncSession = Depends(get_db)):
    product_ids = sorted(set(payload.product_ids))
    if not product_ids:
        raise HTTPException(status_code=400, detail="Select at least one archived product.")

    result = await db.execute(
        select(models.Product).where(
            models.Product.id.in_(product_ids),
            models.Product.is_deleted == False,
        )
    )
    products = result.scalars().all()
    if not products:
        raise HTTPException(status_code=404, detail="No matching products found.")

    updated = 0
    for product in products:
        if product.is_archived:
            product.is_archived = False
            updated += 1

    if updated == 0:
        raise HTTPException(status_code=400, detail="Selected products are already active.")

    await db.commit()
    return {
        "detail": f"Unarchived {updated} product{'s' if updated != 1 else ''}.",
        "count": updated,
    }


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
        prev_batch_stock = int(batch.available_quantity or 0)
        qty = int(adjustment.quantity or 0)
        adjustment_type = adjustment.adjustment_type.strip().upper()

        if adjustment_type in DAMAGE_ADJUSTMENT_TYPES:
            (
                batch.available_quantity,
                batch.non_sellable_quantity,
                product.current_stock,
                product.non_sellable_stock,
            ) = apply_non_sellable_stock_move(
                batch.available_quantity,
                batch.non_sellable_quantity,
                product.current_stock,
                product.non_sellable_stock,
                qty,
            )
            recorded_quantity = -abs(qty)
        else:
            new_batch_stock = prev_batch_stock + qty
            if new_batch_stock < 0:
                raise HTTPException(status_code=400, detail=f"Cannot reduce stock below zero. Current batch stock: {prev_batch_stock}")
            batch.available_quantity = new_batch_stock
            product.current_stock += qty
            recorded_quantity = qty

        # Create Adjustment Record
        db_adj = models.StockAdjustment(
            product_id=product.id,
            stock_batch_id=batch.id,
            adjustment_type=adjustment_type,
            quantity=recorded_quantity,
            reason=adjustment.reason,
            adjusted_by=current_user.username,
            final_action=adjustment.final_action,
            previous_stock=prev_batch_stock,
            new_stock=batch.available_quantity,
        )
        db.add(db_adj)
        await db.flush()

        # Create Ledger Entry
        db.add(models.StockLedger(
            product_id=product.id,
            transaction_type="ADJUSTMENT" if adjustment_type not in DAMAGE_ADJUSTMENT_TYPES else "NON_SELLABLE_ADJUSTMENT",
            quantity=recorded_quantity,
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


@router.get("/stock-adjustments", response_model=List[schemas.StockAdjustmentResponse])
async def get_stock_adjustments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.StockAdjustment).order_by(models.StockAdjustment.created_at.desc(), models.StockAdjustment.id.desc())
    )
    return result.scalars().all()
