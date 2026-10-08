import json
import re


INTENTS = {
    "GENERAL_CHAT",
    "MEMORY_QUERY",
    "FILE_SEARCH",
    "FILE_READ",
    "FILE_WRITE",
    "FILE_MOVE",
    "FILE_DELETE",
    "FILE_OPEN",
    "APP_OPEN",
    "APP_CLOSE",
    "SYSTEM_INFO",
    "PERFORMANCE_CHECK",
    "SCREEN_CAPTURE",
    "SCREEN_ANALYZE",
    "MOUSE_ACTION",
    "KEYBOARD_ACTION",
    "BROWSER_ACTION",
    "PROJECT_ANALYSIS",
    "BUG_ANALYSIS",
    "SECURITY_ANALYSIS",
    "FIX_REQUEST",
    "MULTI_STEP_TASK",
    "UNKNOWN",
}


ROUTER_PROMPT = """
You are ALEX's semantic intent and goal resolver.

The owner can speak:

English
Hindi
Hinglish
slang
abbreviations
typos
short messages
incomplete sentences

The owner may use references:

"isko"
"usko"
"wahi"
"ye"
"that"
"this"
"pehla wala"
"doosra wala"
"same file"
"jo abhi mila"

You MUST use the conversation context and known entities
to resolve those references.

Recent context:
{context}

Known entities:
{entities}

Owner message:
{message}

Available intents:
{intents}

Return ONLY JSON:

{{
  "intent": "...",
  "language": "en|hi|hinglish",
  "goal": "clear description of what the owner actually wants",
  "entities": {{
    "file": null,
    "app": null,
    "process": null,
    "url": null,
    "other": null
  }},
  "needs_confirmation": false,
  "complexity": "fast|deep",
  "confidence": 0.0
}}

Do not invent facts.
If the request is ordinary conversation, use GENERAL_CHAT.
If the request requires several actions, use MULTI_STEP_TASK.
"""


class IntentRouter:

    def __init__(
        self,
        gemini,
        context
    ):
        self.gemini = gemini
        self.ctx = context

    # ==========================================================
    # GEMINI CALL
    # ==========================================================

    def _generate(self, prompt):

        if hasattr(
            self.gemini,
            "generate"
        ):
            return self.gemini.generate(
                prompt,
                temperature=0.1,
                response_mime_type="application/json",
                timeout=8000,
                retries=2,
                chatMode=False,
            )

        if callable(
            self.gemini
        ):
            return self.gemini(
                prompt
            )

        raise RuntimeError(
            "Gemini router client is not callable."
        )

    # ==========================================================
    # JSON
    # ==========================================================

    @staticmethod
    def _parse(raw):

        if isinstance(
            raw,
            dict
        ):
            return raw

        if hasattr(
            raw,
            "text"
        ):
            raw = raw.text

        raw = str(
            raw or ""
        ).strip()

        try:
            return json.loads(
                raw
            )
        except Exception:
            pass

        match = re.search(
            r"\{[\s\S]*\}",
            raw
        )

        if match:
            try:
                return json.loads(
                    match.group(0)
                )
            except Exception:
                pass

        return {}

    # ==========================================================
    # FALLBACK
    # ==========================================================

    def _fallback(
        self,
        message
    ):
        text = str(
            message or ""
        ).strip()

        lower = text.lower()

        if any(
            x in lower
            for x in (
                "resume",
                "pdf",
                "file",
                "document",
                "folder",
                "downloads",
            )
        ):
            intent = "FILE_SEARCH"
        elif any(
            x in lower
            for x in (
                "chrome",
                "notepad",
                "explorer",
                "open app",
                "band karo",
                "close",
            )
        ):
            intent = (
                "APP_CLOSE"
                if any(
                    x in lower
                    for x in (
                        "band",
                        "close",
                    )
                )
                else "APP_OPEN"
            )
        else:
            intent = "GENERAL_CHAT"

        return {
            "intent": intent,
            "language": "hinglish",
            "goal": text,
            "entities": {},
            "needs_confirmation": False,
            "complexity": "fast",
            "confidence": 0.45,
        }

    # ==========================================================
    # ROUTE
    # ==========================================================

    def route(
        self,
        message
    ):
        message = str(
            message or ""
        ).strip()

        if not message:
            return self._fallback(
                message
            )

        block = self.ctx.context_block(
            n=8
        )

        prompt = ROUTER_PROMPT.format(
            context=json.dumps(
                block.get(
                    "recent",
                    ""
                ),
                ensure_ascii=False,
            ),
            entities=json.dumps(
                block.get(
                    "entities",
                    {}
                ),
                ensure_ascii=False,
            ),
            message=message,
            intents=", ".join(
                sorted(INTENTS)
            ),
        )

        try:
            raw = self._generate(
                prompt
            )

            decision = self._parse(
                raw
            )

            intent = str(
                decision.get(
                    "intent",
                    ""
                )
            ).upper()

            if intent not in INTENTS:
                return self._fallback(
                    message
                )

            decision["intent"] = intent

            decision.setdefault(
                "language",
                "hinglish"
            )

            decision.setdefault(
                "goal",
                message
            )

            decision.setdefault(
                "entities",
                {}
            )

            decision.setdefault(
                "needs_confirmation",
                False
            )

            decision.setdefault(
                "complexity",
                "deep"
            )

            decision.setdefault(
                "confidence",
                0.5
            )

            return decision

        except Exception:
            return self._fallback(
                message
            )