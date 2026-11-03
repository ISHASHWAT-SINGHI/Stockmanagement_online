# StockPro — Stock Management & Billing

StockPro is a web-based inventory, GST billing, and accounting system for a single retail or wholesale business. It tracks stock by purchase batch (FIFO), issues GST sales bills, records customer and supplier payments, handles returns and damaged stock, and keeps customer, supplier, and daily ledgers.

- **Backend:** FastAPI + async SQLAlchemy 2.0 on PostgreSQL (hosted on Supabase), JWT auth, Alembic migrations.
- **Frontend:** React 19 + Vite 7 single-page app, React Router 7, Axios, Tailwind 4 (plus a large hand-written stylesheet), lucide-react icons. The UI is keyboard-first.
- **Deployment targets:** backend on Render, frontend on Vercel.

## Features

| Area | What it does |
|---|---|
| Products | Product master (brand, name, packing). Archive/unarchive with bulk restore, low-stock badges, search/filter/sort. Products are never hard-deleted. A background job auto-archives products that have been at zero stock for 60 days. |
| Purchases | Supplier purchase invoices. Each line creates a stock batch. Prices can be entered with or without tax. Duplicate invoices are rejected, and an idempotency key prevents double-submits. |
| Sales / Billing | GST bills with per-line discount and GST, a bill-level discount, and the total rounded to the rupee. Bill numbers are per financial year (`INV/25-26/0001`). Stock is taken from batches FIFO. Bills can be edited (a new revision is saved) and printed. An HTML snapshot is written to disk. |
| Payments | Initial payment at billing, follow-up payments against a bill, and supplier payments. Modes: Cash, UPI, Card, Credit. |
| Sales returns | Returns against an original bill, back to sellable or non-sellable stock. Settled by refund or credit note. |
| Supplier stock returns | Send stock back to a supplier from sellable or non-sellable stock. A status workflow (Pending → Sent → Accepted/Rejected) controls the supplier credit. |
| Damage / expiry | Moves stock from sellable to non-sellable, or applies manual corrections. |
| Ledgers | Customer ledger (receivables), supplier ledger (payables), daily ledger (sales by mode, collections, returns), and an accounting summary (net position). |
| Settings | Business profile used on invoices: name, address, GSTIN, PAN, invoice prefix, footer. |
| Auth | Username/password login with JWT. A default admin is seeded and must change their password on first login. |

## Repository layout

```
stockmanagement_online/
├── backend/                 FastAPI application
│   ├── main.py              App entry: middleware, routers, startup seeding
│   ├── database.py          Engine, session, Supabase URL handling, connection fallback
│   ├── models.py            SQLAlchemy ORM models (all tables)
│   ├── schemas.py           Pydantic request/response models
│   ├── accounting.py        Pure business rules + ledger sync helpers
│   ├── security.py          Password hashing, JWT, get_current_user dependency
│   ├── tasks.py             Background auto-archive loop
│   ├── routers/             One module per API area (auth, products, sales, …)
│   ├── migrations/          Alembic environment + version scripts
│   ├── tests/               unittest suite for accounting rules
│   ├── scripts/backup.sh    pg_dump backup helper
│   └── *.py (root)          One-off admin/debug scripts (see docs/DEVELOPMENT.md)
├── frontend/                React + Vite SPA
│   ├── src/api/index.js     Axios clients + every API call
│   ├── src/pages/           One component per screen
│   ├── src/components/      Layout pieces (Sidebar, Navbar, Modal, Toast, …)
│   ├── src/hooks/           useKeyboardShortcut, useToast
│   ├── vite.config.js       Dev proxy to the backend
│   └── vercel.json          SPA rewrites for Vercel
├── secrets/                 Real credentials: git-ignored, never committed (local only)
├── secrets.example/         Committed template for secrets/
└── docs/                    Project documentation
```

## Quick start (local development)

You need Python 3.11+, Node.js 20+, and a PostgreSQL database (the app refuses to start without one; SQLite is not supported).

```bash
# 1. Backend
cd backend
python -m venv venv
venv\Scripts\activate            # Windows  (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
# create the credentials file (see "Configuration" below):
#   mkdir ..\secrets  &&  copy ..\secrets.example\backend.env.example ..\secrets\backend.env
#   then fill in the real values
alembic upgrade head
uvicorn main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                      # http://localhost:5173, proxies /api and /auth to :8000
```

Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `secrets/backend.env` (defaults: `admin` / `admin123`). You will be asked to change the password straight away.

## Configuration

Backend settings come from environment variables. Locally they are loaded from **`secrets/backend.env`**, which is git-ignored (template: [secrets.example/](secrets.example/)). `backend/.env` is still read as a fallback. Values already set in the environment, such as on Render, take precedence. Never put credentials in code.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string. `postgres://` and `postgresql://` are rewritten to `postgresql+asyncpg://` automatically. |
| `DATABASE_FALLBACK_URL` | no | — | Extra connection string to try first if set. |
| `JWT_SECRET_KEY` | **yes** | — (startup fails without it) | Signs access tokens. |
| `JWT_ALGORITHM` | no | `HS256` | JWT algorithm. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | no | `admin` / `admin123` | Seeded admin, created only when the `users` table is empty. |
| `DB_CONNECT_RETRIES` | no | `3` | Connection attempts per candidate URL at startup. |
| `DB_CONNECT_RETRY_DELAY_SECONDS` | no | `2` | Delay between attempts. |
| `LOG_LEVEL` | no | `INFO` | Python log level. |

Frontend setting (build time):

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend origin, e.g. `https://stockpro-api.onrender.com`. Leave empty in local dev so the Vite proxy is used. **It must be set for the Vercel build.** |

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system fits together: request lifecycle, auth, DB connection strategy, stock and accounting design. |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every table, its key columns and relationships, plus the migration history. |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every HTTP endpoint with parameters, payloads, and side effects. |
| [docs/FEATURE_IMPACT_MAP.md](docs/FEATURE_IMPACT_MAP.md) | Business view: how each feature affects stock, ledgers, and the daily ledger. |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Routes, pages, shared components, keyboard shortcuts, billing calculations. |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, migrations, tests, utility scripts, troubleshooting. |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Branch model (`dev` → `deploy`), release checklist, hosting settings, rollback, release log. |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | Confirmed bugs, security risks, and gaps found during the code review. |
