# gate.py
import os
from .allowlist import Risk

class AccessDenied(Exception): pass

class CapabilityGate:
    def __init__(self, allowlist, auditor, confirmer):
        self.al = allowlist; self.audit = auditor; self.confirm = confirmer

    def check_path(self, path: str, risk: Risk):
        p = os.path.abspath(os.path.expanduser(path))
        for b in self.al.blocked_dirs:
            if p.lower().startswith(b.lower()):
                raise AccessDenied(f"Protected path: {p}")
        for r in self.al.roots:
            if p.lower().startswith(os.path.abspath(r.path).lower()):
                if risk == Risk.READ and r.read: return p
                if risk in (Risk.WRITE, Risk.SENSITIVE, Risk.DESTRUCTIVE) and r.write:
                    self.confirm.require(f"{risk.name}: modify {p}")
                    return p
        raise AccessDenied(f"Path outside authorized roots: {p}")

    def check_app(self, name: str):
        if name.lower() not in self.al.allowed_apps:
            raise AccessDenied(f"App not in allowlist: {name}")
        return self.al.allowed_apps[name.lower()]

    def check_command(self, cmd: str):
        if cmd.strip() not in self.al.approved_commands:
            raise AccessDenied(f"Command not approved: {cmd}")
        return cmd