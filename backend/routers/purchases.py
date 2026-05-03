"""routers/purchases.py - Purchase invoice endpoints."""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["purchases"], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)


def get_product_display_name(product: models.Product | None) -> str:
    if not product:
        return "Unknown Product"
    return " ".join(part for part in [product.brand_name, product.product_name] if part).strip() or f"Product #{product.id}"


def normalize_invoice_number(invoice_number: str) -> str:
    return " ".join((invoice_number or "").split()).strip()


async def get_supplier_or_404(db: AsyncSession, supplier_id: int) -> models.Supplier:
    result = await db.execute(
        select(models.Supplier).where(
            models.Supplier.id == supplier_id,
            models.Supplier.is_deleted == False,
        )
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found")
    return supplier


async def get_product_or_404(db: AsyncSession, product_id: int) -> models.Product:
    result = await db.execute(
        select(models.Product).where(
            models.Product.id == product_id,
            models.Product.is_deleted == False,
        )
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


async def load_purchase_invoice(db: AsyncSession, invoice_id: int) -> models.PurchaseInvoice | None:
    result = await db.execute(
        select(models.PurchaseInvoice)
        .options(
            selectinload(models.PurchaseInvoice.purchase_items).selectinload(models.PurchaseItem.product)
        )
        .where(models.PurchaseInvoice.id == invoice_id)
    )
    return result.scalar_one_or_none()


async def load_purchase_invoice_by_request_id(
    db: AsyncSession,
    client_request_id: str,
) -> models.PurchaseInvoice | None:
    if not client_request_id:
        return None

    result = await db.execute(
        select(models.PurchaseInvoice.id).where(
            models.PurchaseInvoice.client_request_id == client_request_id
        )
    )
    invoice_id = result.scalar_one_or_none()
    if not invoice_id:
        return None
    return await load_purchase_invoice(db, invoice_id)


async def find_existing_purchase_invoice(
    db: AsyncSession,
    supplier_id: int,
    invoice_number: str,
) -> models.PurchaseInvoice | None:
    normalized_invoice_number = normalize_invoice_number(invoice_number)
    if not normalized_invoice_number:
        return None

    result = await db.execute(
        select(models.PurchaseInvoice.id).where(
            models.PurchaseInvoice.supplier_id == supplier_id,
            models.PurchaseInvoice.is_deleted == False,
            func.lower(func.btrim(models.PurchaseInvoice.invoice_number)) == normalized_invoice_number.lower(),
        )
    )
    invoice_id = result.scalar_one_or_none()
    if not invoice_id:
        return None
    return await load_purchase_invoice(db, invoice_id)


@router.get("/purchase-invoices", response_model=List[schemas.PurchaseInvoiceResponse])
async def get_purchase_invoices(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.PurchaseInvoice)
        .options(selectinload(models.PurchaseInvoice.purchase_items))
        .where(models.PurchaseInvoice.is_deleted == False)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/purchase-invoices", response_model=schemas.PurchaseInvoiceResponse)
async def create_purchase_invoice(
    invoice: schemas.PurchaseInvoiceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    items_data = invoice.items
    request_id = getattr(request.state, "request_id", "unknown")
    client_request_id = request.headers.get("X-Idempotency-Key")
    normalized_invoice_number = normalize_invoice_number(invoice.invoice_number)
    if not normalized_invoice_number:
        raise HTTPException(status_code=400, detail="Invoice number is required")

    invoice_dict = invoice.model_dump(exclude={"items"})
    invoice_dict["invoice_number"] = normalized_invoice_number

    if client_request_id:
        existing_by_request = await load_purchase_invoice_by_request_id(db, client_request_id)
        if existing_by_request:
            logger.info(
                "purchase_invoice_idempotent_replay request_id=%s client_request_id=%s invoice_id=%s",
                request_id,
                client_request_id,
                existing_by_request.id,
            )
            return existing_by_request

    existing_invoice = await find_existing_purchase_invoice(
        db,
        invoice.supplier_id,
        normalized_invoice_number,
    )
    if existing_invoice:
        raise HTTPException(
            status_code=409,
            detail=f"Purchase invoice {normalized_invoice_number} already exists for this supplier.",
        )

    try:
        await get_supplier_or_404(db, invoice.supplier_id)
        db_invoice = models.PurchaseInvoice(
            **invoice_dict,
            client_request_id=client_request_id,
        )
        db.add(db_invoice)
        await db.flush()

        for item in items_data:
            product = await get_product_or_404(db, item.product_id)
            db_item = models.PurchaseItem(
                **item.model_dump(),
                invoice_id=db_invoice.id,
                product_name_snapshot=get_product_display_name(product),
            )
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

            product.current_stock = (product.current_stock or 0) + item.quantity

            db.add(
                models.StockLedger(
                    product_id=item.product_id,
                    transaction_type="PURCHASE",
                    quantity=item.quantity,
                    reference_id=db_invoice.id,
                )
            )

        await db.commit()
    except IntegrityError:
        await db.rollback()

        if client_request_id:
            existing_by_request = await load_purchase_invoice_by_request_id(db, client_request_id)
            if existing_by_request:
                logger.info(
                    "purchase_invoice_idempotent_recover request_id=%s client_request_id=%s invoice_id=%s",
                    request_id,
                    client_request_id,
                    existing_by_request.id,
                )
                return existing_by_request

        duplicate_invoice = await find_existing_purchase_invoice(
            db,
            invoice.supplier_id,
            normalized_invoice_number,
        )
        if duplicate_invoice:
            raise HTTPException(
                status_code=409,
                detail=f"Purchase invoice {normalized_invoice_number} already exists for this supplier.",
            )

        raise HTTPException(
            status_code=409,
            detail="Duplicate purchase submission detected. Refresh purchase history before retrying.",
        )
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    created_invoice = await load_purchase_invoice(db, db_invoice.id)
    if not created_invoice:
        raise HTTPException(status_code=404, detail="Invoice not found after creation")

    logger.info(
        "purchase_invoice_created request_id=%s client_request_id=%s invoice_id=%s supplier_id=%s invoice_number=%s",
        request_id,
        client_request_id,
        created_invoice.id,
        created_invoice.supplier_id,
        created_invoice.invoice_number,
    )
    return created_invoice


@router.get("/purchase-invoices/{invoice_id}", response_model=schemas.PurchaseInvoiceDetailResponse)
async def get_purchase_invoice(invoice_id: int, db: AsyncSession = Depends(get_db)):
    invoice = await load_purchase_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice
