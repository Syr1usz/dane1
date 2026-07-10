import asyncio
import asyncpg
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
    print(f"Connecting to database at {POSTGRES_HOST}:{POSTGRES_PORT}...")
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        users = await conn.fetch("SELECT id, email, encrypted_password, email_confirmed_at, confirmed_at FROM auth.users")
        print("USERS IN auth.users:")
        for u in users:
            print(f"  {u['email']}: {u['encrypted_password']} (Confirmed: {u['confirmed_at']})")
            
        stats = await conn.fetch("SELECT id, name, email, goals, misses FROM player_stats")
        print("\nUSERS IN public.player_stats:")
        for s in stats:
            print(f"  {s['name']} ({s['email']}): Goals={s['goals']}, Misses={s['misses']}")
            
        await conn.close()
    except Exception as e:
        print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
