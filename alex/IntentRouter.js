// ============================================================
// ALEX CENTRAL INTENT ROUTER
// Syntax-safe Node-native NLU layer
// ============================================================

const { callGemini } = require("./utils/gemini");

const INTENTS = new Set([
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
  "WEB_RESEARCH",

  "HEALTH_CHECK",
  "TASK_PLAN",
  "AGENT_INSPECTION",

  "PROJECT_ANALYSIS",
  "BUG_ANALYSIS",
  "SECURITY_ANALYSIS",
  "FIX_REQUEST",
  "MULTI_STEP_TASK",

  "UNKNOWN",
]);

class IntentRouter {
  constructor(contextProvider = null) {
    this.contextProvider = contextProvider;
  }

  // ==========================================================
  // MAIN ROUTE
  // ==========================================================

  async route(message, context = {}) {
    const text = String(message || "").trim();

    if (!text) {
      return this._unknown("Empty message");
    }

    const deterministic = this._deterministic(text, context);

    if (deterministic) {
      return deterministic;
    }

    return this._aiRoute(text, context);
  }

  // ==========================================================
  // HELPERS
  // ==========================================================

  _hasAny(text, words = []) {
    const value = String(text || "").toLowerCase();

    return words.some((word) => {
      const escaped = String(word)
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i").test(value);
    });
  }

  _hasPhrase(text, phrases = []) {
    const value = String(text || "").toLowerCase();

    return phrases.some((phrase) =>
      value.includes(String(phrase).toLowerCase())
    );
  }

  _getHistory(context = {}) {
    if (!context || typeof context !== "object") {
      return [];
    }

    const candidates = [
      context.recentHistory,
      context.history,
      context.messages,
      context.conversation,
      context.recentMessages,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate.slice(-12);
      }
    }

    return [];
  }

  // ==========================================================
  // DETERMINISTIC ROUTING
  // ==========================================================

  _deterministic(text, context = {}) {
    const lower = text.toLowerCase().trim();

    // --------------------------------------------------------
    // GREETING
    // --------------------------------------------------------

    if (
      /^(hi|hii|hiii|hey|hello|hye|hlo|namaste|namaskar|salam|yo)\b/i.test(
        lower
      )
    ) {
      return this._result(
        "GENERAL_CHAT",
        text,
        "Respond naturally to the owner.",
        context
      );
    }

    // --------------------------------------------------------
    // MEMORY
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "mera naam",
        "meri age",
        "meri umar",
        "maine kya",
        "mujhe yaad",
        "yaad hai",
        "do you remember",
        "previous conversation",
        "pichli baat",
        "pehle kya",
        "my name",
        "my age",
      ])
    ) {
      return this._result(
        "MEMORY_QUERY",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // SYSTEM INFORMATION
    // --------------------------------------------------------

    const systemWords = [
      "cpu",
      "processor",
      "ram",
      "memory",
      "disk",
      "storage",
      "battery",
      "os",
      "uptime",
      "spec",
      "specs",
      "information",
      "info",
    ];

    if (
      this._hasAny(lower, [
        "laptop",
        "computer",
        "pc",
        "system",
        "machine",
        "windows",
      ]) &&
      this._hasAny(lower, systemWords)
    ) {
      return this._result(
        "SYSTEM_INFO",
        text,
        "Get complete authorized laptop/system information.",
        context
      );
    }

    if (
      this._hasAny(lower, systemWords) &&
      this._hasAny(lower, [
        "check",
        "batao",
        "btao",
        "kitna",
        "kitni",
        "show",
        "dikhao",
        "info",
        "information",
        "status",
        "dekh",
      ])
    ) {
      return this._result(
        "SYSTEM_INFO",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // PERFORMANCE
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "performance",
        "slow",
        "lag",
        "lagging",
        "hang",
        "hanging",
        "freeze",
        "usage",
        "resource",
        "resources",
        "speed",
      ]) ||
      this._hasPhrase(lower, [
        "high cpu",
        "high ram",
      ])
    ) {
      return this._result(
        "PERFORMANCE_CHECK",
        text,
        "Check current authorized laptop performance.",
        context
      );
    }

    // --------------------------------------------------------
    // FILE SEARCH
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "find",
        "search",
        "dhund",
        "dhoond",
        "dhundho",
        "dhoondo",
        "locate",
      ]) ||
      this._hasPhrase(lower, [
        "where is",
        "kahan hai",
        "kaha hai",
      ])
    ) {
      if (
        this._hasAny(lower, [
          "file",
          "folder",
          "document",
          "pdf",
          "resume",
          "photo",
          "image",
          "video",
          "code",
        ])
      ) {
        return this._result(
          "FILE_SEARCH",
          text,
          text,
          context
        );
      }
    }

    // --------------------------------------------------------
    // FILE OPEN
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "open",
        "khol",
        "kholna",
        "kholo",
      ]) &&
      this._hasAny(lower, [
        "file",
        "folder",
        "document",
        "pdf",
        "resume",
        "photo",
        "image",
      ])
    ) {
      return this._result(
        "FILE_OPEN",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // FILE DELETE
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "delete",
        "remove",
        "hata",
        "hatao",
      ]) &&
      this._hasAny(lower, [
        "file",
        "folder",
        "document",
        "pdf",
        "photo",
        "image",
        "video",
      ])
    ) {
      return this._result(
        "FILE_DELETE",
        text,
        text,
        context,
        {
          needs_confirmation: true,
        }
      );
    }

    // --------------------------------------------------------
    // FILE MOVE
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "move",
        "shift",
        "transfer",
      ]) &&
      this._hasAny(lower, [
        "file",
        "folder",
        "document",
        "pdf",
        "photo",
        "image",
        "video",
      ])
    ) {
      return this._result(
        "FILE_MOVE",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // FILE WRITE
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "create",
        "make",
        "bana",
        "banao",
        "likh",
        "write",
        "save",
      ]) &&
      this._hasAny(lower, [
        "file",
        "document",
        "text",
        "json",
        "js",
        "javascript",
        "html",
        "css",
        "code",
      ])
    ) {
      return this._result(
        "FILE_WRITE",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // APP OPEN
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "open",
        "launch",
        "start",
        "run",
        "khol",
        "kholo",
        "chalao",
      ]) &&
      this._hasAny(lower, [
        "chrome",
        "notepad",
        "explorer",
        "browser",
        "app",
        "application",
      ])
    ) {
      return this._result(
        "APP_OPEN",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // APP CLOSE
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "close",
        "band",
        "terminate",
        "stop",
      ]) &&
      this._hasAny(lower, [
        "chrome",
        "notepad",
        "explorer",
        "browser",
        "app",
        "application",
        "process",
      ])
    ) {
      return this._result(
        "APP_CLOSE",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // SCREEN
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "screenshot",
        "screen",
        "screen dekh",
        "screen dikhao",
        "screen analyze",
        "screen analyse",
      ])
    ) {
      const analyze =
        this._hasAny(lower, [
          "analyze",
          "analyse",
          "samjho",
        ]) ||
        this._hasPhrase(lower, [
          "batao kya hai",
          "kya hai",
        ]);

      return this._result(
        analyze
          ? "SCREEN_ANALYZE"
          : "SCREEN_CAPTURE",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // WEB RESEARCH
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "research",
        "web research",
        "internet par research",
        "web par research",
        "latest information",
        "latest info",
        "reliable sources",
        "sources ke basis",
        "sources ke according",
        "verify online",
        "online verify",
        "internet se check",
      ])
    ) {
      return this._result(
        "WEB_RESEARCH",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "health check",
        "health status",
        "system health",
        "component status",
        "components ki status",
        "status report",
        "health report",
        "system ki health",
      ])
    ) {
      return this._result(
        "HEALTH_CHECK",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // PLAN
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "plan banao",
        "plan bana",
        "task plan",
        "task ka plan",
        "planning karo",
        "roadmap banao",
        "steps ka plan",
        "roadmap do",
      ]) &&
      !this._hasAny(lower, [
        "execute",
        "implement",
        "modify",
        "change",
      ])
    ) {
      return this._result(
        "TASK_PLAN",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // AGENT INSPECTION
    // --------------------------------------------------------

    if (
      this._hasPhrase(lower, [
        "agent*.js",
        "agent files",
        "agent files ki list",
        "agent files ka purpose",
        "available agent files",
        "agent files inspect",
        "alex folder agent",
      ])
    ) {
      return this._result(
        "AGENT_INSPECTION",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // BROWSER
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "browser",
        "website",
        "webpage",
        "url",
        "site",
      ]) &&
      this._hasAny(lower, [
        "open",
        "search",
        "read",
        "visit",
        "khol",
        "dekho",
        "kholo",
      ])
    ) {
      return this._result(
        "BROWSER_ACTION",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // PROJECT ANALYSIS
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "project",
        "codebase",
        "repository",
        "repo",
      ]) &&
      this._hasAny(lower, [
        "analyze",
        "analyse",
        "inspect",
        "check",
        "scan",
        "dekho",
        "batao",
        "review",
      ])
    ) {
      return this._result(
        "PROJECT_ANALYSIS",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // SECURITY
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "security",
        "vulnerability",
        "vulnerabilities",
        "secure",
      ]) ||
      this._hasPhrase(lower, [
        "security scan",
        "security issue",
        "security problem",
      ])
    ) {
      return this._result(
        "SECURITY_ANALYSIS",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // FIX REQUEST
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "fix",
        "repair",
        "solve",
        "correct",
        "thik",
        "theek",
        "sahi",
        "sudhar",
      ]) &&
      this._hasAny(lower, [
        "bug",
        "bugs",
        "error",
        "errors",
        "issue",
        "issues",
        "problem",
        "problems",
        "code",
        "file",
        "crash",
        "failure",
      ])
    ) {
      return this._result(
        "FIX_REQUEST",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // BUG ANALYSIS
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "bug",
        "bugs",
        "error",
        "errors",
        "issue",
        "issues",
        "problem",
        "problems",
        "crash",
        "failure",
      ])
    ) {
      return this._result(
        "BUG_ANALYSIS",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // MULTI STEP BUILD
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "build",
        "bana",
        "banao",
        "create",
        "develop",
        "implement",
        "setup",
        "integrate",
      ]) &&
      this._hasAny(lower, [
        "system",
        "project",
        "feature",
        "module",
        "app",
        "application",
        "website",
        "backend",
        "frontend",
        "api",
        "assistant",
        "bot",
      ])
    ) {
      return this._result(
        "MULTI_STEP_TASK",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // EXPLICIT QUESTIONS
    // --------------------------------------------------------

    if (
      this._hasAny(lower, [
        "kya",
        "kaise",
        "kyu",
        "kyun",
        "what",
        "why",
        "how",
        "can",
        "could",
        "should",
        "would",
        "tell",
        "bata",
        "bta",
        "batao",
        "btao",
      ])
    ) {
      return this._result(
        "GENERAL_CHAT",
        text,
        text,
        context
      );
    }

    // --------------------------------------------------------
    // CONVERSATIONAL FALLBACK
    // --------------------------------------------------------

    if (this._looksConversational(lower, context)) {
      return this._result(
        "GENERAL_CHAT",
        text,
        this._inferConversationalGoal(
          text,
          context
        ),
        context,
        {
          source: "intent-router-conversation-fallback",
        }
      );
    }

    return null;
  }

  // ==========================================================
  // CONVERSATIONAL DETECTION
  // ==========================================================

  _looksConversational(lower, context = {}) {
    const value = String(lower || "").trim();

    if (!value) {
      return false;
    }

    // Short replies / follow-ups.
    if (
      value.length <= 80 &&
      this._hasAny(value, [
        "haan",
        "han",
        "yes",
        "okay",
        "ok",
        "thik",
        "theek",
        "sahi",
        "acha",
        "accha",
        "nahi",
        "no",
        "hmm",
        "hmmm",
        "samjha",
        "fir",
        "phir",
        "ab",
        "aage",
        "next",
        "short",
        "simple",
        "detail",
        "bss",
        "bas",
      ])
    ) {
      return true;
    }

    // Common Hinglish conversation.
    if (
      this._hasAny(value, [
        "muje",
        "mujhe",
        "mera",
        "meri",
        "mere",
        "tu",
        "tum",
        "aap",
        "ap",
        "main",
        "mai",
        "hum",
        "hume",
        "karna",
        "bana",
        "banana",
        "bna",
        "bna na",
        "bna do",
        "chahiye",
        "chahie",
        "samjha",
        "samjhao",
        "bata",
        "bta",
        "dikha",
        "dikhao",
        "de",
        "dedo",
      ])
    ) {
      return true;
    }

    // Solution/advice requests.
    if (
      this._hasAny(value, [
        "solution",
        "solve",
        "answer",
        "jawab",
        "advice",
        "suggestion",
        "idea",
        "option",
        "kaunsa",
        "konsa",
      ]) ||
      this._hasPhrase(value, [
        "best way",
        "kya karu",
        "kya kru",
        "ab kya",
        "aage kya",
        "next kya",
        "which one",
      ])
    ) {
      return true;
    }

    // Contextual short follow-up.
    const history = this._getHistory(context);

    if (history.length > 0 && value.length <= 120) {
      if (
        this._hasAny(value, [
          "isko",
          "usko",
          "ye",
          "yeh",
          "woh",
          "wahi",
          "isme",
          "usme",
          "iske",
          "uske",
          "pehla",
          "dusra",
          "same",
          "previous",
          "fir",
          "phir",
          "ab",
          "next",
          "continue",
          "aage",
        ]) ||
        this._hasPhrase(value, [
          "same wala",
          "upar wala",
          "niche wala",
          "continue karo",
          "short me",
          "short mein",
          "simple mein",
          "simple me",
        ])
      ) {
        return true;
      }
    }

    return false;
  }

  // ==========================================================
  // CONVERSATIONAL GOAL
  // ==========================================================

  _inferConversationalGoal(text, context = {}) {
    const history = this._getHistory(context);

    if (history.length > 0) {
      return (
        "Continue the current conversation and infer the " +
        "owner's intended follow-up from recent context. " +
        `Owner message: ${text}`
      );
    }

    return text;
  }

  // ==========================================================
  // AI ROUTER
  // ==========================================================

  async _aiRoute(message, context = {}) {
    const history = this._getHistory(context);

    const prompt = `
You are ALEX's central intent router.

Your job is ONLY to understand the owner's intent.
You are NOT the final answer generator.

Owner language:
English, Hindi, Hinglish, slang, abbreviations,
typos, incomplete sentences, short replies and
different word orders.

Use conversation context.

Recent conversation:
${JSON.stringify(history || []).slice(0, 12000)}

Additional context:
${JSON.stringify(context || {}).slice(0, 12000)}

Owner message:
${JSON.stringify(message)}

Allowed intents:
${Array.from(INTENTS).join(", ")}

Return ONLY valid JSON:

{
  "intent": "ONE_ALLOWED_INTENT",
  "language": "en|hi|hinglish",
  "goal": "actual owner goal",
  "entities": {
    "file": null,
    "folder": null,
    "app": null,
    "url": null,
    "process": null,
    "other": null
  },
  "needs_confirmation": false,
  "complexity": "fast|deep"
}

ROUTING RULES:

1. GENERAL_CHAT is the default for normal conversation.

2. Use GENERAL_CHAT for:
- questions
- advice
- explanations
- recommendations
- opinions
- problem solving
- incomplete Hinglish
- slang
- typos
- short replies
- follow-up messages
- contextual replies
- "short me solution de"
- "muje bss bna na h"
- "tu ku nhi ker shkta"
- "ab kya karu"
- "aage bata"
- "simple me samjha"

3. Do NOT use UNKNOWN merely because:
- grammar is incomplete
- spelling is wrong
- the sentence is short
- Hinglish is informal
- some details are missing
- the owner is continuing the previous topic

4. Use conversation context to understand follow-ups.

5. Use UNKNOWN only when the message cannot reasonably
be interpreted even with conversation context.

6. Use FILE_* only for clear filesystem requests.

7. Use APP_* only for clear application open/close requests.

8. Use SCREEN_* only for explicit screen/screenshot requests.

9. Use BROWSER_ACTION only for clear browser interaction.

10. Use WEB_RESEARCH for explicit online research,
current information, sources or online verification.

11. Use MEMORY_QUERY for remembered information.

12. Use PROJECT_ANALYSIS, BUG_ANALYSIS, SECURITY_ANALYSIS
or FIX_REQUEST for explicit project/code analysis or fixing.

13. Never invent paths, filenames, apps, URLs or completed actions.

14. Destructive operations must set needs_confirmation=true.

15. When uncertain between GENERAL_CHAT and UNKNOWN,
choose GENERAL_CHAT unless a specific protected action is clear.
`;

    try {
      const response = await callGemini(prompt, {
        temperature: 0,
        maxOutputTokens: 1000,
        timeoutMs: 12000,
        retries: 2,
        responseMimeType: "application/json",
      });

      if (!response || response.error) {
        if (
          this._looksConversational(
            String(message).toLowerCase(),
            context
          )
        ) {
          return this._result(
            "GENERAL_CHAT",
            message,
            this._inferConversationalGoal(
              message,
              context
            ),
            context,
            {
              source: "intent-router-degraded-fallback",
            }
          );
        }

        return this._unknown(
          response?.message ||
            "Intent router AI unavailable"
        );
      }

      const raw =
        typeof response === "string"
          ? response
          : response.text || response.raw || "";

      const parsed = this._parseJSON(raw);

      if (
        !parsed ||
        !INTENTS.has(parsed.intent)
      ) {
        if (
          this._looksConversational(
            String(message).toLowerCase(),
            context
          )
        ) {
          return this._result(
            "GENERAL_CHAT",
            message,
            this._inferConversationalGoal(
              message,
              context
            ),
            context,
            {
              source:
                "intent-router-invalid-ai-fallback",
            }
          );
        }

        return this._unknown(
          "Invalid router response"
        );
      }

      // Never allow understandable conversation
      // to become UNKNOWN.
      if (
        parsed.intent === "UNKNOWN" &&
        this._looksConversational(
          String(message).toLowerCase(),
          context
        )
      ) {
        return this._result(
          "GENERAL_CHAT",
          message,
          this._inferConversationalGoal(
            message,
            context
          ),
          context,
          {
            source:
              "intent-router-unknown-correction",
          }
        );
      }

      return this._result(
        parsed.intent,
        message,
        parsed.goal || message,
        context,
        parsed
      );
    } catch (error) {
      if (
        this._looksConversational(
          String(message).toLowerCase(),
          context
        )
      ) {
        return this._result(
          "GENERAL_CHAT",
          message,
          this._inferConversationalGoal(
            message,
            context
          ),
          context,
          {
            source:
              "intent-router-error-fallback",
          }
        );
      }

      return this._unknown(
        error?.message || "Router failed"
      );
    }
  }

  // ==========================================================
  // JSON PARSER
  // ==========================================================

  _parseJSON(raw) {
    if (!raw) {
      return null;
    }

    let text = String(raw).trim();

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start >= 0 && end > start) {
        try {
          return JSON.parse(
            text.slice(start, end + 1)
          );
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  _result(
    intent,
    message,
    goal,
    context,
    extra = {}
  ) {
    return {
      success: true,

      intent,

      language:
        extra.language ||
        this._language(message),

      goal:
        goal ||
        message,

      entities: {
        file: null,
        folder: null,
        app: null,
        url: null,
        process: null,
        other: null,
        ...(extra.entities || {}),
      },

      needs_confirmation:
        !!extra.needs_confirmation,

      complexity:
        extra.complexity ||
        "fast",

      source:
        extra.source ||
        "intent-router",

      context:
        context || {},
    };
  }

  // ==========================================================
  // UNKNOWN
  // ==========================================================

  _unknown(reason) {
    return {
      success: false,
      intent: "UNKNOWN",
      goal: "",
      entities: {},
      needs_confirmation: false,
      complexity: "fast",
      error: reason,
    };
  }

  // ==========================================================
  // LANGUAGE
  // ==========================================================

  _language(text) {
    const value = String(text || "");

    if (/[ऀ-ॿ]/.test(value)) {
      return "hi";
    }

    if (
      this._hasAny(value, [
        "mera",
        "meri",
        "mere",
        "mujhe",
        "muje",
        "kya",
        "kyu",
        "kyun",
        "hai",
        "h",
        "batao",
        "btao",
        "bata",
        "bta",
        "kar",
        "karo",
        "karna",
        "isko",
        "usko",
        "wahi",
        "ye",
        "yeh",
        "woh",
        "haan",
        "han",
        "nahi",
        "chahiye",
        "bna",
        "bana",
      ])
    ) {
      return "hinglish";
    }

    return "en";
  }
}

module.exports = {
  IntentRouter,
};