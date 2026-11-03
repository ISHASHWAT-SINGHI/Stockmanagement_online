# Known Issues and Risks

These findings come from a full read of the codebase on branch `ui-change-sales-list` (2026-11-03). Each entry names the code involved so it can be checked and fixed. Remove entries as they are resolved.

Severity: **High** = data loss, a broken feature, or a security exposure. **Medium** = wrong numbers in some cases, or a likely operational problem. **Low** = cleanup or inconsistency.

## Security

| # | Severity | Issue | Where | Suggested fix |
|---|---|---|---|---|
| S1 | **High** | The production database password was hard-coded in `backend/test_sync.py` and is in the **public git history**. | `backend/test_sync.py` (before `dev`) | *Code fixed on `dev`:* the script now reads `DATABASE_URL` from `secrets/backend.env`. **Still open:** rotate the password in Supabase. Optionally purge it from history (needs a force-push). |
| S2 | **High** | The JWT secret fell back to a hard-coded value that is public in git history, and the `.env` value was that same public string, so anyone could create tokens. | [backend/security.py](../backend/security.py) | *Code fixed on `dev`:* startup now fails if `JWT_SECRET_KEY` is unset. **Still open:** generate a new secret and set it locally and on Render. |
| S3 | Medium | Roles (`admin`/`billing_staff`/`viewer`) are never checked. Every logged-in user can do everything. | all routers | Add a `require_role(...)` dependency on write endpoints. |
| S4 | Medium | `must_change_password` is enforced only by the UI. The API accepts the token for every endpoint. | [backend/security.py](../backend/security.py) | Reject such tokens everywhere except `/auth/change-password` and `/auth/me`. |
| S5 | Medium | Default admin password `admin123` when `ADMIN_PASSWORD` is unset. `reset_password.py` and `check_users.py` also assume it. | [backend/main.py](../backend/main.py) | Require `ADMIN_PASSWORD` in production. |
| S6 | Low | CORS allows every origin with credentials. | [backend/main.py](../backend/main.py) | Restrict to the Vercel domain and localhost. |
| S7 | Low | 7-day tokens in `localStorage`, with no revocation. | `security.py`, `api/index.js` | Shorter lifetime + refresh, or accept as a known trade-off. |

## Functional bugs

| # | Severity | Issue | Where | Details |
|---|---|---|---|---|
| F1 | **High** | **Every sales return saved from the UI is rejected with 400.** | [SalesReturns.jsx:290-296](../frontend/src/pages/SalesReturns.jsx#L290-L296) vs [routers/accounting.py:47-55](../backend/routers/accounting.py#L47-L55) | The UI sends `Cash Refund`, `UPI Refund`, `Adjust Against Due`, `Customer Credit / Store Credit`, or `No Refund`. The backend accepts only `Refund`, `Credit Note`, or `Adjust Outstanding`. Map the UI values to the backend ones, or extend the backend vocabulary (FEATURE_IMPACT_MAP open question 3). |
| F2 | ~~High~~ **Fixed on `dev`** | A sales return with `stock_action` `DAMAGED` or `NON_SELLABLE` crashed with a 500 (`TypeError`). | `routers/accounting.py` `create_sales_return` | The missing `product.non_sellable_stock` argument is now passed. Regression test: `test_damaged_return_moves_stock_to_non_sellable`. |
| F3 | ~~High~~ **Fixed on `dev`** | For `Credit Note` / `Adjust Outstanding` returns, the return value was subtracted from the bill's outstanding balance **twice**. | `routers/accounting.py` `create_sales_return` | The value is now applied once: through the credit note when one is created, otherwise directly. Regression tests: `test_credit_note_return_reduces_outstanding_once`, `test_credit_note_larger_than_outstanding_keeps_remaining_credit`. |
| F4 | ~~High~~ **Fixed on `dev`** | Editing a product could **overwrite live stock** with a stale value. | `schemas.ProductBase` | `current_stock` is no longer accepted on create or update (it is still returned). Regression test: `test_product_update_cannot_overwrite_stock`. |
| F13 | ~~High~~ **Fixed on `dev`** | Customer and supplier ledger pages returned a 500 (`MissingGreenlet`) for any customer with a sales return or supplier with a stock return. | `routers/contacts.py` ledger endpoints | The return items are now eager-loaded. Found by the new API tests. Regression test: `test_supplier_ledger_loads_with_stock_returns`. |
| F5 | Medium | The server stores client-calculated bill totals and line amounts without checking them. | [routers/sales.py](../backend/routers/sales.py) `create_sale` / `update_sale` | A modified or buggy client can save inconsistent totals. Recalculate on the server from items and compare. |
| F6 | Medium | Supplier stock return without a batch picks the product's **oldest batch even if it is empty**, then fails with "Only 0 sellable unit(s)…". | [routers/accounting.py:525-530](../backend/routers/accounting.py#L525-L530) | Filter on the chosen bucket having quantity, or allocate FIFO across batches. |
| F7 | Medium | Optional product fields (`category`, `tax_rate`, `min_stock_level`, `hsn_code`, `unit_type`) are missing from `ProductCreate`/`ProductResponse`. The Products page's category and GST filters, and the low-stock threshold, are therefore always empty or default. | [backend/schemas.py:79-94](../backend/schemas.py#L79-L94) | Add them to the schemas and the product form. |
| F8 | Medium | There is no way to cancel or void a bill. `sales_bills.status = 'CANCELLED'` exists but nothing sets it, and the `credit_notes` feature flag is unused. | sales router | Design a cancellation flow (reverse stock, credit note). |
| F9 | Low | The Dashboard's "Purchases" card shows the **supplier count**. | [Dashboard.jsx:70](../frontend/src/pages/Dashboard.jsx#L70) | Use the purchase invoice count (`/reports/summary`). |
| F10 | Low | Supplier payments are not capped at the payable amount, and supplier outstanding is floored at 0, so advances or over-payments are hidden. | `create_supplier_payment`, `calculate_supplier_ledger_totals` | Decide on advance-payment handling. |
| F11 | Low | Archiving checks only sellable stock, so a product can be archived while it still has non-sellable units. | [routers/products.py:140](../backend/routers/products.py#L140) | Also check `non_sellable_stock`. |
| F12 | Low | GST is always split CGST/SGST. There is no IGST for inter-state customers, although `state_code` is stored. | `Sales.jsx → calcBill` | Compare the business and customer state codes. |

## Operational risks

| # | Severity | Issue | Details |
|---|---|---|---|
| O1 | Medium | Bill HTML snapshots are written to local disk (`<repo>/exports/sales-bills/`). | They are lost on Render redeploys or restarts, and `exports/` is not git-ignored, so local snapshots can be committed by accident. Add `exports/` to `.gitignore`, and store snapshots in object storage if they matter. |
| O2 | Medium | The auto-archive background task runs inside every web worker and is not supervised. | With multiple workers it runs N times a day. If it crashes outside the `try`, it stops silently. Consider a scheduled job instead. |
| O3 | Medium | No pagination on several list endpoints (`/stock-ledger`, `/payments`, `/credit-notes`, `/sales-returns`, `/stock-returns`, `/stock-adjustments`, `/barcodes`, `/stock-batches`). The frontend loads at most 100 bills, 100 purchase invoices, and 200 products by default. | Lists will slow down and silently truncate as data grows. |
| O4 | Low | `backend/python311.exe` (26 MB), a copy of the Python interpreter, is committed. *Fixed on `dev`:* log files and `output.txt` are no longer tracked, and `backups/` and `exports/` are now git-ignored. | `git rm --cached backend/python311.exe`. |
| O5 | Low | `frontend/vercel.json` rewrites `/api/*` and `/auth/*` to themselves, so they do nothing. | Production depends entirely on `VITE_API_URL`. Either set it, or point those rewrites at the Render URL. |
| O6 | Low | `datetime.utcnow()` is deprecated in Python 3.12+, and timestamps are naive UTC while the UI shows IST. | Daily ledger dates follow the stored date. Bills store midnight of the chosen day, so they are unaffected, but payment timestamps near midnight IST can land on the previous UTC day. |

## Code health

- `frontend/README.md` (previously Vite boilerplate), `frontend/src/App.css`, and `<title>frontend</title>` in `index.html` are leftovers from the template.
- `getApiErrorMessage` / `formatCurrency` are copied into most page files. Move them to `src/utils/`.
- `routers/__init__.py` `__all__` leaves out `accounting` and `settings` (harmless, since `main.py` imports them directly).
- `get_product_display_name` / `get_sale_item_display_name` are duplicated across routers. Move them into a shared helper.
- `main.py` mentions a `services/` layer that does not exist.
- Endpoint-level tests (`tests/test_api_workflows.py`) cover purchases, sales, returns and ledgers, but not yet bill edits, payments, stock adjustments, or the daily ledger. The frontend has no tests.
