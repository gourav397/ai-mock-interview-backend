import os
from enum import Enum
from dataclasses import dataclass, field

class Risk(Enum):
    READ = 0        # auto-allowed
    WRITE = 1       # auto-allowed inside authorized roots
    SENSITIVE = 2   # requires owner confirmation
    DESTRUCTIVE = 3 # requires confirmation + never auto-retried

@dataclass
class AuthorizedRoot:
    path: str
    read: bool = True
    write: bool = True

@dataclass
class Allowlist:
    roots: list[AuthorizedRoot] = field(default_factory=lambda: [
        AuthorizedRoot(os.path.expanduser(r"~\Documents")),
        AuthorizedRoot(os.path.expanduser(r"~\Downloads"), write=False),
        AuthorizedRoot(os.path.expanduser(r"~\Desktop")),
    ])
    allowed_apps: dict = field(default_factory=lambda: {
        "chrome":  r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "notepad": r"C:\Windows\System32\notepad.exe",
        "explorer": r"C:\Windows\explorer.exe",
        # add more apps the owner approves
    })
    blocked_dirs = {r"C:\Windows", r"C:\Program Files", os.path.expanduser(r"~\.ssh"),
                    os.path.expanduser(r"~\AppData\Local\Microsoft\Credentials")}
    approved_commands = {  # exact-match command layer, no arbitrary shell
        "ipconfig /all", "systeminfo", "tasklist", "whoami", "wmic os get caption",
    }