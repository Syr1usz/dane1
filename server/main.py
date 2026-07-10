import os
import logging
from fastapi import FastAPI, HTTPException, Header, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import asyncpg
import jwt
import httpx


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fastapi-server")

app = FastAPI(title="Penalty Shootout API")

# Enable CORS for convenience
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

postgres_host = os.environ.get("POSTGRES_HOST", "localhost")
postgres_port = os.environ.get("POSTGRES_PORT", "5432")
postgres_db = os.environ.get("POSTGRES_DB", "postgres")
postgres_password = os.environ.get("POSTGRES_PASSWORD", "postgres")
DATABASE_URL = f"postgresql://postgres:{postgres_password}@{postgres_host}:{postgres_port}/{postgres_db}"

JWT_SECRET = os.environ.get("JWT_SECRET", "your-super-secret-jwt-token-with-at-least-32-characters-long")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://kong:8000")

db_pool = None

async def init_db():
    global db_pool
    # Try connecting to the database with a retry loop
    for i in range(10):
        try:
            logger.info(f"Connecting to database (attempt {i+1}/10)...")
            db_pool = await asyncpg.create_pool(DATABASE_URL)
            break
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            import asyncio
            await asyncio.sleep(3)
    
    if not db_pool:
        raise RuntimeError("Could not connect to database after 10 attempts")
        
    # Create tables
    async with db_pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS player_stats (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                goals INTEGER DEFAULT 0,
                misses INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        # Ensure email has a unique constraint
        try:
            await conn.execute("ALTER TABLE player_stats ADD CONSTRAINT unique_email UNIQUE (email);")
        except Exception:
            pass
            
        # Seed Robert Lewandowski with 100 goals
        lewy_id = await conn.fetchval("SELECT id FROM player_stats WHERE name = 'Robert Lewandowski'")
        if lewy_id:
            await conn.execute("UPDATE player_stats SET goals = 100, misses = 0 WHERE id = $1", lewy_id)
            
        # Check total player count. If less than 100 or lacks famous players, generate 300 players
        has_messi = await conn.fetchval("SELECT COUNT(*) FROM player_stats WHERE name = 'Lionel Messi'")
        if has_messi == 0:
            logger.info("Database lacks famous players. Re-seeding database...")
            await conn.execute("TRUNCATE player_stats RESTART IDENTITY;")
            
        player_count = await conn.fetchval("SELECT COUNT(*) FROM player_stats")
        if player_count < 100:
            logger.info("Generating 300 randomized football players for the database...")
            import random
            first_names = ["Jan", "Adam", "Piotr", "Krzysztof", "Tomasz", "Andrzej", "Michał", "Jakub", "Mariusz", "Marcin", 
                           "Robert", "Grzegorz", "Łukasz", "Rafał", "Zbigniew", "Wojciech", "Maciej", "Paweł", "Kamil", "Sebastian",
                           "David", "John", "Marco", "Lionel", "Cristiano", "Kylian", "Erling", "Luka", "Thomas", "Thierry",
                           "Zlatan", "Luis", "Neymar", "Karim", "Mohamed", "Harry", "Sadio", "Antoine", "Olivier", "Hugo"]
            last_names = ["Kowalski", "Nowak", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak",
                          "Dąbrowski", "Kozłowski", "Mazur", "Jankowski", "Kwiatkowski", "Wojciechowski", "Krawczyk", "Kaczmarek", "Piotrowski", "Grabowski",
                          "Smith", "Jones", "Messi", "Ronaldo", "Mbappe", "Haaland", "Modric", "Muller", "Zidane", "Henry",
                          "Ibrahimovic", "Suarez", "Neymar", "Benzema", "Salah", "Kane", "Mane", "Rooney", "Gerrard", "Lampard"]
            
            db_rows = await conn.fetch("SELECT name, email FROM player_stats")
            existing_names = {r["name"] for r in db_rows}
            existing_emails = {r["email"] for r in db_rows}
            
            players_to_insert = []
            famous_players = [
                ("Robert Lewandowski", "lewy@rl9.com", "lewy", 100, 0),
                ("Lionel Messi", "messi@barca.com", "messi123", 95, 5),
                ("Cristiano Ronaldo", "cr7@alnasr.com", "siuuu7", 94, 6),
                ("Kylian Mbappé", "mbappe@psg.com", "ninja10", 90, 10),
                ("Erling Haaland", "haaland@city.com", "terminator", 88, 8),
                ("Neymar Jr", "neymar@psg.com", "samba10", 85, 12),
                ("Kevin De Bruyne", "kdb@city.com", "ginger8", 82, 11),
                ("Luka Modrić", "modric@real.com", "luka10", 80, 10),
                ("Mohamed Salah", "salah@liverpool.com", "pharaoh11", 87, 13),
                ("Karim Benzema", "benzema@ittihad.com", "karim9", 86, 12),
                ("Zlatan Ibrahimović", "zlatan@milan.com", "lion", 89, 15),
                ("Harry Kane", "kane@bayern.com", "harry9", 84, 10),
                ("Ronaldinho", "ronaldinho@milan.com", "joga10", 91, 14),
                ("Zinedine Zidane", "zidane@real.com", "zizou", 83, 12),
                ("Luis Suárez", "suarez@miami.com", "pistolero", 88, 16)
            ]
            
            for name, email, password, goals, misses in famous_players:
                if name not in existing_names and email not in existing_emails:
                    players_to_insert.append((name, email, password, goals, misses))
                    existing_names.add(name)
                    existing_emails.add(email)
                
            rng = random.Random(42)
            while len(players_to_insert) + len(existing_names) < 300:
                fn = rng.choice(first_names)
                ln = rng.choice(last_names)
                name = f"{fn} {ln}"
                email = f"{fn.lower()}.{ln.lower()}{rng.randint(10, 99)}@shootout.com"
                if name not in existing_names and email not in existing_emails:
                    existing_names.add(name)
                    existing_emails.add(email)
                    password = f"secret{rng.randint(100, 999)}"
                    goals = rng.randint(5, 95)
                    misses = rng.randint(5, 50)
                    players_to_insert.append((name, email, password, goals, misses))
            
            if players_to_insert:
                await conn.executemany("""
                    INSERT INTO player_stats (name, email, password, goals, misses)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (email) DO NOTHING;
                """, players_to_insert)
            logger.info("Successfully generated and seeded 300 players.")
            
        logger.info("Database initialized.")

@app.on_event("startup")
async def startup_event():
    await init_db()

@app.on_event("shutdown")
async def shutdown_event():
    global db_pool
    if db_pool:
        await db_pool.close()

# Token verification dependency
def verify_token(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization Header")
    try:
        parts = authorization.split(" ")
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authorization header format")
        token = parts[1]
        
        # Decode the token
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False}
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

class KickRequest(BaseModel):
    player_id: int
    result: str # "goal" or "miss"

class ProfileRequest(BaseModel):
    name: str
    email: str
    password: str

@app.post("/api/register_profile")
async def register_profile(request: ProfileRequest):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database connection not ready")
    async with db_pool.acquire() as conn:
        try:
            existing = await conn.fetchrow("SELECT id FROM player_stats WHERE email = $1", request.email)
            if existing:
                await conn.execute("UPDATE player_stats SET name = $1, password = $2 WHERE id = $3", request.name, request.password, existing["id"])
                return {"status": "updated", "player_id": existing["id"]}
            player_id = await conn.fetchval(
                "INSERT INTO player_stats (name, email, password, goals, misses) VALUES ($1, $2, $3, 0, 0) RETURNING id",
                request.name, request.email, request.password
            )
            return {"status": "success", "player_id": player_id}
        except Exception as e:
            logger.error(f"Error registering profile: {e}")
            raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

@app.get("/api/profile")
async def get_profile(payload: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database connection not ready")
    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload: missing email")
        
    async with db_pool.acquire() as conn:
        profile = await conn.fetchrow("SELECT id, name, email, password, goals, misses FROM player_stats WHERE email = $1", email)
        if not profile:
            # Auto-insert profile with dummy nickname if registered in Supabase but not sync'd yet
            dummy_name = email.split("@")[0]
            try:
                profile_id = await conn.fetchval(
                    "INSERT INTO player_stats (name, email, password, goals, misses) VALUES ($1, $2, '', 0, 0) RETURNING id",
                    dummy_name, email
                )
                new_profile = await conn.fetchrow("SELECT id, name, email, password, goals, misses FROM player_stats WHERE id = $1", profile_id)
                return dict(new_profile)
            except Exception as e:
                logger.error(f"Failed to auto-create profile: {e}")
                raise HTTPException(status_code=500, detail="Failed to create user profile")
        return dict(profile)

@app.get("/api/leaderboard")
async def get_leaderboard():
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database connection not ready")
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, email, password, goals, misses 
            FROM player_stats 
            ORDER BY 
                CASE WHEN (goals + misses) = 0 THEN 0.0 ELSE goals::float / (goals + misses) END DESC, 
                goals DESC, 
                name ASC
        """)
        return [dict(r) for r in rows]

@app.post("/api/kick")
async def register_kick(request: KickRequest, payload: dict = Depends(verify_token)):
    if not db_pool:
        raise HTTPException(status_code=500, detail="Database connection not ready")
    if request.result not in ["goal", "miss"]:
        raise HTTPException(status_code=400, detail="Invalid result value. Must be 'goal' or 'miss'")
        
    async with db_pool.acquire() as conn:
        # Verify the player exists
        player = await conn.fetchrow("SELECT id FROM player_stats WHERE id = $1", request.player_id)
        if not player:
            raise HTTPException(status_code=404, detail="Player not found")
            
        if request.result == "goal":
            await conn.execute("UPDATE player_stats SET goals = goals + 1 WHERE id = $1", request.player_id)
        else:
            await conn.execute("UPDATE player_stats SET misses = misses + 1 WHERE id = $1", request.player_id)
            
        updated_player = await conn.fetchrow("SELECT id, name, goals, misses FROM player_stats WHERE id = $1", request.player_id)
        return {"status": "success", "player": dict(updated_player)}

# Initialize async client for proxy
http_client = httpx.AsyncClient()

@app.get("/api/config")
async def get_config():
    return {
        "supabaseAnonKey": SUPABASE_ANON_KEY
    }

@app.api_route("/supabase/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"])
async def proxy_supabase(path: str, request: Request):
    url = f"{SUPABASE_URL}/{path}"
    query_params = dict(request.query_params)
    body = await request.body()
    
    headers = {}
    for k, v in request.headers.items():
        if k.lower() not in ["host", "content-length"]:
            headers[k] = v
            
    try:
        response = await http_client.request(
            method=request.method,
            url=url,
            headers=headers,
            params=query_params,
            content=body,
            timeout=30.0
        )
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers)
        )
    except Exception as e:
        logger.error(f"Proxy error: {e}")
        raise HTTPException(status_code=502, detail=f"Proxy error: {str(e)}")

# Serve static files for frontend. Mount static files at root
app.mount("/", StaticFiles(directory="static", html=True), name="static")
