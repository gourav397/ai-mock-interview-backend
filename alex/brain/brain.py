import json
import re

from .context import (
    ContextStore,
    Turn,
    Entity,
)

from .fastpath import FastPath
from .router import IntentRouter
from .planner import TaskPlanner
from .executor import AgentExecutor


class Brain:

    def __init__(
        self,
        gemini,
        tools,
        gate,
        broker,
        audit,
        context=None,
    ):
        self.gemini = gemini
        self.tools = tools or {}

        self.ctx = (
            context
            if context is not None
            else ContextStore()
        )

        self.router = IntentRouter(
            gemini,
            self.ctx
        )

        self.planner = TaskPlanner(
            gemini,
            self.ctx
        )

        self.executor = AgentExecutor(
            self.tools,
            gate,
            broker,
            audit,
            self.ctx
        )

        self.fast = FastPath()

    # ==========================================================
    # MAIN ENTRY
    # ==========================================================

    def handle(
        self,
        message
    ):
        message = str(
            message or ""
        ).strip()

        if not message:
            return (
                "Haan, bolo. Main sun raha hoon."
            )

        # ------------------------------------------------------
        # FAST PATH
        # ------------------------------------------------------

        fast_intent = (
            self.fast.classify(
                message
            )
        )

        if fast_intent == "GREETING":
            name = self.ctx.prefs.get(
                "owner_name",
                "Gourav"
            )

            reply = (
                f"Hey {name}! "
                f"Bolo, kya karna hai?"
            )

            self._remember_turn(
                "owner",
                message,
                "GREETING"
            )

            self._remember_turn(
                "alex",
                reply,
                "GREETING"
            )

            return reply

        if fast_intent == "MEMORY_QUERY":
            reply = self._answer_memory(
                message
            )

            if reply:
                self._remember_turn(
                    "owner",
                    message,
                    "MEMORY_QUERY"
                )

                self._remember_turn(
                    "alex",
                    reply,
                    "MEMORY_QUERY"
                )

                self.ctx.persist()

                return reply

        if fast_intent == "SYSTEM_INFO":
            reply = self._system_info()

            self._remember_turn(
                "owner",
                message,
                "SYSTEM_INFO"
            )

            self._remember_turn(
                "alex",
                reply,
                "SYSTEM_INFO"
            )

            return reply

        # ------------------------------------------------------
        # REFERENCE-FIRST CONTEXT
        # ------------------------------------------------------

        resolved_message = (
            self._resolve_references(
                message
            )
        )

        # ------------------------------------------------------
        # DEEP ROUTER
        # ------------------------------------------------------

        decision = self.router.route(
            resolved_message
        )

        intent = str(
            decision.get(
                "intent",
                "UNKNOWN"
            )
        ).upper()

        goal = str(
            decision.get(
                "goal",
                resolved_message
            )
        ).strip()

        entities = (
            decision.get(
                "entities",
                {}
            )
            or {}
        )

        self._remember_turn(
            "owner",
            message,
            intent,
            entities
        )

        # ------------------------------------------------------
        # GENERAL CHAT
        # ------------------------------------------------------

        if intent in (
            "GENERAL_CHAT",
            "MEMORY_QUERY",
        ):
            reply = self._chat(
                message,
                decision
            )

            self._remember_turn(
                "alex",
                reply,
                intent
            )

            self.ctx.persist()

            return reply

        # ------------------------------------------------------
        # SIMPLE TOOL ACTION
        # ------------------------------------------------------

        simple = self._try_simple_action(
            intent,
            entities,
            goal
        )

        if simple is not None:
            self._remember_turn(
                "alex",
                simple,
                intent
            )

            self.ctx.persist()

            return simple

        # ------------------------------------------------------
        # PLAN
        # ------------------------------------------------------

        steps = self.planner.plan(
            goal,
            entities
        )

        if not steps:

            # If planner failed, do not fake success.
            return (
                "Main request samajh gaya, "
                "lekin is task ka safe executable plan "
                "create nahi ho paya."
            )

        self.ctx.pending_task = {
            "goal": goal,
            "steps": [
                step.action
                for step in steps
            ],
        }

        self.ctx.persist()

        # ------------------------------------------------------
        # EXECUTE
        # ------------------------------------------------------

        result = self.executor.run(
            steps
        )

        # Keep pending task if failed.
        if result.get(
            "success"
        ):
            self.ctx.pending_task = None

        # ------------------------------------------------------
        # REMEMBER RESULTS
        # ------------------------------------------------------

        self._update_referents(
            decision,
            result
        )

        # ------------------------------------------------------
        # RESPONSE
        # ------------------------------------------------------

        reply = self._respond(
            decision,
            result
        )

        self._remember_turn(
            "alex",
            reply,
            intent
        )

        self.ctx.persist()

        return reply

    # ==========================================================
    # SIMPLE SYSTEM INFO
    # ==========================================================

    def _system_info(self):

        fn = self.tools.get(
            "sys.info"
        )

        if not fn:
            return (
                "System information tool "
                "available nahi hai."
            )

        try:
            info = fn()

            if not isinstance(
                info,
                dict
            ):
                return str(
                    info
                )

            parts = []

            if info.get(
                "cpu_name"
            ):
                parts.append(
                    f"CPU: {info['cpu_name']}"
                )

            if info.get(
                "ram_gb"
            ) is not None:
                parts.append(
                    f"RAM: {info['ram_gb']} GB"
                )

            if info.get(
                "disk"
            ) is not None:
                parts.append(
                    f"Disk: {info['disk']}"
                )

            if info.get(
                "battery"
            ) is not None:
                parts.append(
                    f"Battery: {info['battery']}"
                )

            if info.get(
                "os"
            ):
                parts.append(
                    f"OS: {info['os']}"
                )

            if not parts:
                return (
                    "System information mil gayi, "
                    "lekin displayable details nahi mili."
                )

            return "\n".join(
                parts
            )

        except Exception as error:
            return (
                "System information read nahi ho payi: "
                + str(error)
            )

    # ==========================================================
    # MEMORY QUESTIONS
    # ==========================================================

    def _answer_memory(
        self,
        message
    ):
        text = str(
            message or ""
        ).lower().strip()

        if re.search(
            r"\b("
            r"mera\s+naam\s+kya\s+hai|"
            r"mera\s+naam\s+batao|"
            r"what\s+is\s+my\s+name"
            r")\b",
            text,
            re.I
        ):
            name = self.ctx.prefs.get(
                "owner_name"
            )

            if name:
                return (
                    f"Tumhara naam "
                    f"{name} hai."
                )

            return (
                "Mujhe abhi tumhara naam "
                "memory me saved nahi mila."
            )

        return None

    # ==========================================================
    # NORMAL CHAT
    # ==========================================================

    def _chat(
        self,
        message,
        decision
    ):
        context = (
            self.ctx.context_block(
                n=10
            )
        )

        prompt = f"""
You are ALEX, the owner's personal AI assistant.

Talk naturally like a helpful intelligent assistant.

Owner language:
English/Hindi/Hinglish.

Understand:
- typos
- slang
- short messages
- incomplete sentences
- previous-message references
- emotional/contextual meaning

Do NOT claim an action happened unless a tool actually executed it.

Recent conversation:
{json.dumps(
    context.get("recent", ""),
    ensure_ascii=False
)}

Known entities:
{json.dumps(
    context.get("entities", {}),
    ensure_ascii=False
)}

Owner message:
{message}

Router decision:
{json.dumps(
    decision,
    ensure_ascii=False
)}

Reply naturally and concisely.
Do not start every response with "Done".
"""

        try:
            return self._gemini_text(
                prompt
            )

        except Exception:
            # Important:
            # normal chat failure should NOT
            # become fake "Done".
            return (
                "Main tumhari baat samajh raha hoon, "
                "lekin AI response service abhi "
                "temporarily unavailable hai. "
                "Tum message dobara bhej sakte ho."
            )

    # ==========================================================
    # GEMINI COMPATIBILITY
    # ==========================================================

    def _gemini_text(
        self,
        prompt
    ):
        if hasattr(
            self.gemini,
            "generate"
        ):
            response = self.gemini.generate(
                prompt,
                temperature=0.6,
                timeout=20000,
                retries=2,
                chatMode=True,
            )

            if isinstance(
                response,
                str
            ):
                text = response
            else:
                text = (
                    getattr(
                        response,
                        "text",
                        None
                    )
                    or (
                        response.get(
                            "text"
                        )
                        if isinstance(
                            response,
                            dict
                        )
                        else None
                    )
                    or (
                        response.get(
                            "message"
                        )
                        if isinstance(
                            response,
                            dict
                        )
                        else None
                    )
                )

            if text:
                return str(
                    text
                ).strip()

            raise RuntimeError(
                "Gemini returned empty response."
            )

        if callable(
            self.gemini
        ):
            result = self.gemini(
                prompt
            )

            return str(
                result
            ).strip()

        raise RuntimeError(
            "Gemini client unavailable."
        )

    # ==========================================================
    # REFERENCE RESOLUTION
    # ==========================================================

    def _resolve_references(
        self,
        message
    ):
        text = str(
            message or ""
        )

        reference = re.search(
            r"\b("
            r"isko|is\s*ko|"
            r"usko|us\s*ko|"
            r"wahi|"
            r"pehla\s+wala|"
            r"doosra\s+wala|"
            r"first\s+one|"
            r"second\s+one|"
            r"this|that|it"
            r")\b",
            text,
            re.I
        )

        if not reference:
            return text

        hint = reference.group(
            1
        )

        entity = self.ctx.get_referent(
            hint
        )

        if not entity:
            return text

        resolved = (
            f"{text}\n\n"
            f"[ALEX CONTEXT RESOLUTION]\n"
            f"Reference '{hint}' refers to "
            f"{entity.kind}: "
            f"{entity.value}\n"
        )

        return resolved

    # ==========================================================
    # SIMPLE ACTIONS
    # ==========================================================

    def _try_simple_action(
        self,
        intent,
        entities,
        goal
    ):
        entities = (
            entities or {}
        )

        # ------------------------------------------------------
        # APP OPEN
        # ------------------------------------------------------

        if intent == "APP_OPEN":
            app_name = (
                entities.get(
                    "app"
                )
                or entities.get(
                    "other"
                )
            )

            fn = self.tools.get(
                "app.open"
            )

            if fn and app_name:
                try:
                    result = fn(
                        name=app_name
                    )

                    if self._tool_success(
                        result
                    ):
                        self.ctx.remember_app(
                            app_name
                        )

                        return (
                            f"{app_name} open "
                            "kar diya aur result verify "
                            "kiya."
                        )

                except Exception:
                    pass

        # ------------------------------------------------------
        # APP CLOSE
        # ------------------------------------------------------

        if intent == "APP_CLOSE":
            app_name = (
                entities.get(
                    "app"
                )
            )

            fn = self.tools.get(
                "app.close"
            )

            if fn and app_name:
                try:
                    result = fn(
                        name_or_pid=app_name
                    )

                    if self._tool_success(
                        result
                    ):
                        return (
                            f"{app_name} close "
                            "kar diya."
                        )

                except Exception:
                    pass

        return None

    # ==========================================================
    # RESULT HELPERS
    # ==========================================================

    @staticmethod
    def _tool_success(
        result
    ):
        if isinstance(
            result,
            dict
        ):
            if result.get(
                "success"
            ) is False:
                return False

            if result.get(
                "status"
            ) in (
                "failed",
                "denied",
                "error",
            ):
                return False

        return bool(
            result is not None
        )

    # ==========================================================
    # REFERENTS
    # ==========================================================

    def _update_referents(
        self,
        decision,
        result
    ):
        entities = (
            decision.get(
                "entities",
                {}
            )
            or {}
        )

        file_value = entities.get(
            "file"
        )

        if file_value:
            self.ctx.remember_file(
                file_value,
                label="file"
            )

        app_value = entities.get(
            "app"
        )

        if app_value:
            self.ctx.remember_app(
                app_value
            )

        # Search result may contain files.
        if isinstance(
            result,
            dict
        ):
            completed = result.get(
                "completed",
                []
            )

            for item in completed:

                payload = item.get(
                    "result"
                )

                if not isinstance(
                    payload,
                    dict
                ):
                    continue

                files = payload.get(
                    "files"
                ) or payload.get(
                    "results"
                )

                if isinstance(
                    files,
                    list
                ):
                    for file_item in files[:10]:

                        if isinstance(
                            file_item,
                            str
                        ):
                            self.ctx.remember_file(
                                file_item
                            )

                        elif isinstance(
                            file_item,
                            dict
                        ):
                            path = (
                                file_item.get(
                                    "path"
                                )
                                or file_item.get(
                                    "value"
                                )
                            )

                            if path:
                                self.ctx.remember_file(
                                    path,
                                    label=file_item.get(
                                        "name",
                                        "file"
                                    ),
                                    meta=file_item
                                )

    # ==========================================================
    # RESPONSE
    # ==========================================================

    def _respond(
        self,
        decision,
        result
    ):
        goal = decision.get(
            "goal",
            "requested task"
        )

        if result.get(
            "success"
        ):
            return self._succinct_success(
                decision,
                result
            )

        message = result.get(
            "message",
            "unknown error"
        )

        return (
            f"Maine try kiya: {goal}\n"
            f"Lekin task complete nahi hua: "
            f"{message}"
        )

    def _succinct_success(
        self,
        decision,
        result
    ):
        goal = str(
            decision.get(
                "goal",
                "task"
            )
        ).strip()

        completed = result.get(
            "completed",
            []
        )

        if completed:
            actions = [
                item.get(
                    "action"
                )
                for item in completed
                if item.get(
                    "action"
                )
            ]

            if actions:
                return (
                    f"Ho gaya. "
                    f"Task complete aur verify "
                    f"kiya: {goal}"
                )

        return (
            f"Ho gaya. "
            f"Task complete aur verify "
            f"kiya: {goal}"
        )

    # ==========================================================
    # TURN MEMORY
    # ==========================================================

    def _remember_turn(
        self,
        role,
        text,
        intent="",
        entities=None
    ):
        try:
            self.ctx.add_turn(
                Turn(
                    role=role,
                    text=str(
                        text or ""
                    )[:4000],
                    intent=intent,
                    entities=(
                        [entities]
                        if entities
                        else []
                    ),
                )
            )
        except Exception:
            pass