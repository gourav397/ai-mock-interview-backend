// ============================================================
// ALEX — AGENT MEMORY BRIDGE
// Version: 1.0.0
//
// PURPOSE:
//   New Agent system ko existing ALEX ChatMemory ke saath
//   connect karna.
//
// CONNECTS:
//   AgentConversationGateway
//          ↓
//   AgentMemoryBridge
//          ↓
//   Existing ChatMemory
//          ↓
//   MongoDB
//
// FEATURES:
//   ✓ Owner-scoped memory
//   ✓ Session-scoped conversation
//   ✓ Recent messages
//   ✓ Relevant context
//   ✓ Long-term facts
//   ✓ Explicit memory
//   ✓ Safe fallback
//   ✓ Existing ChatMemory API compatible
//
// IMPORTANT:
//   Ye existing ChatMemory.js ko replace nahi karta.
// ============================================================

"use strict";

const chatMemory = require("./ChatMemory");

const VERSION = "1.0.0";

const DEFAULT_RECENT_LIMIT = 30;
const MAX_RECENT_LIMIT = 100;

const DEFAULT_FACT_LIMIT = 50;
const MAX_FACT_LIMIT = 200;

const MAX_TEXT_LENGTH = 8000;

// ============================================================
// HELPERS
// ============================================================

function safeString(value, fallback = "") {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value);
}

function cleanText(
  value,
  maxLength = MAX_TEXT_LENGTH
) {
  return safeString(value)
    .trim()
    .slice(0, maxLength);
}

function normalizeOwnerId(ownerId) {
  const value =
    cleanText(ownerId, 200);

  return value || null;
}

function normalizeSessionId(sessionId) {
  const value =
    cleanText(sessionId, 200);

  return value || "default";
}

function normalizeLimit(
  value,
  fallback,
  maximum
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    Math.max(
      Math.floor(number),
      1
    ),
    maximum
  );
}

// ============================================================
// AGENT MEMORY BRIDGE
// ============================================================

class AgentMemoryBridge {
  constructor(options = {}) {
    this.version =
      VERSION;

    this.memory =
      options.memory ||
      chatMemory;

    this.stats = {
      saves: 0,
      reads: 0,
      contextReads: 0,
      factReads: 0,
      explicitMemories: 0,
      failures: 0,
    };
  }

  // ==========================================================
  // SAVE USER MESSAGE
  // ==========================================================

  async saveOwnerMessage({
    ownerId,
    sessionId,
    text,
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeSessionId =
      normalizeSessionId(
        sessionId
      );

    const safeText =
      cleanText(text);

    if (!safeText) {
      return {
        success: false,
        status: "empty",
        message:
          "Message empty hai.",
      };
    }

    if (
      !this.memory ||
      typeof this.memory.saveMessage !==
        "function"
    ) {
      this.stats.failures += 1;

      return {
        success: false,
        status:
          "memory_unavailable",
        error:
          "ChatMemory.saveMessage is unavailable.",
      };
    }

    try {
      const saved =
        await this.memory.saveMessage(
          safeSessionId,
          "owner",
          safeText,
          {
            ownerId:
              safeOwnerId,
          }
        );

      this.stats.saves += 1;

      return {
        success: true,
        status: "saved",
        message:
          saved || null,
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: "failed",
        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // SAVE ALEX MESSAGE
  // ==========================================================

  async saveAssistantMessage({
    ownerId,
    sessionId,
    text,
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeSessionId =
      normalizeSessionId(
        sessionId
      );

    const safeText =
      cleanText(text);

    if (!safeText) {
      return {
        success: false,
        status: "empty",
      };
    }

    if (
      !this.memory ||
      typeof this.memory.saveMessage !==
        "function"
    ) {
      this.stats.failures += 1;

      return {
        success: false,
        status:
          "memory_unavailable",
        error:
          "ChatMemory.saveMessage is unavailable.",
      };
    }

    try {
      const saved =
        await this.memory.saveMessage(
          safeSessionId,
          "alex",
          safeText,
          {
            ownerId:
              safeOwnerId,
          }
        );

      this.stats.saves += 1;

      return {
        success: true,
        status: "saved",
        message:
          saved || null,
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: "failed",
        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // SAVE GENERIC MESSAGE
  // ==========================================================

  async saveMessage({
    ownerId,
    sessionId,
    role = "owner",
    text,
  } = {}) {
    if (
      String(role).toLowerCase() ===
      "alex"
    ) {
      return this.saveAssistantMessage({
        ownerId,
        sessionId,
        text,
      });
    }

    return this.saveOwnerMessage({
      ownerId,
      sessionId,
      text,
    });
  }

  // ==========================================================
  // RECENT CONVERSATION
  // ==========================================================

  async getRecentMessages({
    ownerId,
    sessionId,
    limit = DEFAULT_RECENT_LIMIT,
  } = {}) {
    const safeSessionId =
      normalizeSessionId(
        sessionId
      );

    const safeLimit =
      normalizeLimit(
        limit,
        DEFAULT_RECENT_LIMIT,
        MAX_RECENT_LIMIT
      );

    if (
      !this.memory ||
      typeof this.memory.getRecentMessages !==
        "function"
    ) {
      this.stats.failures += 1;

      return [];
    }

    try {
      const messages =
        await this.memory.getRecentMessages(
          safeSessionId,
          safeLimit
        );

      this.stats.reads += 1;

      // Existing ChatMemory already returns:
      // { role, text, timestamp }
      //
      // Owner filtering is handled by the
      // owner-scoped memory/context methods where
      // available. We never invent another owner's data.
      return Array.isArray(messages)
        ? messages.slice(
            -safeLimit
          )
        : [];
    } catch (error) {
      this.stats.failures += 1;

      return [];
    }
  }

  // ==========================================================
  // BUILD FULL AI CONTEXT
  // ==========================================================

  async buildContext({
    ownerId,
    sessionId,
    currentMessage = "",
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeSessionId =
      normalizeSessionId(
        sessionId
      );

    const safeMessage =
      cleanText(
        currentMessage,
        4000
      );

    if (
      !this.memory ||
      typeof this.memory.buildContextBlock !==
        "function"
    ) {
      this.stats.failures += 1;

      return {
        success: false,
        status:
          "memory_unavailable",
        context: "",
      };
    }

    try {
      const context =
        await this.memory.buildContextBlock(
          safeSessionId,
          safeMessage,
          {
            ownerId:
              safeOwnerId,
          }
        );

      this.stats.contextReads += 1;

      return {
        success: true,
        status: "ready",
        context:
          safeString(
            context
          ),
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: "failed",
        context: "",
        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // GET LONG-TERM FACTS
  // ==========================================================

  async getFacts({
    ownerId,
    limit = DEFAULT_FACT_LIMIT,
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeLimit =
      normalizeLimit(
        limit,
        DEFAULT_FACT_LIMIT,
        MAX_FACT_LIMIT
      );

    if (
      !this.memory ||
      typeof this.memory.getFacts !==
        "function"
    ) {
      this.stats.failures += 1;

      return [];
    }

    try {
      const facts =
        await this.memory.getFacts(
          safeLimit,
          {
            ownerId:
              safeOwnerId,
          }
        );

      this.stats.factReads += 1;

      return Array.isArray(facts)
        ? facts
        : [];
    } catch (error) {
      this.stats.failures += 1;

      return [];
    }
  }

  // ==========================================================
  // RELEVANT MEMORY
  // ==========================================================

  async getRelevantMemory({
    ownerId,
    sessionId,
    query,
    messageLimit = 20,
    factLimit = 20,
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeSessionId =
      normalizeSessionId(
        sessionId
      );

    const safeQuery =
      cleanText(
        query,
        4000
      );

    if (!safeQuery) {
      return {
        success: true,
        messages: [],
        facts: [],
      };
    }

    const result = {
      success: true,
      messages: [],
      facts: [],
    };

    try {
      if (
        this.memory &&
        typeof this.memory.getRelevantMessages ===
          "function"
      ) {
        const messages =
          await this.memory.getRelevantMessages(
            safeSessionId,
            safeQuery,
            normalizeLimit(
              messageLimit,
              20,
              50
            )
          );

        result.messages =
          Array.isArray(messages)
            ? messages
            : [];
      }

      if (
        this.memory &&
        typeof this.memory.getRelevantFacts ===
          "function"
      ) {
        const facts =
          await this.memory.getRelevantFacts(
            safeQuery,
            normalizeLimit(
              factLimit,
              20,
              50
            ),
            {
              ownerId:
                safeOwnerId,
            }
          );

        result.facts =
          Array.isArray(facts)
            ? facts
            : [];
      }

      this.stats.reads += 1;

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        messages: [],
        facts: [],
        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // EXPLICIT "REMEMBER THIS"
  // ==========================================================

  async remember({
    ownerId,
    fact,
    category = "general",
    importance = 7,
  } = {}) {
    const safeOwnerId =
      normalizeOwnerId(
        ownerId
      );

    const safeFact =
      cleanText(
        fact,
        4000
      );

    if (!safeFact) {
      return {
        success: false,
        status: "empty",
      };
    }

    if (
      !this.memory
    ) {
      this.stats.failures += 1;

      return {
        success: false,
        status:
          "memory_unavailable",
      };
    }

    // --------------------------------------------------------
    // Current ChatMemory exposes explicit memory support.
    // We check the available method instead of assuming one.
    // --------------------------------------------------------

    try {
      if (
        typeof this.memory.rememberFact ===
        "function"
      ) {
        const result =
          await this.memory.rememberFact(
            safeOwnerId,
            safeFact,
            {
              category,
              importance,
            }
          );

        this.stats.explicitMemories += 1;

        return {
          success: true,
          status: "remembered",
          fact:
            result || safeFact,
        };
      }

      if (
        typeof this.memory.saveFact ===
        "function"
      ) {
        const result =
          await this.memory.saveFact(
            safeOwnerId,
            safeFact,
            {
              category,
              importance,
              source:
                "explicit",
            }
          );

        this.stats.explicitMemories += 1;

        return {
          success: true,
          status: "remembered",
          fact:
            result || safeFact,
        };
      }

      return {
        success: false,
        status:
          "explicit_memory_method_unavailable",
        message:
          "Existing ChatMemory me explicit memory method available nahi mila.",
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: "failed",
        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  isAvailable() {
    return Boolean(
      this.memory
    );
  }

  getInfo() {
    return {
      success: true,

      version:
        this.version,

      available:
        this.isAvailable(),

      methods: {
        saveMessage:
          typeof this.memory?.saveMessage ===
          "function",

        getRecentMessages:
          typeof this.memory?.getRecentMessages ===
          "function",

        buildContextBlock:
          typeof this.memory?.buildContextBlock ===
          "function",

        getFacts:
          typeof this.memory?.getFacts ===
          "function",

        getRelevantMessages:
          typeof this.memory?.getRelevantMessages ===
          "function",

        getRelevantFacts:
          typeof this.memory?.getRelevantFacts ===
          "function",

        rememberFact:
          typeof this.memory?.rememberFact ===
          "function",

        saveFact:
          typeof this.memory?.saveFact ===
          "function",
      },

      stats: {
        ...this.stats,
      },
    };
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    return {
      version:
        this.version,

      ...this.stats,
    };
  }

  resetStats() {
    this.stats = {
      saves: 0,
      reads: 0,
      contextReads: 0,
      factReads: 0,
      explicitMemories: 0,
      failures: 0,
    };

    return this.getStats();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let singleton = null;

function createAgentMemoryBridge(
  options = {}
) {
  return new AgentMemoryBridge(
    options
  );
}

function getAgentMemoryBridge(
  options = {}
) {
  if (!singleton) {
    singleton =
      createAgentMemoryBridge(
        options
      );
  }

  return singleton;
}

function resetAgentMemoryBridge() {
  singleton = null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentMemoryBridge,

  createAgentMemoryBridge,

  getAgentMemoryBridge,

  resetAgentMemoryBridge,
};