# Deployment

How code gets from a developer's machine to production. Nothing reaches production except through the `deploy` branch and the checklist below.

## Branches

```text
fix/* , feat/*  ──PR/merge──▶  dev  ──release (checklist)──▶  deploy  ──auto-build──▶  Render (API) + Vercel (web)
```

| Branch | Purpose | Who updates it |
|---|---|---|
| `dev` | Integration branch. All work lands here first. Must always pass the tests. | Normal development (merge feature/fix branches, or commit directly for small changes) |
| `deploy` | **The only branch production builds from.** Always equals what is live, or what is about to be live. | Only by fast-forwarding or merging `dev` during a release, after the checklist passes |
| `main` | Previous production line, frozen at `ee10779` (the last state before `dev`). | Untouched for now. Once the first release from `deploy` is live and stable, fast-forward `main` to `deploy` (or retire it) so the GitHub default branch matches production. |

Rules:
- Never commit directly to `deploy`. Never force-push it.
- Every change to the database schema ships as an Alembic migration on `dev`, tested locally (see [DEVELOPMENT.md](DEVELOPMENT.md#tests)) before it is released.
- Migrations must be **backward compatible** with the code currently live (add columns or tables; don't rename or drop in the same release). The database can then be migrated before the new code goes out, and rolling back the code needs no database rollback.

## One-time hosting setup (dashboards)

These settings live in the hosting dashboards, not in the repo. They have **not** been changed yet.

**Render (backend)**
- Settings → Build & Deploy → **Branch: `deploy`** (currently presumably `main`)
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- **Pre-deploy command: `alembic upgrade head`** (applies pending migrations before the new code starts; the deploy fails safely if a migration fails)
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Environment: `DATABASE_URL`, `JWT_SECRET_KEY` (now **required**: the app refuses to start without it), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optionally `LOG_LEVEL`
- Instances: 1 (the auto-archive job runs inside each instance)

**Vercel (frontend)**
- Settings → Git → **Production Branch: `deploy`**
- Root directory: `frontend`. Framework: Vite. Output: `dist`.
- Environment (Production): `VITE_API_URL=https://<render-service>.onrender.com`
- Every other branch (e.g. `dev`) gets a Vercel *preview* deployment. Previews call whatever `VITE_API_URL` the Preview environment has, so point it at a non-production backend, or treat previews as UI-only.

## Release checklist

Run from the repository root on an up-to-date `dev`.

1. **Tests pass**, including the API tests against a throwaway local database:
   ```bash
   cd backend
   TEST_DATABASE_URL=postgresql+asyncpg://postgres@localhost:55432/stockpro_test venv/Scripts/python -m unittest discover -s tests
   cd ../frontend && npm run build
   ```
2. **Review what is being released:** `git log --oneline deploy..dev` and `git diff --stat deploy..dev`. Note any new files in `backend/migrations/versions/`.
3. **Back up production** (always, even when there is no migration):
   ```bash
   bash backend/scripts/backup.sh          # needs pg_dump on PATH (PostgreSQL client 17+)
   ```
   Check the file ends with `-- PostgreSQL database dump complete` and that the table row counts look right.
4. **Apply migrations to production**, if the release has any (skip when Render's pre-deploy command does this):
   ```bash
   cd backend
   venv/Scripts/alembic upgrade 9b7f6c4d2e10:head --sql   # preview the SQL first (replace the start revision with `alembic current`)
   venv/Scripts/alembic upgrade head
   venv/Scripts/alembic current                          # must print the new head
   venv/Scripts/alembic check                            # must print "No new upgrade operations detected."
   ```
5. **Promote:** `git switch deploy && git merge --ff-only dev && git push origin deploy`. Render and Vercel build from this push.
6. **Verify production:** `GET /` and `GET /health/db` on the API return `ok`. Log in, open Daily Ledger, Customer Ledger, Sales Returns, and create one test bill if appropriate.
7. **Record the release** in the log below.

## Rollback

- **Code:** on `deploy`, `git revert <bad commit>` (or merge a fix from `dev`) and push. Never force-push `deploy`. Because migrations are backward compatible, the previous code runs fine on the newer schema.
- **Schema:** `alembic downgrade -1` only if a migration itself is wrong and nothing depends on it yet.
- **Data:** restore from the backup taken in step 3 (`psql "$DATABASE_URL" -f backend/backups/<file>.sql` into a fresh database, then switch `DATABASE_URL`). Treat this as a last resort.

## Release log

| Date | Release | Commit on `deploy` | Migration | Backup | Status |
|---|---|---|---|---|---|
| 2026-11-03 | First release from `deploy`: credentials moved to `secrets/`, docs, fixes F1–F4 and the ledger eager-load bug, refund modes | `bc1d6ad` (before this doc) | `91b5d1548229`: add `sales_returns.refund_mode` | `backend/backups/stockpro_backup_20261103_092734.sql`: verified complete and restorable | **Migration not yet applied** (production is at `9b7f6c4d2e10`). Hosts not yet switched to `deploy`. |
