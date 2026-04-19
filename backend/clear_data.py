import asyncio
from sqlalchemy import text
from database import engine
from models import Base

async def clear_all_data():
    tables = list(Base.metadata.tables.keys())
    if not tables:
        print("No tables found to truncate.")
        return

    table_names = ", ".join(tables)
    # TRUNCATE CASCADE will delete data from listed tables and any other tables referencing them.
    # RESTART IDENTITY resets the primary key sequences to start from 1.
    truncate_query = f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE;"
    
    print(f"Executing: {truncate_query}")

    async with engine.begin() as conn:
        # In asyncpg/SQLAlchemy async engine, we can execute arbitrary text
        await conn.execute(text(truncate_query))
        
    print("\n✅ All data cleared and IDs reset successfully!")

if __name__ == "__main__":
    asyncio.run(clear_all_data())
