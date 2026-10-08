import re


class FastPath:
    """
    Very fast deterministic understanding.

    IMPORTANT:
    This path must only handle requests
    where the meaning is obvious.
    """

    GREETING_RE = re.compile(
        r"^\s*(?:"
        r"hi|hey|hello|hye|"
        r"namaste|namaskar|"
        r"yo|sup|"
        r"kaise\s+ho|"
        r"kya\s+haal"
        r")"
        r"(?:\s+alex)?"
        r"\s*[!.?,]*\s*$",
        re.I,
    )

    SYSTEM_RE = re.compile(
        r"\b("
        r"ram|memory|cpu|processor|"
        r"battery|disk|storage|"
        r"operating\s+system|os|"
        r"uptime|laptop\s+info|"
        r"computer\s+info|"
        r"system\s+info|"
        r"system\s+information"
        r")\b",
        re.I,
    )

    SIMPLE_MEMORY_RE = re.compile(
        r"^\s*(?:"
        r"mera\s+naam\s+kya\s+hai|"
        r"mera\s+naam\s+batao|"
        r"what\s+is\s+my\s+name|"
        r"my\s+name\s+is\s+what"
        r")\s*[?!.,]*\s*$",
        re.I,
    )

    @classmethod
    def classify(cls, text):
        text = str(
            text or ""
        ).strip()

        if not text:
            return None

        if cls.GREETING_RE.match(
            text
        ):
            return "GREETING"

        if cls.SIMPLE_MEMORY_RE.match(
            text
        ):
            return "MEMORY_QUERY"

        # Only classify as SYSTEM_INFO
        # when it looks like a question/request,
        # avoiding false matches in normal chat.
        if cls.SYSTEM_RE.search(
            text
        ) and (
            "?" in text
            or re.search(
                r"\b("
                r"batao|btao|bata|"
                r"check|dikhao|"
                r"kitna|kitni|"
                r"how much|how many|"
                r"show|tell|"
                r"info|information"
                r")\b",
                text,
                re.I,
            )
        ):
            return "SYSTEM_INFO"

        return None