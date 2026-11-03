# Frontend Guide

The frontend is a React 19 single-page app built with Vite 7 in [frontend/](../frontend/). It is plain JavaScript/JSX (no TypeScript) with no global state library. Each page loads its own data through [src/api/index.js](../frontend/src/api/index.js).

## Commands

```bash
cd frontend
npm install
npm run dev       # dev server on http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the built dist/
npm run lint      # ESLint (flat config in eslint.config.js)
```

During `npm run dev`, [vite.config.js](../frontend/vite.config.js) proxies `/api/v1`, `/api`, and `/auth` to `http://127.0.0.1:8000`, so start the backend on port 8000 first.

## Source layout

```
src/
├── main.jsx              React root (StrictMode)
├── App.jsx               Router, ProtectedRoute, ToastProvider
├── index.css             Design tokens (CSS variables, oklch colors), component classes, print styles
├── App.css               Unused Vite boilerplate
├── api/index.js          Axios instances + one exported function per endpoint
├── layouts/MainLayout.jsx  Sidebar + Navbar + <Outlet/> + keyboard hint bar + toasts
├── components/
│   ├── Sidebar.jsx       Main navigation, collapsible, Alt+1..7 shortcuts
│   ├── Navbar.jsx        Page title (from the path) + live date/time
│   ├── ModuleTabs.jsx    Tab strip shared by related pages
│   ├── Modal.jsx         Dialog: Esc to close, autofocus on the first field
│   ├── Toast.jsx         Renders toasts from useToast
│   └── KbdHint.jsx       Bottom bar of shortcut hints
├── hooks/
│   ├── useKeyboard.js    useKeyboardShortcut(key, cb, {alt, ctrl, shift, allowInInput})
│   └── useToast.jsx      ToastProvider / useToast() → addToast(message, type, ms)
└── pages/                One file per screen (below)
```

## Routes and pages

All routes except `/login` and `/change-password` are wrapped in `ProtectedRoute`, which redirects to `/login` when there is no token in `localStorage`, and render inside `MainLayout`.

| Path | Page file | Sidebar group | What it does |
|---|---|---|---|
| `/login` | `Login.jsx` | — | Login form. Stores the JWT. Goes to `/change-password` if the user must change it. |
| `/change-password` | `ChangePassword.jsx` | — | Change the password (old/new/confirm). |
| `/` | `Dashboard.jsx` | Dashboard (Alt+1) | Stat cards, recent sales, low-stock list (`current_stock ≤ 5`). |
| `/products` | `Products.jsx` | Products (Alt+2) | Product list with filters and sort, add/edit modal, stock adjustment modal (per batch), archive, archived view with bulk unarchive. |
| `/sales` | `Sales.jsx` | Sales (Alt+3) | **New Bill** tab: billing grid with product and customer autocomplete, payment entry, save/edit. |
| `/sales/history` | `Sales.jsx` | Sales | **Bill History** tab: bill list, detail modal, follow-up payment, print, edit. |
| `/sales-returns` | `SalesReturns.jsx` | Sales | **Sales Returns** tab: pick a bill, enter return quantities per line, choose settlement. |
| `/purchases` | `Purchases.jsx` | Purchases (Alt+4) | **New Invoice** tab: supplier autocomplete, item grid, price incl./excl. tax toggle. |
| `/purchases/history` | `Purchases.jsx` | Purchases | **Purchase History** tab: invoice list and detail. |
| `/contacts` | `Contacts.jsx` | Contacts (Alt+5) | Customers / Suppliers tabs, add/edit, customer ledger popup. Suppliers require a GST number. |
| `/daily-ledger` | `DailyLedger.jsx` | Accounting (Alt+6) | Pick a date → daily totals + accounting summary. |
| `/customer-ledger` | `CustomerLedger.jsx` | Accounting | Receivables overview + per-customer history. |
| `/supplier-ledger` | `SupplierLedger.jsx` | Accounting | Payables overview + per-supplier history, record a supplier payment. |
| `/payments` | `Payments.jsx` | Accounting | Customer and supplier payment lists. |
| `/stock-returns` | `StockReturns.jsx` | Returns & Adjustments (Alt+7) | **Supplier Stock Returns**: create a return, change its status. |
| `/credit-notes` | `CreditNotes.jsx` | Returns & Adjustments | **Supplier Credit Notes**: read-only list of stock returns with credit or `Accepted` status. This is *not* the customer `/credit-notes` API. |
| `/stock-adjustments` | `StockReturns.jsx` | Returns & Adjustments | **Damage / Expiry**: move batch stock to non-sellable. |
| `/returns-history` | `StockReturns.jsx` | Returns & Adjustments | **Return History**: stock returns + adjustments. |
| `/settings` | `Settings.jsx` | Settings | Business profile used on invoices. |

Several paths share one component, which switches view on `location.pathname`. When adding a route, update `App.jsx`, the `titles` map in `Navbar.jsx`, and the relevant `*Tabs` array.

## API client conventions

- Two Axios instances: `api` → `${VITE_API_URL}/api/v1` and `auth` → `${VITE_API_URL}/auth`.
- The request interceptor adds `Authorization: Bearer <localStorage.token>` and a fresh `X-Request-ID` (UUID).
- The response interceptor, on **401** (except during login), removes the token and does a full-page redirect to `/login`. Errors with a request ID, and all 5xx errors, are logged to the console.
- Pages format errors with a local `getApiErrorMessage(error, fallback)`, which appends `(Ref: <request id>)`. This helper is copied into most pages rather than shared.
- Add new endpoints as named exports in `api/index.js`. Pages import those, never Axios directly.

## Keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| Alt+1 … Alt+7 | anywhere (not while typing in a field) | Jump to a sidebar section |
| Alt+N | Sales, Purchases (works inside inputs) | Add an item row and focus it |
| Alt+N | Products, Contacts | Open the "add" modal |
| Alt+N | Dashboard | Go to New Bill |
| Alt+Enter | Sales | Save the bill |
| Tab on the last editable field of the last row | Sales (discount %), Purchases (GST %) | Add a new row automatically |
| ↑ / ↓, Enter or Tab, Esc | Product/customer/supplier autocomplete | Move, pick, dismiss |
| Esc | Any modal | Close |

## Billing calculations

All bill totals are calculated **in the browser** and sent to the backend, which stores them unchanged. Changing these formulas changes what is persisted.

**Sales line** (`Sales.jsx → calcItem`):

```
base          = selling_price × quantity
afterDiscount = base × (1 − discount_percent/100)
final_amount  = afterDiscount × (1 + gst_percent/100)        // rounded to 2 dp
```

**Sales bill** (`calcBill`):

```
subtotal   = Σ selling_price × quantity
taxable    = Σ afterDiscount
gstTotal   = Σ afterDiscount × gst_percent/100
cgst = sgst = gstTotal / 2
extraDisc  = bill discount (flat ₹, or % of taxable+gst)
grandExact = taxable + gstTotal − extraDisc
grand_total = Math.round(grandExact)                        // rounded to whole rupees
```

The exact figure is shown alongside the rounded total. A new bill defaults to payment mode **Credit**. Paid amount above the total is shown as change.

**Purchase line** (`Purchases.jsx → calcItem`), with a bill-level "price includes tax" toggle:

- Exclusive: `line_total = unit_price × qty × (1 + gst/100)`, and `unit_price` is sent as entered.
- Inclusive: `line_total = unit_price × qty`, and the **pre-tax** unit price `unit_price / (1 + gst/100)` is sent (4 dp).
- `total_amount = Σ line_total`.

## Autocomplete behavior

- Product search matches the combined display name `"{brand} {product}"` once at least 2 characters are typed, and shows up to 8 suggestions.
- If the typed text exactly matches a product's display name, the product is selected on blur and again when saving, so typing the full name without clicking a suggestion still works.
- Supplier selection in Purchases resolves exact name matches the same way.
- A row with a product name that does not resolve to a product blocks the save with an error toast.

## Printing bills

`Sales.jsx → handlePrint` sets `document.title` to `bills-<bill-number>-<YYYY-MM-DD>` (the browser uses it as the default PDF file name), calls `window.print()`, and restores the title afterwards. The `@media print` rules in `index.css` hide the app chrome using `visibility` rather than `display`, which avoids blank PDFs, and `@page` sets the paper margins. The printed invoice uses business details from `GET /settings/business`.

## Styling

- `index.css` (about 1,600 lines) defines the design tokens on `:root` (`--canvas`, `--surface-1..4`, `--brand`, `--ledger`, `--text-*`, `--line*`, motion tokens) and reusable classes (`surface`, `btn`, `badge`, `modal-*`, `module-tabs__*`, `kbd`, `toast*`, `empty-state`, …). The theme is dark only.
- Components use these classes plus a lot of inline `style={{…}}` objects. Tailwind 4 is installed through `@tailwindcss/vite` but is hardly used.
- Fonts: Inter and JetBrains Mono from Google Fonts.

## Deployment (Vercel)

- Build command `npm run build`, output `dist/`, root directory `frontend`.
- **Set `VITE_API_URL`** to the backend origin in the Vercel project. The `/api/*` and `/auth/*` rewrites in [vercel.json](../frontend/vercel.json) point back to the same paths, so they do not proxy to the backend. Only the final rewrite to `index.html` matters, for client-side routing.
