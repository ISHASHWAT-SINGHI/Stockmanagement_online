import asyncio
import os
from sqlalchemy.future import select
from database import engine, SessionLocal
import models
from security import verify_password

async def check():
    async with SessionLocal() as session:
        result = await session.execute(select(models.User))
        users = result.scalars().all()
        for u in users:
            print(f"User: {u.username}, Role: {u.role}")
            # check if password is 'admin123'
            is_valid = verify_password("admin123", u.password_hash)
            print(f"  Valid 'admin123'?: {is_valid}")

if __name__ == "__main__":
    asyncio.run(check())
