import asyncio
import traceback
from sqlalchemy.future import select
from database import SessionLocal
import models
from security import verify_password

async def debug():
    try:
        async with SessionLocal() as session:
            result = await session.execute(select(models.User).where(models.User.username == "admin"))
            user = result.scalar_one_or_none()
            if user:
                print(f"User found: {user.username}, role: {user.role}")
                print(f"Hash: {user.password_hash[:20]}...")
                try:
                    valid = verify_password("admin1234", user.password_hash)
                    print(f"Password 'admin1234' valid: {valid}")
                except Exception as e:
                    print(f"verify_password error: {e}")
                    traceback.print_exc()
            else:
                print("No admin user found!")
    except Exception as e:
        print(f"DB error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(debug())
