import os
import secrets
import base64
import hmac
import hashlib
import json

def base64url_encode(data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    return base64.urlsafe_b64encode(data).replace(b'=', b'').decode('utf-8')

def sign_jwt(payload, secret):
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64url_encode(json.dumps(header))
    payload_b64 = base64url_encode(json.dumps(payload))
    message = f"{header_b64}.{payload_b64}"
    
    signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).replace(b'=', b'').decode('utf-8')
    
    return f"{message}.{signature_b64}"

def main():
    print("Generating secure keys for Supabase configuration...")
    
    # Generate random strings
    postgres_password = secrets.token_hex(16)
    jwt_secret = secrets.token_hex(32)
    secret_key_base = secrets.token_hex(32) # 64 characters in hex
    realtime_db_enc_key = secrets.token_hex(8) # 16 characters in hex
    vault_enc_key = secrets.token_hex(16) # 32 characters in hex
    pg_meta_crypto_key = secrets.token_hex(16) # 32 characters in hex
    logflare_public_token = secrets.token_hex(16)
    logflare_private_token = secrets.token_hex(16)
    s3_key_id = secrets.token_hex(8)
    s3_key_secret = secrets.token_hex(16)
    
    # Sign JWTs matching Supabase payload specs
    # Standard values for iat and exp from env.example
    anon_payload = {
        "role": "anon",
        "iss": "supabase-demo",
        "iat": 1641769200,
        "exp": 1799535600
    }
    service_role_payload = {
        "role": "service_role",
        "iss": "supabase-demo",
        "iat": 1641769200,
        "exp": 1799535600
    }
    
    anon_key = sign_jwt(anon_payload, jwt_secret)
    service_role_key = sign_jwt(service_role_payload, jwt_secret)
    
    # Read env.example
    with open(".env.example", "r", encoding="utf-8") as f:
        content = f.read()
        
    lines = content.splitlines()
    new_lines = []
    for line in lines:
        if line.startswith("POSTGRES_PASSWORD="):
            new_lines.append(f"POSTGRES_PASSWORD={postgres_password}")
        elif line.startswith("JWT_SECRET="):
            new_lines.append(f"JWT_SECRET={jwt_secret}")
        elif line.startswith("ANON_KEY="):
            new_lines.append(f"ANON_KEY={anon_key}")
        elif line.startswith("SERVICE_ROLE_KEY="):
            new_lines.append(f"SERVICE_ROLE_KEY={service_role_key}")
        elif line.startswith("SECRET_KEY_BASE="):
            new_lines.append(f"SECRET_KEY_BASE={secret_key_base}")
        elif line.startswith("REALTIME_DB_ENC_KEY="):
            new_lines.append(f"REALTIME_DB_ENC_KEY={realtime_db_enc_key}")
        elif line.startswith("VAULT_ENC_KEY="):
            new_lines.append(f"VAULT_ENC_KEY={vault_enc_key}")
        elif line.startswith("PG_META_CRYPTO_KEY="):
            new_lines.append(f"PG_META_CRYPTO_KEY={pg_meta_crypto_key}")
        elif line.startswith("LOGFLARE_PUBLIC_ACCESS_TOKEN="):
            new_lines.append(f"LOGFLARE_PUBLIC_ACCESS_TOKEN={logflare_public_token}")
        elif line.startswith("LOGFLARE_PRIVATE_ACCESS_TOKEN="):
            new_lines.append(f"LOGFLARE_PRIVATE_ACCESS_TOKEN={logflare_private_token}")
        elif line.startswith("S3_PROTOCOL_ACCESS_KEY_ID="):
            new_lines.append(f"S3_PROTOCOL_ACCESS_KEY_ID={s3_key_id}")
        elif line.startswith("S3_PROTOCOL_ACCESS_KEY_SECRET="):
            new_lines.append(f"S3_PROTOCOL_ACCESS_KEY_SECRET={s3_key_secret}")
        elif line.startswith("SITE_URL="):
            new_lines.append("SITE_URL=http://localhost:8888")
        elif line.startswith("ENABLE_EMAIL_AUTOCONFIRM="):
            new_lines.append("ENABLE_EMAIL_AUTOCONFIRM=true")
        else:
            new_lines.append(line)
            
    # Write to .env
    with open(".env", "w", encoding="utf-8") as f:
        f.write("\n".join(new_lines) + "\n")
        
    print(".env file generated successfully.")

if __name__ == "__main__":
    main()
