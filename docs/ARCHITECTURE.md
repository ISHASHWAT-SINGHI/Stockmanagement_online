# Architecture

This document explains how StockPro is put together and why the important parts behave the way they do. For individual endpoints see [API_REFERENCE.md](API_REFERENCE.md). For tables see [DATA_MODEL.md](DATA_MODEL.md). For the business-level effect of each feature see [FEATURE_IMPACT_MAP.md](FEATURE_IMPACT_MAP.md).

## System overview

```text
┌───────────────────────┐   HTTPS (JSON, Bearer JWT)   ┌──────────────────────────┐   asyncpg + SSL   ┌────────────────────┐
│ React SPA (Vercel)    │ ───────────────────────────▶ │ FastAPI (Render)         │ ────────────────▶ │ PostgreSQL         │
│ frontend/src          │   /auth/*   /api/v1/*        │ backend/main.py          │                   │ (Supabase)         │
│ token in localStorage │ ◀─────────────────────────── │ + in-process daily task  │                   │                    │
└───────────────────────┘   X-Request-ID echoed        └──────────────────────────┘                   └────────────────────┘
                                                                  │
                                                                  └── writes bill HTML snapshots to <repo>/exports/sales-bills/
```

In local development the Vite dev server proxies `/api` and `/auth` to `http://127.0.0.1:8000`, so the SPA and API appear same-origin. In production the SPA calls the API origin set in `VITE_API_URL`.

## Backend layout

| Module | Responsibility |
|---|---|
| `main.py` | Builds the FastAPI app: CORS, request-ID middleware, exception handlers, router registration, startup hook, health endpoints. |
| `database.py` | Normalizes `DATABASE_URL`, picks engine/pool settings, tries fallback URLs at startup, and exposes `engine`, `SessionLocal`, `Base`, and the `get_db` dependency. |
| `models.py` | All SQLAlchemy ORM models. `TimestampMixin` adds `created_at`/`updated_at`. `SoftDeleteMixin` adds `is_deleted`. |
| `schemas.py` | Pydantic v2 models for request bodies and responses (`from_attributes = True`). |
| `accounting.py` | Business rules written as **pure functions**: payment state, return allocation, stock moves, ledger totals. Also holds async helpers that write to the DB (ledger sync, payment rows, lookups). The unit tests target this module. |
| `security.py` | bcrypt hashing, JWT creation/verification, and the `get_current_user` dependency. |
| `tasks.py` | `auto_archive_products()`, an infinite loop started at startup that runs once every 24 h. |
| `routers/*.py` | HTTP handlers grouped by area: `auth`, `products`, `contacts`, `purchases`, `sales`, `accounting`, `reports`, `settings`. |

There is an empty `services/` directory (untracked) that the `main.py` docstring mentions. All business logic currently lives in `accounting.py` and the routers.

## Request lifecycle

1. **CORS.** `CORSMiddleware` allows all origins, methods, and headers, and exposes `X-Request-ID`.
2. **Request context middleware** (`main.py`):
   - Uses the incoming `X-Request-ID` header or generates a UUID, and stores it on `request.state.request_id`.
   - Captures Render's `Rndr-Id` header as `platform_request_id`.
   - After the response, sets `X-Request-ID` on it and logs `request_complete` with method, path, status, and duration.
3. **Authentication.** Every router except `/auth/login` and `/auth/logout` declares `dependencies=[Depends(get_current_user)]`. That dependency decodes the Bearer token and loads the `User` by username, or returns 401.
4. **Handler** runs with an `AsyncSession` from `get_db()`.
5. **Error handling:**
   - `HTTPException` → FastAPI's normal JSON `{"detail": ...}`.
   - Any `SQLAlchemyError` → **503** `{"detail": "Database unavailable...", "request_id": ...}`.
   - Any other unhandled exception → **500** `{"detail": "Internal server error...", "request_id": ...}`.

The frontend generates its own `X-Request-ID` for every call and shows `(Ref: <id>)` in error toasts. A user-reported error can therefore be matched to a backend log line.

## Authentication and authorization

- `POST /auth/login` takes an OAuth2 password form (`username`, `password`) and returns `{access_token, token_type, must_change_password}`.
- Tokens are HS256 JWTs with claims `sub` (username), `role`, `must_change_password`, and `exp`. **Lifetime is 7 days.** There is no refresh token and no server-side revocation. Logout only tells the client to drop the token.
- The SPA stores the token in `localStorage`. `ProtectedRoute` only checks that a token is present. Any 401 response clears it and redirects to `/login`.
- `must_change_password` is set on the seeded admin. The login page sends that user to `/change-password`. The backend does not enforce it: such a token can still call every endpoint.
- **Roles** (`admin`, `billing_staff`, `viewer`) are stored and put into the token, but **no endpoint checks them**. Every authenticated user has full access.

## Database connection strategy

`database.py` is written for Supabase and its connection poolers:

- `normalize_database_url()` rewrites `postgres://` / `postgresql://` to `postgresql+asyncpg://`. On port **6543** (Supabase transaction pooler) it also adds `prepared_statement_cache_size=0`.
- `get_engine_args()`:
  - Always: `ssl="require"`, `statement_cache_size=0`, 15 s connect timeout, 30 s command timeout, `pool_pre_ping`, `pool_recycle=180`, `application_name=stockpro-api`.
  - `*.pooler.supabase.com` hosts use `NullPool` (no app-side pooling on top of the pooler). Other hosts get `pool_size=5`, `max_overflow=10`.
  - Non-PostgreSQL URLs raise at import time. The app is PostgreSQL-only.
- At startup, `verify_database_connection()` tries candidate URLs in this order, `DB_CONNECT_RETRIES` times each:
  1. `DATABASE_FALLBACK_URL` (if set)
  2. The direct Supabase URL derived from a pooler URL (`postgres.<ref>@…pooler.supabase.com` → `postgres@db.<ref>.supabase.co:5432`)
  3. `DATABASE_URL`

  The first one that answers `SELECT 1` becomes the active engine. **The fallback and derived URLs are tried before the primary.**
- `GET /health/db` runs `SELECT 1` on the active engine.

## Startup sequence (`@app.on_event("startup")`)

1. Pick and verify the database URL (above).
2. Start `tasks.auto_archive_products()` with `asyncio.create_task`.
3. `Base.metadata.create_all()`. This creates missing tables only. **It does not add new columns**, so schema changes must go through Alembic (`alembic upgrade head`).
4. If the `users` table is empty, create an `admin` user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` with `must_change_password=True`.
5. Insert missing feature flags (`barcode_scanning`, `expiry_tracking`, `credit_notes`, `multi_store`, `stock_adjustments`). These rows are **not read by any code path** yet.

## Transaction pattern

Write endpoints follow the same shape:

```python
try:
    db.add(parent); await db.flush()        # get IDs
    ... create children, mutate stock, add StockLedger rows ...
    await sync_customer_ledger(db, id)      # or sync_supplier_ledger
    await db.commit()
except HTTPException:
    await db.rollback(); raise
except Exception:
    await db.rollback(); raise
```

The stock change, the audit rows, and the ledger recalculation for one business action commit together or not at all. Validation that fails half-way (for example, insufficient stock on the third line of a bill) rolls back the whole request.

## Inventory model

Stock is held at two levels and must stay consistent:

| Level | Sellable | Non-sellable |
|---|---|---|
| Product (aggregate) | `products.current_stock` | `products.non_sellable_stock` |
| Batch | `stock_batches.available_quantity` | `stock_batches.non_sellable_quantity` |

- **Batches** are created only by purchase invoice lines (one batch per line, `purchase_date = invoice_date`).
- **FIFO allocation.** A sale takes stock from batches with `available_quantity > 0`, ordered by `(purchase_date, id)`. Each split is stored in `sale_item_batch_allocations`, which lets returns and edits put stock back into the exact batches it came from. `sales_items.stock_batch_id` holds only the first batch and is kept for legacy rows.
- **Returns** use `build_return_allocation_plan()`. It walks the original allocations, subtracts quantities already returned per batch, and rejects any request that exceeds what was sold.
- **Non-sellable moves** (damage, expiry, broken, leaked) take units out of sellable stock and add them to non-sellable stock at both levels.
- **Audit trail.** Every stock change appends a `stock_ledger` row with a signed quantity and a `transaction_type`: `PURCHASE`, `SALE`, `SALE_REVERSAL`, `SALES_RETURN`, `SALES_RETURN_NON_SELLABLE`, `SUPPLIER_RETURN`, `SUPPLIER_RETURN_REJECTED`, `SUPPLIER_RETURN_REAPPLIED`, `ADJUSTMENT`, `NON_SELLABLE_ADJUSTMENT`. Rows are never updated.
- **Auto-archive.** Once a day, products with `current_stock == 0` that have had at least one batch with stock, and no `stock_ledger` activity in 60 days, get `is_archived = True`. Archived products are hidden from `GET /products` unless `include_archived=true`.

## Sales billing design

### Bill numbering

- Financial year runs April–March: a bill dated 2025-05-10 is in `25-26`, and one dated 2026-02-01 is also in `25-26`.
- `sales_bill_sequences` has one row per financial year. `next_bill_identity()` locks it with `SELECT … FOR UPDATE`, increments `last_number`, and formats `"{invoice_prefix}/{FY}/{seq:04d}"`, e.g. `INV/25-26/0001`.
- A unique constraint on `(financial_year, bill_sequence)` guarantees no duplicates.
- When a bill is edited, its date cannot move to a different financial year.

### Who calculates what

The **frontend calculates** line amounts and bill totals (see [FRONTEND.md](FRONTEND.md#billing-calculations)) and sends `subtotal`, `discount_amount`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `grand_total`, and each item's `final_amount`. The **backend trusts these numbers** and stores them as sent. The backend does calculate:

- `paid_amount`, `outstanding_amount`, `payment_status` via `compute_bill_payment_state(grand_total, tendered)`. Paid is capped at the total, and any excess is treated as change.
- `payment_mode`: forced to `Credit` when nothing is paid and an amount is outstanding. Defaults to `Cash` when something is paid but no mode was given.

GST is always split 50/50 into CGST and SGST. There is no IGST (inter-state) handling, even though `business_settings.state_code` is stored for that purpose.

### Payments

- The amount paid at billing becomes a `payment_transactions` row with `is_initial_payment = True`.
- Follow-up payments (`POST /payments` or `/sales/{id}/payments`) must be greater than 0 and no more than the outstanding balance. They are stored with `is_initial_payment = False`.

### Editing a bill (`PUT /sales/{id}`)

1. Refused if the bill has any follow-up (non-initial) payment.
2. For every existing line, stock is restored to the original batches and a `SALE_REVERSAL` ledger row is written.
3. Old lines, allocations, and initial payments are deleted.
4. Header fields are overwritten, `revision_number` goes up by 1, and `edited_at`/`edited_by` are set.
5. New lines are applied with fresh FIFO allocation, and a new initial payment is recorded.
6. Customer ledgers are re-synced: the old customer, plus the new one if the customer changed.

### HTML snapshots

After each create or edit, `write_bill_snapshot()` renders a standalone HTML invoice to `<repo root>/exports/sales-bills/<FY>/<bill-number>[-vN].html` (slashes in the bill number become `-`). If the transaction later fails, the file is deleted. On hosts with ephemeral disks (Render) these files are lost on every deploy or restart. They are a convenience copy and not a system of record.

## Accounting design

### Ledgers are recomputed, not incremented

`customer_ledger` and `supplier_ledger` are **summary caches**. Every write that affects money calls `sync_customer_ledger()` / `sync_supplier_ledger()`, which recompute the totals from source rows:

- **Customer:** `total_billed = Σ bill.grand_total`. `total_paid = Σ payment_transactions.amount`, plus legacy bill `paid_amount` not covered by transactions. `total_credit_notes = Σ non-cancelled credit notes`. `outstanding_balance = Σ bill.outstanding_amount`. `total_credit` is a legacy alias of `total_billed`.
- **Supplier:** `total_purchases = Σ invoice.total_amount`, `total_paid = Σ supplier payments`, `total_returns = Σ credit_amount of Accepted stock returns`, `outstanding = max(0, purchases − paid − returns)`.

Reading a single ledger (`GET /customers/{id}/ledger`, `/suppliers/{id}/ledger`) re-syncs it first. The overview and summary endpoints read the cached rows as they are.

### Credit notes and sales returns

- A customer credit note is first applied against the linked bill's outstanding amount (`apply_credit_note_to_bill`). The applied portion is stored in `applied_amount`, and the status becomes `Open`, `Partially Applied`, or `Applied`.
- A sales return sums its item amounts, each capped at the original per-unit value × quantity, then settles in one of four ways:
  - `Refund` (with `refund_mode` Cash/UPI/Card): clears the bill's outstanding first and pays out the rest.
  - `Credit Note` / `Adjust Outstanding`: creates a linked credit note, which is applied to the outstanding.
  - `No Refund`: leaves the money side untouched.

  The outstanding is reduced at most once.
- Document numbers come from the row ID: `CN-00001`, `SR-00001`, `STR-00001`.

There is no separate supplier credit note table. Supplier credit is the `credit_amount` on a supplier stock return, and it counts only while the return's status is `Accepted`.

### Daily ledger

`GET /daily-ledger?ledger_date=YYYY-MM-DD` is computed on demand:

- Sales by mode: `Σ grand_total` of that day's bills, grouped by `payment_mode`.
- Collections: that day's `payment_transactions`, plus legacy paid amounts.
- Outstanding: `Σ outstanding_amount` of that day's bills.
- Purchase payments, sales return totals, and accepted supplier return credit for that day.
- Refunds paid out that day, by `refund_mode` (Cash, UPI, Card). Legacy refunds with no mode count as Cash.

## Purchase idempotency

The Purchases page generates an idempotency key for each draft (a new key whenever the payload changes) and sends it as `X-Idempotency-Key`. The backend:

1. Returns the existing invoice unchanged if that key was already used (`purchase_invoices.client_request_id`, unique).
2. Rejects with **409** if the same supplier already has a non-deleted invoice with the same number (whitespace-collapsed, case-insensitive).
3. If two requests race and hit the unique constraint, it rolls back and resolves to (1) or (2).

## Frontend architecture (summary)

- `App.jsx` sets up routing. All app routes sit under `MainLayout` (sidebar, title bar, keyboard hint bar, toasts) behind `ProtectedRoute`.
- `api/index.js` holds two Axios instances: `api` (`/api/v1`) and `auth` (`/auth`). Interceptors add the Bearer token and `X-Request-ID`, handle 401, and log errors that carry request IDs.
- Pages fetch their own data with `Promise.allSettled` and report failures through `useToast`. There is no global state store.
- Related screens share a `ModuleTabs` strip, e.g. New Bill / Bill History / Sales Returns.

Details are in [FRONTEND.md](FRONTEND.md).
