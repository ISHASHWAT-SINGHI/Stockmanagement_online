import psycopg2
try:
    c = psycopg2.connect(
        host="aws-1-ap-southeast-2.pooler.supabase.com",
        port=5432,
        database="postgres",
        user="postgres.rydlihjfjndlufdywmiu",
        password="Pradayini#3",
        sslmode="require"
    )
    cur = c.cursor()
    cur.execute("SELECT 1")
    print("psycopg2 sync OK:", cur.fetchone())
    c.close()
except Exception as e:
    print(f"psycopg2 error: {e}")
