import base64, io
from PIL import Image
import mss, pyautogui
pyautogui.FAILSAFE = True  # slam mouse to corner = emergency stop
pyautogui.PAUSE = 0.15

class ScreenModule:
    def __init__(self, gate, audit, vision_fn):
        self.gate = gate; self.audit = audit; self.vision = vision_fn
    def capture_and_analyze(self, question="Describe the UI and clickable elements."):
        with mss.mss() as s:
            shot = s.grab(s.monitors[1])
        img = Image.frombytes("RGB", shot.size, shot.bgra)
        buf = io.BytesIO(); img.save(buf, "PNG")
        self.audit.log("alex", "screen.capture", f"{shot.size}")
        # vision_fn sends the screenshot to your ALEX vision model with the question
        return self.vision(base64.b64encode(buf.getvalue()).decode(), question)

class InputModule:
    """Every method below requires confirmation for the first action in a burst;
    'sensitive' (typing passwords, delete-key sequences, drag) always confirms."""
    def __init__(self, gate, audit):
        self.gate = gate; self.audit = audit
    def click(self, x, y, sensitive=False):
        from .allowlist import Risk
        self.gate.confirm.require(f"Mouse click at ({x},{y})" if sensitive
                                  else f"Click at ({x},{y})")
        pyautogui.click(x, y); self.audit.log("alex", "input.click", f"{x},{y}")
    def type_text(self, text, sensitive=False):
        if sensitive:
            self.gate.confirm.require("Type sensitive text")
        pyautogui.typewrite(text, interval=0.02)
        self.audit.log("alex", "input.type", f"{len(text)} chars")  # never log content
    def scroll(self, amount): pyautogui.scroll(amount)
    def hotkey(self, *keys): self.gate.confirm.require(f"Hotkey {keys}"); pyautogui.hotkey(*keys)