import os
import logging
# pyrefly: ignore [missing-import]
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

JWT_SECRET = os.environ.get("JWT_SECRET", "your-super-secret-jwt-token-with-at-least-32-characters-long")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "http://kong:8000")

def get_supabase_headers():
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

async def supabase_request(method: str, path: str, json_data: dict = None, params: dict = None):
    base_url = SUPABASE_URL.rstrip("/")
    url = f"{base_url}/rest/v1/{path}"
    headers = get_supabase_headers()
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            json=json_data,
            params=params,
            timeout=15.0
        )
    if response.status_code not in [200, 201, 204]:
        logger.error(f"Supabase REST error: {response.status_code} - {response.text}")
        raise HTTPException(status_code=502, detail=f"Database error: {response.text}")
    if response.status_code == 204:
        return []
    return response.json()

async def init_db():
    logger.info("Initializing connection to Supabase REST API...")
    base_url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
    }
    
    table_exists = False
    for i in range(10):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{base_url}/rest/v1/player_stats?select=id&limit=1",
                    headers=headers,
                    timeout=10.0
                )
            if response.status_code == 200:
                logger.info("Successfully connected to Supabase and verified 'player_stats' table.")
                table_exists = True
                break
            elif response.status_code == 404:
                logger.error("Error: 'player_stats' table not found on Supabase. Please create the table in your Supabase SQL Editor as defined in README.md.")
                break
            else:
                logger.error(f"Failed to connect to Supabase: Status {response.status_code} - {response.text}")
        except Exception as e:
            logger.error(f"Database connection attempt failed: {e}")
        import asyncio
        await asyncio.sleep(3)
        
    if not table_exists:
        logger.warning("Could not verify player_stats table on Supabase. Application will proceed, but database operations may fail until the table is created.")
        return
        
    # Seed/generate players if count < 100
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/rest/v1/player_stats?select=id",
                headers=headers,
                timeout=15.0
            )
        if response.status_code == 200:
            players = response.json()
            player_count = len(players)
            logger.info(f"Current players count in Supabase: {player_count}")
            if player_count < 100:
                logger.info("Generating and seeding randomized football players to Supabase...")
                import random
                first_names = ["Jan", "Adam", "Piotr", "Krzysztof", "Tomasz", "Andrzej", "Michał", "Jakub", "Mariusz", "Marcin", 
                               "Robert", "Grzegorz", "Łukasz", "Rafał", "Zbigniew", "Wojciech", "Maciej", "Paweł", "Kamil", "Sebastian",
                               "David", "John", "Marco", "Lionel", "Cristiano", "Kylian", "Erling", "Luka", "Thomas", "Thierry",
                               "Zlatan", "Luis", "Neymar", "Karim", "Mohamed", "Harry", "Sadio", "Antoine", "Olivier", "Hugo"]
                last_names = ["Kowalski", "Nowak", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak",
                              "Dąbrowski", "Kozłowski", "Mazur", "Jankowski", "Kwiatkowski", "Wojciechowski", "Krawczyk", "Kaczmarek", "Piotrowski", "Grabowski",
                              "Smith", "Jones", "Messi", "Ronaldo", "Mbappe", "Haaland", "Modric", "Muller", "Zidane", "Henry",
                              "Ibrahimovic", "Suarez", "Neymar", "Benzema", "Salah", "Kane", "Mane", "Rooney", "Gerrard", "Lampard"]
                
                async with httpx.AsyncClient() as client:
                    res = await client.get(
                        f"{base_url}/rest/v1/player_stats?select=name,email",
                        headers=headers,
                        timeout=15.0
                    )
                db_rows = res.json() if res.status_code == 200 else []
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
                        players_to_insert.append({
                            "name": name,
                            "email": email,
                            "password": password,
                            "goals": goals,
                            "misses": misses
                        })
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
                        players_to_insert.append({
                            "name": name,
                            "email": email,
                            "password": password,
                            "goals": goals,
                            "misses": misses
                        })
                        
                if players_to_insert:
                    async with httpx.AsyncClient() as client:
                        res_insert = await client.post(
                            f"{base_url}/rest/v1/player_stats",
                            headers={
                                **headers,
                                "Content-Type": "application/json",
                                "Prefer": "resolution=ignore-duplicates"
                            },
                            json=players_to_insert,
                            timeout=30.0
                        )
                    if res_insert.status_code in [200, 201, 204]:
                        logger.info("Successfully generated and seeded players on Supabase.")
                    else:
                        logger.error(f"Seeding failed: {res_insert.status_code} - {res_insert.text}")
    except Exception as ex:
        logger.error(f"Error during remote seeding: {ex}")

@app.on_event("startup")
async def startup_event():
    await init_db()

# Token verification dependency
async def verify_token(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization Header")
    
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header format")
    token = parts[1]
    
    # 1. Try local decoding first (for backwards compatibility/local testing)
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False}
        )
        return payload
    except Exception as e:
        logger.info(f"Local token decoding failed or bypassed: {e}. Trying remote Supabase Auth verification...")
        
    # 2. Fallback to calling Supabase Auth API
    try:
        headers = {
            "Authorization": authorization,
            "apikey": SUPABASE_ANON_KEY
        }
        base_url = SUPABASE_URL.rstrip("/")
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/auth/v1/user", headers=headers, timeout=10.0)
            
        if response.status_code == 200:
            user_data = response.json()
            return {
                "email": user_data.get("email"),
                "sub": user_data.get("id"),
                "aud": user_data.get("aud")
            }
        else:
            logger.error(f"Supabase Auth token verification failed with status {response.status_code}: {response.text}")
            raise HTTPException(status_code=401, detail="Invalid token (failed remote verification)")
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Error during remote Supabase token verification: {ex}")
        raise HTTPException(status_code=401, detail=f"Token verification error: {str(ex)}")

class KickRequest(BaseModel):
    player_id: int
    result: str # "goal" or "miss"

class ProfileRequest(BaseModel):
    name: str
    email: str
    password: str

@app.post("/api/register_profile")
async def register_profile(request: ProfileRequest):
    try:
        # Check if player exists by email
        players = await supabase_request("GET", "player_stats", params={"email": f"eq.{request.email}", "select": "id"})
        if players:
            player_id = players[0]["id"]
            await supabase_request(
                "PATCH", 
                "player_stats", 
                json_data={"name": request.name, "password": request.password}, 
                params={"id": f"eq.{player_id}"}
            )
            return {"status": "updated", "player_id": player_id}
        else:
            res = await supabase_request(
                "POST", 
                "player_stats", 
                json_data={
                    "name": request.name, 
                    "email": request.email, 
                    "password": request.password, 
                    "goals": 0, 
                    "misses": 0
                }
            )
            if res:
                return {"status": "success", "player_id": res[0]["id"]}
            raise HTTPException(status_code=500, detail="Failed to retrieve inserted player ID")
    except Exception as e:
        logger.error(f"Error registering profile: {e}")
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

@app.get("/api/profile")
async def get_profile(payload: dict = Depends(verify_token)):
    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload: missing email")
        
    try:
        players = await supabase_request("GET", "player_stats", params={"email": f"eq.{email}"})
        if not players:
            # Auto-insert profile with dummy nickname if registered in Supabase but not sync'd yet
            dummy_name = email.split("@")[0]
            res = await supabase_request(
                "POST", 
                "player_stats", 
                json_data={
                    "name": dummy_name, 
                    "email": email, 
                    "password": "", 
                    "goals": 0, 
                    "misses": 0
                }
            )
            if res:
                return res[0]
            raise HTTPException(status_code=500, detail="Failed to create user profile")
        return players[0]
    except Exception as e:
        logger.error(f"Failed to fetch profile: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve user profile")

@app.get("/api/leaderboard")
async def get_leaderboard():
    try:
        players = await supabase_request("GET", "player_stats", params={"select": "id,name,email,password,goals,misses"})
        
        def sort_key(player):
            goals = player.get("goals", 0) or 0
            misses = player.get("misses", 0) or 0
            total = goals + misses
            ratio = float(goals) / total if total > 0 else 0.0
            return (-ratio, -goals, (player.get("name") or "").lower())
            
        players.sort(key=sort_key)
        return players
    except Exception as e:
        logger.error(f"Error fetching leaderboard: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch leaderboard: {str(e)}")

@app.post("/api/kick")
async def register_kick(request: KickRequest, payload: dict = Depends(verify_token)):
    if request.result not in ["goal", "miss"]:
        raise HTTPException(status_code=400, detail="Invalid result value. Must be 'goal' or 'miss'")
        
    try:
        # Verify the player exists
        players = await supabase_request("GET", "player_stats", params={"id": f"eq.{request.player_id}"})
        if not players:
            raise HTTPException(status_code=404, detail="Player not found")
            
        player = players[0]
        goals = player.get("goals", 0) or 0
        misses = player.get("misses", 0) or 0
        
        if request.result == "goal":
            goals += 1
        else:
            misses += 1
            
        # Update stats in Supabase
        res = await supabase_request(
            "PATCH", 
            "player_stats", 
            json_data={"goals": goals, "misses": misses}, 
            params={"id": f"eq.{request.player_id}"}
        )
        if res:
            return {"status": "success", "player": res[0]}
        return {"status": "success", "player": {"id": request.player_id, "name": player.get("name"), "goals": goals, "misses": misses}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering kick: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to register kick: {str(e)}")

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
