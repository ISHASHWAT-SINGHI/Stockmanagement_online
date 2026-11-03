# secrets/

All credentials for this project live in a `secrets/` folder at the repository root. Git ignores that folder (see `.gitignore`), so it is never committed. This `secrets.example/` folder is the committed template.

Setup on a new machine:

```bash
mkdir secrets
cp secrets.example/backend.env.example secrets/backend.env
# then edit secrets/backend.env with the real values
```

| File | Read by |
|---|---|
| `secrets/backend.env` | `backend/database.py` (and so the whole API), `backend/migrations/env.py` (Alembic), `backend/scripts/backup.sh`, the debug scripts in `backend/` |

`backend/.env` is still read as a fallback for older setups, but keep everything in `secrets/backend.env`.

Never paste real values into code, docs, commit messages, or chat. In production, set the same variable names in the hosting provider's environment settings.
