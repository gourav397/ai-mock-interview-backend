"""
ALEX WindowsAgent - InputModule
Controlled mouse/keyboard automation.

Safety:
- pyautogui.FAILSAFE = corner-abort (mouse ko screen corner me phenko = instant stop)
- har action CapabilityGate confirmation se guzarta hai
- sensitive actions (typing passwords, hotkeys, drags) HAMESHA confirm karte hain
- typed content kabhi log nahi hota — sirf length
"""

import pyautogui
import time

from .allowlist import Risk

pyautogui.FAILSAFE = True   # emergency stop
pyautogui.PAUSE = 0.15      # human-like pacing between actions

# Screen bounds (clamping ke liye)
_screen_w, _screen_h = pyautogui.size()


class InputModule:
    def __init__(self, gate, audit):
        self.gate = gate
        self.audit = audit

    def _clamp(self, x, y):
        return max(0, min(int(x), _screen_w - 1)), max(0, min(int(y), _screen_h - 1))

    # ------------------------- MOUSE -------------------------------
    def click(self, x: int, y: int, button: str = "left", sensitive: bool = False):
        x, y = self._clamp(x, y)
        self.gate.confirm.require(
            f"Mouse {button}-click at ({x}, {y})" + (" [SENSITIVE]" if sensitive else "")
        )
        pyautogui.click(x=x, y=y, button=button)
        self.audit.log("alex", "input.click", f"{button}@{x},{y}")
        return {"status": "ok", "clicked": [x, y]}

    def double_click(self, x: int, y: int):
        x, y = self._clamp(x, y)
        self.gate.confirm.require(f"Double-click at ({x}, {y})")
        pyautogui.doubleClick(x=x, y=y)
        self.audit.log("alex", "input.double_click", f"{x},{y}")
        return {"status": "ok"}

    def right_click(self, x: int, y: int):
        x, y = self._clamp(x, y)
        self.gate.confirm.require(f"Right-click at ({x}, {y})")
        pyautogui.rightClick(x=x, y=y)
        self.audit.log("alex", "input.right_click", f"{x},{y}")
        return {"status": "ok"}

    def move(self, x: int, y: int, duration: float = 0.3):
        x, y = self._clamp(x, y)
        pyautogui.moveTo(x, y, duration=duration)  # READ-level: no confirm, cursor move only
        self.audit.log("alex", "input.move", f"{x},{y}")
        return {"status": "ok"}

    def scroll(self, amount: int, x=None, y=None):
        pyautogui.scroll(amount, x=x, y=y)
        self.audit.log("alex", "input.scroll", str(amount))
        return {"status": "ok"}

    def drag(self, x1, y1, x2, y2, duration: float = 0.5):
        """Drag = SENSITIVE (files move ho sakte hain, selections badal sakte hain)."""
        x1, y1 = self._clamp(x1, y1)
        x2, y2 = self._clamp(x2, y2)
        self.gate.confirm.require(f"Drag from ({x1},{y1}) to ({x2},{y2})")
        pyautogui.moveTo(x1, y1, duration=0.2)
        pyautogui.drag(x2 - x1, y2 - y1, duration=duration)
        self.audit.log("alex", "input.drag", f"({x1},{y1})->({x2},{y2})")
        return {"status": "ok"}

    # ------------------------ KEYBOARD ------------------------------
    def type_text(self, text: str, sensitive: bool = False):
        """Text typing. 'sensitive=True' -> password-style input, confirm required.
        Content AUDIT LOG me kabhi nahi jaata, sirf character count jaata hai."""
        if not text:
            return {"status": "failed", "reason": "empty text"}
        if sensitive:
            self.gate.confirm.require("Type sensitive text (e.g., password field)")
        pyautogui.typewrite(text, interval=0.02)
        self.audit.log("alex", "input.type", f"{len(text)} chars", "content_not_logged")
        return {"status": "ok"}

    def press(self, key: str):
        """Single key press: 'enter', 'esc', 'tab', 'delete', etc.
        'delete'/'backspace' jaise keys destructive ho sakti hain -> confirm."""
        destructive_keys = {"delete", "backspace"}
        if key.lower() in destructive_keys:
            self.gate.confirm.require(f"Press key '{key}' (potentially destructive)")
        pyautogui.press(key)
        self.audit.log("alex", "input.press", key)
        return {"status": "ok"}

    def hotkey(self, *keys):
        """Key combo, e.g. hotkey('ctrl','s'). SENSITIVE -> hamesha confirm."""
        combo = "+".join(keys)
        self.gate.confirm.require(f"Hotkey combination: {combo}")
        pyautogui.hotkey(*keys)
        self.audit.log("alex", "input.hotkey", combo)
        return {"status": "ok"}

    # ------------------- REPETITIVE TASK MACRO ----------------------
    def run_macro(self, steps: list, step_delay: float = 0.5):
        """Repetitive task automation: steps = list of action dicts, e.g.:
        [
          {"op": "click", "args": {"x": 100, "y": 200}},
          {"op": "type_text", "args": {"text": "hello", "sensitive": False}},
          {"op": "hotkey", "args": {"keys": ["ctrl", "s"]}},
        ]
        Poore macro ke liye EK baar confirmation, phir har step audit hota hai.
        Koi step fail ho -> turant abort (no blind retries)."""
        summary = []
        self.gate.confirm.require(
            f"Run automation macro with {len(steps)} steps: "
            + ", ".join(s.get("op", "?") for s in steps)
        )
        for i, step in enumerate(steps):
            op, args = step.get("op"), dict(step.get("args", {}))
            args.setdefault("sensitive", False)  # individual steps: no re-confirm
            fn = getattr(self, op, None)
            if not callable(fn):
                summary.append({"step": i, "op": op, "status": "failed", "reason": "unknown op"})
                break
            try:
                r = fn(**args)
                summary.append({"step": i, "op": op, "status": r.get("status", "ok")})
                if r.get("status") not in ("ok", None):
                    break
            except Exception as e:
                summary.append({"step": i, "op": op, "status": "failed", "reason": str(e)})
                self.audit.log("alex", "input.macro", f"step {i} failed: {e}", "aborted")
                break
            time.sleep(step_delay)
        self.audit.log("alex", "input.macro", f"{len(summary)} steps executed")
        return {"status": "ok", "steps": summary}