# confirm.py — the confirmation surfaces in the ALEX chat the owner already uses
class ConfirmationBroker:
    def __init__(self, audit):
        self.audit = audit; self.pending = {}
    def require(self, description) -> bool:
        # In production: push a confirmation card to the ALEX web UI / system tray
        # and block until the owner clicks Approve/Deny. Simplified console version:
        print(f"\n[ALEX-AGENT] Confirmation required:\n  {description}\nApprove? (y/n) ")
        ok = input().strip().lower() == "y"
        self.audit.log("owner", "confirmation", description, "approved" if ok else "denied")
        if not ok: raise PermissionError(f"Owner denied: {description}")
        return True