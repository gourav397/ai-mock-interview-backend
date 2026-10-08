import secrets, hashlib, os, json

TOKEN_PATH = os.path.expanduser(r"~\.alex_agent\pairing.json")

def ensure_pairing():
    os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
    if not os.path.exists(TOKEN_PATH):
        token = secrets.token_urlsafe(32)
        with open(TOKEN_PATH, "w") as f:
            json.dump({"token_hash": hashlib.sha256(token.encode()).hexdigest()}, f)
        print("PAIRING TOKEN (shown once, paste into ALEX web settings):", token)

def verify(token: str) -> bool:
    try:
        with open(TOKEN_PATH) as f:
            h = hashlib.sha256(token.encode()).hexdigest()
            return secrets.compare_digest(h, json.load(f)["token_hash"])
    except Exception:
        return False