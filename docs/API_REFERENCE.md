# API Reference

Base URL: the backend origin (`http://127.0.0.1:8000` locally). FastAPI also serves interactive docs at **`/docs`** (Swagger UI) and **`/redoc`**, generated from the same code. Treat those as the source of truth for exact field types.

**Auth:** every `/api/v1/*` endpoint needs `Authorization: Bearer <token>`. A missing or invalid token returns `401`.
**Tracing:** send `X-Request-ID` to set the request ID yourself. It is echoed in the response header and included in 500/503 error bodies.
**Errors:** `{"detail": "..."}` with 400 (validation/business rule), 404, 409 (duplicate), 422 (schema validation), 500, or 503 (database).

## Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/` | no | `{"status":"ok","api_version":"v1","message":"StockPro API running"}` |
| GET | `/health/db` | no | `{"status":"ok","database":"<masked url>"}`, or 503 |

## Auth — `/auth`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | form-urlencoded `username`, `password` | → `{access_token, token_type:"bearer", must_change_password}`. Token valid for 7 days. |
| POST | `/auth/change-password` | `{old_password, new_password}` | Auth required. Clears `must_change_password`. 400 if the old password is wrong. |
| GET | `/auth/me` | — | → `{id, username, role, must_change_password, created_at}` |
| POST | `/auth/logout` | — | No-op; the client discards the token. |

## Products — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/products` | Query: `skip` (0), `limit` (200), `include_archived` (false), `search` (matches name/brand/category), `brand`, `category`, `stock_status` (`in_stock` / `low_stock` / `out_of_stock`), `gst_rate`, `sort_by` (`name_asc`, `name_desc`, `stock_asc`, `stock_desc`, `price_asc`, `price_desc`, `recently_added`, `recently_updated`). Low stock = `0 < stock ≤ min_stock_level`, or `≤ 5` when no minimum is set. `price_*` sorts by `tax_rate`. |
| POST | `/products` | `{brand_name?, product_name, packing_type="Unit", units_per_pack=1, current_stock=0}` |
| GET | `/products/{id}` | |
| PUT | `/products/{id}` | Same body as POST. Replaces **all** fields, including `current_stock`. |
| DELETE | `/products/{id}` | Always 400: products cannot be deleted, only archived. |
| POST | `/products/{id}/archive` | 400 if `current_stock > 0`. |
| POST | `/products/{id}/unarchive` | |
| POST | `/products/bulk-unarchive` | `{product_ids: [int]}` → `{detail, count}`. 400 if none were archived. |

`ProductResponse`: `id, brand_name, product_name, packing_type, units_per_pack, current_stock, non_sellable_stock, is_archived`.

## Barcodes — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/barcodes` | All barcodes. |
| POST | `/barcodes` | `{barcode, product_id}` |
| GET | `/barcodes/{barcode}` | → `{barcode, product_id}`, or 404 |

## Stock — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/stock-batches` | All batches. |
| GET | `/stock-batches/product/{product_id}` | Batches with `available_quantity > 0`, oldest first. |
| GET | `/stock-ledger` | Optional `?product_id=`. No pagination or ordering. |
| GET | `/stock-adjustments` | Newest first. |
| POST | `/stock-adjustments` | `{product_id, stock_batch_id, adjustment_type, quantity, reason?, final_action?="Adjusted"}`. See below. |

Stock adjustment behavior:
- `adjustment_type` in `DAMAGE`, `EXPIRY`, `BROKEN`, `LEAKED`, `NON_SELLABLE`: moves `|quantity|` units from batch/product sellable to non-sellable (400 if the batch has too few). Ledger type `NON_SELLABLE_ADJUSTMENT`, recorded quantity negative.
- Any other type (`CORRECTION`, `RETURN`, …): adds the signed `quantity` to the batch and product sellable stock (400 if the batch would go below 0). Ledger type `ADJUSTMENT`.

## Suppliers and customers — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/suppliers` | `skip`, `limit` (200). Non-deleted only. |
| POST | `/suppliers` | `{company_name, gst_number, address?, phone?, email?}`. Also creates an empty supplier ledger. |
| GET / PUT / DELETE | `/suppliers/{id}` | DELETE is a soft delete. |
| GET | `/suppliers/ledger-overview` | `search` (name/phone/GSTIN), `skip`, `limit` (50) → `{items:[{supplier_id, company_name, phone, gst_number, total_purchases, total_paid, total_returns, outstanding_balance}], total_outstanding_payable, total_suppliers}` |
| GET | `/suppliers/{id}/ledger` | `history_limit` (50). Re-syncs, then returns totals + `invoices`, `payments`, `stock_returns`. |
| GET | `/customers` | `skip`, `limit` (200). |
| POST | `/customers` | `{name, phone?, gst_number?, address?}`. Also creates an empty customer ledger. |
| GET / PUT / DELETE | `/customers/{id}` | DELETE is a soft delete. |
| GET | `/customers/ledger-overview` | Same shape as suppliers, with `customer_name`, `total_credit`, `total_billed`, `total_paid`, `total_credit_notes`, `outstanding_balance`, `total_outstanding_receivable`, `total_customers`. |
| GET | `/customers/{id}/ledger` | `history_limit` (50). Re-syncs, then returns totals + `bills`, `payments`, `credit_notes`, `sales_returns`. |

## Purchases — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/purchase-invoices` | `skip`, `limit` (100). Includes `total_quantity`. No explicit ordering. |
| POST | `/purchase-invoices` | See below. |
| GET | `/purchase-invoices/{id}` | Includes `purchase_items` with nested `product`. |

`POST /purchase-invoices`

```json
{
  "supplier_id": 3,
  "invoice_number": "KTI/26-27/052",
  "invoice_date": "2026-05-03",
  "total_amount": 11800.0,
  "items": [
    { "product_id": 12, "quantity": 100, "unit_price": 100.0, "gst_percent": 18, "line_total": 11800.0 }
  ]
}
```

- Optional header `X-Idempotency-Key`. Repeating a key returns the original invoice (200).
- 400 if `invoice_number` is blank. 404 if the supplier or a product is missing. **409** if the supplier already has this invoice number.
- Side effects per item: a `purchase_items` row, a new `stock_batches` row, `products.current_stock += quantity`, and a `PURCHASE` stock-ledger row. The supplier ledger is then re-synced.

## Sales — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/sales` | `skip`, `limit` (100). Newest first. Includes `customer` and `total_quantity`. |
| POST | `/sales` | Create a bill. See below. |
| GET | `/sales/{id}` | Detail: `sales_items` (with `product`, `batch_allocations`), `customer`, `payment_transactions`. |
| PUT | `/sales/{id}` | Replace a bill (same body as POST). Creates a new revision. 400 if the bill has follow-up payments or the date moves to another financial year. |
| GET | `/sales/{id}/payments` | Oldest first. |
| POST | `/sales/{id}/payments` | Same as `POST /payments`; `bill_id` in the body must match the path. |

`POST /sales`

```json
{
  "customer_id": 7,
  "bill_date": "2026-05-10",
  "subtotal": 1000.0,
  "discount_amount": 0,
  "taxable_amount": 950.0,
  "cgst_amount": 23.75,
  "sgst_amount": 23.75,
  "grand_total": 998,
  "paid_amount": 500,
  "payment_mode": "Cash",
  "payment_note": null,
  "payment_reference": null,
  "items": [
    { "product_id": 12, "quantity": 10, "selling_price": 100, "gst_percent": 5, "discount_percent": 5, "final_amount": 997.5 }
  ]
}
```

- `customer_id` null = walk-in. `bill_date` defaults to today (UTC).
- The client-supplied `bill_number`, `outstanding_amount`, and `payment_status` are ignored and recalculated. `paid_amount` is capped at `grand_total`.
- 400 `Insufficient stock for <name>. Available: N` if FIFO batches cannot cover a line. 404 if the customer or a product is missing.
- Side effects: bill number assigned, FIFO batch allocation, `products.current_stock` decreased, `SALE` ledger rows, an initial payment transaction (if paid > 0), customer ledger re-sync, and an HTML snapshot written.

## Payments — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/payments` | All customer payments, newest first. |
| POST | `/payments` | `{bill_id, customer_id?, amount, payment_mode, payment_date?, notes?, reference_number?}`. 400 if `amount ≤ 0`, it exceeds the outstanding balance, or the customer does not match the bill. Updates the bill's paid/outstanding/status and re-syncs the customer ledger. |
| GET | `/supplier-payments` | Newest first. |
| POST | `/supplier-payments` | `{supplier_id, amount, payment_mode, payment_date?, notes?, reference_number?}`. 400 if `amount ≤ 0`. No upper limit is checked against payable. |

`payment_mode` is case-insensitive and must be one of `Cash`, `UPI`, `Card`, `Credit`.

## Accounting — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/daily-ledger?ledger_date=YYYY-MM-DD` | → `{ledger_date, cash_sales, upi_sales, card_sales, credit_sales, purchase_payments, sales_returns, stock_return_credit, total_collection, total_outstanding, cash_refunds, upi_refunds, card_refunds, total_refunds}`. `sales_returns` is the value of goods returned; `*_refunds` is money paid out, by refund mode. |
| GET | `/accounting/summary` | → `{total_customer_receivable, total_supplier_payable, net_position}` from the cached ledger tables. |

## Credit notes — `/api/v1` (customer-side)

| Method | Path | Notes |
|---|---|---|
| GET | `/credit-notes` | Newest first. |
| GET | `/credit-notes/{id}` | |
| POST | `/credit-notes` | `{bill_id?, customer_id?, sales_return_id?, amount, reason, credit_date?}`. Needs a bill or a customer. Applied to the bill's outstanding balance right away; `status` reflects how much was applied. |

## Sales returns — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/sales-returns` | Newest first, with `items`. |
| GET | `/sales-returns/{id}` | |
| POST | `/sales-returns` | See below. |

```json
{
  "bill_id": 41,
  "customer_id": 7,
  "return_date": "2026-05-12",
  "reason": "Wrong size",
  "settlement_type": "Refund",
  "refund_mode": "UPI",
  "notes": null,
  "items": [
    { "sale_item_id": 88, "product_id": 12, "quantity": 2, "amount": 199.5, "stock_action": "SELLABLE", "reason": "Wrong size" }
  ]
}
```

- `settlement_type` must normalize to **`Refund`**, **`Credit Note`**, **`Adjust Outstanding`**, or **`No Refund`** (case- and space-insensitive). Anything else returns 400.
  - `Refund`: the value first clears the bill's outstanding; the rest is `refund_amount`. `refund_mode` must be `Cash`, `UPI`, or `Card` (default `Cash`; anything else returns 400).
  - `Credit Note` / `Adjust Outstanding`: a credit note for the full value is created and applied to the bill's outstanding; any excess stays open.
  - `No Refund`: stock is restored only. No refund, no credit note, outstanding unchanged.
  - `refund_mode` is ignored (stored as null) for non-refund settlements.
- `stock_action`: `SELLABLE` (back to available stock), `DAMAGED` or `NON_SELLABLE` (into non-sellable stock).
- 400 when: items are empty, a line does not belong to the bill, the quantity exceeds what was sold minus earlier returns, the amount exceeds the original per-unit value × quantity, or the customer does not match.
- Side effects: return rows and batch allocations, stock updates and stock-ledger rows, the bill's outstanding reduced (except `No Refund`), a credit note for `Credit Note` / `Adjust Outstanding`, and a customer ledger re-sync.

## Supplier stock returns — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/stock-returns` | Newest first, with `items`. |
| GET | `/stock-returns/{id}` | |
| POST | `/stock-returns` | `{supplier_id, return_date?, reason, status="Pending", credit_amount=0, notes?, items:[{product_id, stock_batch_id?, quantity, amount=0, stock_source="SELLABLE", reason}]}`. If `stock_batch_id` is omitted, the product's oldest batch is used. Stock is deducted right away from the chosen bucket (400 if there is not enough). |
| PUT | `/stock-returns/{id}` | `{status, credit_amount=0, notes?}`. Changing **to** `Rejected` puts the stock back. Changing **from** `Rejected` to anything else deducts it again. Re-syncs the supplier ledger (only `Accepted` credit counts). |

## Reports and settings — `/api/v1`

| Method | Path | Notes |
|---|---|---|
| GET | `/reports/summary` | `{products, customers, sales, purchases, total_revenue}`. Counts of non-deleted rows; revenue = Σ `grand_total`. |
| GET | `/settings/business` | The singleton settings row (created with defaults if missing). |
| PUT | `/settings/business` | Full replacement of all settings fields. Fields left out are reset to schema defaults. |
