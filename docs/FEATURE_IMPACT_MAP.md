# Feature Impact Map

## Overview

This document explains how each business feature in `stockmanagement_online` affects stock, billing, ledger balances, and reporting inside the application.

Important interpretation:

- This system does **not** connect to bank accounts, cash drawers, payment gateways, or real-world settlement systems.
- "Money movement" in this document means **application-side accounting effect** only.
- Ledger values represent business state inside the app:
  - receivable from customers
  - payable to suppliers
  - recorded collections
  - refunds or credits
  - stock movement and stock status

This document is based on the **current backend codebase**, especially:

- [backend/models.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/models.py:1)
- [backend/accounting.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/accounting.py:1)
- [backend/routers/products.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/products.py:1)
- [backend/routers/purchases.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/purchases.py:1)
- [backend/routers/sales.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/sales.py:1)
- [backend/routers/accounting.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/accounting.py:1)
- [backend/routers/contacts.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/contacts.py:1)
- [backend/routers/reports.py](/c:/Users/ssrat/Desktop/New%20folder/Project/stockmanagement_online/backend/routers/reports.py:1)

Where current behavior is unclear or not fully implemented, it is explicitly marked as `Needs confirmation` or `Not currently implemented`.

## Business Flow Diagram

```text
Supplier -> Purchase Invoice -> Stock increases -> Supplier payable may increase
Supplier Payment -> No stock change -> Supplier payable decreases

Product stock available -> Sales Bill -> Stock decreases
Initial/Follow-up Customer Payment -> No stock change -> Customer receivable decreases

Sales Return against original bill ->
  if sellable return: stock increases
  if damaged/non-sellable return: non-sellable stock increases
  outstanding/refund/credit effect is recorded in customer-side accounting

Damage / Expiry adjustment ->
  sellable stock moves out of available stock
  non-sellable stock increases

Supplier Stock Return ->
  stock goes out to supplier
  supplier ledger may later reduce when accepted credit is recorded on the return

Daily Ledger / Customer Ledger / Supplier Ledger ->
  derived from transaction records and ledger summary rows
  should be treated as reporting/accounting views, not independent physical cash systems
```

## System-Wide Impact Table

| Feature | Stock Effect | Customer Ledger Effect | Supplier Ledger Effect | Daily Ledger Effect | Main Records Created / Updated |
|---|---|---|---|---|---|
| Products | Usually none directly | None | None | None directly | `products`, sometimes `barcodes` |
| Purchases | Increases sellable stock | None | Increases supplier payable unless offset by later payment/return | Indirectly affects payable; payment appears via supplier payments | `purchase_invoices`, `purchase_items`, `stock_batches`, `stock_ledger`, `supplier_ledger` |
| Sales / Billing | Decreases sellable stock | Creates or increases receivable if unpaid/partial | None | Increases sales totals and collection category by payment mode | `sales_bills`, `sales_items`, `sale_item_batch_allocations`, `payment_transactions` for initial paid amount, `stock_ledger`, `customer_ledger` |
| Payments | No stock change | Reduces customer outstanding for sale payments | Reduces supplier outstanding for supplier payments | Increases recorded collection or purchase payment totals | `payment_transactions` or `supplier_payment_transactions`, ledger summary rows |
| Sales Returns | May increase sellable stock or non-sellable stock | Reduces outstanding and/or creates customer-side credit/refund effect | None | Increases `sales_returns`; may reduce effective net collection position conceptually | `sales_returns`, `sales_return_items`, `sales_return_batch_allocations`, maybe `credit_notes`, `stock_ledger`, `customer_ledger` |
| Supplier Stock Returns | Decreases sellable or non-sellable stock sent back to supplier | None | May reduce payable when accepted credit amount is recorded | Increases `stock_return_credit` only when accepted and credited | `supplier_stock_returns`, `supplier_stock_return_items`, `stock_ledger`, `supplier_ledger` |
| Supplier Credit Notes | Intended to reduce payable or create supplier credit | None | Should reduce payable | Should contribute to supplier return credit/accounting summary | `Not currently implemented as a separate model/table` |
| Damage / Expiry | Moves stock from sellable to non-sellable or adjusts stock | None | None unless later linked to supplier return | No direct dedicated daily-ledger field | `stock_adjustments`, `stock_ledger`, `products`, `stock_batches` |
| Daily Ledger | None | None directly | None directly | Summarizes same-day sales, payments, returns, and outstanding | Derived from `sales_bills`, `payment_transactions`, `sales_returns`, `supplier_stock_returns`, `supplier_payment_transactions` |
| Customer Ledger | None | Summary of billed, paid, credit-note, and outstanding customer state | None | Provides receivable totals used by accounting summary | `customer_ledger` plus history from `sales_bills`, `payment_transactions`, `credit_notes`, `sales_returns` |
| Supplier Ledger | None | None | Summary of purchases, payments, returns, and outstanding supplier state | Provides payable totals used by accounting summary | `supplier_ledger` plus history from `purchase_invoices`, `supplier_payment_transactions`, `supplier_stock_returns` |
| Stock Ledger | Records all stock-changing events | None | None | No direct daily-ledger field currently | `stock_ledger` |
| Product Stock Quantity | Tracks current sellable and non-sellable stock | None | None | Used indirectly in operational views, not daily ledger totals | `products.current_stock`, `products.non_sellable_stock`, `stock_batches.available_quantity`, `stock_batches.non_sellable_quantity` |
| Dashboard Summary Values | None directly | None directly | None directly | Current dashboard is high-level counts + total revenue only | Derived from `products`, `customers`, `sales_bills`, `purchase_invoices` via `/api/v1/reports/summary` |

## 1. Products

### A. Business meaning

Products represent inventory items that can be purchased, stocked, sold, returned, archived, or moved into non-sellable condition.

### B. Main database records affected

- `products`
- `barcodes`
- related downstream tables:
  - `stock_batches`
  - `sales_items`
  - `purchase_items`

### C. Stock effect

- Creating or editing a product does **not** itself move stock.
- Product-level stock is stored in:
  - `products.current_stock` for sellable stock
  - `products.non_sellable_stock` for damaged/expiry/non-sellable stock

### D. Ledger/accounting effect

- No direct customer or supplier ledger effect.
- No direct payment effect.

### E. Daily Ledger effect

- No direct daily-ledger effect.

### F. Example scenario

Example: Add product "Soap 100g".

- Product master record is created.
- Stock remains `0`.
- No ledger values change.

### G. Edge cases

- Products cannot be hard-deleted through the API; they are archived instead.
- Archiving is blocked if `current_stock > 0`.
- Directly editing stock quantity through product master would be incorrect; stock should change through purchase, sale, return, or adjustment flows.

## 2. Purchases

### A. Business meaning

A purchase invoice means stock is received from a supplier. It increases inventory and represents a liability to the supplier unless later paid or offset.

### B. Main database records affected

- `purchase_invoices`
- `purchase_items`
- `stock_batches`
- `products`
- `stock_ledger`
- `supplier_ledger`

### C. Stock effect

- Each purchase item creates a `stock_batches` row.
- `stock_batches.available_quantity` is initialized to the purchased quantity.
- `products.current_stock` increases by the purchased quantity.
- One `stock_ledger` row is added per item with `transaction_type = "PURCHASE"`.

### D. Ledger/accounting effect

- Purchase invoice amount contributes to supplier liability through `sync_supplier_ledger()`.
- Supplier payable increases because `supplier_ledger.total_purchases` increases.
- Supplier payable decreases only later when:
  - a supplier payment is recorded
  - an accepted supplier stock return carries `credit_amount`

### E. Daily Ledger effect

- Purchase creation itself is **not** directly included as a top-level Daily Ledger metric.
- Supplier-side outgoing payments appear under `purchase_payments`.
- Supplier return credit appears under `stock_return_credit` when accepted.
- Purchase payable is reflected indirectly through supplier ledger and accounting summary, not directly in daily ledger line items.

### F. Example scenario

Example: Purchase `₹10,000` stock from supplier, unpaid.

- `products.current_stock` increases based on purchased quantities.
- `stock_batches` are created.
- `stock_ledger` gets `PURCHASE` entries.
- `supplier_ledger.total_purchases` increases by `₹10,000`.
- `supplier_ledger.outstanding_balance` increases by `₹10,000`.
- No customer ledger effect.

### G. Edge cases

- Duplicate purchase invoice protection exists through:
  - normalized supplier invoice number check
  - `client_request_id` idempotency support
- Purchase should not be used to correct stock mistakes retroactively; stock corrections belong in adjustments.
- Current purchase model does not store an explicit invoice payment status field; payable is derived via supplier ledger totals.

## 3. Sales / Billing

### A. Business meaning

A sales bill means goods are sold to a customer or walk-in buyer. It reduces stock and creates a receivable if the bill is not fully paid.

### B. Main database records affected

- `sales_bills`
- `sales_items`
- `sale_item_batch_allocations`
- `products`
- `stock_batches`
- `stock_ledger`
- `payment_transactions` for the initial payment if paid amount is greater than zero
- `customer_ledger`

### C. Stock effect

- Stock is allocated FIFO from `stock_batches.available_quantity`.
- `products.current_stock` decreases by sold quantity.
- `stock_ledger` rows are created with `transaction_type = "SALE"` and negative quantity.

### D. Ledger/accounting effect

- If fully paid immediately:
  - `sales_bills.paid_amount` is set
  - `outstanding_amount = 0`
  - `payment_status = "Paid"`
  - an initial `payment_transactions` row is created
- If partially paid:
  - customer receivable increases by the remaining outstanding amount
  - payment status becomes `Partial`
- If unpaid:
  - receivable is fully created
  - payment mode may become `Credit`

### E. Daily Ledger effect

Daily ledger uses sales bill data and payment transactions:

- `cash_sales`, `upi_sales`, `card_sales`, `credit_sales`
  - grouped by `sales_bills.payment_mode`
- `total_collection`
  - from same-day `payment_transactions`
  - plus legacy paid amounts stored directly on bills when not represented by transaction rows
- `total_outstanding`
  - sum of `sales_bills.outstanding_amount` for bills dated that day

### F. Example scenario

Example: Sale `₹2,000`, paid `₹1,500` cash.

- Stock decreases.
- `sales_bills.grand_total = 2000`
- `paid_amount = 1500`
- `outstanding_amount = 500`
- `payment_status = "Partial"`
- initial `payment_transactions` record is created for `₹1,500`
- `customer_ledger.outstanding_balance` increases by `₹500` if customer is linked

### G. Edge cases

- Insufficient stock is blocked before bill creation.
- Follow-up payments prevent editing a bill revision.
- Editing a bill restores previous stock first, deletes original initial payment rows, then reapplies the revised sale.
- Walk-in bills may have `customer_id = null`; in that case customer ledger impact is limited or absent.

## 4. Payments

### A. Business meaning

Payments record that money was collected from customers or paid to suppliers inside the app’s accounting system. They do not move stock.

### B. Main database records affected

Customer-side:

- `payment_transactions`
- `sales_bills`
- `customer_ledger`

Supplier-side:

- `supplier_payment_transactions`
- `supplier_ledger`

### C. Stock effect

- No stock effect.

### D. Ledger/accounting effect

Customer payment:

- reduces `sales_bills.outstanding_amount`
- increases `sales_bills.paid_amount`
- updates `payment_status` to `Paid` or `Partial`
- reduces customer outstanding in `customer_ledger`

Supplier payment:

- reduces supplier outstanding in `supplier_ledger`
- increases `supplier_ledger.total_paid`

### E. Daily Ledger effect

Customer payment:

- contributes to `total_collection` on the payment date

Supplier payment:

- contributes to `purchase_payments` on the payment date

### F. Example scenario

Example: Customer later pays remaining `₹500` on a partially paid bill.

- No stock change.
- New `payment_transactions` row is created.
- Bill outstanding becomes `0`.
- Bill status becomes `Paid`.
- Customer receivable reduces by `₹500`.

### G. Edge cases

- Customer follow-up payment cannot exceed outstanding balance.
- Payment customer must match bill customer if both are specified.
- Supplier payment amount must be greater than zero.
- Payment mode is validated to `Cash`, `UPI`, `Card`, or `Credit`.

## 5. Sales Returns

### A. Business meaning

A sales return records goods returned by a customer against an existing sales bill. It should reverse part of the sale economically without deleting the original bill.

### B. Main database records affected

- `sales_returns`
- `sales_return_items`
- `sales_return_batch_allocations`
- `sales_bills`
- `credit_notes` in some settlement paths
- `products`
- `stock_batches`
- `stock_ledger`
- `customer_ledger`

### C. Stock effect

If `stock_action = "SELLABLE"`:

- `stock_batches.available_quantity` increases
- `products.current_stock` increases
- `stock_ledger.transaction_type = "SALES_RETURN"`

If `stock_action = "DAMAGED"` or `NON_SELLABLE`:

- `stock_batches.non_sellable_quantity` increases
- `products.non_sellable_stock` increases
- available sellable stock does **not** increase
- `stock_ledger.transaction_type = "SALES_RETURN_NON_SELLABLE"`

### D. Ledger/accounting effect

Current code supports settlement types:

- `Refund`
- `Credit Note`
- `Adjust Outstanding`

Current implementation detail:

- `compute_sales_return_financials()` treats only `Refund` as refund logic.
- Any other supported settlement type currently routes into the customer credit-note path.

That means:

- outstanding may be reduced by `apply_credit_note_to_bill()`
- `refund_amount` is used only for `Refund`
- `credit_note_amount` is created for non-refund settlements

### E. Daily Ledger effect

- `sales_returns` in Daily Ledger is the sum of `sales_returns.total_amount` for the selected date.
- There is no dedicated separate "cash refund outflow" line currently.
- Reviewers should interpret Daily Ledger sales-return value as return activity amount, not necessarily net cash-out only.

### F. Example scenario

Example: Customer returns item worth `₹500` and receives cash refund.

- Original bill remains in place.
- A `sales_returns` row is created.
- If item is sellable, stock increases.
- If item is damaged, non-sellable stock increases instead.
- `sales_returns.total_amount` increases by `₹500`.
- `refund_amount = ₹500` if there was no outstanding to offset.
- Customer ledger may reduce depending on original outstanding and settlement behavior.

### G. Edge cases

- Return quantity cannot exceed original sold quantity minus previous returns.
- Return amount cannot exceed original sold value for the returned quantity.
- Return customer must match original bill customer when the bill already has one.
- The original bill is not deleted or rewritten.
- `Adjust Outstanding` and `Credit Note` are both customer-side concepts in the current code.

## 6. Supplier Stock Returns

### A. Business meaning

Supplier stock return means goods are sent back to the supplier because of defect, damage, expiry, wrong item, or excess stock.

### B. Main database records affected

- `supplier_stock_returns`
- `supplier_stock_return_items`
- `products`
- `stock_batches`
- `stock_ledger`
- `supplier_ledger`

### C. Stock effect

If `stock_source = "SELLABLE"`:

- `stock_batches.available_quantity` decreases
- `products.current_stock` decreases

If `stock_source = "NON_SELLABLE"`:

- `stock_batches.non_sellable_quantity` decreases
- `products.non_sellable_stock` decreases

In both cases:

- `stock_ledger.transaction_type = "SUPPLIER_RETURN"`
- quantity is recorded as negative

### D. Ledger/accounting effect

- Supplier return itself does not automatically create a separate supplier credit-note record.
- `supplier_stock_returns.credit_amount` is the current code’s way to represent the financial value expected or accepted from the supplier return.
- `supplier_ledger.total_returns` includes only returns whose status is `Accepted`.
- Accepted supplier returns reduce supplier outstanding through `sync_supplier_ledger()`.

### E. Daily Ledger effect

- `stock_return_credit` in Daily Ledger sums `supplier_stock_returns.credit_amount`
  - only for returns with `status == "Accepted"`
  - on the selected return date

### F. Example scenario

Example: Return damaged stock worth `₹800` to supplier.

- Non-sellable or sellable stock decreases depending on source.
- `supplier_stock_returns` row is created.
- If status is `Pending`, payable may not reduce yet.
- If later updated to `Accepted` with `credit_amount = 800`, supplier payable reduces by `₹800`.

### G. Edge cases

- Quantity cannot exceed available stock in the chosen source bucket.
- If rejected, stock is restored back into the original source bucket.
- If a previously rejected return is changed back to active status, stock is moved out again.
- This flow must not be confused with customer sales return logic.

## 7. Supplier Credit Notes

### A. Business meaning

Business-wise, a supplier credit note means the supplier accepts returned stock or grants an adjustment, reducing what the business owes that supplier.

### B. Main database records affected

`Not currently implemented as a separate supplier credit-note model/table.`

Current related records are:

- `supplier_stock_returns`
- `supplier_ledger`

### C. Stock effect

- A supplier credit note by itself should not change stock.
- Stock movement already happens in the supplier stock return step.

### D. Ledger/accounting effect

Current implementation:

- Supplier-side financial offset is stored via `supplier_stock_returns.credit_amount`
- It affects `supplier_ledger.total_returns` only when the return status is `Accepted`

Missing separation:

- There is no dedicated `supplier_credit_notes` table
- There is no dedicated supplier credit note number/date/status record separate from stock return

### E. Daily Ledger effect

Current implementation:

- accepted `supplier_stock_returns.credit_amount` contributes to `stock_return_credit`

### F. Example scenario

Example: Supplier accepts returned stock and grants `₹800` credit.

Current code behavior:

- likely update `supplier_stock_returns.status = "Accepted"`
- set `credit_amount = 800`
- `supplier_ledger.outstanding_balance` reduces by `₹800`
- `Daily Ledger.stock_return_credit` includes it on that date

### G. Edge cases

- Supplier credit note numbering, separate lifecycle, and attachments are `Not currently implemented`.
- Reviewer should not assume customer `credit_notes` table is valid for supplier credit notes; it is customer-side only in the current schema.

## 8. Damage / Expiry

### A. Business meaning

Damage/expiry records stock that is no longer sellable. This is an internal stock condition change, not a sale or customer refund.

### B. Main database records affected

- `stock_adjustments`
- `products`
- `stock_batches`
- `stock_ledger`

### C. Stock effect

For damage-style adjustment types:

- sellable `stock_batches.available_quantity` decreases
- `stock_batches.non_sellable_quantity` increases
- `products.current_stock` decreases
- `products.non_sellable_stock` increases

For non-damage corrections:

- available stock may increase or decrease directly
- `products.current_stock` changes by the entered quantity

### D. Ledger/accounting effect

- No direct customer ledger effect.
- No direct supplier ledger effect.
- Conceptually this may represent loss/adjustment, but there is no dedicated expense/loss ledger model in the current code.

### E. Daily Ledger effect

- No dedicated Daily Ledger field currently tracks damage/expiry totals.
- Impact is visible operationally in stock levels and stock ledger, not in the current daily ledger response.

### F. Example scenario

Example: 10 expired units moved to non-sellable stock.

- `current_stock` decreases by `10`
- `non_sellable_stock` increases by `10`
- `stock_adjustments` row is created
- `stock_ledger` row is created with `NON_SELLABLE_ADJUSTMENT`

### G. Edge cases

- Quantity cannot move more sellable stock out than the batch currently has.
- Damage/expiry should not create a customer refund.
- If later returned to supplier, that should happen through supplier stock return flow, not by editing the damage record directly.

## 9. Daily Ledger

### A. Business meaning

Daily Ledger is the application’s date-wise accounting summary. It is a reporting view of the day’s recorded sales, collections, returns, supplier return credits, purchase payments, and outstanding.

### B. Main database records affected

Daily Ledger is derived from:

- `sales_bills`
- `payment_transactions`
- `sales_returns`
- `supplier_stock_returns`
- `supplier_payment_transactions`

It does not create its own persistent source table.

### C. Stock effect

- None directly.

### D. Ledger/accounting effect

Daily Ledger summarizes accounting effect; it does not itself post entries.

Current source mapping:

- `cash_sales`, `upi_sales`, `card_sales`, `credit_sales`
  - from `sales_bills.grand_total` grouped by `sales_bills.payment_mode`
- `total_collection`
  - from same-day `payment_transactions.amount`
  - plus legacy paid amounts still stored directly on `sales_bills`
- `total_outstanding`
  - from same-day `sales_bills.outstanding_amount`
- `sales_returns`
  - sum of `sales_returns.total_amount`
- `stock_return_credit`
  - sum of accepted `supplier_stock_returns.credit_amount`
- `purchase_payments`
  - sum of same-day `supplier_payment_transactions.amount`

### E. Daily Ledger effect

This section is itself the Daily Ledger effect.

### F. Example scenario

Example: Same day activity:

- Cash sale `₹1,000`
- Credit sale `₹2,000`
- Customer payment received later that day `₹500`
- Supplier payment `₹700`
- Sales return `₹200`

Then Daily Ledger should show roughly:

- `cash_sales = 1000`
- `credit_sales = 2000`
- `total_collection` includes customer payment activity
- `purchase_payments = 700`
- `sales_returns = 200`

### G. Edge cases

- Daily Ledger is not a separate source of truth; it is derived from transaction tables.
- Sales mode classification currently follows bill payment mode, not separate multi-mode split across one bill.
- Refund-outflow treatment is not separately modeled as a negative collection line in the current API.

## 10. Customer Ledger

### A. Business meaning

Customer Ledger shows how much money should be recovered from customers, along with supporting bill/payment/credit-return history.

### B. Main database records affected

- `customer_ledger`
- `sales_bills`
- `payment_transactions`
- `credit_notes`
- `sales_returns`

### C. Stock effect

- None directly.

### D. Ledger/accounting effect

Customer ledger totals are synchronized from:

- billed amounts from `sales_bills.grand_total`
- outstanding from `sales_bills.outstanding_amount`
- payments from `payment_transactions.amount`
- credit note amounts from `credit_notes.amount`

Fields in `customer_ledger`:

- `total_credit`
- `total_billed`
- `total_paid`
- `total_credit_notes`
- `outstanding_balance`

### E. Daily Ledger effect

- Customer ledger itself does not update daily ledger directly.
- Its aggregated outstanding is used by `/api/v1/accounting/summary` as `total_customer_receivable`.

### F. Example scenario

Example: Customer has two bills:

- Bill A `₹1,000`, paid `₹700`
- Bill B `₹500`, unpaid

Then customer ledger should show:

- `total_billed = 1500`
- `total_paid = 700`
- `outstanding_balance = 800`

### G. Edge cases

- Walk-in sales without `customer_id` do not naturally belong to customer ledger.
- Legacy bills may have `paid_amount` on the bill beyond payment transaction rows; sync logic tries to avoid double-counting by subtracting recorded transactions first.
- Customer credit notes are customer-side only in current schema.

## 11. Supplier Ledger

### A. Business meaning

Supplier Ledger shows how much the business owes suppliers after considering purchases, supplier payments, and accepted supplier return credits.

### B. Main database records affected

- `supplier_ledger`
- `purchase_invoices`
- `supplier_payment_transactions`
- `supplier_stock_returns`

### C. Stock effect

- None directly.

### D. Ledger/accounting effect

Supplier ledger totals are synchronized from:

- `purchase_invoices.total_amount`
- `supplier_payment_transactions.amount`
- accepted `supplier_stock_returns.credit_amount`

Fields in `supplier_ledger`:

- `total_purchases`
- `total_paid`
- `total_returns`
- `outstanding_balance`

### E. Daily Ledger effect

- Supplier ledger outstanding feeds `/api/v1/accounting/summary` as `total_supplier_payable`.
- Supplier payments contribute to Daily Ledger `purchase_payments`.
- Accepted supplier return credits contribute to Daily Ledger `stock_return_credit`.

### F. Example scenario

Example:

- Purchases from supplier: `₹10,000`
- Supplier payment: `₹3,000`
- Accepted supplier stock return credit: `₹800`

Then supplier ledger should show:

- `total_purchases = 10000`
- `total_paid = 3000`
- `total_returns = 800`
- `outstanding_balance = 6200`

### G. Edge cases

- Supplier ledger must not be mixed with customer ledger.
- Only `Accepted` stock returns reduce payable in current code.
- There is no separate supplier-credit-note history table yet.

## 12. Stock Ledger

### A. Business meaning

Stock Ledger is the audit trail for stock-changing events. It should explain why stock went up or down.

### B. Main database records affected

- `stock_ledger`

Related source tables:

- `purchase_invoices`
- `sales_bills`
- `sales_returns`
- `supplier_stock_returns`
- `stock_adjustments`

### C. Stock effect

Stock ledger does not change stock by itself; it records the stock effect created elsewhere.

Current transaction types in code include:

- `PURCHASE`
- `SALE`
- `SALE_REVERSAL`
- `SALES_RETURN`
- `SALES_RETURN_NON_SELLABLE`
- `SUPPLIER_RETURN`
- `SUPPLIER_RETURN_REJECTED`
- `SUPPLIER_RETURN_REAPPLIED`
- `ADJUSTMENT`
- `NON_SELLABLE_ADJUSTMENT`

### D. Ledger/accounting effect

- No direct customer/supplier accounting effect by itself.
- It is operational stock audit, not payment ledger.

### E. Daily Ledger effect

- No direct Daily Ledger field currently reads from stock ledger.

### F. Example scenario

Example:

- Purchase 20 units -> stock ledger `PURCHASE +20`
- Sell 5 units -> stock ledger `SALE -5`
- Customer returns 1 sellable unit -> stock ledger `SALES_RETURN +1`

### G. Edge cases

- Stock-changing features should create ledger rows instead of directly mutating stock without trace.
- Reviewers should treat missing stock ledger entries for future features as a correctness gap.

## 13. Product Stock Quantity

### A. Business meaning

Product quantity is split into sellable and non-sellable stock.

### B. Main database records affected

Product-level:

- `products.current_stock`
- `products.non_sellable_stock`

Batch-level:

- `stock_batches.available_quantity`
- `stock_batches.non_sellable_quantity`

### C. Stock effect

Sellable stock changes through:

- purchases
- sales
- sellable returns
- supplier returns from sellable stock
- manual corrections

Non-sellable stock changes through:

- damage/expiry adjustments
- non-sellable customer returns
- supplier returns from non-sellable stock

### D. Ledger/accounting effect

- Product quantity fields do not directly hold ledger/accounting values.
- Their financial meaning comes from related purchase/sale/return transactions.

### E. Daily Ledger effect

- No direct Daily Ledger metric uses product quantity fields.

### F. Example scenario

Example:

- Buy 50 units -> `current_stock +50`
- Damage 3 units -> `current_stock -3`, `non_sellable_stock +3`
- Return 1 damaged unit to supplier from non-sellable -> `non_sellable_stock -1`

### G. Edge cases

- Direct manual editing of `current_stock` or `non_sellable_stock` outside the controlled flows would break stock integrity.
- Batch-level and product-level totals should stay aligned.

## 14. Dashboard Summary Values

### A. Business meaning

Dashboard summary is a high-level snapshot for counts and total revenue. It is not the same as full accounting summary.

### B. Main database records affected

Derived from `/api/v1/reports/summary`:

- `products`
- `customers`
- `sales_bills`
- `purchase_invoices`

### C. Stock effect

- None directly.

### D. Ledger/accounting effect

Current dashboard endpoint returns:

- product count
- customer count
- sales bill count
- purchase invoice count
- `total_revenue = sum(sales_bills.grand_total)`

It does **not** currently return:

- customer receivable
- supplier payable
- net position

Those values exist instead in `/api/v1/accounting/summary`.

### E. Daily Ledger effect

- None directly.

### F. Example scenario

Example:

- 100 products
- 40 customers
- 150 sales bills
- 60 purchase invoices
- total billed revenue `₹4,50,000`

Dashboard summary returns those counts and revenue only.

### G. Edge cases

- `total_revenue` is billed sales total, not collected cash.
- Dashboard summary should not be confused with receivable/payable position.

## Example Scenarios

### Example 1: Purchase ₹10,000 stock from supplier, unpaid

- Stock increases
- `stock_batches` are created
- `products.current_stock` increases
- `stock_ledger` gets `PURCHASE`
- `supplier_ledger.total_purchases` increases by `₹10,000`
- `supplier_ledger.outstanding_balance` increases by `₹10,000`
- No customer ledger effect

### Example 2: Sale ₹2,000, paid ₹1,500 cash

- Stock decreases
- `sales_bills.grand_total = 2000`
- `paid_amount = 1500`
- `outstanding_amount = 500`
- `payment_status = Partial`
- initial `payment_transactions` row is created
- customer receivable increases by `₹500` if customer is tracked
- Daily Ledger collection includes the paid portion

### Example 3: Customer returns item worth ₹500 and receives cash refund

- Original bill stays unchanged as the original sale record
- `sales_returns` row is created
- Stock increases if `stock_action = SELLABLE`
- Non-sellable stock increases if returned damaged
- `sales_returns.total_amount` increases by `₹500`
- `refund_amount` reflects refund logic
- Daily Ledger `sales_returns` increases by `₹500`

### Example 4: Damaged stock returned to supplier, supplier accepted credit ₹800

- Available or non-sellable stock decreases depending on return source
- `supplier_stock_returns` record is created
- When accepted with `credit_amount = 800`:
  - `supplier_ledger.total_returns` increases by `₹800`
  - supplier outstanding decreases by `₹800`
  - Daily Ledger `stock_return_credit` includes `₹800`

## Validation and Data Integrity Rules

### Stock integrity

- Do not edit stock totals directly unless through a proper adjustment workflow.
- Every stock-changing event should create a `stock_ledger` row.
- Batch-level and product-level quantities should remain consistent.

### Sales integrity

- A sale cannot exceed available stock.
- Bill edits restore prior stock before applying revised items.
- Bills with follow-up payments cannot be edited.
- Follow-up payments cannot exceed outstanding balance.

### Purchase integrity

- Duplicate purchase invoice creation is blocked by normalized invoice checks and idempotency support.
- Purchase should remain the source for incoming stock, not manual product edits.

### Sales return integrity

- Return quantity cannot exceed sold quantity minus previous returns.
- Return amount cannot exceed original sold value for returned quantity.
- Original bill should never be deleted to simulate a return.

### Supplier return integrity

- Supplier returns must validate source bucket:
  - sellable source cannot exceed available sellable stock
  - non-sellable source cannot exceed non-sellable stock
- Rejected supplier returns restore stock.

### Ledger integrity

- Customer ledger and supplier ledger are synchronized summary tables, not free-form editable accounting entries.
- Customer payments must match the bill/customer relationship.
- Supplier payable should not be reduced by customer-side credit notes.

## Open Questions / Needs Confirmation

1. Supplier credit note lifecycle:
Current code does not have a dedicated `supplier_credit_notes` model/table. Supplier-side credit is represented through `supplier_stock_returns.credit_amount` plus status. If a separate supplier credit note document is required, it still needs implementation.

2. Customer credit-note semantics:
The current `credit_notes` table is customer-side and is also used by sales return settlement flows. It should not be interpreted as supplier credit notes.

3. Sales return settlement vocabulary:
Business requested settlement options such as `Cash Refund`, `UPI Refund`, `Adjust Against Due`, `Customer Credit / Store Credit`, `No Refund`. Current backend normalization supports only:
- `Refund`
- `Credit Note`
- `Adjust Outstanding`
More granular refund-mode tracking would need separate implementation if required.

4. Daily Ledger refund treatment:
Daily Ledger currently exposes `sales_returns` total but does not separately expose refund outflow by refund mode. If the business needs net cash-position reporting by refund type, that needs additional design.

5. Dashboard accounting cards:
Receivable, payable, and net position currently belong to `/api/v1/accounting/summary`, not the dashboard reports endpoint. If those values must appear on the main dashboard, frontend integration or endpoint expansion may be needed.

6. Loss/expense reporting for damage/expiry:
Stock damage affects inventory state but there is no dedicated accounting-loss table in current backend code. Any formal loss reporting is `Not currently implemented`.
