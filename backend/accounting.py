from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

import models

PAYMENT_MODES = {"Cash", "UPI", "Card", "Credit"}
DAMAGE_ADJUSTMENT_TYPES = {"DAMAGE", "EXPIRY", "BROKEN", "LEAKED", "NON_SELLABLE"}
RETURN_STOCK_ACTIONS = {"SELLABLE", "DAMAGED", "NON_SELLABLE"}
SUPPLIER_RETURN_STATUSES = {"Pending", "Sent", "Accepted", "Rejected"}
SUPPLIER_RETURN_SOURCES = {"SELLABLE", "NON_SELLABLE"}
CREDIT_NOTE_STATUSES = {"Open", "Partially Applied", "Applied", "Cancelled"}


@dataclass(slots=True)
class BillPaymentState:
    tendered_amount: float
    applied_paid_amount: float
    outstanding_amount: float
    change_amount: float
    payment_status: str


def clamp_money(value: float | int | None) -> float:
    numeric = float(value or 0)
    if numeric < 0:
        return 0.0
    return round(numeric, 2)


def normalize_payment_mode(mode: str | None) -> str | None:
    if mode is None:
        return None
    normalized = str(mode).strip().title()
    if not normalized:
        return None
    if normalized == "Upi":
        normalized = "UPI"
    if normalized not in PAYMENT_MODES:
        raise HTTPException(status_code=400, detail="Payment mode must be Cash, UPI, Card, or Credit.")
    return normalized


def combine_date_at_start(value: date | None) -> datetime:
    effective_date = value or datetime.utcnow().date()
    return datetime.combine(effective_date, time.min)


def compute_bill_payment_state(grand_total: float | int | None, tendered_amount: float | int | None) -> BillPaymentState:
    total = clamp_money(grand_total)
    tendered = clamp_money(tendered_amount)
    applied = min(tendered, total)
    outstanding = max(0.0, round(total - applied, 2))
    change_amount = max(0.0, round(tendered - total, 2))

    if applied >= total and total > 0:
        payment_status = "Paid"
    elif applied > 0:
        payment_status = "Partial"
    else:
        payment_status = "Pending"

    if total == 0:
        payment_status = "Paid"

    return BillPaymentState(
        tendered_amount=tendered,
        applied_paid_amount=applied,
        outstanding_amount=outstanding,
        change_amount=change_amount,
        payment_status=payment_status,
    )


def compute_followup_payment_state(
    grand_total: float | int | None,
    current_paid_amount: float | int | None,
    payment_amount: float | int | None,
) -> BillPaymentState:
    total = clamp_money(grand_total)
    current_paid = clamp_money(current_paid_amount)
    payment = clamp_money(payment_amount)

    if payment <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    outstanding_before = max(0.0, round(total - current_paid, 2))
    if payment - outstanding_before > 0.009:
        raise HTTPException(
            status_code=400,
            detail=f"Payment exceeds outstanding balance of {outstanding_before:.2f}.",
        )

    updated_paid = round(current_paid + payment, 2)
    updated_outstanding = max(0.0, round(total - updated_paid, 2))
    payment_status = "Paid" if updated_outstanding == 0 else "Partial"

    return BillPaymentState(
        tendered_amount=payment,
        applied_paid_amount=updated_paid,
        outstanding_amount=updated_outstanding,
        change_amount=0.0,
        payment_status=payment_status,
    )


def resolve_credit_note_status(amount: float | int | None, applied_amount: float | int | None) -> str:
    total = clamp_money(amount)
    applied = clamp_money(applied_amount)
    if total == 0 or applied <= 0:
        return "Open"
    if applied >= total:
        return "Applied"
    return "Partially Applied"


def calculate_customer_ledger_totals(
    billed_amounts: Iterable[float | int | None],
    outstanding_amounts: Iterable[float | int | None],
    payment_amounts: Iterable[float | int | None],
    credit_note_amounts: Iterable[float | int | None],
) -> dict[str, float]:
    total_billed = round(sum(clamp_money(value) for value in billed_amounts), 2)
    total_paid = round(sum(clamp_money(value) for value in payment_amounts), 2)
    total_credit_notes = round(sum(clamp_money(value) for value in credit_note_amounts), 2)
    total_outstanding = round(sum(clamp_money(value) for value in outstanding_amounts), 2)
    return {
        "total_billed": total_billed,
        "total_paid": total_paid,
        "total_credit_notes": total_credit_notes,
        "outstanding_balance": total_outstanding,
        "total_credit": total_billed,
    }


def calculate_supplier_ledger_totals(
    purchase_amounts: Iterable[float | int | None],
    payment_amounts: Iterable[float | int | None],
    accepted_return_amounts: Iterable[float | int | None],
) -> dict[str, float]:
    total_purchases = round(sum(clamp_money(value) for value in purchase_amounts), 2)
    total_paid = round(sum(clamp_money(value) for value in payment_amounts), 2)
    total_returns = round(sum(clamp_money(value) for value in accepted_return_amounts), 2)
    outstanding = max(0.0, round(total_purchases - total_paid - total_returns, 2))
    return {
        "total_purchases": total_purchases,
        "total_paid": total_paid,
        "total_returns": total_returns,
        "outstanding_balance": outstanding,
    }


def calculate_daily_ledger_totals(
    sales_by_mode: dict[str, float],
    collections: float,
    outstanding: float,
    sales_return_value: float,
    supplier_return_credit: float,
    purchase_payments: float = 0.0,
) -> dict[str, float]:
    return {
        "cash_sales": clamp_money(sales_by_mode.get("Cash")),
        "upi_sales": clamp_money(sales_by_mode.get("UPI")),
        "card_sales": clamp_money(sales_by_mode.get("Card")),
        "credit_sales": clamp_money(sales_by_mode.get("Credit")),
        "purchase_payments": clamp_money(purchase_payments),
        "sales_returns": clamp_money(sales_return_value),
        "stock_return_credit": clamp_money(supplier_return_credit),
        "total_collection": clamp_money(collections),
        "total_outstanding": clamp_money(outstanding),
    }


def compute_sales_return_financials(
    total_return_amount: float | int | None,
    current_outstanding_amount: float | int | None,
    settlement_type: str,
) -> dict[str, float | bool]:
    total_amount = clamp_money(total_return_amount)
    outstanding = clamp_money(current_outstanding_amount)
    applied_outstanding = min(total_amount, outstanding)
    remaining = round(max(total_amount - applied_outstanding, 0.0), 2)

    if settlement_type == "Refund":
        return {
            "total_amount": total_amount,
            "applied_outstanding_amount": applied_outstanding,
            "refund_amount": remaining,
            "credit_note_amount": 0.0,
            "create_credit_note": False,
        }

    return {
        "total_amount": total_amount,
        "applied_outstanding_amount": applied_outstanding,
        "refund_amount": 0.0,
        "credit_note_amount": total_amount,
        "create_credit_note": True,
    }


def build_return_allocation_plan(
    sold_allocations: Iterable[tuple[int, int]],
    previously_returned_allocations: Iterable[tuple[int, int]],
    requested_quantity: int,
) -> list[tuple[int, int]]:
    if requested_quantity <= 0:
        raise HTTPException(status_code=400, detail="Return quantity must be greater than zero.")

    returned_map: dict[int, int] = {}
    for batch_id, quantity in previously_returned_allocations:
        returned_map[batch_id] = returned_map.get(batch_id, 0) + int(quantity or 0)

    remaining = requested_quantity
    plan: list[tuple[int, int]] = []
    for batch_id, sold_quantity in sold_allocations:
        sold_qty = int(sold_quantity or 0)
        already_returned = returned_map.get(batch_id, 0)
        eligible_quantity = max(sold_qty - already_returned, 0)
        if eligible_quantity <= 0:
            continue
        take = min(eligible_quantity, remaining)
        if take > 0:
            plan.append((batch_id, take))
            remaining -= take
        if remaining == 0:
            break

    if remaining > 0:
        raise HTTPException(status_code=400, detail="Returned quantity exceeds the remaining sold quantity.")

    return plan


def apply_sellable_stock_return(
    available_quantity: int,
    current_stock: int,
    quantity: int,
) -> tuple[int, int]:
    qty = int(quantity or 0)
    return int(available_quantity or 0) + qty, int(current_stock or 0) + qty


def apply_non_sellable_stock_move(
    available_quantity: int,
    non_sellable_quantity: int,
    current_stock: int,
    product_non_sellable_stock: int,
    quantity: int,
) -> tuple[int, int, int, int]:
    qty = abs(int(quantity or 0))
    available = int(available_quantity or 0)
    non_sellable = int(non_sellable_quantity or 0)
    stock = int(current_stock or 0)
    product_non_sellable = int(product_non_sellable_stock or 0)

    if qty > available:
        raise HTTPException(status_code=400, detail=f"Only {available} sellable unit(s) are available in this batch.")

    return (
        available - qty,
        non_sellable + qty,
        stock - qty,
        product_non_sellable + qty,
    )


def apply_non_sellable_customer_return(
    non_sellable_quantity: int,
    product_non_sellable_stock: int,
    quantity: int,
) -> tuple[int, int]:
    qty = abs(int(quantity or 0))
    return int(non_sellable_quantity or 0) + qty, int(product_non_sellable_stock or 0) + qty


def apply_supplier_stock_return(
    available_quantity: int,
    non_sellable_quantity: int,
    current_stock: int,
    product_non_sellable_stock: int,
    quantity: int,
    source: str,
) -> tuple[int, int, int, int]:
    qty = abs(int(quantity or 0))
    available = int(available_quantity or 0)
    non_sellable = int(non_sellable_quantity or 0)
    stock = int(current_stock or 0)
    product_non_sellable = int(product_non_sellable_stock or 0)

    if source == "NON_SELLABLE":
        if qty > non_sellable:
            raise HTTPException(status_code=400, detail=f"Only {non_sellable} non-sellable unit(s) are available in this batch.")
        return available, non_sellable - qty, stock, product_non_sellable - qty

    if qty > available:
        raise HTTPException(status_code=400, detail=f"Only {available} sellable unit(s) are available in this batch.")
    return available - qty, non_sellable, stock - qty, product_non_sellable


async def ensure_customer_ledger(db: AsyncSession, customer_id: int) -> models.CustomerLedger:
    result = await db.execute(
        select(models.CustomerLedger).where(models.CustomerLedger.customer_id == customer_id)
    )
    ledger = result.scalar_one_or_none()
    if ledger:
        return ledger

    ledger = models.CustomerLedger(customer_id=customer_id)
    db.add(ledger)
    await db.flush()
    return ledger


async def ensure_supplier_ledger(db: AsyncSession, supplier_id: int) -> models.SupplierLedger:
    result = await db.execute(
        select(models.SupplierLedger).where(models.SupplierLedger.supplier_id == supplier_id)
    )
    ledger = result.scalar_one_or_none()
    if ledger:
        return ledger

    ledger = models.SupplierLedger(supplier_id=supplier_id)
    db.add(ledger)
    await db.flush()
    return ledger


async def sync_customer_ledger(db: AsyncSession, customer_id: int | None) -> models.CustomerLedger | None:
    if not customer_id:
        return None

    await db.flush()
    ledger = await ensure_customer_ledger(db, customer_id)

    billed_result = await db.execute(
        select(
            models.SalesBill.id,
            models.SalesBill.grand_total,
            models.SalesBill.outstanding_amount,
            models.SalesBill.paid_amount,
        ).where(
            models.SalesBill.customer_id == customer_id,
            models.SalesBill.is_deleted == False,
        )
    )
    billed_rows = billed_result.all()

    payment_result = await db.execute(
        select(
            models.PaymentTransaction.bill_id,
            models.PaymentTransaction.amount,
        ).where(models.PaymentTransaction.customer_id == customer_id)
    )
    credit_note_result = await db.execute(
        select(models.CreditNote.amount).where(
            models.CreditNote.customer_id == customer_id,
            models.CreditNote.status != "Cancelled",
        )
    )

    payment_rows = payment_result.all()
    payment_totals_by_bill: dict[int | None, float] = {}
    payment_amounts: list[float] = []
    for bill_id, amount in payment_rows:
        numeric_amount = clamp_money(amount)
        payment_amounts.append(numeric_amount)
        payment_totals_by_bill[bill_id] = round(payment_totals_by_bill.get(bill_id, 0.0) + numeric_amount, 2)

    legacy_paid_amounts: list[float] = []
    for bill_id, _grand_total, _outstanding_amount, paid_amount in billed_rows:
        legacy_paid = round(max(clamp_money(paid_amount) - payment_totals_by_bill.get(bill_id, 0.0), 0.0), 2)
        if legacy_paid > 0:
            legacy_paid_amounts.append(legacy_paid)

    totals = calculate_customer_ledger_totals(
        billed_amounts=[row[1] for row in billed_rows],
        outstanding_amounts=[row[2] for row in billed_rows],
        payment_amounts=[*payment_amounts, *legacy_paid_amounts],
        credit_note_amounts=credit_note_result.scalars().all(),
    )

    ledger.total_credit = totals["total_credit"]
    ledger.total_billed = totals["total_billed"]
    ledger.total_paid = totals["total_paid"]
    ledger.total_credit_notes = totals["total_credit_notes"]
    ledger.outstanding_balance = totals["outstanding_balance"]
    return ledger


async def sync_supplier_ledger(db: AsyncSession, supplier_id: int | None) -> models.SupplierLedger | None:
    if not supplier_id:
        return None

    await db.flush()
    ledger = await ensure_supplier_ledger(db, supplier_id)

    purchase_result = await db.execute(
        select(models.PurchaseInvoice.total_amount).where(
            models.PurchaseInvoice.supplier_id == supplier_id,
            models.PurchaseInvoice.is_deleted == False,
        )
    )
    payment_result = await db.execute(
        select(models.SupplierPaymentTransaction.amount).where(
            models.SupplierPaymentTransaction.supplier_id == supplier_id
        )
    )
    return_result = await db.execute(
        select(models.SupplierStockReturn.credit_amount).where(
            models.SupplierStockReturn.supplier_id == supplier_id,
            models.SupplierStockReturn.status == "Accepted",
        )
    )

    totals = calculate_supplier_ledger_totals(
        purchase_amounts=purchase_result.scalars().all(),
        payment_amounts=payment_result.scalars().all(),
        accepted_return_amounts=return_result.scalars().all(),
    )

    ledger.total_purchases = totals["total_purchases"]
    ledger.total_paid = totals["total_paid"]
    ledger.total_returns = totals["total_returns"]
    ledger.outstanding_balance = totals["outstanding_balance"]
    return ledger


async def create_sale_payment_transaction(
    db: AsyncSession,
    bill: models.SalesBill,
    *,
    amount: float,
    payment_mode: str | None,
    payment_date: datetime | None = None,
    notes: str | None = None,
    reference_number: str | None = None,
    is_initial_payment: bool = False,
) -> models.PaymentTransaction | None:
    applied_amount = clamp_money(amount)
    if applied_amount <= 0:
        return None

    db_payment = models.PaymentTransaction(
        bill_id=bill.id,
        customer_id=bill.customer_id,
        amount=applied_amount,
        payment_mode=normalize_payment_mode(payment_mode) or "Cash",
        payment_date=payment_date or bill.bill_date or datetime.utcnow(),
        notes=notes,
        reference_number=reference_number,
        is_initial_payment=is_initial_payment,
    )
    db.add(db_payment)
    await db.flush()
    return db_payment


async def delete_initial_sale_payments(db: AsyncSession, bill: models.SalesBill) -> None:
    for payment in list(bill.payment_transactions or []):
        if payment.is_initial_payment:
            await db.delete(payment)
    await db.flush()


async def apply_credit_note_to_bill(
    bill: models.SalesBill | None,
    credit_amount: float | int | None,
) -> float:
    if not bill:
        return 0.0

    available_credit = clamp_money(credit_amount)
    if available_credit <= 0:
        return 0.0

    applied_amount = min(clamp_money(bill.outstanding_amount), available_credit)
    if applied_amount <= 0:
        return 0.0

    bill.outstanding_amount = round(max(0.0, clamp_money(bill.outstanding_amount) - applied_amount), 2)
    if bill.outstanding_amount == 0:
        bill.payment_status = "Paid"
    elif clamp_money(bill.paid_amount) > 0:
        bill.payment_status = "Partial"
    else:
        bill.payment_status = "Pending"
    return applied_amount


async def get_sales_bill_or_404(db: AsyncSession, bill_id: int) -> models.SalesBill:
    result = await db.execute(
        select(models.SalesBill).where(models.SalesBill.id == bill_id, models.SalesBill.is_deleted == False)
    )
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


async def get_customer_or_404(db: AsyncSession, customer_id: int) -> models.Customer:
    result = await db.execute(
        select(models.Customer).where(models.Customer.id == customer_id, models.Customer.is_deleted == False)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


async def get_supplier_or_404(db: AsyncSession, supplier_id: int) -> models.Supplier:
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id, models.Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


async def next_document_number(
    db: AsyncSession,
    model: type[models.CreditNote] | type[models.SalesReturn] | type[models.SupplierStockReturn],
    prefix: str,
    instance_id: int,
) -> str:
    # Keep numbering simple and deterministic without introducing another sequence table.
    return f"{prefix}-{instance_id:05d}"


async def sum_bill_returned_quantity(db: AsyncSession, sale_item_id: int) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(models.SalesReturnItem.quantity), 0)).where(
            models.SalesReturnItem.sale_item_id == sale_item_id
        )
    )
    return int(result.scalar_one() or 0)
