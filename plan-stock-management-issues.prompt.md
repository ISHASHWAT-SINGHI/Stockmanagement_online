# Plan: Fix 9 Stock Management Issues

## Final Status

### 1. Products with 0 stock get archived
- Status: Completed in this pass
- Result: Auto-archiving now skips products that have never had real stock history and only evaluates items that previously received stock through batches.
- Main files: `backend/tasks.py`

### 2. Input boxes too short for quantity/price
- Status: Completed in this pass
- Result: Purchase and sales table columns were widened, and table number/select inputs now fill the available cell width.
- Main files: `frontend/src/pages/Purchases.jsx`, `frontend/src/pages/Sales.jsx`, `frontend/src/index.css`

### 3. Purchase price with/without tax toggle
- Status: Completed in this pass
- Result: The bill-level inclusive/exclusive toggle was already present, and this pass fixed the remaining calculation gap so inclusive pricing now handles quantity correctly and saves the computed base unit price.
- Main files: `frontend/src/pages/Purchases.jsx`

### 4. Auto pick malfunction with brand name
- Status: Completed in this pass
- Result: Product search now matches the combined `brand + product` display name, exact full-name typing works again, and exact matches are committed on blur/save.
- Main files: `frontend/src/pages/Purchases.jsx`, `frontend/src/pages/Sales.jsx`

### 5. Supplier name should be picked from list
- Status: Completed in this pass
- Result: Supplier selection still remains list-based, but exact typed supplier names now auto-resolve to the matching supplier so saving no longer fails when the name is typed correctly without an extra click.
- Main files: `frontend/src/pages/Purchases.jsx`

### 6. Products rounded to integers
- Status: Already corrected before this pass
- Result: Sales already preserved decimal line calculations and rounded only the final bill total while still showing the exact amount separately.
- Main files: `frontend/src/pages/Sales.jsx`

### 7. Selection and unarchive in archive section
- Status: Completed in this pass
- Result: Archived products can now be selected with checkboxes and restored in bulk from the Products screen.
- Main files: `frontend/src/pages/Products.jsx`, `frontend/src/api/index.js`, `backend/routers/products.py`, `backend/schemas.py`

### 8. Shortcut keys and auto-add row on Tab from tax
- Status: Completed in this pass
- Result: `Alt+N` now works while focused inside item-entry inputs, purchase rows auto-add when tabbing out of the last GST field, and sales rows auto-add from the last editable discount field.
- Main files: `frontend/src/hooks/useKeyboard.js`, `frontend/src/pages/Purchases.jsx`, `frontend/src/pages/Sales.jsx`

### 9. Print button saves blank PDF
- Status: Already corrected before this pass
- Result: Print CSS already used `visibility`-based hiding, so the printable invoice content stays available during print/export.
- Main files: `frontend/src/index.css`

## Notes

### Already done before this pass
- Issue 6
- Issue 9

### Partially done before this pass and completed now
- Issue 3

### Completed during this pass
- Issue 1
- Issue 2
- Issue 4
- Issue 5
- Issue 7
- Issue 8

## Remaining Work

- None from this 9-issue list.
