# Development and Operations

## Prerequisites

- Python **3.11+** (the code uses `X | None` types and `dataclass(slots=True)`)
- Node.js **20+** and npm
- A PostgreSQL database. Production uses Supabase. A local PostgreSQL works if you point `DATABASE_URL` at it, but note that `database.py` always requests SSL (`ssl="require"`). For a local server without SSL, either enable SSL or relax that setting in your local copy.
- Optional: `pg_dump` for `scripts/backup.sh`

## Backend setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate                  # Windows
# source venv/bin/activate             # macOS / Linux
pip install -r requirements.txt
```

All credentials live in **`secrets/backend.env`** at the repository root. Git ignores the whole `secrets/` folder. Create the file from the committed template:

```bash
# from the repository root
mkdir secrets
cp secrets.example/backend.env.example secrets/backend.env     # Windows: copy secrets.example\backend.env.example secrets\backend.env
```

Then fill it in:

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
JWT_SECRET_KEY=<long random string, e.g. python -c "import secrets;print(secrets.token_hex(32))">
JWT_ALGORITHM=HS256
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<initial admin password>
```

All supported variables are listed in the [root README](../README.md#configuration). `database.py`, `migrations/env.py`, and `scripts/backup.sh` all read this file. `backend/.env` is still read as a fallback, but do not keep a second copy there. Never write a credential into code, docs, or a commit. If one ever lands in git, rotate it, because removing it from the files does not remove it from history.

Apply the schema and start the server:

```bash
alembic upgrade head
uvicorn main:app --reload --port 8000
```

- API docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/ and http://127.0.0.1:8000/health/db
- Startup prints `[startup] Connected to <masked url>` once a database is reachable.

## Frontend setup

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Leave `VITE_API_URL` unset locally so the Vite proxy forwards `/api` and `/auth` to port 8000. See [FRONTEND.md](FRONTEND.md).

## Tests

The backend has two `unittest` suites in `backend/tests/`:

| File | What it covers | Needs a database? |
|---|---|---|
| `test_accounting_workflows.py` | Pure business rules in `accounting.py`: payment state, follow-up payments, return allocation, stock moves, ledger and daily-ledger totals | No |
| `test_api_workflows.py` | The real HTTP endpoints end to end (purchase → sale → returns → ledgers), including regression tests for fixed bugs | Yes: a **throwaway local** PostgreSQL. Skipped when `TEST_DATABASE_URL` is unset. |

```bash
cd backend
venv\Scripts\python -m unittest discover -s tests -v        # API tests are skipped
```

To run the API tests too, start a disposable PostgreSQL on a spare port. **Never use the real database: the test drops and recreates every table**, and it refuses any host other than localhost.

```bash
# one-time: create a throwaway cluster (paths shown for PostgreSQL 18 on Windows)
"C:\Program Files\PostgreSQL\18\bin\initdb" -D %TEMP%\stockpro-pg -U postgres --auth=trust
"C:\Program Files\PostgreSQL\18\bin\pg_ctl" -D %TEMP%\stockpro-pg -o "-p 55432 -c listen_addresses=localhost" -l %TEMP%\stockpro-pg.log start
"C:\Program Files\PostgreSQL\18\bin\psql" -h localhost -p 55432 -U postgres -c "create database stockpro_test"

# each run (Git Bash syntax; in PowerShell set $env:TEST_DATABASE_URL first)
TEST_DATABASE_URL=postgresql+asyncpg://postgres@localhost:55432/stockpro_test venv/Scripts/python -m unittest discover -s tests -v

# when done
"C:\Program Files\PostgreSQL\18\bin\pg_ctl" -D %TEMP%\stockpro-pg stop
```

The API tests override the database and auth dependencies and write bill snapshots to a temp folder. The frontend has no automated tests yet.

## Database migrations

- The schema lives in `models.py`. Every change needs an Alembic revision. Startup `create_all()` only creates missing tables and never adds columns.
- Workflow:
  ```bash
  cd backend
  alembic revision --autogenerate -m "short description"
  # read and fix the generated file in migrations/versions/
  alembic upgrade head
  ```
- Add new non-null columns with a `server_default` (see `9b7f6c4d2e10`) so existing rows stay valid. Drop the default afterwards if it is not wanted.
- Back up before migrating production (see below). The revision history is in [DATA_MODEL.md](DATA_MODEL.md#migration-history).

## Utility scripts (`backend/`)

Run these from `backend/` with the venv active. They act on whatever database `secrets/backend.env` points at, so check that first.

| Script | What it does | Caution |
|---|---|---|
| `test_db.py` | Runs the startup connection logic and prints the URL that worked. | Safe. |
| `check_users.py` | Lists users and whether each password is `admin123`. | Read-only. |
| `debug_login.py` | Checks the `admin` user against the password `admin1234`. | Read-only. |
| `reset_password.py` | Resets `admin`'s password to `admin123` and forces a change at next login. | Writes. |
| `clear_data.py` | **`TRUNCATE … RESTART IDENTITY CASCADE` on every table.** | **Destroys all data, including users.** Never run against production. |
| `test_sync.py` | Checks the database with a plain synchronous psycopg2 connection, using `DATABASE_URL`. | Read-only. |
| `scripts/backup.sh` | `pg_dump` of `DATABASE_URL` → `backend/backups/stockpro_backup_<timestamp>.sql`. | Run with bash from anywhere. Needs `pg_dump`. Driver suffixes such as `+asyncpg` / `+psycopg2` are stripped automatically. |

`python311.exe` in `backend/` is a committed copy of the Python interpreter. It is not used by the app.

## Deployment

### Backend (Render)

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Pre-deploy command: `alembic upgrade head`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Environment: `DATABASE_URL`, `JWT_SECRET_KEY` (required: the app will not start without it), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and optionally `LOG_LEVEL`.
- Logs: each request logs `request_complete request_id=… render_request_id=…`. Errors log `database_error` or `unhandled_error` with the same IDs. A user's "Ref:" ID from an error toast can be searched for directly.
- Render's disk is ephemeral, so bill snapshots under `exports/` do not survive a restart.
- Run a single worker. The auto-archive loop runs inside every worker process.

### Frontend (Vercel)

- Root directory: `frontend`. Framework preset: Vite. Output: `dist`.
- Environment: `VITE_API_URL=https://<your-render-service>.onrender.com` (no trailing slash, no `/api`).
- `vercel.json` gives deep links such as `/sales/history` an SPA fallback.

### Backups

Take a backup before every migration or risky deploy:

```bash
bash backend/scripts/backup.sh
```

Supabase also keeps its own scheduled backups, depending on the plan.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `RuntimeError: DATABASE_URL is not set` at import | `secrets/backend.env` is missing or has no `DATABASE_URL`. Create it from `secrets.example/`. |
| `RuntimeError: JWT_SECRET_KEY is not set` at import | Add `JWT_SECRET_KEY` to `secrets/backend.env`, or to the host's environment variables in production. |
| `Could not connect … Tenant or user not found` | Wrong Supabase pooler username or region. Copy the exact pooler string from the Supabase dashboard (user looks like `postgres.<project-ref>`). |
| `… getaddrinfo failed` for `db.<ref>.supabase.co` | The derived direct host is IPv6-only and your network has no IPv6. This is expected: the app moves on to the next candidate URL. Set `DATABASE_FALLBACK_URL` to a reachable URL to skip the delay. |
| `prepared statement "__asyncpg_stmt_…" already exists` | Using the transaction pooler (6543) without the cache settings. Let `normalize_database_url` handle the URL, or use port 5432. |
| `ModuleNotFoundError: No module named 'fastapi'` | Started with the system Python instead of the venv. Activate `venv` first. |
| API returns **503** "Database unavailable" | A `SQLAlchemyError` was raised. Check the server log for `database_error request_id=<id>`. This includes schema drift (a column missing because migrations were not run). |
| UI keeps returning to `/login` | Token expired (7 days), or `JWT_SECRET_KEY` changed. Log in again. |
| Frontend calls fail only in production | `VITE_API_URL` not set at build time. Rebuild after setting it. |
| New column "does not exist" after deploy | `alembic upgrade head` was not run against that database. |

## Conventions

- **Never change stock directly.** Go through purchase, sale, return, or adjustment flows so `stock_batches`, `products`, and `stock_ledger` stay consistent.
- **Money writes end with a ledger sync** (`sync_customer_ledger` / `sync_supplier_ledger`) before `commit()`.
- **Keep business rules pure** in `accounting.py` and add a unit test for each new rule.
- **Soft delete** master data and transactions (`is_deleted`). Products are archived, never deleted.
- **Snapshot names** on transactional rows (`product_name_snapshot`) so history survives renames.
- **Frontend:** add API calls to `src/api/index.js`. Show errors with `addToast(getApiErrorMessage(err, '…'), 'error')`. Give new item-entry screens keyboard support.
- Business-level side effects of each feature are documented in [FEATURE_IMPACT_MAP.md](FEATURE_IMPACT_MAP.md). Update it when a flow changes.
