import os, shutil, json, hashlib, datetime, uuid
from .gate import CapabilityGate
from .allowlist import Risk

class RecoveryManager:
    def __init__(self, backup_dir=os.path.expanduser(r"~\.alex_agent\backups")):
        self.dir = backup_dir; os.makedirs(self.dir, exist_ok=True)
    def backup(self, path):
        if not os.path.exists(path): return None
        bid = uuid.uuid4().hex[:12]
        dst = os.path.join(self.dir, bid + "_" + os.path.basename(path))
        shutil.copy2(path, dst)
        return {"id": bid, "original": path, "backup": dst}
    def restore(self, rec):
        if rec and os.path.exists(rec["backup"]):
            shutil.copy2(rec["backup"], rec["original"]); return True
        return False

class FileSystemModule:
    def __init__(self, gate: CapabilityGate, recovery: RecoveryManager, audit):
        self.gate = gate; self.rec = recovery; self.audit = audit

    def read(self, path):
        p = self.gate.check_path(path, Risk.READ)
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            self.audit.log("alex", "file.read", p); return f.read(200_000)

    def write(self, path, content):
        p = self.gate.check_path(path, Risk.SENSITIVE)
        bak = self.rec.backup(p)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        ok = os.path.exists(p) and hashlib.md5(content.encode()).hexdigest() == \
             hashlib.md5(open(p, "rb").read()).hexdigest()
        if not ok and self.rec.restore(bak):
            self.audit.log("alex", "file.write", p, "rolled_back")
            return {"status": "rolled_back"}
        self.audit.log("alex", "file.write", p)
        return {"status": "ok", "backup": bak}

    def delete(self, path):
        p = self.gate.check_path(path, Risk.DESTRUCTIVE)
        bak = self.rec.backup(p)
        os.remove(p)
        self.audit.log("alex", "file.delete", p, "backed_up")
        return {"status": "ok", "restore_id": bak["id"] if bak else None}

    def move(self, src, dst):
        s = self.gate.check_path(src, Risk.SENSITIVE)
        d = self.gate.check_path(dst, Risk.SENSITIVE)
        shutil.move(s, d)
        self.audit.log("alex", "file.move", f"{s} -> {d}"); return {"status": "ok"}

    def search(self, root, pattern):
        r = self.gate.check_path(root, Risk.READ)
        import glob
        return glob.glob(os.path.join(r, "**", pattern), recursive=True)[:100]