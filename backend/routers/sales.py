"""routers/sales.py - Sales bill and payment endpoints."""
from __future__ import annotations

from datetime import date, datetime, time
from html import escape
from pathlib import Path
from typing import Iterable, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from accounting import (
    clamp_money,
    compute_bill_payment_state,
    compute_followup_payment_state,
    create_sale_payment_transaction,
    delete_initial_sale_payments,
    normalize_payment_mode,
    sync_customer_ledger,
)
import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["sales"], dependencies=[Depends(get_current_user)])

EXPORTS_ROOT = Path(__file__).resolve().parents[2] / "exports" / "sales-bills"


def get_product_display_name(product: models.Product | None) -> str:
    if not product:
        return "Unknown Product"
    return " ".join(part for part in [product.brand_name, product.product_name] if part).strip() or f"Product #{product.id}"


def get_sale_item_display_name(item: models.SaleItem) -> str:
    if item.product_name_snapshot:
        return item.product_name_snapshot
    if item.product:
        return get_product_display_name(item.product)
    return f"Product #{item.product_id}"


def get_bill_datetime(input_date: date | None) -> datetime:
    effective_date = input_date or datetime.utcnow().date()
    return datetime.combine(effective_date, time.min)


def get_financial_year(bill_date: date) -> str:
    if bill_date.month >= 4:
        start_year = bill_date.year
        end_year = bill_date.year + 1
    else:
        start_year = bill_date.year - 1
        end_year = bill_date.year
    return f"{str(start_year)[-2:]}-{str(end_year)[-2:]}"


def format_bill_number(prefix: str, financial_year: str, sequence: int) -> str:
    safe_prefix = prefix.strip() or "INV"
    return f"{safe_prefix}/{financial_year}/{sequence:04d}"


def safe_filename(value: str) -> str:
    sanitized = value.replace("/", "-").replace("\\", "-").replace(":", "-")
    sanitized = sanitized.replace("*", "-").replace("?", "").replace('"', "")
    sanitized = sanitized.replace("<", "").replace(">", "").replace("|", "-")
    return sanitized


async def get_business_settings(db: AsyncSession) -> models.BusinessSettings:
    result = await db.execute(select(models.BusinessSettings).where(models.BusinessSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings:
        return settings

    settings = models.BusinessSettings(id=1, company_name="My Business", invoice_prefix="INV")
    db.add(settings)
    await db.flush()
    return settings


async def next_bill_identity(db: AsyncSession, bill_day: date) -> tuple[str, int, str]:
    settings = await get_business_settings(db)
    financial_year = get_financial_year(bill_day)
    prefix = settings.invoice_prefix or "INV"

    sequence_result = await db.execute(
        select(models.SalesBillSequence)
        .where(models.SalesBillSequence.financial_year == financial_year)
        .with_for_update()
    )
    sequence_row = sequence_result.scalar_one_or_none()
    if not sequence_row:
        sequence_row = models.SalesBillSequence(financial_year=financial_year, last_number=0)
        db.add(sequence_row)
        await db.flush()

    sequence_row.last_number += 1
    return financial_year, sequence_row.last_number, format_bill_number(prefix, financial_year, sequence_row.last_number)


async def get_product_or_404(db: AsyncSession, product_id: int) -> models.Product:
    result = await db.execute(
        select(models.Product).where(models.Product.id == product_id, models.Product.is_deleted == False)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product


async def allocate_batches_for_product(
    db: AsyncSession,
    product: models.Product,
    quantity: int,
) -> list[tuple[models.StockBatch, int]]:
    batch_result = await db.execute(
        select(models.StockBatch)
        .where(
            models.StockBatch.product_id == product.id,
            models.StockBatch.available_quantity > 0,
        )
        .order_by(models.StockBatch.purchase_date, models.StockBatch.id)
    )
    batches = batch_result.scalars().all()
    total_available = sum(max(batch.available_quantity or 0, 0) for batch in batches)
    if total_available < quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {get_product_display_name(product)}. Available: {total_available}",
        )

    allocations: list[tuple[models.StockBatch, int]] = []
    remaining = quantity
    for batch in batches:
        if remaining <= 0:
            break
        take = min(batch.available_quantity, remaining)
        if take <= 0:
            continue
        batch.available_quantity -= take
        allocations.append((batch, take))
        remaining -= take

    if remaining > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to allocate stock for {get_product_display_name(product)}.",
        )
    return allocations


async def apply_sale_items(
    db: AsyncSession,
    db_bill: models.SalesBill,
    items_data: Iterable[schemas.SaleItemCreate],
) -> None:
    for item in items_data:
        product = await get_product_or_404(db, item.product_id)
        allocations = await allocate_batches_for_product(db, product, item.quantity)
        display_name = get_product_display_name(product)

        db_item = models.SaleItem(
            bill_id=db_bill.id,
            product_id=product.id,
            stock_batch_id=allocations[0][0].id if allocations else item.stock_batch_id,
            quantity=item.quantity,
            selling_price=item.selling_price,
            gst_percent=item.gst_percent,
            discount_percent=item.discount_percent,
            final_amount=item.final_amount,
            product_name_snapshot=display_name,
        )
        db.add(db_item)
        await db.flush()

        for batch, allocated_quantity in allocations:
            db.add(
                models.SaleItemBatchAllocation(
                    sale_item_id=db_item.id,
                    stock_batch_id=batch.id,
                    quantity=allocated_quantity,
                )
            )

        product.current_stock = max((product.current_stock or 0) - item.quantity, 0)
        db.add(
            models.StockLedger(
                product_id=product.id,
                transaction_type="SALE",
                quantity=-item.quantity,
                reference_id=db_bill.id,
                notes=f"{db_bill.bill_number} sold {item.quantity} unit(s) of {display_name}",
            )
        )


def build_sale_payment_fields(bill: schemas.SalesBillCreate) -> dict:
    payment_state = compute_bill_payment_state(bill.grand_total, bill.paid_amount)
    payment_mode = normalize_payment_mode(bill.payment_mode)
    bill_dict = bill.model_dump(
        exclude={
            "items",
            "bill_number",
            "payment_note",
            "payment_reference",
            "paid_amount",
            "outstanding_amount",
            "payment_status",
            "payment_mode",
        },
        exclude_none=True,
    )

    if payment_state.applied_paid_amount <= 0 and payment_state.outstanding_amount > 0:
        payment_mode = "Credit"
    elif payment_mode is None and payment_state.applied_paid_amount > 0:
        payment_mode = "Cash"

    bill_dict.update(
        {
            "paid_amount": payment_state.applied_paid_amount,
            "outstanding_amount": payment_state.outstanding_amount,
            "payment_status": payment_state.payment_status,
            "payment_mode": payment_mode,
        }
    )
    return bill_dict


async def restore_sale_item_stock(
    db: AsyncSession,
    bill: models.SalesBill,
    sale_item: models.SaleItem,
) -> None:
    product = await get_product_or_404(db, sale_item.product_id)
    product.current_stock = (product.current_stock or 0) + (sale_item.quantity or 0)

    if sale_item.batch_allocations:
        allocations = [(allocation.stock_batch, allocation.quantity) for allocation in sale_item.batch_allocations]
    else:
        batch_result = await db.execute(
            select(models.StockBatch).where(models.StockBatch.id == sale_item.stock_batch_id)
        )
        batch = batch_result.scalar_one_or_none()
        allocations = [(batch, sale_item.quantity)] if batch else []

    for batch, quantity in allocations:
        if batch:
            batch.available_quantity = (batch.available_quantity or 0) + quantity

    db.add(
        models.StockLedger(
            product_id=sale_item.product_id,
            transaction_type="SALE_REVERSAL",
            quantity=sale_item.quantity,
            reference_id=bill.id,
            notes=f"Reversed revision of {bill.bill_number}",
        )
    )


def render_bill_snapshot_html(
    settings: models.BusinessSettings,
    bill: models.SalesBill,
    customer: models.Customer | None,
) -> str:
    total_quantity = sum((item.quantity or 0) for item in bill.sales_items or [])
    customer_name = customer.name if customer else "Walk-in Customer"
    customer_address = customer.address if customer and customer.address else ""
    customer_phone = customer.phone if customer and customer.phone else ""
    customer_gst_html = escape(customer.gst_number) if customer and customer.gst_number else "&nbsp;"

    rows = []
    for index, item in enumerate(bill.sales_items or [], start=1):
        rows.append(
            "<tr>"
            f"<td>{index}</td>"
            f"<td>{escape(get_sale_item_display_name(item))}</td>"
            f"<td style='text-align:center'>{item.quantity}</td>"
            f"<td style='text-align:right'>{item.selling_price:.2f}</td>"
            f"<td style='text-align:right'>{item.final_amount:.2f}</td>"
            "</tr>"
        )
    rows_html = "".join(rows)

    address_parts = [settings.address, settings.city, settings.state, settings.pincode]
    business_address = ", ".join(part for part in address_parts if part)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{escape(bill.bill_number)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111; }}
    .header {{ text-align: center; border-bottom: 1px solid #bbb; padding-bottom: 12px; margin-bottom: 18px; }}
    .header h1 {{ margin: 0; font-size: 24px; }}
    .muted {{ color: #555; font-size: 12px; }}
    .meta {{ display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ border: 1px solid #ccc; padding: 8px; font-size: 13px; }}
    th {{ background: #f5f5f5; text-align: left; }}
    .totals {{ margin-top: 16px; width: 320px; margin-left: auto; }}
    .totals td {{ border: none; padding: 4px 0; }}
    .strong {{ font-weight: bold; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>{escape(settings.company_name or "My Business")}</h1>
    <div class="muted">{escape(settings.tagline or "")}</div>
    <div class="muted">{escape(business_address)}</div>
    <div class="muted">Phone: {escape(settings.phone or "-")} | Email: {escape(settings.email or "-")}</div>
    <div class="muted">GSTIN: {escape(settings.gst_number or "-")}</div>
  </div>

  <div class="meta">
    <div>
      <div class="strong">Customer</div>
      <div>{escape(customer_name)}</div>
      <div>{escape(customer_address)}</div>
      <div>{escape(customer_phone)}</div>
      <div>GSTIN: {customer_gst_html}</div>
    </div>
    <div style="text-align:right">
      <div class="strong">{escape(bill.bill_number)}</div>
      <div>Date: {escape(bill.bill_date.strftime("%d-%m-%Y"))}</div>
      <div>Revision: {bill.revision_number}</div>
      <div>Total Qty: {total_quantity}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>S.N.</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Rate</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
    </tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td>Total Quantity</td><td style="text-align:right">{total_quantity}</td></tr>
      <tr><td>Subtotal</td><td style="text-align:right">Rs {bill.subtotal:.2f}</td></tr>
      <tr><td>Discount</td><td style="text-align:right">Rs {bill.discount_amount:.2f}</td></tr>
      <tr><td>Taxable</td><td style="text-align:right">Rs {bill.taxable_amount:.2f}</td></tr>
      <tr><td>CGST</td><td style="text-align:right">Rs {bill.cgst_amount:.2f}</td></tr>
      <tr><td>SGST</td><td style="text-align:right">Rs {bill.sgst_amount:.2f}</td></tr>
      <tr class="strong"><td>Grand Total</td><td style="text-align:right">Rs {bill.grand_total:.2f}</td></tr>
      <tr><td>Paid</td><td style="text-align:right">Rs {bill.paid_amount:.2f}</td></tr>
      <tr><td>Outstanding</td><td style="text-align:right">Rs {bill.outstanding_amount:.2f}</td></tr>
    </tbody>
  </table>

  <div class="muted" style="margin-top:18px">{escape(settings.invoice_footer or "")}</div>
</body>
</html>
"""


def write_bill_snapshot(
    settings: models.BusinessSettings,
    bill: models.SalesBill,
    customer: models.Customer | None,
) -> Path:
    folder = EXPORTS_ROOT / (bill.financial_year or get_financial_year(bill.bill_date.date()))
    folder.mkdir(parents=True, exist_ok=True)
    suffix = "" if (bill.revision_number or 1) <= 1 else f"-v{bill.revision_number}"
    file_path = folder / f"{safe_filename(bill.bill_number)}{suffix}.html"
    file_path.write_text(render_bill_snapshot_html(settings, bill, customer), encoding="utf-8")
    return file_path


async def load_bill_for_edit(db: AsyncSession, bill_id: int) -> models.SalesBill | None:
    result = await db.execute(
        select(models.SalesBill)
        .options(
            selectinload(models.SalesBill.sales_items)
            .selectinload(models.SaleItem.product),
            selectinload(models.SalesBill.sales_items)
            .selectinload(models.SaleItem.batch_allocations)
            .selectinload(models.SaleItemBatchAllocation.stock_batch),
            selectinload(models.SalesBill.customer),
            selectinload(models.SalesBill.payment_transactions),
        )
        .where(models.SalesBill.id == bill_id, models.SalesBill.is_deleted == False)
    )
    return result.scalar_one_or_none()


@router.get("/sales", response_model=List[schemas.SalesBillResponse])
async def get_sales(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SalesBill)
        .options(
            selectinload(models.SalesBill.sales_items),
            selectinload(models.SalesBill.customer),
        )
        .where(models.SalesBill.is_deleted == False)
        .order_by(models.SalesBill.bill_date.desc(), models.SalesBill.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/sales", response_model=schemas.SalesBillResponse)
async def create_sale(
    bill: schemas.SalesBillCreate,
    db: AsyncSession = Depends(get_db),
):
    items_data = bill.items
    bill_day = bill.bill_date or datetime.utcnow().date()
    financial_year, bill_sequence, bill_number = await next_bill_identity(db, bill_day)
    bill_datetime = get_bill_datetime(bill_day)
    if bill.customer_id:
        customer_result = await db.execute(
            select(models.Customer).where(
                models.Customer.id == bill.customer_id,
                models.Customer.is_deleted == False,
            )
        )
        if not customer_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Customer not found")

    bill_dict = build_sale_payment_fields(bill)
    bill_dict.update(
        {
            "bill_number": bill_number,
            "bill_date": bill_datetime,
            "financial_year": financial_year,
            "bill_sequence": bill_sequence,
        }
    )

    snapshot_path: Path | None = None
    try:
        db_bill = models.SalesBill(**bill_dict)
        db.add(db_bill)
        await db.flush()

        await apply_sale_items(db, db_bill, items_data)
        await create_sale_payment_transaction(
            db,
            db_bill,
            amount=db_bill.paid_amount,
            payment_mode=db_bill.payment_mode,
            payment_date=db_bill.bill_date,
            notes=bill.payment_note,
            reference_number=bill.payment_reference,
            is_initial_payment=True,
        )
        await sync_customer_ledger(db, db_bill.customer_id)

        settings = await get_business_settings(db)
        detailed_bill = await load_bill_for_edit(db, db_bill.id)
        snapshot_path = write_bill_snapshot(settings, detailed_bill, detailed_bill.customer)

        await db.commit()
    except Exception as exc:
        await db.rollback()
        if snapshot_path and snapshot_path.exists():
            snapshot_path.unlink()
        raise exc

    return await load_bill_for_edit(db, db_bill.id)


@router.put("/sales/{bill_id}", response_model=schemas.SalesBillDetailResponse)
async def update_sale(
    bill_id: int,
    bill: schemas.SalesBillCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_bill = await load_bill_for_edit(db, bill_id)
    if not db_bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    if any(not payment.is_initial_payment for payment in (db_bill.payment_transactions or [])):
        raise HTTPException(status_code=400, detail="Bills with recorded follow-up payments cannot be edited.")

    if bill.customer_id:
        customer_result = await db.execute(
            select(models.Customer).where(
                models.Customer.id == bill.customer_id,
                models.Customer.is_deleted == False,
            )
        )
        if not customer_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Customer not found")

    bill_day = bill.bill_date or db_bill.bill_date.date()
    if get_financial_year(bill_day) != (db_bill.financial_year or get_financial_year(db_bill.bill_date.date())):
        raise HTTPException(
            status_code=400,
            detail="Bill date cannot be moved into a different financial year during edit.",
        )

    snapshot_path: Path | None = None
    old_customer_id = db_bill.customer_id
    try:
        for sale_item in db_bill.sales_items:
            await restore_sale_item_stock(db, db_bill, sale_item)

        for sale_item in list(db_bill.sales_items):
            for allocation in list(sale_item.batch_allocations):
                await db.delete(allocation)
            await db.delete(sale_item)
        await delete_initial_sale_payments(db, db_bill)
        await db.flush()

        bill_dict = build_sale_payment_fields(bill)
        bill_dict["bill_date"] = get_bill_datetime(bill_day)
        for key, value in bill_dict.items():
            setattr(db_bill, key, value)

        db_bill.edited_at = datetime.utcnow()
        db_bill.edited_by = current_user.username
        db_bill.revision_number = (db_bill.revision_number or 1) + 1

        await apply_sale_items(db, db_bill, bill.items)
        await create_sale_payment_transaction(
            db,
            db_bill,
            amount=db_bill.paid_amount,
            payment_mode=db_bill.payment_mode,
            payment_date=db_bill.bill_date,
            notes=bill.payment_note,
            reference_number=bill.payment_reference,
            is_initial_payment=True,
        )
        await sync_customer_ledger(db, old_customer_id)
        if db_bill.customer_id != old_customer_id:
            await sync_customer_ledger(db, db_bill.customer_id)

        settings = await get_business_settings(db)
        detailed_bill = await load_bill_for_edit(db, db_bill.id)
        snapshot_path = write_bill_snapshot(settings, detailed_bill, detailed_bill.customer)

        await db.commit()
    except Exception as exc:
        await db.rollback()
        if snapshot_path and snapshot_path.exists():
            snapshot_path.unlink()
        raise exc

    return await load_bill_for_edit(db, db_bill.id)


@router.get("/sales/{bill_id}", response_model=schemas.SalesBillDetailResponse)
async def get_sale(bill_id: int, db: AsyncSession = Depends(get_db)):
    bill = await load_bill_for_edit(db, bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


@router.get("/sales/{bill_id}/payments", response_model=List[schemas.PaymentTransactionResponse])
async def get_sale_payments(bill_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.PaymentTransaction)
        .where(models.PaymentTransaction.bill_id == bill_id)
        .order_by(models.PaymentTransaction.payment_date.asc(), models.PaymentTransaction.id.asc())
    )
    return result.scalars().all()


@router.post("/sales/{bill_id}/payments", response_model=schemas.PaymentTransactionResponse)
async def create_sale_payment(
    bill_id: int,
    payment: schemas.PaymentTransactionCreate,
    db: AsyncSession = Depends(get_db),
):
    if payment.bill_id != bill_id:
        raise HTTPException(status_code=400, detail="Bill ID in path and payload must match.")
    return await create_payment(payment, db)


@router.get("/payments", response_model=List[schemas.PaymentTransactionResponse])
async def get_payments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.PaymentTransaction)
        .order_by(models.PaymentTransaction.payment_date.desc(), models.PaymentTransaction.id.desc())
    )
    return result.scalars().all()


@router.post("/payments", response_model=schemas.PaymentTransactionResponse)
async def create_payment(payment: schemas.PaymentTransactionCreate, db: AsyncSession = Depends(get_db)):
    bill_result = await db.execute(
        select(models.SalesBill)
        .where(models.SalesBill.id == payment.bill_id, models.SalesBill.is_deleted == False)
    )
    bill = bill_result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    customer_id = bill.customer_id
    if payment.customer_id is not None and customer_id is not None and payment.customer_id != customer_id:
        raise HTTPException(status_code=400, detail="Payment customer does not match the bill customer.")
    if payment.customer_id is not None and customer_id is None:
        customer_id = payment.customer_id

    payment_mode = normalize_payment_mode(payment.payment_mode) or "Cash"
    payment_state = compute_followup_payment_state(bill.grand_total, bill.paid_amount, payment.amount)

    try:
        db_payment = models.PaymentTransaction(
            bill_id=bill.id,
            customer_id=customer_id,
            amount=clamp_money(payment.amount),
            payment_mode=payment_mode,
            payment_date=payment.payment_date or datetime.utcnow(),
            notes=payment.notes,
            reference_number=payment.reference_number,
            is_initial_payment=False,
        )
        db.add(db_payment)

        bill.paid_amount = payment_state.applied_paid_amount
        bill.outstanding_amount = payment_state.outstanding_amount
        bill.payment_status = payment_state.payment_status
        if not bill.payment_mode:
            bill.payment_mode = payment_mode

        await sync_customer_ledger(db, customer_id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    await db.refresh(db_payment)
    return db_payment
