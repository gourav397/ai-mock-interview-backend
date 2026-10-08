// ============================================================
// ALEX — AGENT CONVERSATION GATEWAY
// Version: 2.0.0
//
// PURPOSE:
//   ALEX ke liye single conversation entry layer.
//
// FLOW:
//
//   USER MESSAGE
//        ↓
//   ConversationGateway
//        ↓
//   Goal Router
//        ├── CHAT
//        ├── MEMORY
//        ├── WEB RESEARCH
//        ├── COMPUTER / SYSTEM TOOL
//        └── AUTONOMOUS TASK
//
//   Unknown / complex OWNER goals
//        ↓
//   AlexBrain fallback
//
// ACCESS MODEL:
//
//   NORMAL USER
//      ├── CHAT             ✅
//      ├── MEMORY           ✅
//      ├── WEB RESEARCH     ✅
//      └── OWNER ACTIONS    ❌
//
//   OWNER / ADMIN
//      ├── CHAT             ✅
//      ├── MEMORY           ✅
//      ├── WEB RESEARCH     ✅
//      ├── COMPUTER / TOOL  ✅
//      └── AUTONOMOUS       ✅
//
// SECURITY:
//   - Ye file authentication bypass nahi karti.
//   - Ye file normal user ko owner privilege nahi deti.
//   - Actual privileged execution existing runtime /
//     security / allowlist layer ke through hota hai.
//   - Brain fallback sirf owner/admin context mein allowed hai.
//
// IMPORTANT:
//   - Unknown request ko automatically clarification nahi banaya jayega.
//   - Empty message par hi automatic clarification hogi.
//   - Existing session + memory behavior preserve rahega.
//   - Fake "completed" response nahi diya jayega.
// ============================================================

"use strict";

const {
  getAgentGoalRouter,
} = require("./AgentGoalRouter");

const {
  getChatMemory,
} = require("./ChatMemory");

const {
  getAlexBrain,
} = require("./AlexBrain");

const {
  getAgentRuntime,
} = require("./AgentRuntime");

// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "2.0.0";

const MAX_MESSAGE_LENGTH = 20000;

const MAX_HISTORY = 12;

const STATUS = Object.freeze({
  COMPLETED: "completed",
  PROCESSING: "processing",
  NEEDS_CONFIRMATION: "waiting_confirmation",
  NEEDS_CLARIFICATION: "needs_clarification",
  FAILED: "failed",
});

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

function normalizeMessage(value) {
  return safeString(value)
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function safeClone(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}

function normalizeOwnerId({
  ownerId = null,
  ownerKey = null,
  owner = null,
} = {}) {
  const candidates = [
    ownerId,
    ownerKey,
    owner?.userId,
    owner?.id,
    owner?._id,
    owner?.ownerId,
    owner?.ownerKey,
    owner?.email,
  ];

  for (const value of candidates) {
    const normalized =
      safeString(value).trim();

    if (
      normalized &&
      normalized !== "null" &&
      normalized !== "undefined"
    ) {
      return normalized;
    }
  }

  return null;
}

function normalizeSessionId(sessionId) {
  const value =
    safeString(sessionId).trim();

  return (
    value ||
    `alex-session-${Date.now()}`
  );
}

function normalizeRole(value) {
  return safeString(value)
    .trim()
    .toLowerCase();
}

function isOwnerContext(context = {}) {
  const user =
    context?.user || {};

  const owner =
    context?.owner || {};

  const userRole =
    normalizeRole(
      user.role
    );

  const ownerRole =
    normalizeRole(
      owner.role
    );

  return (
    user.isOwner === true ||
    user.isAdmin === true ||
    owner.isOwner === true ||
    owner.isAdmin === true ||
    userRole === "owner" ||
    userRole === "admin" ||
    ownerRole === "owner" ||
    ownerRole === "admin"
  );
}

function getAccessMode(context = {}) {
  return isOwnerContext(context)
    ? "owner"
    : "user";
}

function getResultMessage(result) {
  if (!result) {
    return "";
  }

  return safeString(
    result.message ||
    result.reply ||
    result.response ||
    result.text ||
    ""
  ).trim();
}

// ============================================================
// CONVERSATION GATEWAY
// ============================================================

class AgentConversationGateway {
  constructor(options = {}) {
    this.version =
      VERSION;

    this.goalRouter =
      options.goalRouter ||
      getAgentGoalRouter();

    this.memory =
      options.memory ||
      getChatMemory();

    this.brain =
      options.brain ||
      getAlexBrain(
        options.brainOptions || {}
      );

    this.runtime =
      options.runtime ||
      getAgentRuntime();

    this.stats = {
      total: 0,
      completed: 0,
      processing: 0,
      confirmations: 0,
      clarifications: 0,
      failures: 0,
    };
  }

  // ==========================================================
  // MAIN MESSAGE HANDLER
  // ==========================================================

  async handleMessage({
    ownerId = null,
    ownerKey = null,
    sessionId = null,
    message = "",
    context = {},
    execute = true,
    confirmed = false,
    confirmationReason = "",
    useBrain = true,
  } = {}) {
    this.stats.total += 1;

    const safeContext =
      safeClone(context) || {};

    const resolvedOwner =
      normalizeOwnerId({
        ownerId,
        ownerKey,
        owner:
          safeContext?.owner ||
          safeContext?.user ||
          null,
      });

    const resolvedSession =
      normalizeSessionId(
        sessionId
      );

    const text =
      normalizeMessage(message);

    // --------------------------------------------------------
    // EMPTY MESSAGE
    // --------------------------------------------------------

    if (!text) {
      this.stats.clarifications += 1;

      return {
        success: true,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          "clarification",

        sessionId:
          resolvedSession,

        message:
          "ALEX ko message nahi mila. Batao kya karna hai.",
      };
    }

    // --------------------------------------------------------
    // IDENTITY
    // --------------------------------------------------------

    if (!resolvedOwner) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          "authentication",

        sessionId:
          resolvedSession,

        error:
          "Authenticated user identity is required.",
      };
    }

    // --------------------------------------------------------
    // ACCESS MODE
    // --------------------------------------------------------

    const ownerMode =
      isOwnerContext(
        safeContext
      );

    const accessMode =
      getAccessMode(
        safeContext
      );

    // --------------------------------------------------------
    // LOAD HISTORY BEFORE ROUTING
    // --------------------------------------------------------

    const history =
      await this._getHistory(
        resolvedOwner,
        resolvedSession
      );

    // --------------------------------------------------------
    // BUILD CONTEXT
    // --------------------------------------------------------

    const enrichedContext = {
      ...safeContext,

      ownerId:
        resolvedOwner,

      sessionId:
        resolvedSession,

      accessMode,

      isOwner:
        ownerMode,

      isAdmin:
        normalizeRole(
          safeContext?.user?.role ||
          safeContext?.owner?.role
        ) === "admin",

      conversation: {
        ...(safeContext.conversation || {}),

        recentMessages:
          history,
      },

      gatewayVersion:
        this.version,
    };

    // --------------------------------------------------------
    // SAVE USER MESSAGE
    // --------------------------------------------------------

    await this._rememberMessage({
      ownerId:
        resolvedOwner,

      sessionId:
        resolvedSession,

      role:
        "user",

      content:
        text,
    });

    // --------------------------------------------------------
    // ROUTE MESSAGE
    // --------------------------------------------------------

    let routed;

    try {
      routed =
        await this.goalRouter.route({
          ownerId:
            resolvedOwner,

          ownerKey:
            resolvedOwner,

          message:
            text,

          context:
            enrichedContext,

          sessionId:
            resolvedSession,

          execute,

          confirmed,

          confirmationReason,
        });
    } catch (error) {
      this.stats.failures += 1;

      console.error(
        "[ALEX] Goal router failed:",
        error?.message ||
        error
      );

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          "router",

        sessionId:
          resolvedSession,

        error:
          error?.message ||
          String(error),
      };
    }

    // ========================================================
    // MEMORY
    // ========================================================

    if (
      routed?.route ===
      "memory"
    ) {
      return this._handleMemory({
        routed,
        text,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
        context:
          enrichedContext,
      });
    }

    // ========================================================
    // CHAT
    // ========================================================

    if (
      routed?.route ===
      "chat"
    ) {
      return this._handleChat({
        routed,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
      });
    }

    // ========================================================
    // CONFIRMATION
    // ========================================================

    if (
      routed?.status ===
      STATUS.NEEDS_CONFIRMATION
    ) {
      return this._handleConfirmation({
        routed,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
      });
    }

    // ========================================================
    // EXPLICIT CLARIFICATION
    // ========================================================
    //
    // IMPORTANT:
    //
    // Sirf actual clarification ko clarification maana jayega.
    //
    // "unknown" ko automatically clarification nahi banayenge.
    //
    // ========================================================

    if (
      routed?.status ===
        STATUS.NEEDS_CLARIFICATION ||
      routed?.route ===
        "clarification"
    ) {
      this.stats.clarifications += 1;

      const message =
        routed?.message ||
        routed?.reply ||
        "Request ko thoda aur clearly batao.";

      await this._rememberMessage({
        ownerId:
          resolvedOwner,

        sessionId:
          resolvedSession,

        role:
          "assistant",

        content:
          message,
      });

      return {
        success:
          routed?.success !== false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          routed?.route ||
          "clarification",

        sessionId:
          resolvedSession,

        message,
      };
    }

    // ========================================================
    // AUTONOMOUS
    // ========================================================

    if (
      routed?.route ===
      "autonomous"
    ) {
      return this._handleAutonomous({
        routed,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
      });
    }

    // ========================================================
    // RESEARCH
    // ========================================================

    if (
      routed?.route ===
      "research"
    ) {
      return this._handleResearch({
        routed,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
      });
    }

    // ========================================================
    // TOOL
    // ========================================================

    if (
      routed?.route ===
      "tool"
    ) {
      return this._handleTool({
        routed,
        ownerId:
          resolvedOwner,
        sessionId:
          resolvedSession,
      });
    }

    // ========================================================
    // UNKNOWN / UNSUPPORTED
    // ========================================================
    //
    // NEW BEHAVIOUR:
    //
    // NORMAL USER:
    //   unknown → normal chat fallback
    //
    // OWNER / ADMIN:
    //   unknown → AlexBrain fallback
    //
    // Isse natural conversation unnecessarily
    // clarification mein nahi jayegi.
    //
    // ========================================================

    const isUnknown =
      !routed ||
      routed?.route ===
        "unknown" ||
      routed?.status ===
        "unsupported_intent";

    if (isUnknown) {
      // ------------------------------------------------------
      // OWNER / ADMIN
      // ------------------------------------------------------

      if (
        useBrain &&
        ownerMode
      ) {
        return this._runBrainFallback({
          ownerId:
            resolvedOwner,

          sessionId:
            resolvedSession,

          message:
            text,

          context:
            enrichedContext,
        });
      }

      // ------------------------------------------------------
      // NORMAL USER
      // ------------------------------------------------------

      return this._runNormalUserFallback({
        routed,

        ownerId:
          resolvedOwner,

        sessionId:
          resolvedSession,

        message:
          text,

        context:
          enrichedContext,
      });
    }

    // ========================================================
    // FINAL FAILURE
    // ========================================================

    this.stats.failures += 1;

    return {
      success: false,

      status:
        STATUS.FAILED,

      route:
        "unknown",

      sessionId:
        resolvedSession,

      message:
        routed?.message ||
        "ALEX ko is request ke liye suitable capability nahi mili.",

      result:
        routed ||
        null,
    };
  }

  // ==========================================================
  // MEMORY HANDLER
  // ==========================================================

  async _handleMemory({
    routed,
    text,
    ownerId,
    sessionId,
    context,
  }) {
    try {
      let memoryAnswer = "";

      if (
        this.memory &&
        typeof this.memory.answerMemoryQuestion ===
          "function"
      ) {
        memoryAnswer =
          await this.memory.answerMemoryQuestion(
            text,
            {
              ownerId,

              ownerKey:
                ownerId,

              sessionId,

              context,
            }
          );
      }

      memoryAnswer =
        safeString(
          memoryAnswer
        ).trim();

      if (memoryAnswer) {
        await this._rememberMessage({
          ownerId,

          sessionId,

          role:
            "assistant",

          content:
            memoryAnswer,
        });

        this.stats.completed += 1;

        return {
          success: true,

          status:
            STATUS.COMPLETED,

          route:
            "memory",

          sessionId,

          reply:
            memoryAnswer,

          result:
            routed,

          memoryFound:
            true,
        };
      }

      const notFoundReply =
        "Mujhe abhi is baat ki saved memory nahi mili.";

      await this._rememberMessage({
        ownerId,

        sessionId,

        role:
          "assistant",

        content:
          notFoundReply,
      });

      this.stats.completed += 1;

      return {
        success: true,

        status:
          STATUS.COMPLETED,

        route:
          "memory",

        sessionId,

        reply:
          notFoundReply,

        result:
          routed,

        memoryFound:
          false,
      };
    } catch (error) {
      this.stats.failures += 1;

      console.warn(
        "[ALEX] Memory question handling failed:",
        error?.message ||
        error
      );

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          "memory",

        sessionId,

        error:
          error?.message ||
          String(error),

        message:
          "Saved memory read karte waqt error aa gaya.",
      };
    }
  }

  // ==========================================================
  // CHAT HANDLER
  // ==========================================================

  async _handleChat({
    routed,
    ownerId,
    sessionId,
  }) {
    const reply =
      getResultMessage(
        routed
      );

    const finalReply =
      reply ||
      "Main samajh gaya. Batao kya karna hai.";

    await this._rememberMessage({
      ownerId,

      sessionId,

      role:
        "assistant",

      content:
        finalReply,
    });

    this.stats.completed += 1;

    return {
      success:
        routed?.success !== false,

      status:
        STATUS.COMPLETED,

      route:
        "chat",

      sessionId,

      reply:
        finalReply,

      message:
        finalReply,

      result:
        routed,
    };
  }

  // ==========================================================
  // NORMAL USER FALLBACK
  // ==========================================================

  async _runNormalUserFallback({
    routed,
    ownerId,
    sessionId,
    message,
    context,
  }) {
    // --------------------------------------------------------
    // Normal user ko owner Brain nahi milega.
    //
    // GoalRouter ka chat handler available ho to use karo.
    // --------------------------------------------------------

    try {
      if (
        this.goalRouter &&
        typeof this.goalRouter._handleChat ===
          "function"
      ) {
        const result =
          await this.goalRouter._handleChat({
            message,

            context,

            sessionId,

            ownerId,
          });

        const reply =
          getResultMessage(
            result
          );

        if (reply) {
          await this._rememberMessage({
            ownerId,

            sessionId,

            role:
              "assistant",

            content:
              reply,
          });

          this.stats.completed += 1;

          return {
            success:
              result?.success !== false,

            status:
              STATUS.COMPLETED,

            route:
              "chat",

            sessionId,

            reply,

            message:
              reply,

            result,
          };
        }
      }
    } catch (error) {
      console.warn(
        "[ALEX] Normal user chat fallback failed:",
        error?.message ||
        error
      );
    }

    // --------------------------------------------------------
    // Safe final response
    // --------------------------------------------------------

    this.stats.failures += 1;

    const safeMessage =
      "Main is request ko abhi clearly process nahi kar pa raha. Please thoda differently batao.";

    await this._rememberMessage({
      ownerId,

      sessionId,

      role:
        "assistant",

      content:
        safeMessage,
    });

    return {
      success: false,

      status:
        STATUS.FAILED,

      route:
        "chat",

      sessionId,

      message:
        safeMessage,

      error:
        routed?.error ||
        "No safe user-chat capability available.",

      result:
        routed ||
        null,
    };
  }

  // ==========================================================
  // CONFIRMATION
  // ==========================================================

  async _handleConfirmation({
    routed,
    ownerId,
    sessionId,
  }) {
    this.stats.confirmations += 1;

    const message =
      routed?.message ||
      "Is action ke liye confirmation required hai.";

    const response = {
      success: true,

      status:
        STATUS.NEEDS_CONFIRMATION,

      route:
        routed?.route ||
        "tool",

      sessionId,

      requiresConfirmation:
        true,

      tool:
        routed?.tool ||
        null,

      args:
        routed?.args ||
        null,

      message,
    };

    await this._rememberMessage({
      ownerId,

      sessionId,

      role:
        "assistant",

      content:
        message,
    });

    return response;
  }

  // ==========================================================
  // AUTONOMOUS
  // ==========================================================

  async _handleAutonomous({
    routed,
    ownerId,
    sessionId,
  }) {
    if (
      routed?.success === false
    ) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          routed?.status ||
          STATUS.FAILED,

        route:
          "autonomous",

        sessionId,

        message:
          routed?.error ||
          routed?.message ||
          "ALEX autonomous task fail ho gaya.",

        error:
          routed?.error ||
          null,

        result:
          routed?.result ||
          routed,
      };
    }

    const status =
      routed?.status ||
      STATUS.PROCESSING;

    if (
      status ===
      STATUS.COMPLETED
    ) {
      this.stats.completed += 1;
    } else {
      this.stats.processing += 1;
    }

    const message =
      routed?.result?.message ||
      routed?.message ||
      (
        status ===
        STATUS.COMPLETED
          ? "ALEX task complete ho gaya."
          : "ALEX task process kar raha hai."
      );

    await this._rememberMessage({
      ownerId,

      sessionId,

      role:
        "assistant",

      content:
        message,
    });

    return {
      success: true,

      status,

      route:
        "autonomous",

      sessionId,

      taskId:
        routed?.result?.taskId ||
        routed?.taskId ||
        null,

      message,

      result:
        routed?.result ||
        routed,
    };
  }

  // ==========================================================
  // RESEARCH
  // ==========================================================

  async _handleResearch({
    routed,
    ownerId,
    sessionId,
  }) {
    if (
      routed?.success === false
    ) {
      this.stats.failures += 1;
    } else {
      this.stats.completed += 1;
    }

    const message =
      routed?.message ||
      getResultMessage(
        routed
      );

    if (message) {
      await this._rememberMessage({
        ownerId,

        sessionId,

        role:
          "assistant",

        content:
          message,
      });
    }

    return {
      success:
        routed?.success !== false,

      status:
        routed?.status ||
        STATUS.COMPLETED,

      route:
        "research",

      sessionId,

      result:
        routed?.result ||
        routed,

      message:
        message ||
        null,
    };
  }

  // ==========================================================
  // TOOL
  // ==========================================================

  async _handleTool({
    routed,
    ownerId,
    sessionId,
  }) {
    if (
      routed?.success === false
    ) {
      this.stats.failures += 1;
    } else if (
      routed?.status ===
      STATUS.PROCESSING
    ) {
      this.stats.processing += 1;
    } else {
      this.stats.completed += 1;
    }

    const message =
      routed?.message ||
      getResultMessage(
        routed
      );

    if (message) {
      await this._rememberMessage({
        ownerId,

        sessionId,

        role:
          "assistant",

        content:
          message,
      });
    }

    return {
      success:
        routed?.success !== false,

      status:
        routed?.status ||
        STATUS.COMPLETED,

      route:
        "tool",

      sessionId,

      tool:
        routed?.tool ||
        null,

      result:
        routed?.result ||
        null,

      message:
        message ||
        null,

      error:
        routed?.error ||
        null,
    };
  }

  // ==========================================================
  // BRAIN FALLBACK
  // ==========================================================
  //
  // IMPORTANT:
  //
  // Ye function sirf owner/admin request se call hona chahiye.
  //
  // ==========================================================

  async _runBrainFallback({
    ownerId,
    sessionId,
    message,
    context,
  }) {
    if (
      !isOwnerContext(
        context
      )
    ) {
      return this._runNormalUserFallback({
        routed: {
          route:
            "unknown",
        },

        ownerId,

        sessionId,

        message,

        context,
      });
    }

    if (
      !this.brain ||
      typeof this.brain.processOwnerGoal !==
        "function"
    ) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          "brain",

        sessionId,

        error:
          "AlexBrain is not available.",
      };
    }

    try {
      const result =
        await this.brain.processOwnerGoal({
          ownerKey:
            ownerId,

          goal:
            message,

          sessionId,

          context: {
            ...context,

            accessMode:
              "owner",

            isOwner:
              true,
          },
        });

      // ------------------------------------------------------
      // PROCESSING
      // ------------------------------------------------------

      if (
        result?.status ===
          STATUS.PROCESSING ||
        result?.status ===
          "processing" ||
        result?.taskId
      ) {
        this.stats.processing += 1;

        const responseMessage =
          result?.message ||
          "ALEX task process kar raha hai.";

        await this._rememberMessage({
          ownerId,

          sessionId,

          role:
            "assistant",

          content:
            responseMessage,
        });

        return {
          success: true,

          status:
            STATUS.PROCESSING,

          route:
            "brain",

          sessionId,

          taskId:
            result?.taskId ||
            null,

          message:
            responseMessage,

          result,
        };
      }

      // ------------------------------------------------------
      // CLARIFICATION
      // ------------------------------------------------------

      if (
        result?.status ===
          STATUS.NEEDS_CLARIFICATION ||
        result?.status ===
          "needs_clarification"
      ) {
        this.stats.clarifications += 1;

        const clarification =
          result?.message ||
          "ALEX ko thodi aur information chahiye.";

        await this._rememberMessage({
          ownerId,

          sessionId,

          role:
            "assistant",

          content:
            clarification,
        });

        return {
          success: true,

          status:
            STATUS.NEEDS_CLARIFICATION,

          route:
            "brain",

          sessionId,

          message:
            clarification,

          result,
        };
      }

      // ------------------------------------------------------
      // FAILURE
      // ------------------------------------------------------

      if (
        result?.success === false ||
        result?.status ===
          STATUS.FAILED ||
        result?.status ===
          "failed"
      ) {
        this.stats.failures += 1;

        const failureMessage =
          result?.message ||
          "ALEX Brain task start nahi kar paya.";

        await this._rememberMessage({
          ownerId,

          sessionId,

          role:
            "assistant",

          content:
            failureMessage,
        });

        return {
          success: false,

          status:
            STATUS.FAILED,

          route:
            "brain",

          sessionId,

          message:
            failureMessage,

          error:
            result?.error ||
            null,

          result,
        };
      }

      // ------------------------------------------------------
      // COMPLETED
      // ------------------------------------------------------

      this.stats.completed += 1;

      const completedMessage =
        result?.message ||
        getResultMessage(
          result
        ) ||
        "ALEX ne request process kar di.";

      await this._rememberMessage({
        ownerId,

        sessionId,

        role:
          "assistant",

        content:
          completedMessage,
      });

      return {
        success: true,

        status:
          result?.status ||
          STATUS.COMPLETED,

        route:
          "brain",

        sessionId,

        message:
          completedMessage,

        result,
      };
    } catch (error) {
      this.stats.failures += 1;

      console.error(
        "[ALEX] Brain fallback failed:",
        error?.message ||
        error
      );

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          "brain",

        sessionId,

        error:
          error?.message ||
          String(error),

        message:
          "ALEX Brain request process karte waqt error aa gaya.",
      };
    }
  }

  // ==========================================================
  // MEMORY SAVE
  // ==========================================================

  async _rememberMessage({
    ownerId,
    sessionId,
    role,
    content,
  }) {
    if (
      !this.memory ||
      !content
    ) {
      return;
    }

    try {
      if (
        typeof this.memory.saveMessage ===
        "function"
      ) {
        const safeRole =
          role === "assistant"
            ? "alex"
            : "owner";

        await this.memory.saveMessage(
          sessionId,

          safeRole,

          String(content),

          {
            ownerId,
          }
        );

        return;
      }

      if (
        typeof this.memory.addMessage ===
        "function"
      ) {
        await this.memory.addMessage(
          ownerId,

          sessionId,

          {
            role,

            content:
              String(content),
          }
        );

        return;
      }

      if (
        typeof this.memory.remember ===
        "function"
      ) {
        await this.memory.remember({
          ownerId,

          sessionId,

          role,

          content:
            String(content),
        });

        return;
      }

      if (
        typeof this.memory.add ===
        "function"
      ) {
        await this.memory.add({
          ownerId,

          sessionId,

          role,

          content:
            String(content),
        });
      }
    } catch (error) {
      console.warn(
        "[ALEX] Conversation memory save failed:",
        error?.message ||
        error
      );
    }
  }

  // ==========================================================
  // GET HISTORY
  // ==========================================================

  async _getHistory(
    ownerId,
    sessionId
  ) {
    if (!this.memory) {
      return [];
    }

    try {
      if (
        typeof this.memory.getRecentMessages ===
        "function"
      ) {
        const result =
          await this.memory.getRecentMessages(
            sessionId,

            MAX_HISTORY
          );

        if (
          Array.isArray(result)
        ) {
          return result.slice(
            -MAX_HISTORY
          );
        }
      }
    } catch (error) {
      console.warn(
        "[ALEX] Conversation history load failed:",
        error?.message ||
        error
      );
    }

    return [];
  }

  // ==========================================================
  // INSPECT WITHOUT EXECUTION
  // ==========================================================

  async inspect({
    ownerId = null,
    ownerKey = null,
    sessionId = null,
    message = "",
    context = {},
  } = {}) {
    const resolvedOwner =
      normalizeOwnerId({
        ownerId,

        ownerKey,

        owner:
          context?.owner ||
          context?.user ||
          null,
      });

    const resolvedSession =
      normalizeSessionId(
        sessionId
      );

    const text =
      normalizeMessage(
        message
      );

    if (!text) {
      return {
        success: true,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          "clarification",

        sessionId:
          resolvedSession,
      };
    }

    return this.goalRouter.inspect({
      message:
        text,

      context: {
        ...safeClone(
          context
        ),

        ownerId:
          resolvedOwner,

        sessionId:
          resolvedSession,

        accessMode:
          getAccessMode(
            context
          ),

        isOwner:
          isOwnerContext(
            context
          ),
      },

      sessionId:
        resolvedSession,
    });
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
      total: 0,

      completed: 0,

      processing: 0,

      confirmations: 0,

      clarifications: 0,

      failures: 0,
    };

    return this.getStats();
  }

  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      version:
        this.version,

      components: {
        goalRouter:
          Boolean(
            this.goalRouter
          ),

        memory:
          Boolean(
            this.memory
          ),

        brain:
          Boolean(
            this.brain
          ),

        runtime:
          Boolean(
            this.runtime
          ),
      },

      statuses: {
        ...STATUS,
      },

      stats:
        this.getStats(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let singleton = null;

function getAgentConversationGateway(
  options = {}
) {
  if (!singleton) {
    singleton =
      new AgentConversationGateway(
        options
      );
  }

  return singleton;
}

function createAgentConversationGateway(
  options = {}
) {
  return new AgentConversationGateway(
    options
  );
}

function resetAgentConversationGateway() {
  singleton = null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentConversationGateway,

  STATUS,

  getAgentConversationGateway,

  createAgentConversationGateway,

  resetAgentConversationGateway,
};