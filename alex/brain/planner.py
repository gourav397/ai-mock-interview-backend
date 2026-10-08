import json
from dataclasses import dataclass, field


@dataclass
class Step:
    action: str
    params: dict = field(default_factory=dict)

    verify: str | None = None
    on_fail: str | None = None

    needs_confirmation: bool = False

    result: dict | None = None
    verified: bool = False


PLANNER_PROMPT = """
You are ALEX's task planner.

The owner gives a goal in English, Hindi or Hinglish.

Convert the goal into the SMALLEST useful sequence of
authorized tool calls.

Available tools:

fs.search
fs.read
fs.write
fs.move
fs.delete
fs.open
app.open
app.close
app.list
sys.info
sys.processes
screen.capture
screen.analyze
mouse.click
keyboard.type
browser.open
browser.read_page

Rules:

1. Do not invent tools.
2. Prefer deterministic/simple tools.
3. Use context entities when available.
4. Do not ask the owner for information that can safely
   be discovered using an authorized tool.
5. Mutating operations require verification.
6. Destructive/sensitive operations require confirmation.
7. Keep the plan short.
8. If a task is already completed, do not repeat it.
9. Do not claim success; execution will verify it.

GOAL:
{goal}

ENTITIES:
{entities}

OWNER PREFERENCES:
{prefs}

Return ONLY valid JSON:

[
  {{
    "action": "tool.name",
    "params": {{}},
    "verify": "tool.name or null",
    "on_fail": "tool.name or null",
    "needs_confirmation": false
  }}
]
"""


class TaskPlanner:

    def __init__(
        self,
        gemini,
        context
    ):
        self.gemini = gemini
        self.ctx = context

    # ==========================================================
    # GEMINI COMPATIBILITY
    # ==========================================================

    def _generate(self, prompt):
        """
        Supports common Gemini wrapper styles.
        """

        if hasattr(
            self.gemini,
            "generate"
        ):
            return self.gemini.generate(
                prompt,
                temperature=0.0,
                response_mime_type="application/json",
                timeout=10000,
                retries=2,
            )

        if callable(
            self.gemini
        ):
            return self.gemini(
                prompt
            )

        raise RuntimeError(
            "Gemini planner client is not callable."
        )

    # ==========================================================
    # JSON EXTRACTION
    # ==========================================================

    @staticmethod
    def _extract_json(raw):
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

        if not raw:
            return []

        try:
            return json.loads(
                raw
            )
        except Exception:
            pass

        start = raw.find("[")
        end = raw.rfind("]")

        if start >= 0 and end > start:
            try:
                return json.loads(
                    raw[start:end + 1]
                )
            except Exception:
                pass

        return []

    # ==========================================================
    # PLAN
    # ==========================================================

    def plan(
        self,
        goal,
        entities=None
    ):
        goal = str(
            goal or ""
        ).strip()

        if not goal:
            return []

        prompt = PLANNER_PROMPT.format(
            goal=goal,
            entities=json.dumps(
                entities or {},
                ensure_ascii=False,
            ),
            prefs=json.dumps(
                self.ctx.prefs or {},
                ensure_ascii=False,
            ),
        )

        try:
            raw = self._generate(
                prompt
            )

            payload = self._extract_json(
                raw
            )

            if isinstance(
                payload,
                dict
            ):
                payload = payload.get(
                    "steps",
                    []
                )

            if not isinstance(
                payload,
                list
            ):
                return []

            steps = []

            for item in payload[:7]:
                if not isinstance(
                    item,
                    dict
                ):
                    continue

                action = str(
                    item.get(
                        "action",
                        ""
                    )
                ).strip()

                if not action:
                    continue

                steps.append(
                    Step(
                        action=action,
                        params=item.get(
                            "params",
                            {}
                        ) or {},
                        verify=item.get(
                            "verify"
                        ),
                        on_fail=item.get(
                            "on_fail"
                        ),
                        needs_confirmation=bool(
                            item.get(
                                "needs_confirmation",
                                False
                            )
                        ),
                    )
                )

            return steps

        except Exception:
            return []