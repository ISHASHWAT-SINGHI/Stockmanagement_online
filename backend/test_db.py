import asyncio
from database import verify_database_connection

async def test():
    try:
        url = await verify_database_connection()
        print(f"Success! URL: {url}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test())
