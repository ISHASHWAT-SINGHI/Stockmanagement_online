"""routers/accounting.py - Daily ledger, returns, credit notes, and ledger workflows."""
from __future__ import annotations

from datetime import date, datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from accounting import (
    CREDIT_NOTE_STATUSES,
    DAMAGE_ADJUSTMENT_TYPES,
    RETURN_STOCK_ACTIONS,
    SUPPLIER_RETURN_SOURCES,
    SUPPLIER_RETURN_STATUSES,
    apply_credit_note_to_bill,
    apply_non_sellable_customer_return,
    apply_non_sellable_stock_move,
    apply_supplier_stock_return,
    apply_sellable_stock_return,
    build_return_allocation_plan,
    calculate_daily_ledger_totals,
    compute_sales_return_financials,
    clamp_money,
    combine_date_at_start,
    ensure_supplier_ledger,
    get_customer_or_404,
    get_sales_bill_or_404,
    get_supplier_or_404,
    next_document_number,
    normalize_payment_mode,
    resolve_credit_note_status,
    sync_customer_ledger,
    sync_supplier_ledger,
)
import models
import schemas
from database import get_db
from security import get_current_user

router = APIRouter(prefix="/api/v1", tags=["accounting"], dependencies=[Depends(get_current_user)])


def normalize_settlement_type(value: str | None) -> str:
    normalized = " ".join((value or "").strip().split()).title()
    if normalized in {"Creditnote", "Credit Note"}:
        return "Credit Note"
    if normalized in {"Adjustoutstanding", "Adjust Outstanding"}:
        return "Adjust Outstanding"
    if normalized in {"Refund"}:
        return "Refund"
    raise HTTPException(status_code=400, detail="Settlement type must be Refund, Credit Note, or Adjust Outstanding.")


async def load_sales_return(db: AsyncSession, return_id: int) -> models.SalesReturn | None:
    result = await db.execute(
        select(models.SalesReturn)
        .options(selectinload(models.SalesReturn.items))
        .where(models.SalesReturn.id == return_id)
    )
    return result.scalar_one_or_none()


async def load_supplier_stock_return(db: AsyncSession, stock_return_id: int) -> models.SupplierStockReturn | None:
    result = await db.execute(
        select(models.SupplierStockReturn)
        .options(selectinload(models.SupplierStockReturn.items))
        .where(models.SupplierStockReturn.id == stock_return_id)
    )
    return result.scalar_one_or_none()


async def load_credit_note(db: AsyncSession, credit_note_id: int) -> models.CreditNote | None:
    result = await db.execute(
        select(models.CreditNote).where(models.CreditNote.id == credit_note_id)
    )
    return result.scalar_one_or_none()


async def load_bill_for_return(db: AsyncSession, bill_id: int) -> models.SalesBill:
    result = await db.execute(
        select(models.SalesBill)
        .options(
            selectinload(models.SalesBill.customer),
            selectinload(models.SalesBill.sales_items)
            .selectinload(models.SaleItem.product),
            selectinload(models.SalesBill.sales_items)
            .selectinload(models.SaleItem.batch_allocations)
            .selectinload(models.SaleItemBatchAllocation.stock_batch),
        )
        .where(models.SalesBill.id == bill_id, models.SalesBill.is_deleted == False)
    )
    bill = result.scalar_one_or_none()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


def get_sale_item_display_name(item: models.SaleItem) -> str:
    if item.product_name_snapshot:
        return item.product_name_snapshot
    if item.product:
        return " ".join(part for part in [item.product.brand_name, item.product.product_name] if part).strip() or f"Product #{item.product_id}"
    return f"Product #{item.product_id}"


async def create_credit_note_record(
    db: AsyncSession,
    *,
    bill: models.SalesBill | None,
    customer_id: int | None,
    sales_return_id: int | None,
    amount: float,
    reason: str,
    credit_date: date | None,
) -> models.CreditNote:
    if not customer_id and not bill:
        raise HTTPException(status_code=400, detail="Credit note requires a customer or a linked bill.")

    effective_customer_id = customer_id or (bill.customer_id if bill else None)
    if effective_customer_id:
        await get_customer_or_404(db, effective_customer_id)

    db_note = models.CreditNote(
        bill_id=bill.id if bill else None,
        customer_id=effective_customer_id,
        sales_return_id=sales_return_id,
        amount=clamp_money(amount),
        reason=reason.strip(),
        credit_date=combine_date_at_start(credit_date),
        status="Open",
    )
    db.add(db_note)
    await db.flush()
    db_note.note_number = await next_document_number(db, models.CreditNote, "CN", db_note.id)
    db_note.applied_amount = await apply_credit_note_to_bill(bill, db_note.amount)
    db_note.status = resolve_credit_note_status(db_note.amount, db_note.applied_amount)
    return db_note


@router.get("/daily-ledger", response_model=schemas.DailyLedgerResponse)
async def get_daily_ledger(ledger_date: date, db: AsyncSession = Depends(get_db)):
    sales_result = await db.execute(
        select(
            models.SalesBill.id,
            models.SalesBill.grand_total,
            models.SalesBill.paid_amount,
            models.SalesBill.outstanding_amount,
            models.SalesBill.payment_mode,
        ).where(func.date(models.SalesBill.bill_date) == ledger_date, models.SalesBill.is_deleted == False)
    )
    sales_rows = sales_result.all()

    payment_result = await db.execute(
        select(
            models.PaymentTransaction.bill_id,
            models.PaymentTransaction.amount,
        ).where(func.date(models.PaymentTransaction.payment_date) == ledger_date)
    )
    payment_rows = payment_result.all()

    payment_totals_by_bill: dict[int | None, float] = {}
    transaction_collection_total = 0.0
    for bill_id, amount in payment_rows:
        numeric_amount = clamp_money(amount)
        transaction_collection_total += numeric_amount
        payment_totals_by_bill[bill_id] = round(payment_totals_by_bill.get(bill_id, 0.0) + numeric_amount, 2)

    legacy_collection_total = 0.0
    sales_by_mode = {"Cash": 0.0, "UPI": 0.0, "Card": 0.0, "Credit": 0.0}
    outstanding_total = 0.0
    for bill_id, grand_total, paid_amount, outstanding_amount, payment_mode in sales_rows:
        normalized_mode = payment_mode if payment_mode in sales_by_mode else ("Credit" if clamp_money(paid_amount) == 0 else "Cash")
        sales_by_mode[normalized_mode] += clamp_money(grand_total)
        outstanding_total += clamp_money(outstanding_amount)
        legacy_collection_total += max(
            clamp_money(paid_amount) - payment_totals_by_bill.get(bill_id, 0.0),
            0.0,
        )

    purchase_payment_result = await db.execute(
        select(func.coalesce(func.sum(models.SupplierPaymentTransaction.amount), 0)).where(
            func.date(models.SupplierPaymentTransaction.payment_date) == ledger_date
        )
    )
    sales_return_result = await db.execute(
        select(func.coalesce(func.sum(models.SalesReturn.total_amount), 0)).where(
            func.date(models.SalesReturn.return_date) == ledger_date
        )
    )
    stock_return_credit_result = await db.execute(
        select(func.coalesce(func.sum(models.SupplierStockReturn.credit_amount), 0)).where(
            func.date(models.SupplierStockReturn.return_date) == ledger_date,
            models.SupplierStockReturn.status == "Accepted",
        )
    )

    totals = calculate_daily_ledger_totals(
        sales_by_mode=sales_by_mode,
        collections=transaction_collection_total + legacy_collection_total,
        outstanding=outstanding_total,
        sales_return_value=sales_return_result.scalar_one(),
        supplier_return_credit=stock_return_credit_result.scalar_one(),
        purchase_payments=purchase_payment_result.scalar_one(),
    )
    return {"ledger_date": ledger_date, **totals}


@router.get("/accounting/summary", response_model=schemas.AccountingSummaryResponse)
async def get_accounting_summary(db: AsyncSession = Depends(get_db)):
    customer_result = await db.execute(
        select(func.coalesce(func.sum(models.CustomerLedger.outstanding_balance), 0))
    )
    supplier_result = await db.execute(
        select(func.coalesce(func.sum(models.SupplierLedger.outstanding_balance), 0))
    )
    total_customer_receivable = float(customer_result.scalar_one() or 0)
    total_supplier_payable = float(supplier_result.scalar_one() or 0)
    return {
        "total_customer_receivable": total_customer_receivable,
        "total_supplier_payable": total_supplier_payable,
        "net_position": total_customer_receivable - total_supplier_payable,
    }


@router.get("/credit-notes", response_model=List[schemas.CreditNoteResponse])
async def get_credit_notes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.CreditNote).order_by(models.CreditNote.credit_date.desc(), models.CreditNote.id.desc())
    )
    return result.scalars().all()


@router.get("/credit-notes/{credit_note_id}", response_model=schemas.CreditNoteResponse)
async def get_credit_note(credit_note_id: int, db: AsyncSession = Depends(get_db)):
    credit_note = await load_credit_note(db, credit_note_id)
    if not credit_note:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return credit_note


@router.post("/credit-notes", response_model=schemas.CreditNoteResponse)
async def create_credit_note(payload: schemas.CreditNoteCreate, db: AsyncSession = Depends(get_db)):
    bill = None
    if payload.bill_id:
        bill = await get_sales_bill_or_404(db, payload.bill_id)

    try:
        credit_note = await create_credit_note_record(
            db,
            bill=bill,
            customer_id=payload.customer_id,
            sales_return_id=payload.sales_return_id,
            amount=payload.amount,
            reason=payload.reason,
            credit_date=payload.credit_date,
        )
        await sync_customer_ledger(db, credit_note.customer_id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    await db.refresh(credit_note)
    return credit_note


@router.get("/sales-returns", response_model=List[schemas.SalesReturnResponse])
async def get_sales_returns(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SalesReturn)
        .options(selectinload(models.SalesReturn.items))
        .order_by(models.SalesReturn.return_date.desc(), models.SalesReturn.id.desc())
    )
    return result.scalars().all()


@router.get("/sales-returns/{sales_return_id}", response_model=schemas.SalesReturnResponse)
async def get_sales_return(sales_return_id: int, db: AsyncSession = Depends(get_db)):
    sales_return = await load_sales_return(db, sales_return_id)
    if not sales_return:
        raise HTTPException(status_code=404, detail="Sales return not found")
    return sales_return


@router.post("/sales-returns", response_model=schemas.SalesReturnResponse)
async def create_sales_return(
    payload: schemas.SalesReturnCreate,
    db: AsyncSession = Depends(get_db),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one return item.")

    bill = await load_bill_for_return(db, payload.bill_id)
    if payload.customer_id and bill.customer_id and payload.customer_id != bill.customer_id:
        raise HTTPException(status_code=400, detail="Return customer does not match the original bill customer.")

    effective_customer_id = bill.customer_id or payload.customer_id
    if effective_customer_id:
        await get_customer_or_404(db, effective_customer_id)

    sale_items_by_id = {item.id: item for item in bill.sales_items}
    requested_quantity_by_sale_item: dict[int, int] = {}
    total_return_amount = 0.0

    try:
        db_return = models.SalesReturn(
            bill_id=bill.id,
            customer_id=effective_customer_id,
            return_date=combine_date_at_start(payload.return_date),
            reason=payload.reason.strip(),
            settlement_type=normalize_settlement_type(payload.settlement_type),
            notes=payload.notes,
            status="Completed",
        )
        db.add(db_return)
        await db.flush()
        db_return.return_number = await next_document_number(db, models.SalesReturn, "SR", db_return.id)

        for item in payload.items:
            sale_item = sale_items_by_id.get(item.sale_item_id)
            if not sale_item or sale_item.product_id != item.product_id:
                raise HTTPException(status_code=400, detail="Return item does not match the original bill lines.")

            stock_action = item.stock_action.strip().upper()
            if stock_action not in RETURN_STOCK_ACTIONS:
                raise HTTPException(status_code=400, detail="Stock action must be SELLABLE, DAMAGED, or NON_SELLABLE.")

            requested_quantity = int(item.quantity or 0)
            if requested_quantity <= 0:
                raise HTTPException(status_code=400, detail="Return quantity must be greater than zero.")

            requested_quantity_by_sale_item[item.sale_item_id] = requested_quantity_by_sale_item.get(item.sale_item_id, 0) + requested_quantity
            if requested_quantity_by_sale_item[item.sale_item_id] > int(sale_item.quantity or 0):
                raise HTTPException(status_code=400, detail="Return quantity exceeds the original sold quantity.")

            sold_allocations = [
                (allocation.stock_batch_id, allocation.quantity)
                for allocation in (sale_item.batch_allocations or [])
            ]
            if not sold_allocations and sale_item.stock_batch_id:
                sold_allocations = [(sale_item.stock_batch_id, sale_item.quantity)]

            previous_allocations_result = await db.execute(
                select(
                    models.SalesReturnBatchAllocation.stock_batch_id,
                    func.coalesce(func.sum(models.SalesReturnBatchAllocation.quantity), 0),
                )
                .join(models.SalesReturnItem, models.SalesReturnItem.id == models.SalesReturnBatchAllocation.sales_return_item_id)
                .where(models.SalesReturnItem.sale_item_id == sale_item.id)
                .group_by(models.SalesReturnBatchAllocation.stock_batch_id)
            )
            return_plan = build_return_allocation_plan(
                sold_allocations=sold_allocations,
                previously_returned_allocations=previous_allocations_result.all(),
                requested_quantity=requested_quantity,
            )

            unit_amount = clamp_money(sale_item.final_amount) / max(int(sale_item.quantity or 1), 1)
            max_amount = round(unit_amount * requested_quantity, 2)
            item_amount = clamp_money(item.amount)
            if item_amount - max_amount > 0.009:
                raise HTTPException(status_code=400, detail="Return amount exceeds the original sold value for the selected quantity.")

            total_return_amount += item_amount
            db_return_item = models.SalesReturnItem(
                sales_return_id=db_return.id,
                sale_item_id=sale_item.id,
                product_id=sale_item.product_id,
                quantity=requested_quantity,
                amount=item_amount,
                stock_action=stock_action,
                reason=item.reason.strip(),
                product_name_snapshot=get_sale_item_display_name(sale_item),
            )
            db.add(db_return_item)
            await db.flush()

            batch_map = {allocation.stock_batch_id: allocation.stock_batch for allocation in (sale_item.batch_allocations or [])}
            product = sale_item.product
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {sale_item.product_id} not found for the selected sale item.")

            for batch_id, quantity in return_plan:
                batch = batch_map.get(batch_id)
                if not batch:
                    batch_result = await db.execute(select(models.StockBatch).where(models.StockBatch.id == batch_id))
                    batch = batch_result.scalar_one_or_none()
                if not batch:
                    raise HTTPException(status_code=404, detail=f"Stock batch {batch_id} not found.")

                db.add(
                    models.SalesReturnBatchAllocation(
                        sales_return_item_id=db_return_item.id,
                        stock_batch_id=batch.id,
                        quantity=quantity,
                    )
                )

                if stock_action == "SELLABLE":
                    batch.available_quantity, product.current_stock = apply_sellable_stock_return(
                        batch.available_quantity,
                        product.current_stock,
                        quantity,
                    )
                else:
                    (
                        batch.non_sellable_quantity,
                        product.non_sellable_stock,
                    ) = apply_non_sellable_customer_return(
                        batch.non_sellable_quantity,
                        quantity,
                    )

                db.add(
                    models.StockLedger(
                        product_id=product.id,
                        transaction_type="SALES_RETURN" if stock_action == "SELLABLE" else "SALES_RETURN_NON_SELLABLE",
                        quantity=quantity,
                        reference_id=db_return.id,
                        notes=f"{db_return.return_number} {stock_action.lower()} return of {quantity} unit(s) for {get_sale_item_display_name(sale_item)}",
                    )
                )

        return_financials = compute_sales_return_financials(
            total_return_amount=total_return_amount,
            current_outstanding_amount=bill.outstanding_amount,
            settlement_type=db_return.settlement_type,
        )

        db_return.total_amount = return_financials["total_amount"]
        db_return.applied_outstanding_amount = await apply_credit_note_to_bill(bill, db_return.total_amount)
        db_return.refund_amount = return_financials["refund_amount"]
        db_return.credit_note_amount = return_financials["credit_note_amount"]

        if return_financials["create_credit_note"]:
            credit_note = await create_credit_note_record(
                db,
                bill=bill,
                customer_id=effective_customer_id,
                sales_return_id=db_return.id,
                amount=db_return.total_amount,
                reason=f"{payload.reason.strip()} ({db_return.return_number})",
                credit_date=payload.return_date,
            )
            db_return.credit_note_amount = credit_note.amount

        await sync_customer_ledger(db, effective_customer_id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    created_return = await load_sales_return(db, db_return.id)
    if not created_return:
        raise HTTPException(status_code=404, detail="Sales return not found after creation.")
    return created_return


@router.get("/stock-returns", response_model=List[schemas.SupplierStockReturnResponse])
async def get_stock_returns(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SupplierStockReturn)
        .options(selectinload(models.SupplierStockReturn.items))
        .order_by(models.SupplierStockReturn.return_date.desc(), models.SupplierStockReturn.id.desc())
    )
    return result.scalars().all()


@router.get("/stock-returns/{stock_return_id}", response_model=schemas.SupplierStockReturnResponse)
async def get_stock_return(stock_return_id: int, db: AsyncSession = Depends(get_db)):
    stock_return = await load_supplier_stock_return(db, stock_return_id)
    if not stock_return:
        raise HTTPException(status_code=404, detail="Stock return not found")
    return stock_return


@router.post("/stock-returns", response_model=schemas.SupplierStockReturnResponse)
async def create_stock_return(payload: schemas.SupplierStockReturnCreate, db: AsyncSession = Depends(get_db)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Add at least one stock return item.")

    supplier = await get_supplier_or_404(db, payload.supplier_id)
    status = payload.status.strip().title()
    if status not in SUPPLIER_RETURN_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be Pending, Sent, Accepted, or Rejected.")

    try:
        db_return = models.SupplierStockReturn(
            supplier_id=supplier.id,
            return_date=combine_date_at_start(payload.return_date),
            reason=payload.reason.strip(),
            status=status,
            credit_amount=clamp_money(payload.credit_amount),
            notes=payload.notes,
        )
        db.add(db_return)
        await db.flush()
        db_return.return_number = await next_document_number(db, models.SupplierStockReturn, "STR", db_return.id)

        for item in payload.items:
            product_result = await db.execute(
                select(models.Product).where(
                    models.Product.id == item.product_id,
                    models.Product.is_deleted == False,
                )
            )
            product = product_result.scalar_one_or_none()
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found.")

            if item.stock_batch_id:
                batch_result = await db.execute(select(models.StockBatch).where(models.StockBatch.id == item.stock_batch_id))
                batch = batch_result.scalar_one_or_none()
            else:
                batch_result = await db.execute(
                    select(models.StockBatch)
                    .where(models.StockBatch.product_id == product.id)
                    .order_by(models.StockBatch.purchase_date.asc(), models.StockBatch.id.asc())
                )
                batch = batch_result.scalars().first()
            if not batch:
                raise HTTPException(status_code=404, detail=f"No stock batch found for product {product.id}.")
            if batch.product_id != product.id:
                raise HTTPException(status_code=400, detail="Selected batch does not belong to the selected product.")

            stock_source = item.stock_source.strip().upper()
            if stock_source not in SUPPLIER_RETURN_SOURCES:
                raise HTTPException(status_code=400, detail="Stock source must be SELLABLE or NON_SELLABLE.")

            (
                batch.available_quantity,
                batch.non_sellable_quantity,
                product.current_stock,
                product.non_sellable_stock,
            ) = apply_supplier_stock_return(
                batch.available_quantity,
                batch.non_sellable_quantity,
                product.current_stock,
                product.non_sellable_stock,
                item.quantity,
                stock_source,
            )

            db.add(
                models.SupplierStockReturnItem(
                    supplier_stock_return_id=db_return.id,
                    product_id=product.id,
                    stock_batch_id=batch.id,
                    quantity=int(item.quantity or 0),
                    amount=clamp_money(item.amount),
                    stock_source=stock_source,
                    reason=item.reason.strip(),
                    product_name_snapshot=" ".join(part for part in [product.brand_name, product.product_name] if part).strip() or f"Product #{product.id}",
                    batch_number_snapshot=batch.batch_number,
                )
            )
            db.add(
                models.StockLedger(
                    product_id=product.id,
                    transaction_type="SUPPLIER_RETURN",
                    quantity=-abs(int(item.quantity or 0)),
                    reference_id=db_return.id,
                    notes=f"{db_return.return_number} {stock_source.lower()} return to supplier {supplier.company_name}",
                )
            )

        await ensure_supplier_ledger(db, supplier.id)
        await sync_supplier_ledger(db, supplier.id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise

    created_return = await load_supplier_stock_return(db, db_return.id)
    if not created_return:
        raise HTTPException(status_code=404, detail="Stock return not found after creation.")
    return created_return


@router.put("/stock-returns/{stock_return_id}", response_model=schemas.SupplierStockReturnResponse)
async def update_stock_return(
    stock_return_id: int,
    payload: schemas.SupplierStockReturnUpdate,
    db: AsyncSession = Depends(get_db),
):
    stock_return = await load_supplier_stock_return(db, stock_return_id)
    if not stock_return:
        raise HTTPException(status_code=404, detail="Stock return not found")

    status = payload.status.strip().title()
    if status not in SUPPLIER_RETURN_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be Pending, Sent, Accepted, or Rejected.")

    try:
        if stock_return.status != status and (status == "Rejected" or stock_return.status == "Rejected"):
            for item in stock_return.items:
                batch_result = await db.execute(select(models.StockBatch).where(models.StockBatch.id == item.stock_batch_id))
                batch = batch_result.scalar_one_or_none()
                product_result = await db.execute(select(models.Product).where(models.Product.id == item.product_id))
                product = product_result.scalar_one_or_none()
                if not batch or not product:
                    raise HTTPException(status_code=404, detail="Unable to restore stock for the selected return item.")

                quantity = abs(int(item.quantity or 0))
                if status == "Rejected":
                    if item.stock_source == "NON_SELLABLE":
                        batch.non_sellable_quantity = int(batch.non_sellable_quantity or 0) + quantity
                        product.non_sellable_stock = int(product.non_sellable_stock or 0) + quantity
                    else:
                        batch.available_quantity = int(batch.available_quantity or 0) + quantity
                        product.current_stock = int(product.current_stock or 0) + quantity
                    db.add(
                        models.StockLedger(
                            product_id=product.id,
                            transaction_type="SUPPLIER_RETURN_REJECTED",
                            quantity=quantity,
                            reference_id=stock_return.id,
                            notes=f"{stock_return.return_number} rejected by supplier, stock restored",
                        )
                    )
                elif stock_return.status == "Rejected":
                    (
                        batch.available_quantity,
                        batch.non_sellable_quantity,
                        product.current_stock,
                        product.non_sellable_stock,
                    ) = apply_supplier_stock_return(
                        batch.available_quantity,
                        batch.non_sellable_quantity,
                        product.current_stock,
                        product.non_sellable_stock,
                        quantity,
                        item.stock_source,
                    )
                    db.add(
                        models.StockLedger(
                            product_id=product.id,
                            transaction_type="SUPPLIER_RETURN_REAPPLIED",
                            quantity=-quantity,
                            reference_id=stock_return.id,
                            notes=f"{stock_return.return_number} moved back out after rejection status change",
                        )
                    )

        stock_return.status = status
        stock_return.credit_amount = clamp_money(payload.credit_amount)
        stock_return.notes = payload.notes
        await sync_supplier_ledger(db, stock_return.supplier_id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    updated_return = await load_supplier_stock_return(db, stock_return_id)
    if not updated_return:
        raise HTTPException(status_code=404, detail="Stock return not found after update.")
    return updated_return


@router.get("/supplier-payments", response_model=List[schemas.SupplierPaymentTransactionResponse])
async def get_supplier_payments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SupplierPaymentTransaction)
        .order_by(models.SupplierPaymentTransaction.payment_date.desc(), models.SupplierPaymentTransaction.id.desc())
    )
    return result.scalars().all()


@router.post("/supplier-payments", response_model=schemas.SupplierPaymentTransactionResponse)
async def create_supplier_payment(
    payload: schemas.SupplierPaymentTransactionCreate,
    db: AsyncSession = Depends(get_db),
):
    supplier = await get_supplier_or_404(db, payload.supplier_id)
    payment_mode = normalize_payment_mode(payload.payment_mode) or "Cash"
    if clamp_money(payload.amount) <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    try:
        payment = models.SupplierPaymentTransaction(
            supplier_id=supplier.id,
            amount=clamp_money(payload.amount),
            payment_mode=payment_mode,
            payment_date=payload.payment_date or datetime.utcnow(),
            notes=payload.notes,
            reference_number=payload.reference_number,
        )
        db.add(payment)
        await sync_supplier_ledger(db, supplier.id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    await db.refresh(payment)
    return payment
