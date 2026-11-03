"""Check the database with a plain synchronous psycopg2 connection (no asyncpg).

Uses DATABASE_URL from secrets/backend.env, so no credentials live in this file.
"""
import psycopg2
from sqlalchemy.engine import make_url

import database

url = make_url(database.DATABASE_URL)
try:
    c = psycopg2.connect(
        host=url.host,
        port=url.port or 5432,
        database=url.database,
        user=url.username,
        password=url.password,
        sslmode="require",
    )
    cur = c.cursor()
    cur.execute("SELECT 1")
    print("psycopg2 sync OK:", cur.fetchone())
    c.close()
except Exception as e:
    print(f"psycopg2 error: {e}")
