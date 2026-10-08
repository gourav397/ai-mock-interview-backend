import time
import json
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path


@dataclass
class Entity:
    kind: str
    value: str
    label: str
    meta: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


@dataclass
class Turn:
    role: str
    text: str
    ts: float = field(default_factory=time.time)
    intent: str = ""
    entities: list = field(default_factory=list)


class ContextStore:
    """
    ALEX short-term + lightweight persistent memory.

    Short-term:
      - recent turns
      - latest entities
      - recent search results
      - pending task

    Persistent:
      - owner preferences
      - frequent files
      - known entities
      - conversation summary/state
    """

    def __init__(
        self,
        store_path: str = None,
        max_turns: int = 40,
    ):
        if store_path is None:
            store_path = str(
                Path.home() / ".alex_agent" / "alex_memory.json"
            )

        self.path = Path(store_path)
        self.max_turns = max_turns

        self._lock = threading.RLock()

        self.turns: list[Turn] = []
        self.last_entities: dict[str, Entity] = {}
        self.entity_history: list[Entity] = []

        self.pending_task = None

        loaded = self._load()

        self.prefs = loaded.get("prefs", {})
        self.frequent_files = loaded.get("frequent_files", {})

        self._restore_entities(
            loaded.get("last_entities", {})
        )

        self._restore_turns(
            loaded.get("turns", [])
        )

        self.pending_task = loaded.get(
            "pending_task"
        )

    # ==========================================================
    # LOAD
    # ==========================================================

    def _load(self):
        try:
            if not self.path.exists():
                return {}

            raw = self.path.read_text(
                encoding="utf-8"
            ).strip()

            if not raw:
                return {}

            data = json.loads(raw)

            return (
                data
                if isinstance(data, dict)
                else {}
            )

        except Exception:
            return {}

    # ==========================================================
    # RESTORE
    # ==========================================================

    def _restore_entities(self, data):
        if not isinstance(data, dict):
            return

        for kind, value in data.items():
            try:
                if not isinstance(value, dict):
                    continue

                entity = Entity(
                    kind=str(
                        value.get(
                            "kind",
                            kind
                        )
                    ),
                    value=str(
                        value.get(
                            "value",
                            ""
                        )
                    ),
                    label=str(
                        value.get(
                            "label",
                            ""
                        )
                    ),
                    meta=value.get(
                        "meta",
                        {}
                    ) or {},
                    created_at=float(
                        value.get(
                            "created_at",
                            time.time()
                        )
                    ),
                )

                self.last_entities[
                    entity.kind
                ] = entity

                self.entity_history.append(
                    entity
                )

            except Exception:
                continue

    def _restore_turns(self, data):
        if not isinstance(data, list):
            return

        for item in data[-self.max_turns:]:
            try:
                if not isinstance(item, dict):
                    continue

                self.turns.append(
                    Turn(
                        role=str(
                            item.get(
                                "role",
                                ""
                            )
                        ),
                        text=str(
                            item.get(
                                "text",
                                ""
                            )
                        ),
                        ts=float(
                            item.get(
                                "ts",
                                time.time()
                            )
                        ),
                        intent=str(
                            item.get(
                                "intent",
                                ""
                            )
                        ),
                        entities=item.get(
                            "entities",
                            []
                        ) or [],
                    )
                )

            except Exception:
                continue

    # ==========================================================
    # TURN MEMORY
    # ==========================================================

    def add_turn(self, turn: Turn):
        if not isinstance(turn, Turn):
            return

        with self._lock:
            self.turns.append(turn)

            self.turns = self.turns[
                -self.max_turns:
            ]

    # ==========================================================
    # ENTITY MEMORY
    # ==========================================================

    def remember_entity(
        self,
        entity: Entity
    ):
        if not isinstance(entity, Entity):
            return

        if not entity.value:
            return

        with self._lock:
            self.last_entities[
                entity.kind
            ] = entity

            self.entity_history.append(
                entity
            )

            self.entity_history = (
                self.entity_history[-100:]
            )

    def remember_file(
        self,
        path,
        label=None,
        meta=None
    ):
        if not path:
            return

        entity = Entity(
            kind="file",
            value=str(path),
            label=label or Path(
                str(path)
            ).name,
            meta=meta or {},
        )

        self.remember_entity(entity)

        with self._lock:
            self.frequent_files[
                str(path)
            ] = (
                self.frequent_files.get(
                    str(path),
                    0
                ) + 1
            )

    def remember_app(
        self,
        name,
        value=None,
        meta=None
    ):
        if not name:
            return

        entity = Entity(
            kind="app",
            value=str(
                value or name
            ),
            label=str(name),
            meta=meta or {},
        )

        self.remember_entity(entity)

    # ==========================================================
    # REFERENCE RESOLUTION
    # ==========================================================

    def get_referent(
        self,
        phrase_hint="",
        kind=None
    ):
        hint = str(
            phrase_hint or ""
        ).strip().lower()

        with self._lock:

            if kind:
                direct = self.last_entities.get(
                    kind
                )

                if direct:
                    return direct

            # First / pehla
            if any(
                x in hint
                for x in (
                    "pehla",
                    "first",
                    "1st",
                )
            ):
                candidates = [
                    e
                    for e in reversed(
                        self.entity_history
                    )
                    if not kind
                    or e.kind == kind
                ]

                if candidates:
                    return candidates[-1]

            # Last / latest
            if any(
                x in hint
                for x in (
                    "last",
                    "latest",
                    "aakhri",
                    "sabse latest",
                )
            ):
                candidates = [
                    e
                    for e in reversed(
                        self.entity_history
                    )
                    if not kind
                    or e.kind == kind
                ]

                if candidates:
                    return candidates[0]

            # Generic references
            if any(
                x in hint
                for x in (
                    "isko",
                    "is ko",
                    "usko",
                    "us ko",
                    "wahi",
                    "same",
                    "that",
                    "this",
                    "it",
                )
            ):
                if kind:
                    return self.last_entities.get(
                        kind
                    )

                if self.entity_history:
                    return self.entity_history[-1]

            if kind:
                return self.last_entities.get(
                    kind
                )

            if self.entity_history:
                return self.entity_history[-1]

        return None

    def get_recent_entities(
        self,
        kind=None,
        limit=10
    ):
        with self._lock:
            result = []

            for entity in reversed(
                self.entity_history
            ):
                if kind and entity.kind != kind:
                    continue

                result.append(entity)

                if len(result) >= limit:
                    break

            return result

    # ==========================================================
    # CONTEXT
    # ==========================================================

    def recent_summary(
        self,
        n=8
    ):
        with self._lock:
            turns = self.turns[-n:]

            return "\n".join(
                f"{t.role}: {t.text}"
                for t in turns
            )

    def context_block(
        self,
        n=8
    ):
        with self._lock:

            recent = self.recent_summary(
                n
            )

            entities = {}

            for kind, entity in (
                self.last_entities.items()
            ):
                entities[kind] = {
                    "label": entity.label,
                    "value": entity.value,
                    "meta": entity.meta,
                }

            return {
                "recent": recent,
                "entities": entities,
                "pending_task": self.pending_task,
                "prefs": self.prefs,
            }

    # ==========================================================
    # PERSISTENCE
    # ==========================================================

    def persist(self):
        with self._lock:
            try:
                self.path.parent.mkdir(
                    parents=True,
                    exist_ok=True
                )

                data = {
                    "prefs": self.prefs,

                    "frequent_files":
                        self.frequent_files,

                    "last_entities": {
                        k: asdict(v)
                        for k, v in
                        self.last_entities.items()
                    },

                    "turns": [
                        asdict(t)
                        for t in
                        self.turns[-self.max_turns:]
                    ],

                    "pending_task":
                        self.pending_task,
                }

                temp = self.path.with_suffix(
                    ".tmp"
                )

                temp.write_text(
                    json.dumps(
                        data,
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )

                temp.replace(
                    self.path
                )

            except Exception:
                # Memory failure must never
                # break ALEX itself.
                pass