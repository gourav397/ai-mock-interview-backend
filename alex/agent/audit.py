# audit.py
import json, datetime, os, threading

class AuditLogger:
    def __init__(self, path=os.path.expanduser(r"~\.alex_agent\audit.jsonl")):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.path = path; self._lock = threading.Lock()
    def log(self, actor, action, detail, status="ok"):
        rec = {"ts": datetime.datetime.utcnow().isoformat(), "actor": actor,
               "action": action, "detail": detail, "status": status}
        with self._lock, open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")