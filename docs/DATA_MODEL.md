# Data Model

All tables are defined in [backend/models.py](../backend/models.py). The schema is managed by Alembic ([backend/migrations/](../backend/migrations/)). Money columns are `Float` and are rounded to 2 decimals in code (`accounting.clamp_money`). Quantities are `Integer`, so fractional quantities are not supported.

Conventions:

- **Timestamp** = has `created_at` and `updated_at` (`TimestampMixin`). Times are naive UTC (`datetime.utcnow`).
- **Soft delete** = has an indexed `is_deleted` (`SoftDeleteMixin`). Queries filter `is_deleted == False`. Nothing in the API currently sets `is_deleted` except supplier and customer delete.
- **Snapshot columns** (`product_name_snapshot`, `batch_number_snapshot`) keep the name as it was at transaction time, so renaming a product does not rewrite history.

## Entity relationships

```text
users                feature_flags            business_settings (singleton, id=1)

suppliers ─┬─< purchase_invoices ─┬─< purchase_items >── products ──< barcodes
           │                      └─< stock_batches  >──┘   │
           ├── supplier_ledger (1:1)                         │
           ├─< supplier_payment_transactions                 │
           └─< supplier_stock_returns ─< supplier_stock_return_items >── products, stock_batches

customers ─┬─< sales_bills ─┬─< sales_items ─┬─< sale_item_batch_allocations >── stock_batches
           │                │                └── products
           │                ├─< payment_transactions >── customers
           │                ├─< sales_returns ─< sales_return_items ─< sales_return_batch_allocations >── stock_batches
           │                └─< credit_notes  (optionally linked to a sales_return, 1:1)
           └── customer_ledger (1:1)

sales_bill_sequences (one row per financial year)
stock_ledger (append-only audit; product_id + reference_id, no FK on reference)
stock_adjustments >── products, stock_batches
```

## Reference tables

### `users`  · Timestamp
| Column | Notes |
|---|---|
| `id` | PK |
| `username` | unique |
| `password_hash` | bcrypt |
| `role` | `admin` / `billing_staff` / `viewer` (default `viewer`). Stored only, not enforced. |
| `must_change_password` | set for the seeded admin; cleared by `/auth/change-password` |

### `feature_flags`
`feature_name` (unique), `enabled`, `description`. Seeded at startup, not read by the app.

### `business_settings`  · Timestamp · singleton
Always row `id = 1`. It is created with defaults the first time it is read. Fields: `company_name`, `tagline`, `address`, `city`, `state`, `pincode`, `phone`, `email`, `website`, `gst_number`, `state_code`, `pan_number`, `invoice_prefix` (default `INV`, used in bill numbers), `invoice_footer`, `logo_url`.

## Master data

### `products`  · Timestamp · Soft delete
| Column | Notes |
|---|---|
| `brand_name`, `product_name` | display name = `"{brand} {product}"` |
| `packing_type` | e.g. Unit, Strip, Box, Carton, Bottle |
| `units_per_pack` | int, default 1 |
| `current_stock` | aggregate **sellable** units |
| `non_sellable_stock` | aggregate damaged/expired units |
| `is_archived` | hidden from default product lists; auto-set by the daily task |
| `hsn_code`, `unit_type`, `tax_rate`, `category`, `min_stock_level` | optional fields that exist in the DB but are **not** in `ProductCreate`/`ProductResponse`, so the API cannot set or return them |

### `barcodes`
`barcode` (PK, string) → `product_id`.

### `suppliers`  · Timestamp · Soft delete
`company_name`, `gst_number` (required by the schema), `address`, `phone`, `email`.

### `customers`  · Timestamp · Soft delete
`name`, `phone`, `gst_number`, `address`.

## Purchasing and stock

### `purchase_invoices`  · Timestamp · Soft delete
| Column | Notes |
|---|---|
| `supplier_id` | FK |
| `invoice_number` | the supplier's number; unique per supplier (enforced in code, case-insensitive) |
| `client_request_id` | unique; idempotency key from the `X-Idempotency-Key` header |
| `invoice_date` | date; becomes each batch's `purchase_date` |
| `total_amount` | sum of line totals, as sent by the client |

### `purchase_items`
`invoice_id`, `product_id`, `quantity`, `unit_price` (pre-tax unit price), `gst_percent`, `line_total` (incl. tax), `product_name_snapshot`.

### `stock_batches`
| Column | Notes |
|---|---|
| `product_id`, `purchase_invoice_id` | FKs |
| `batch_number`, `expiry_date` | present but never filled by the current purchase flow |
| `purchase_price`, `gst_percentage` | copied from the purchase line |
| `initial_quantity` | quantity received |
| `available_quantity` | remaining sellable units in this batch |
| `non_sellable_quantity` | damaged/expired units in this batch |
| `purchase_date` | FIFO sort key |

### `stock_ledger`  · append-only
`product_id`, `transaction_type`, `quantity` (signed), `transaction_date`, `reference_id` (ID of the invoice/bill/return/adjustment, with no FK), `notes`. Transaction types are listed in [ARCHITECTURE.md](ARCHITECTURE.md#inventory-model).

### `stock_adjustments`  · Timestamp
`product_id`, `stock_batch_id`, `adjustment_type` (`CORRECTION`, `RETURN`, or one of the non-sellable types `DAMAGE`/`EXPIRY`/`BROKEN`/`LEAKED`/`NON_SELLABLE`), `quantity` (signed as recorded), `reason`, `adjusted_by` (username), `final_action` (`Adjusted`/`Destroyed`/`Returned to Supplier`), `previous_stock`, `new_stock` (batch-level available quantity).

## Sales

### `sales_bills`  · Timestamp · Soft delete
| Column | Notes |
|---|---|
| `customer_id` | nullable (walk-in) |
| `bill_number` | unique, `PREFIX/FY/NNNN` |
| `financial_year`, `bill_sequence` | unique together |
| `bill_date` | datetime at 00:00 of the bill day |
| `subtotal`, `discount_amount`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `grand_total` | stored as calculated by the client |
| `paid_amount`, `outstanding_amount`, `payment_status` | `Pending` / `Partial` / `Paid`, calculated by the server |
| `payment_mode` | `Cash` / `UPI` / `Card` / `Credit` |
| `status` | `ACTIVE` (default). `CANCELLED` is reserved but never set. |
| `revision_number`, `edited_at`, `edited_by` | edit tracking |

### `sales_items`
`bill_id`, `product_id`, `stock_batch_id` (first allocated batch, legacy), `quantity`, `selling_price`, `gst_percent`, `discount_percent`, `final_amount`, `product_name_snapshot`.

### `sale_item_batch_allocations`
`sale_item_id`, `stock_batch_id`, `quantity`. One row per batch a sale line drew from.

### `sales_bill_sequences`
`financial_year` (PK), `last_number`. Locked `FOR UPDATE` when a bill number is assigned.

### `payment_transactions`
`bill_id`, `customer_id`, `amount`, `payment_mode`, `payment_date`, `notes`, `reference_number`, `is_initial_payment` (true for the amount paid at billing; these are deleted and re-created on bill edit).

## Returns and credit

### `sales_returns`  · Timestamp
`return_number` (`SR-00001`), `bill_id`, `customer_id`, `return_date`, `reason`, `settlement_type` (`Refund` / `Credit Note` / `Adjust Outstanding`), `total_amount`, `applied_outstanding_amount`, `refund_amount`, `credit_note_amount`, `status` (`Completed`), `notes`.

### `sales_return_items`
`sales_return_id`, `sale_item_id`, `product_id`, `quantity`, `amount`, `stock_action` (`SELLABLE` / `DAMAGED` / `NON_SELLABLE`), `reason`, `product_name_snapshot`.

### `sales_return_batch_allocations`
`sales_return_item_id`, `stock_batch_id`, `quantity`. Used to stop the same sold units being returned twice.

### `credit_notes`  · Timestamp  (customer-side only)
`note_number` (`CN-00001`), `bill_id`, `customer_id`, `sales_return_id`, `amount`, `applied_amount`, `reason`, `credit_date`, `status` (`Open` / `Partially Applied` / `Applied` / `Cancelled`).

### `supplier_stock_returns`  · Timestamp
`return_number` (`STR-00001`), `supplier_id`, `return_date`, `reason`, `status` (`Pending` / `Sent` / `Accepted` / `Rejected`), `credit_amount` (counts toward the supplier ledger only when `Accepted`), `notes`.

### `supplier_stock_return_items`
`supplier_stock_return_id`, `product_id`, `stock_batch_id`, `quantity`, `amount`, `stock_source` (`SELLABLE` / `NON_SELLABLE`), `reason`, `product_name_snapshot`, `batch_number_snapshot`.

### `supplier_payment_transactions`
`supplier_id`, `amount`, `payment_mode`, `payment_date`, `notes`, `reference_number`.

## Ledger summary tables

### `customer_ledger`  (PK = `customer_id`)
`total_credit` (legacy alias of billed), `total_billed`, `total_paid`, `total_credit_notes`, `outstanding_balance`.

### `supplier_ledger`  (PK = `supplier_id`)
`total_purchases`, `total_paid`, `total_returns`, `outstanding_balance`.

Both tables are rebuilt from source rows by `sync_*_ledger()`. Never edit them by hand. See [ARCHITECTURE.md](ARCHITECTURE.md#ledgers-are-recomputed-not-incremented).

## Migration history

Run from `backend/`: `alembic upgrade head`. The chain is linear:

| # | Revision | Date | Change |
|---|---|---|---|
| 1 | `567e8d2d25c3` | 2026-03-06 | Initial: feature flags, stock adjustments, audit and soft-delete columns, optional product fields |
| 2 | `d63e38d38728` | 2026-03-06 | Same audit columns with server defaults (safe on existing rows) |
| 3 | `cceef20c219d` | 2026-03-06 | `stock_adjustments.stock_batch_id` |
| 4 | `47fe2ab516a0` | 2026-03-06 | `business_settings` table |
| 5 | `2e1ff04195dc` | 2026-04-06 | `products.is_archived` |
| 6 | `a3d4b2c1e5f6` | 2026-05-03 | Bill sequences, FY numbering, revisions, batch allocations, name snapshots, with **backfill** of existing bills and snapshots |
| 7 | `f4b9c7d2a1e0` | 2026-05-03 | `purchase_invoices.client_request_id` |
| 8 | `9b7f6c4d2e10` | 2026-05-10 | **head.** Accounting workflow: sales returns, credit notes, supplier stock returns and payments, supplier ledger, non-sellable stock columns, `is_initial_payment`, ledger columns |

Creating a new migration:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
# review the generated file in migrations/versions/, then
alembic upgrade head
```

`migrations/env.py` reads `DATABASE_URL` from `secrets/backend.env`, with `backend/.env` as a fallback (the same files as `database.py`). Run Alembic from `backend/`, where `alembic.ini` lives. It converts the URL to asyncpg but does **not** apply the SSL/statement-cache settings from `database.py`. Use a direct or session-pooler connection (port 5432) for migrations, not the 6543 transaction pooler.
