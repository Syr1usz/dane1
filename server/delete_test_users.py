import asyncio
import asyncpg
import sys
import os

def load_postgres_password():
    # Attempt to load password from .env file to avoid hardcoding
    possible_paths = ['.env', '../.env', 'server/.env', '/app/.env']
    for path in possible_paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    for line in f:
                        if line.strip().startswith('POSTGRES_PASSWORD='):
                            return line.split('=', 1)[1].strip()
            except Exception:
                pass
    return os.environ.get("POSTGRES_PASSWORD", "postgres")

POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_PASSWORD = load_postgres_password()
DATABASE_URL = f"postgresql://postgres:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/postgres"

async def main():
    if len(sys.argv) < 2:
        print("Usage: python delete_test_users.py <email_to_delete>")
        print("Example: python delete_test_users.py piotr.regen@gmail.com")
        return
        
    email_to_delete = sys.argv[1]
    print(f"Connecting to database at {POSTGRES_HOST}:{POSTGRES_PORT}...")
    
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Delete from auth.users (cascade will handle child tables in auth schema)
        res1 = await conn.execute("DELETE FROM auth.users WHERE email = $1", email_to_delete)
        print(f"DELETED FROM auth.users: {res1}")
        
        # Delete from player_stats
        res2 = await conn.execute("DELETE FROM player_stats WHERE email = $1", email_to_delete)
        print(f"DELETED FROM player_stats: {res2}")
        
    except Exception as e:
        print("ERROR:", e)
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
