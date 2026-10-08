/*
 * ============================================================
 * ALEX — AGENT ASSISTANT CORE
 * Version: 2.0.0
 * ============================================================
 *
 * PURPOSE
 * -------
 * ALEX ka unified assistant core.
 *
 * This layer gives ALEX one stable interface for:
 *
 *   • Normal conversation
 *   • Memory
 *   • Web research
 *   • Computer tools
 *   • Autonomous tasks
 *   • Project/system operations
 *   • Capability inspection
 *
 * ARCHITECTURE
 * ------------
 *
 * USER
 *   ↓
 * AgentAssistantCore
 *   ↓
 * AgentConversationGateway
 *   ↓
 * AgentGoalRouter
 *   ├── CHAT
 *   ├── MEMORY
 *   ├── TOOL
 *   ├── RESEARCH
 *   └── AUTONOMOUS
 *          ↓
 * Existing ALEX infrastructure
 *
 * ACCESS MODEL
 * ------------
 *
 * NORMAL USER
 *   ├── CHAT             ✅
 *   ├── MEMORY           ✅
 *   ├── RESEARCH         ✅
 *   └── OWNER ACTIONS    ❌
 *
 * OWNER / ADMIN
 *   ├── CHAT             ✅
 *   ├── MEMORY           ✅
 *   ├── RESEARCH         ✅
 *   ├── COMPUTER         ✅
 *   └── AUTONOMOUS       ✅
 *
 * IMPORTANT
 * ---------
 * This file does not bypass:
 *
 *   • authentication
 *   • permissions
 *   • allowlists
 *   • runtime checks
 *   • WindowsAgent authentication
 *
 * It is an orchestration layer only.
 *
 * ============================================================
 */

"use strict";

const {
  getAgentConversationGateway,
} = require("./AgentConversationGateway");

const {
  getAgentGoalRouter,
} = require("./AgentGoalRouter");

const {
  getAgentCapabilityHub,
} = require("./AgentCapabilityHub");

// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "2.0.0";

const STATUS = Object.freeze({
  COMPLETED: "completed",

  PROCESSING: "processing",

  FAILED: "failed",

  NEEDS_CONFIRMATION:
    "waiting_confirmation",

  NEEDS_CLARIFICATION:
    "needs_clarification",

  PLANNED: "planned",

  UNAVAILABLE:
    "capability_unavailable",
});

const ROUTES = Object.freeze({
  CHAT: "chat",

  MEMORY: "memory",

  TOOL: "tool",

  RESEARCH: "research",

  AUTONOMOUS: "autonomous",

  CLARIFICATION:
    "clarification",

  UNKNOWN: "unknown",
});

// ============================================================
// HELPERS
// ============================================================

function stringValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function objectValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function getErrorMessage(error) {
  return (
    error?.message ||
    error?.reason ||
    String(
      error ||
      "Unknown error"
    )
  );
}

function hasMethod(
  target,
  method
) {
  return Boolean(
    target &&
    typeof target[method] ===
      "function"
  );
}

function normalizeRole(value) {
  return stringValue(value)
    .toLowerCase();
}

function isOwnerContext(
  context = {}
) {
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

function getAccessMode(
  context = {}
) {
  return isOwnerContext(
    context
  )
    ? "owner"
    : "user";
}

function normalizeSessionId(
  sessionId
) {
  const value =
    stringValue(
      sessionId
    );

  return (
    value ||
    `alex-session-${Date.now()}`
  );
}

// ============================================================
// AGENT ASSISTANT CORE
// ============================================================

class AgentAssistantCore {
  constructor(options = {}) {
    this.name =
      "ALEX Agent Assistant Core";

    this.version =
      VERSION;

    this.conversation =
      options.conversation ||
      getAgentConversationGateway();

    this.goalRouter =
      options.goalRouter ||
      getAgentGoalRouter();

    this.capabilityHub =
      options.capabilityHub ||
      getAgentCapabilityHub();

    this.stats = {
      total: 0,

      messages: 0,

      chat: 0,

      memory: 0,

      tools: 0,

      research: 0,

      autonomous: 0,

      clarification: 0,

      failures: 0,

      confirmations: 0,
    };
  }

  // ==========================================================
  // MAIN ASSISTANT ENTRY
  // ==========================================================

  async ask({
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

    this.stats.messages += 1;

    const text =
      stringValue(message);

    const safeContext =
      objectValue(context);

    const resolvedSession =
      normalizeSessionId(
        sessionId
      );

    // --------------------------------------------------------
    // EMPTY MESSAGE
    // --------------------------------------------------------

    if (!text) {
      this.stats.clarification += 1;

      return {
        success: true,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          ROUTES.CLARIFICATION,

        message:
          "ALEX ko message nahi mila. Batao kya karna hai.",

        sessionId:
          resolvedSession,
      };
    }

    // --------------------------------------------------------
    // ACCESS CONTEXT
    // --------------------------------------------------------

    const accessMode =
      getAccessMode(
        safeContext
      );

    // --------------------------------------------------------
    // BUILD SAFE CONTEXT
    // --------------------------------------------------------

    const assistantContext = {
      ...safeContext,

      accessMode,

      isOwner:
        isOwnerContext(
          safeContext
        ),

      sessionId:
        resolvedSession,

      assistantVersion:
        this.version,
    };

    /*
     * ConversationGateway is the primary path.
     *
     * Isse:
     *
     *   USER
     *     ↓
     *   CORE
     *     ↓
     *   GATEWAY
     *     ↓
     *   GOAL ROUTER
     *
     * architecture consistent rehta hai.
     */

    if (
      hasMethod(
        this.conversation,
        "handleMessage"
      )
    ) {
      try {
        const result =
          await this.conversation.handleMessage({
            ownerId,

            ownerKey,

            sessionId:
              resolvedSession,

            message:
              text,

            context:
              assistantContext,

            execute:
              execute !== false,

            confirmed:
              confirmed === true,

            confirmationReason:
              stringValue(
                confirmationReason
              ),

            useBrain:
              useBrain !== false,
          });

        this._recordResult(
          result
        );

        return {
          success:
            result?.success !== false,

          status:
            result?.status ||
            STATUS.COMPLETED,

          route:
            result?.route ||
            ROUTES.CHAT,

          sessionId:
            result?.sessionId ||
            resolvedSession,

          taskId:
            result?.taskId ||
            result?.result?.taskId ||
            null,

          reply:
            result?.reply ||
            null,

          message:
            result?.message ||
            null,

          result:
            result || null,

          requiresConfirmation:
            result?.requiresConfirmation === true,

          tool:
            result?.tool ||
            null,

          error:
            result?.error ||
            null,
        };
      } catch (error) {
        this.stats.failures += 1;

        console.error(
          "[ALEX] Conversation gateway failed:",
          error?.message ||
            error
        );

        return {
          success: false,

          status:
            STATUS.FAILED,

          route:
            ROUTES.UNKNOWN,

          sessionId:
            resolvedSession,

          error:
            getErrorMessage(
              error
            ),
        };
      }
    }

    // --------------------------------------------------------
    // SAFETY FALLBACK
    // --------------------------------------------------------
    //
    // Gateway unavailable ho to ALEX fake success nahi
    // batayega.
    //
    // --------------------------------------------------------

    this.stats.failures += 1;

    return {
      success: false,

      status:
        STATUS.UNAVAILABLE,

      route:
        ROUTES.UNKNOWN,

      sessionId:
        resolvedSession,

      error:
        "ALEX conversation gateway is unavailable.",
    };
  }

  // ==========================================================
  // PLAN ONLY
  // ==========================================================

  async plan({
    ownerId = null,

    ownerKey = null,

    sessionId = null,

    message = "",

    context = {},
  } = {}) {
    const text =
      stringValue(message);

    if (!text) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          ROUTES.CLARIFICATION,

        error:
          "Message is required.",
      };
    }

    if (
      !hasMethod(
        this.goalRouter,
        "route"
      )
    ) {
      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        error:
          "AgentGoalRouter is unavailable.",
      };
    }

    const resolvedSession =
      normalizeSessionId(
        sessionId
      );

    try {
      const result =
        await this.goalRouter.route({
          ownerId,

          ownerKey,

          sessionId:
            resolvedSession,

          message:
            text,

          context:
            objectValue(context),

          execute: false,
        });

      return {
        success:
          result?.success !== false,

        status:
          result?.status ||
          STATUS.PLANNED,

        route:
          result?.route ||
          ROUTES.UNKNOWN,

        sessionId:
          result?.sessionId ||
          resolvedSession,

        intent:
          result?.intent ||
          null,

        goal:
          result?.intent?.goal ||
          result?.goal ||
          text,

        tool:
          result?.tool ||
          null,

        args:
          result?.args ||
          null,

        result:
          result || null,
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        error:
          getErrorMessage(
            error
          ),
      };
    }
  }

  // ==========================================================
  // INSPECT REQUEST
  // ==========================================================

  async inspect({
    message = "",

    context = {},
  } = {}) {
    const text =
      stringValue(message);

    if (!text) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        error:
          "Message is required.",
      };
    }

    const safeContext =
      objectValue(context);

    if (
      hasMethod(
        this.goalRouter,
        "inspect"
      )
    ) {
      try {
        return await this.goalRouter.inspect({
          message:
            text,

          context: {
            ...safeContext,

            accessMode:
              getAccessMode(
                safeContext
              ),

            isOwner:
              isOwnerContext(
                safeContext
              ),
          },
        });
      } catch (error) {
        this.stats.failures += 1;

        return {
          success: false,

          status:
            STATUS.FAILED,

          error:
            getErrorMessage(
              error
            ),
        };
      }
    }

    return this.plan({
      message:
        text,

      context:
        safeContext,
    });
  }

  // ==========================================================
  // DIRECT RESEARCH
  // ==========================================================

  async research({
    question = "",

    urls = [],

    discover = false,

    options = {},
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "researchWeb"
      )
    ) {
      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          ROUTES.RESEARCH,

        error:
          "Research capability is unavailable.",
      };
    }

    const normalizedQuestion =
      stringValue(
        question
      );

    if (
      !normalizedQuestion &&
      (!Array.isArray(urls) ||
        urls.length === 0)
    ) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          ROUTES.RESEARCH,

        error:
          "Research question or URL is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.researchWeb({
          question:
            normalizedQuestion,

          urls:
            Array.isArray(urls)
              ? urls
              : [],

          discover:
            discover === true,

          options:
            objectValue(
              options
            ),
        });

      this._recordResult(
        result
      );

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          ROUTES.RESEARCH,

        error:
          getErrorMessage(
            error
          ),
      };
    }
  }

  // ==========================================================
  // DIRECT AUTONOMOUS TASK
  // ==========================================================

  async runTask({
    goal = "",

    ownerId = null,

    sessionId = null,

    metadata = {},

    confirmations = {},

    stopOnFailure = true,
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "runAutonomous"
      )
    ) {
      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          ROUTES.AUTONOMOUS,

        error:
          "Autonomous capability is unavailable.",
      };
    }

    const normalizedGoal =
      stringValue(
        goal
      );

    if (!normalizedGoal) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          ROUTES.AUTONOMOUS,

        error:
          "Autonomous task goal is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.runAutonomous({
          goal:
            normalizedGoal,

          ownerId,

          sessionId:
            normalizeSessionId(
              sessionId
            ),

          metadata:
            objectValue(
              metadata
            ),

          confirmations:
            objectValue(
              confirmations
            ),

          stopOnFailure:
            stopOnFailure !== false,
        });

      this._recordResult(
        result
      );

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          ROUTES.AUTONOMOUS,

        error:
          getErrorMessage(
            error
          ),
      };
    }
  }

  // ==========================================================
  // DIRECT COMPUTER ACTION
  // ==========================================================

  async computer({
    ownerId = null,

    sessionId = null,

    goal = "",

    agentToken = "",

    tool = "",

    args = {},

    confirmed = false,

    confirmationReason = "",

    metadata = {},
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "executeComputer"
      )
    ) {
      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          ROUTES.TOOL,

        error:
          "Computer capability is unavailable.",
      };
    }

    const normalizedTool =
      stringValue(tool);

    if (!normalizedTool) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          ROUTES.TOOL,

        error:
          "Computer tool is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.executeComputer({
          ownerId,

          sessionId:
            normalizeSessionId(
              sessionId
            ),

          goal:
            stringValue(
              goal
            ),

          agentToken:
            stringValue(
              agentToken
            ),

          tool:
            normalizedTool,

          args:
            objectValue(
              args
            ),

          confirmed:
            confirmed === true,

          confirmationReason:
            stringValue(
              confirmationReason
            ),

          metadata:
            objectValue(
              metadata
            ),
        });

      this._recordResult(
        result
      );

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          ROUTES.TOOL,

        error:
          getErrorMessage(
            error
          ),
      };
    }
  }

  // ==========================================================
  // CAPABILITY DISCOVERY
  // ==========================================================

  getCapabilities() {
    if (
      hasMethod(
        this.capabilityHub,
        "getCapabilities"
      )
    ) {
      try {
        return this.capabilityHub
          .getCapabilities();
      } catch (error) {
        console.warn(
          "[ALEX] Capability discovery failed:",
          error?.message ||
            error
        );

        return [];
      }
    }

    return [];
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  health() {
    const capabilities =
      this.getCapabilities();

    const available =
      capabilities.filter(
        (item) =>
          item?.available === true
      ).length;

    let status =
      "unavailable";

    if (
      capabilities.length > 0 &&
      available ===
        capabilities.length
    ) {
      status = "healthy";
    } else if (
      available > 0
    ) {
      status = "degraded";
    }

    return {
      success: true,

      status,

      name:
        this.name,

      version:
        this.version,

      capabilities,

      availableCapabilities:
        available,

      totalCapabilities:
        capabilities.length,

      stats:
        this.getStats(),

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // STATS
  // ==========================================================

  _recordResult(result) {
    const route =
      stringValue(
        result?.route
      ).toLowerCase();

    switch (route) {
      case ROUTES.CHAT:
        this.stats.chat += 1;
        break;

      case ROUTES.MEMORY:
        this.stats.memory += 1;
        break;

      case ROUTES.TOOL:
        this.stats.tools += 1;
        break;

      case ROUTES.RESEARCH:
        this.stats.research += 1;
        break;

      case ROUTES.AUTONOMOUS:
        this.stats.autonomous += 1;
        break;

      case ROUTES.CLARIFICATION:
        this.stats.clarification += 1;
        break;

      default:
        break;
    }

    if (
      result?.status ===
      STATUS.NEEDS_CONFIRMATION
    ) {
      this.stats.confirmations += 1;
    }

    if (
      result?.success === false
    ) {
      this.stats.failures += 1;
    }
  }

  getStats() {
    return {
      ...this.stats,

      version:
        this.version,
    };
  }

  resetStats() {
    this.stats = {
      total: 0,

      messages: 0,

      chat: 0,

      memory: 0,

      tools: 0,

      research: 0,

      autonomous: 0,

      clarification: 0,

      failures: 0,

      confirmations: 0,
    };

    return this.getStats();
  }

  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      name:
        this.name,

      version:
        this.version,

      architecture: {
        conversation:
          Boolean(
            this.conversation
          ),

        goalRouter:
          Boolean(
            this.goalRouter
          ),

        capabilityHub:
          Boolean(
            this.capabilityHub
          ),
      },

      routes: {
        ...ROUTES,
      },

      capabilities:
        this.getCapabilities(),

      stats:
        this.getStats(),

      timestamp:
        new Date().toISOString(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let singleton = null;

function createAgentAssistantCore(
  options = {}
) {
  return new AgentAssistantCore(
    options
  );
}

function getAgentAssistantCore(
  options = {}
) {
  if (!singleton) {
    singleton =
      createAgentAssistantCore(
        options
      );
  }

  return singleton;
}

function resetAgentAssistantCore() {
  singleton = null;
}

function isAgentAssistantCore(
  value
) {
  return Boolean(
    value &&
    typeof value.ask ===
      "function" &&
    typeof value.plan ===
      "function" &&
    typeof value.inspect ===
      "function"
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  STATUS,

  ROUTES,

  AgentAssistantCore,

  createAgentAssistantCore,

  getAgentAssistantCore,

  resetAgentAssistantCore,

  isAgentAssistantCore,
};