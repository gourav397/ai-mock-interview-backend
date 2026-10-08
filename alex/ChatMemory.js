// ============================================================
// ALEX CHAT MEMORY — ADVANCED VERSION
// ============================================================
// Purpose:
// - Unlimited conversation storage in MongoDB
// - Smart recent + relevant context retrieval
// - Long-term owner memory
// - Explicit "remember this" support
// - Fact update / deduplication
// - Backward-compatible public methods
// ============================================================

const mongoose = require("mongoose");

// ============================================================
// CONFIG
// ============================================================

const MAX_STORED_MESSAGE_LENGTH = 8000;

// Recent messages used for conversational continuity.
// Database is NOT limited by this number.
const DEFAULT_RECENT_LIMIT = 30;
const MAX_RECENT_LIMIT = 100;

// Relevant old messages.
const DEFAULT_RELEVANT_LIMIT = 20;
const MAX_RELEVANT_LIMIT = 50;

// Long-term facts.
const DEFAULT_FACT_LIMIT = 50;
const MAX_FACT_LIMIT = 200;

// Context safety limits.
// These only limit what is sent to Gemini,
// NOT what is stored in MongoDB.
const MAX_CONTEXT_MESSAGES = 60;
const MAX_CONTEXT_CHARS = 30000;
const MAX_FACT_CONTEXT_CHARS = 12000;

// ============================================================
// CHAT MESSAGE SCHEMA
// ============================================================

const chatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },

    // Optional owner identifier.
    // Kept optional for compatibility with existing calls.
    ownerId: {
      type: String,
      default: null,
      index: true,
    },

    role: {
      type: String,
      enum: ["owner", "alex"],
      required: true,
      index: true,
    },

    text: {
      type: String,
      required: true,
      maxlength: MAX_STORED_MESSAGE_LENGTH,
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Useful for future retrieval/ranking.
    normalizedText: {
      type: String,
      default: "",
      index: true,
    },
  },
  {
    capped: false,
    timestamps: false,
  }
);

// Fast conversation retrieval.
chatMessageSchema.index({
  sessionId: 1,
  timestamp: -1,
});

// Owner-specific retrieval.
chatMessageSchema.index({
  ownerId: 1,
  timestamp: -1,
});

// ============================================================
// LONG-TERM MEMORY FACT
// ============================================================

const memoryFactSchema = new mongoose.Schema(
  {
    ownerId: {
      type: String,
      default: null,
      index: true,
    },

    fact: {
      type: String,
      required: true,
      index: true,
    },

    // Normalized version helps duplicate detection.
    normalizedFact: {
      type: String,
      required: true,
      index: true,
    },

    // Categories make future retrieval easier.
    category: {
      type: String,
      enum: [
        "identity",
        "preference",
        "project",
        "work",
        "personal",
        "instruction",
        "general",
      ],
      default: "general",
      index: true,
    },

    importance: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },

    source: {
      type: String,
      enum: ["explicit", "detected"],
      default: "detected",
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    capped: false,
  }
);

memoryFactSchema.index({
  ownerId: 1,
  updatedAt: -1,
});

memoryFactSchema.index({
  ownerId: 1,
  category: 1,
  importance: -1,
});

// ============================================================
// MODELS
// ============================================================

const ChatMessage =
  mongoose.models.AlexChatMessage ||
  mongoose.model("AlexChatMessage", chatMessageSchema);

const MemoryFact =
  mongoose.models.AlexMemoryFact ||
  mongoose.model("AlexMemoryFact", memoryFactSchema);

// ============================================================
// MEMORY INDEX MIGRATION
// Remove old global unique fact index.
// Memory is owner-scoped, so same fact can exist for different owners.
// ============================================================
(async () => {
  try {
    await MemoryFact.collection.dropIndex("fact_1");
    console.log("[ALEX MEMORY] Old global unique fact index removed.");
  } catch (error) {
    // Index already removed / does not exist
    if (error?.codeName !== "IndexNotFound") {
      console.warn(
        "[ALEX MEMORY] Index migration warning:",
        error?.message || error
      );
    }
  }
})();


// ============================================================
// HELPERS
// ============================================================

function cleanText(value, maxLength = MAX_STORED_MESSAGE_LENGTH) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 3);
}

function uniqueArray(items) {
  return [...new Set(items.filter(Boolean))];
}

// ============================================================
// CHAT MEMORY CLASS
// ============================================================

class ChatMemory {
  // ==========================================================
  // SAVE MESSAGE
  // ==========================================================

  async saveMessage(sessionId, role, text, options = {}) {
    try {
      const safeSessionId = cleanText(sessionId || "default", 200);
      const safeRole = role === "alex" ? "alex" : "owner";
      const safeText = cleanText(text);

      if (!safeText) {
        return null;
      }

      const ownerId = options?.ownerId
        ? cleanText(options.ownerId, 200)
        : null;

      const message = await ChatMessage.create({
        sessionId: safeSessionId,
        ownerId,
        role: safeRole,
        text: safeText,
        normalizedText: normalizeText(safeText),
        timestamp: new Date(),
      });

      // Only owner messages can create long-term memories.
      if (safeRole === "owner") {
        await this._extractFacts(safeText, {
          ownerId,
          explicit: false,
        });
      }

      return message;
    } catch (error) {
      console.error(
        "[ALEX] ChatMemory save error:",
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // EXPLICIT MEMORY
  // ==========================================================

  async remember(text, options = {}) {
    try {
      const original = cleanText(text);

      if (!original) {
        return {
          success: false,
          saved: [],
        };
      }

      const ownerId = options?.ownerId
        ? cleanText(options.ownerId, 200)
        : null;

      const extracted = this._extractExplicitMemoryText(original);

      if (!extracted) {
        return {
          success: false,
          saved: [],
        };
      }

      const facts = await this._extractFacts(extracted, {
        ownerId,
        explicit: true,
      });

      // If no structured fact was detected,
      // save the explicit statement itself.
      if (!facts.length) {
        const fact = this._cleanMemoryStatement(extracted);

        if (fact) {
          const saved = await this._saveFact(fact, {
            ownerId,
            category: this._guessCategory(fact),
            importance: 7,
            source: "explicit",
          });

          return {
            success: Boolean(saved),
            saved: saved ? [saved.fact] : [],
          };
        }
      }

      return {
        success: facts.length > 0,
        saved: facts,
      };
    } catch (error) {
      console.error(
        "[ALEX] Explicit memory error:",
        error?.message || error
      );

      return {
        success: false,
        saved: [],
      };
    }
  }

  // ==========================================================
  // EXTRACT FACTS
  // ==========================================================

  async _extractFacts(text, options = {}) {
    const original = cleanText(text);

    if (!original) {
      return [];
    }

    const ownerId = options?.ownerId
      ? cleanText(options.ownerId, 200)
      : null;

    const explicit = Boolean(options?.explicit);
    const facts = [];

   // --------------------------------------------------------
// NAME — HINDI / HINGLISH
// Only save actual name statements.
// Questions like:
// "mera naam kya hai"
// "mera naam kya h"
// "mera naam btao"
// "mera naam batao"
// must NEVER be saved as a name.
// --------------------------------------------------------

  let match = original.match(
  /\bmera\s+(?:naam|name)\s+(?:(?:hai|h)\s+)?([A-Za-z]{2,40})(?:\s+(?:hai|h))?\b/i
);

if (match) {
  const name = match[1].trim();

  const invalidNameWords = new Set([
    "kya",
    "btao",
    "batao",
    "bta",
    "bata",
    "bolo",
    "bol",
    "kaun",
    "kon",
    "who",
    "what",
    "tell",
    "name",
    "mera",
    "my",
    "hai",
    "h",
  ]);

  if (!invalidNameWords.has(name.toLowerCase())) {
    facts.push({
      fact: `Owner's name is ${name}`,
      category: "identity",
      importance: 10,
    });
  }
}

    // --------------------------------------------------------
    // NAME — ENGLISH
    // --------------------------------------------------------

    match = original.match(
      /\bmy\s+name\s+(?:is|=)\s+([A-Za-z]{2,40})\b/i
    );

    if (match) {
      facts.push({
        fact: `Owner's name is ${match[1].trim()}`,
        category: "identity",
        importance: 10,
      });
    }

    // --------------------------------------------------------
    // I AM NAME
    // --------------------------------------------------------

    match = original.match(
      /\bi\s+am\s+([A-Za-z]{2,40})\b/i
    );

    if (match && !this._looksLikeAgeStatement(original)) {
      const ignored = new Set([
        "fine",
        "good",
        "okay",
        "ok",
        "ready",
        "here",
        "back",
        "busy",
        "happy",
        "sad",
        "tired",
        "confused",
        "learning",
        "working",
        "coding",
      ]);

      const name = match[1].trim();

      if (!ignored.has(name.toLowerCase())) {
        facts.push({
          fact: `Owner's name is ${name}`,
          category: "identity",
          importance: 10,
        });
      }
    }

    // --------------------------------------------------------
    // I'M NAME
    // --------------------------------------------------------

    match = original.match(
      /\bi['’]?m\s+([A-Za-z]{2,40})\b/i
    );

    if (match && !this._looksLikeAgeStatement(original)) {
      const ignored = new Set([
        "fine",
        "good",
        "okay",
        "ok",
        "ready",
        "here",
        "back",
        "busy",
        "happy",
        "sad",
        "tired",
        "confused",
        "learning",
        "working",
        "coding",
      ]);

      const name = match[1].trim();

      if (!ignored.has(name.toLowerCase())) {
        facts.push({
          fact: `Owner's name is ${name}`,
          category: "identity",
          importance: 10,
        });
      }
    }

    // --------------------------------------------------------
    // AGE — HINDI
    // --------------------------------------------------------

    match = original.match(
      /\bmeri\s+umar\s+(\d{1,3})\s*(?:saal|years?)?\b/i
    );

    if (match) {
      facts.push({
        fact: `Owner's age is ${match[1]}`,
        category: "personal",
        importance: 7,
      });
    }

    // --------------------------------------------------------
    // AGE — ENGLISH
    // --------------------------------------------------------

    match = original.match(
      /\bi\s+am\s+(\d{1,3})\s+years?\s+old\b/i
    );

    if (match) {
      facts.push({
        fact: `Owner's age is ${match[1]}`,
        category: "personal",
        importance: 7,
      });
    }

    // --------------------------------------------------------
    // LIKES — HINDI
    // --------------------------------------------------------

    match = original.match(
      /\bmujhe\s+(.{2,100}?)\s+pasand\s+(?:hai|hain)\b/i
    );

    if (match) {
      const thing = this._cleanExtractedValue(match[1]);

      if (thing) {
        facts.push({
          fact: `Owner likes ${thing}`,
          category: "preference",
          importance: 6,
        });
      }
    }

    // --------------------------------------------------------
    // LIKES — ENGLISH
    // --------------------------------------------------------

    match = original.match(
      /\bi\s+(?:really\s+)?like\s+(.{2,100})$/i
    );

    if (match) {
      const thing = this._cleanExtractedValue(match[1]);

      if (thing && !this._looksLikeConversationNoise(thing)) {
        facts.push({
          fact: `Owner likes ${thing}`,
          category: "preference",
          importance: 6,
        });
      }
    }

    // --------------------------------------------------------
    // DISLIKES — HINDI
    // --------------------------------------------------------

    match = original.match(
      /\bmujhe\s+(.{2,100}?)\s+pasand\s+nahi\s+(?:hai|hain)?\b/i
    );

    if (match) {
      const thing = this._cleanExtractedValue(match[1]);

      if (thing) {
        facts.push({
          fact: `Owner does not like ${thing}`,
          category: "preference",
          importance: 6,
        });
      }
    }

    // --------------------------------------------------------
    // DISLIKES — ENGLISH
    // --------------------------------------------------------

    match = original.match(
      /\bi\s+(?:really\s+)?(?:do\s+not|don't|dont)\s+like\s+(.{2,100})$/i
    );

    if (match) {
      const thing = this._cleanExtractedValue(match[1]);

      if (thing) {
        facts.push({
          fact: `Owner does not like ${thing}`,
          category: "preference",
          importance: 6,
        });
      }
    }

    // --------------------------------------------------------
    // PROJECT STATEMENTS
    // --------------------------------------------------------

    const projectPatterns = [
      /\bmera\s+project\s+(.{2,100})\s+(?:hai|h)\b/i,
      /\bmy\s+project\s+is\s+(.{2,100})$/i,
      /\bmain\s+(.{2,100})\s+project\s+par\s+kaam\s+kar\s+raha\s+hu\b/i,
      /\bi\s+(?:am\s+)?working\s+on\s+(.{2,100})$/i,
    ];

    for (const pattern of projectPatterns) {
      match = original.match(pattern);

      if (match) {
        const project = this._cleanExtractedValue(match[1]);

        if (project) {
          facts.push({
            fact: `Owner is working on ${project}`,
            category: "project",
            importance: 8,
          });

          break;
        }
      }
    }

    // --------------------------------------------------------
    // EXPLICIT MEMORY STATEMENT
    // --------------------------------------------------------

    if (explicit && !facts.length) {
      const cleaned = this._cleanMemoryStatement(original);

      if (cleaned) {
        facts.push({
          fact: cleaned,
          category: this._guessCategory(cleaned),
          importance: 7,
        });
      }
    }

    // --------------------------------------------------------
    // SAVE
    // --------------------------------------------------------

    const savedFacts = [];

    for (const item of facts) {
      try {
        const saved = await this._saveFact(item.fact, {
          ownerId,
          category: item.category,
          importance: item.importance,
          source: explicit ? "explicit" : "detected",
        });

        if (saved?.fact) {
          savedFacts.push(saved.fact);
        }
      } catch (error) {
        console.error(
          "[ALEX] Memory fact save error:",
          error?.message || error
        );
      }
    }

    return uniqueArray(savedFacts);
  }

  // ==========================================================
  // SAVE FACT
  // ==========================================================

  async _saveFact(fact, options = {}) {
    const cleanFact = this._cleanMemoryStatement(fact);

    if (!cleanFact) {
      return null;
    }

    const ownerId = options?.ownerId
      ? cleanText(options.ownerId, 200)
      : null;

    const normalizedFact = normalizeText(cleanFact);

    if (!normalizedFact) {
      return null;
    }

    const category =
      options?.category || this._guessCategory(cleanFact);

    const importance = Math.min(
      Math.max(Number(options?.importance) || 5, 1),
      10
    );

    const source =
      options?.source === "explicit"
        ? "explicit"
        : "detected";

    // --------------------------------------------------------
    // SPECIAL HANDLING FOR IDENTITY
    // --------------------------------------------------------

    if (
      normalizedFact.startsWith("owner s name is")
    ) {
      await MemoryFact.deleteMany({
        ownerId,
        category: "identity",
        normalizedFact: {
          $regex: "^owner s name is",
        },
      });
    }

    // --------------------------------------------------------
    // UPDATE EXISTING FACT
    // --------------------------------------------------------

    const existing = await MemoryFact.findOne({
      ownerId,
      normalizedFact,
    }).lean();

    if (existing) {
      await MemoryFact.updateOne(
        { _id: existing._id },
        {
          $set: {
            fact: cleanFact,
            category,
            importance,
            source,
            updatedAt: new Date(),
          },
        }
      );

      console.log(
        `[ALEX MEMORY] Updated: ${cleanFact}`
      );

      return {
        ...existing,
        fact: cleanFact,
        category,
        importance,
        source,
      };
    }

    // --------------------------------------------------------
    // CREATE
    // --------------------------------------------------------

    try {
      const created = await MemoryFact.create({
        ownerId,
        fact: cleanFact,
        normalizedFact,
        category,
        importance,
        source,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(
        `[ALEX MEMORY] Saved: ${cleanFact}`
      );

      return created;
    } catch (error) {
      // Race-condition safe fallback.
      if (error?.code === 11000) {
        return await MemoryFact.findOne({
          ownerId,
          normalizedFact,
        }).lean();
      }

      throw error;
    }
  }

  // ==========================================================
  // GET RECENT MESSAGES
  // ==========================================================

  async getRecentMessages(sessionId, limit = DEFAULT_RECENT_LIMIT) {
    try {
      const safeSessionId = cleanText(
        sessionId || "default",
        200
      );

      const safeLimit = Math.min(
        Math.max(Number(limit) || DEFAULT_RECENT_LIMIT, 1),
        MAX_RECENT_LIMIT
      );

      const msgs = await ChatMessage.find({
        sessionId: safeSessionId,
      })
        .sort({ timestamp: -1 })
        .limit(safeLimit)
        .lean();

      return msgs.reverse().map((message) => ({
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
      }));
    } catch (error) {
      console.error(
        "[ALEX] Recent messages error:",
        error?.message || error
      );

      return [];
    }
  }

  // ==========================================================
  // GET ALL FACTS
  // ==========================================================

  async getFacts(limit = DEFAULT_FACT_LIMIT, options = {}) {
    try {
      const safeLimit = Math.min(
        Math.max(Number(limit) || DEFAULT_FACT_LIMIT, 1),
        MAX_FACT_LIMIT
      );

      const ownerId = options?.ownerId
        ? cleanText(options.ownerId, 200)
        : null;

      const query = {
        ownerId,
      };

      const facts = await MemoryFact.find(query)
        .sort({
          importance: -1,
          updatedAt: -1,
        })
        .limit(safeLimit)
        .lean();

      return facts.map((fact) => fact.fact);
    } catch (error) {
      console.error(
        "[ALEX] Get facts error:",
        error?.message || error
      );

      return [];
    }
  }

  // ==========================================================
  // GET RELEVANT OLD MESSAGES
  // ==========================================================

  async getRelevantMessages(
    sessionId,
    queryText,
    limit = DEFAULT_RELEVANT_LIMIT
  ) {
    try {
      const safeSessionId = cleanText(
        sessionId || "default",
        200
      );

      const safeLimit = Math.min(
        Math.max(Number(limit) || DEFAULT_RELEVANT_LIMIT, 1),
        MAX_RELEVANT_LIMIT
      );

      const tokens = uniqueArray(tokenize(queryText))
        .filter((token) => token.length >= 4)
        .slice(0, 12);

      if (!tokens.length) {
        return [];
      }

      const regexes = tokens.map(
        (token) => new RegExp(escapeRegex(token), "i")
      );

      const messages = await ChatMessage.find({
        sessionId: safeSessionId,
        normalizedText: {
          $in: regexes,
        },
      })
        .sort({ timestamp: -1 })
        .limit(safeLimit * 3)
        .lean();

      // Score messages by number of matching keywords.
      const scored = messages.map((message) => {
        const normalized = message.normalizedText || "";

        let score = 0;

        for (const token of tokens) {
          if (normalized.includes(token)) {
            score += token.length >= 6 ? 2 : 1;
          }
        }

        return {
          ...message,
          score,
        };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return (
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime()
        );
      });

      return scored.slice(0, safeLimit).reverse().map((message) => ({
        role: message.role,
        text: message.text,
        timestamp: message.timestamp,
      }));
    } catch (error) {
      console.error(
        "[ALEX] Relevant message search error:",
        error?.message || error
      );

      return [];
    }
  }

  // ==========================================================
  // SMART MEMORY SEARCH
  // ==========================================================

  async searchMemory(queryText, options = {}) {
    try {
      const query = cleanText(queryText);

      if (!query) {
        return {
          facts: [],
          messages: [],
        };
      }

      const sessionId = options?.sessionId || "default";
      const ownerId = options?.ownerId || null;

      const [facts, messages] = await Promise.all([
        this.getRelevantFacts(query, 20, { ownerId }),
        this.getRelevantMessages(
          sessionId,
          query,
          20
        ),
      ]);

      return {
        facts,
        messages,
      };
    } catch (error) {
      console.error(
        "[ALEX] Memory search error:",
        error?.message || error
      );

      return {
        facts: [],
        messages: [],
      };
    }
  }

  // ==========================================================
  // GET RELEVANT FACTS
  // ==========================================================

  async getRelevantFacts(
    queryText,
    limit = 20,
    options = {}
  ) {
    try {
      const safeQuery = cleanText(queryText);

      if (!safeQuery) {
        return [];
      }

      const ownerId = options?.ownerId
        ? cleanText(options.ownerId, 200)
        : null;

      const safeLimit = Math.min(
        Math.max(Number(limit) || 20, 1),
        50
      );

      const tokens = uniqueArray(tokenize(safeQuery))
        .filter((token) => token.length >= 3)
        .slice(0, 15);

      if (!tokens.length) {
        return [];
      }

      const regexes = tokens.map(
        (token) => new RegExp(escapeRegex(token), "i")
      );

      const facts = await MemoryFact.find({
        ownerId,
        $or: [
          {
            normalizedFact: {
              $in: regexes,
            },
          },
          {
            fact: {
              $in: regexes,
            },
          },
        ],
      })
        .sort({
          importance: -1,
          updatedAt: -1,
        })
        .limit(safeLimit)
        .lean();

      // Mark relevant memories as recently used.
      if (facts.length) {
        await MemoryFact.updateMany(
          {
            _id: {
              $in: facts.map((fact) => fact._id),
            },
          },
          {
            $set: {
              lastUsedAt: new Date(),
            },
          }
        );
      }

      return facts.map((fact) => fact.fact);
    } catch (error) {
      console.error(
        "[ALEX] Relevant facts error:",
        error?.message || error
      );

      return [];
    }
  }

  // ==========================================================
  // BUILD SMART CONTEXT
  // ==========================================================

  async buildContextBlock(sessionId, currentMessage = "", options = {}) {
    try {
      const safeSessionId = cleanText(
        sessionId || "default",
        200
      );

      const safeCurrentMessage = cleanText(
        currentMessage
      );

      const ownerId = options?.ownerId
        ? cleanText(options.ownerId, 200)
        : null;

      // ------------------------------------------------------
      // Fetch in parallel.
      // ------------------------------------------------------

      const [
        recentMessages,
        allFacts,
        relevantMessages,
        relevantFacts,
      ] = await Promise.all([
        this.getRecentMessages(
          safeSessionId,
          DEFAULT_RECENT_LIMIT
        ),

        this.getFacts(DEFAULT_FACT_LIMIT, {
          ownerId,
        }),

        safeCurrentMessage
          ? this.getRelevantMessages(
              safeSessionId,
              safeCurrentMessage,
              DEFAULT_RELEVANT_LIMIT
            )
          : Promise.resolve([]),

        safeCurrentMessage
          ? this.getRelevantFacts(
              safeCurrentMessage,
              20,
              { ownerId }
            )
          : Promise.resolve([]),
      ]);

      let block = "";

      // ------------------------------------------------------
      // LONG-TERM MEMORY
      // ------------------------------------------------------

      const mergedFacts = uniqueArray([
        ...relevantFacts,
        ...allFacts,
      ]);

      if (mergedFacts.length) {
        let factText = mergedFacts
          .map((fact) => `- ${fact}`)
          .join("\n");

        factText = factText.slice(
          0,
          MAX_FACT_CONTEXT_CHARS
        );

        block +=
          "LONG-TERM MEMORY ABOUT OWNER:\n";

        block += factText;

        block += "\n\n";
      }

      // ------------------------------------------------------
      // RELEVANT OLD CONVERSATION
      // ------------------------------------------------------

      const recentKeys = new Set(
        recentMessages.map(
          (message) =>
            `${message.role}:${message.text}`
        )
      );

      const relevantOld = relevantMessages.filter(
        (message) =>
          !recentKeys.has(
            `${message.role}:${message.text}`
          )
      );

      if (relevantOld.length) {
        block +=
          "RELEVANT OLDER CONVERSATION:\n";

        for (const message of relevantOld) {
          const label =
            message.role === "owner"
              ? "OWNER"
              : "ALEX";

          block += `${label}: ${message.text}\n`;
        }

        block += "\n";
      }

      // ------------------------------------------------------
      // RECENT CONVERSATION
      // ------------------------------------------------------

      if (recentMessages.length) {
        block += "RECENT CONVERSATION:\n";

        const limitedRecent =
          recentMessages.slice(
            -MAX_CONTEXT_MESSAGES
          );

        for (const message of limitedRecent) {
          const label =
            message.role === "owner"
              ? "OWNER"
              : "ALEX";

          block += `${label}: ${message.text}\n`;
        }

        block += "\n";
      }

      // ------------------------------------------------------
      // FINAL CONTEXT SIZE PROTECTION
      // ------------------------------------------------------

      if (block.length > MAX_CONTEXT_CHARS) {
        block = block.slice(
          block.length - MAX_CONTEXT_CHARS
        );
      }

      return block.trim();
    } catch (error) {
      console.error(
        "[ALEX] Build context error:",
        error?.message || error
      );

      return "";
    }
  }

  // ==========================================================
  // MEMORY QUESTION HELPER
  // ==========================================================

  async answerMemoryQuestion(question, options = {}) {
    try {
      const text = normalizeText(question);

      if (!text) {
        return null;
      }

      const ownerId = options?.ownerId || null;

      // ------------------------------------------------------
      // NAME
      // ------------------------------------------------------

      if (
        text.includes("mera naam") ||
        text.includes("my name") ||
        text.includes("what is my name") ||
        text.includes("whats my name")
      ) {
        const facts = await MemoryFact.find({
          ownerId,
          category: "identity",
          normalizedFact: {
            $regex: "^owner s name is",
          },
        })
          .sort({ updatedAt: -1 })
          .limit(1)
          .lean();

        if (facts.length) {
          return facts[0].fact.replace(
            /^Owner's name is\s*/i,
            ""
          );
        }
      }

      // ------------------------------------------------------
      // GENERAL MEMORY SEARCH
      // ------------------------------------------------------

      const result = await this.searchMemory(
        question,
        {
          ownerId,
          sessionId: options?.sessionId || "default",
        }
      );

      if (result.facts.length) {
        return result.facts.slice(0, 5).join("; ");
      }

      return null;
    } catch (error) {
      console.error(
        "[ALEX] Memory question error:",
        error?.message || error
      );

      return null;
    }
  }

  // ==========================================================
  // FORGET FACT
  // ==========================================================

  async forget(query, options = {}) {
    try {
      const safeQuery = cleanText(query);

      if (!safeQuery) {
        return {
          success: false,
          deleted: 0,
        };
      }

      const ownerId = options?.ownerId || null;
      const normalizedQuery = normalizeText(
        safeQuery
      );

      const result = await MemoryFact.deleteMany({
        ownerId,
        $or: [
          {
            normalizedFact: {
              $regex: escapeRegex(normalizedQuery),
              $options: "i",
            },
          },
          {
            fact: {
              $regex: escapeRegex(safeQuery),
              $options: "i",
            },
          },
        ],
      });

      console.log(
        `[ALEX MEMORY] Forgotten ${result.deletedCount} fact(s)`
      );

      return {
        success: true,
        deleted: result.deletedCount || 0,
      };
    } catch (error) {
      console.error(
        "[ALEX] Forget memory error:",
        error?.message || error
      );

      return {
        success: false,
        deleted: 0,
      };
    }
  }

  // ==========================================================
  // CLEAR SESSION
  // ==========================================================

  async clearSession(sessionId) {
    try {
      const safeSessionId = cleanText(
        sessionId || "default",
        200
      );

      const result = await ChatMessage.deleteMany({
        sessionId: safeSessionId,
      });

      console.log(
        `[ALEX] Cleared session ${safeSessionId}: ${result.deletedCount} messages`
      );

      return {
        success: true,
        deleted: result.deletedCount || 0,
      };
    } catch (error) {
      console.error(
        "[ALEX] Clear session error:",
        error?.message || error
      );

      return {
        success: false,
        deleted: 0,
      };
    }
  }

  // ==========================================================
  // PRIVATE HELPERS
  // ==========================================================

  _extractExplicitMemoryText(text) {
    let value = cleanText(text);

    // Remove common "remember" prefixes.
    value = value.replace(
      /^\s*(?:please\s+)?(?:remember|yaad\s+rakh(?:na)?|yaad\s+rakho)\s*/i,
      ""
    );

    value = value.replace(
      /^\s*(?:this|it|ye|yeh)\s*(?:ko|ki)?\s*/i,
      ""
    );

    value = value.replace(
      /^\s*(?:that|ki)\s+/i,
      ""
    );

    return this._cleanMemoryStatement(value);
  }

  _cleanMemoryStatement(value) {
    let text = cleanText(value, 1000);

    if (!text) {
      return "";
    }

    // Remove accidental memory command wording.
    text = text.replace(
      /^(?:remember|yaad\s+rakh(?:na)?|yaad\s+rakho)\s*/i,
      ""
    );

    text = text.replace(
      /\s+(?:please\s+)?(?:remember|yaad\s+rakh(?:na)?|yaad\s+rakho)\s*$/i,
      ""
    );

    // Avoid meaningless statements.
    const normalized = normalizeText(text);

    const ignored = new Set([
      "",
      "this",
      "it",
      "ye",
      "yeh",
      "that",
      "okay",
      "ok",
      "haan",
      "yes",
    ]);

    if (ignored.has(normalized)) {
      return "";
    }

    return text;
  }

  _cleanExtractedValue(value) {
    let text = cleanText(value, 150);

    text = text
      .replace(/[.!?,;:]+$/g, "")
      .replace(/^(?:ki|ke|ka)\s+/i, "")
      .trim();

    return text;
  }

  _looksLikeAgeStatement(text) {
    return /\b\d{1,3}\s*(?:years?\s+old|saal)\b/i.test(
      text
    );
  }

  _looksLikeConversationNoise(text) {
    const normalized = normalizeText(text);

    const noise = [
      "this",
      "that",
      "it",
      "this one",
      "that one",
      "the answer",
      "your answer",
      "this answer",
      "the response",
      "your response",
    ];

    return noise.includes(normalized);
  }

  _guessCategory(text) {
    const normalized = normalizeText(text);

    if (
      normalized.includes("name") ||
      normalized.includes("naam")
    ) {
      return "identity";
    }

    if (
      normalized.includes("like") ||
      normalized.includes("pasand") ||
      normalized.includes("prefer") ||
      normalized.includes("favorite")
    ) {
      return "preference";
    }

    if (
      normalized.includes("project") ||
      normalized.includes("backend") ||
      normalized.includes("frontend") ||
      normalized.includes("app") ||
      normalized.includes("website") ||
      normalized.includes("coding")
    ) {
      return "project";
    }

    if (
      normalized.includes("work") ||
      normalized.includes("job") ||
      normalized.includes("study") ||
      normalized.includes("school")
    ) {
      return "work";
    }

    return "general";
  }
}

// ============================================================
// SINGLETON
// ============================================================

const chatMemory = new ChatMemory();

function getChatMemory() {
  return chatMemory;
}

module.exports = chatMemory;

// Backward-compatible getter for AgentConversationGateway
module.exports.getChatMemory = getChatMemory;