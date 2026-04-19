import asyncio
from sqlalchemy.future import select
from database import SessionLocal
import models
from security import get_password_hash

async def reset_password():
    async with SessionLocal() as session:
        result = await session.execute(select(models.User).where(models.User.username == "admin"))
        user = result.scalar_one_or_none()
        if user:
            user.password_hash = get_password_hash("admin123")
            user.must_change_password = True
            await session.commit()
            print("Successfully reset admin password to 'admin123'.")
        else:
            print("Admin user not found.")

if __name__ == "__main__":
    asyncio.run(reset_password())
