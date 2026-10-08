from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .auth import ensure_pairing, verify
from .audit import AuditLogger
from .allowlist import Allowlist
from .gate import CapabilityGate, AccessDenied
from .confirm import ConfirmationBroker
from .files import FileSystemModule, RecoveryManager
from .apps import AppControlModule, SystemModule
from .screen import ScreenModule
from .input import InputModule

ensure_pairing()
audit = AuditLogger()
confirm = ConfirmationBroker(audit)
gate = CapabilityGate(Allowlist(), audit, confirm)
recovery = RecoveryManager()
app = FastAPI(title="ALEX WindowsAgent", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

mods = {
    "fs": FileSystemModule(gate, recovery, audit),
    "apps": AppControlModule(gate, audit),
    "sys": SystemModule(gate, audit),
    "screen": ScreenModule(gate, audit, vision_fn=lambda b64, q: None),  # wire to your vision model
    "input": InputModule(gate, audit),
}

def authz(authorization: str):
    if not authorization.startswith("Bearer ") or not verify(authorization[7:]):
        raise HTTPException(401, "Unauthorized")
    return True

class Req(BaseModel):
    tool: str; args: dict = {}

@app.post("/agent/execute")
def execute(req: Req, authorization: str = Header("")):
    authz(authorization)
    mod, _, fn = req.tool.partition(".")
    try:
        result = getattr(mods[mod], fn)(**req.args)
        return {"status": "ok", "result": result}
    except AccessDenied as e:
        audit.log("alex", req.tool, str(e), "denied")
        return {"status": "denied", "reason": str(e)}
    except PermissionError as e:
        return {"status": "needs_confirmation", "reason": str(e)}
    except FileNotFoundError:
        return {"status": "failed", "reason": "not found"}   # report failure, never pretend success