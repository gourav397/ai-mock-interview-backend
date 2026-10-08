/**
 * ============================================================
 * ALEX — Agent Capability Hub
 * ============================================================
 *
 * Central entry point for ALEX capabilities.
 *
 * Connects:
 *   - Conversation
 *   - Goal Router
 *   - Public Web Research
 *   - Autonomous Tasks
 *   - Authorized Computer Control
 *   - Agent Runtime
 *   - Tool Registry
 *
 * IMPORTANT:
 * This layer DOES NOT bypass:
 *   - AgentPermissionManager
 *   - AgentExecutionContext
 *   - AgentRuntime
 *   - Tool Registry
 *   - WindowsAgent authentication
 *
 * It only coordinates existing capabilities.
 * ============================================================
 */

const {
  getAgentConversationGateway,
} = require("./AgentConversationGateway");

const {
  getAgentGoalRouter,
} = require("./AgentGoalRouter");

const {
  getAgentResearchEngine,
} = require("./AgentResearchEngine");

const {
  getAgentAutonomousBridge,
} = require("./AgentAutonomousBridge");

const {
  getAgentComputerBridge,
} = require("./AgentComputerBridge");

const {
  getAgentRuntime,
} = require("./AgentRuntime");

const {
  getAgentToolRegistry,
} = require("./AgentToolRegistry");

const VERSION = "1.1.0";

const CAPABILITY = Object.freeze({
  CHAT: "chat",
  RESEARCH: "research",
  AUTONOMOUS: "autonomous",
  COMPUTER: "computer",
  RUNTIME: "runtime",
});

const STATUS = Object.freeze({
  COMPLETED: "completed",
  PROCESSING: "processing",
  FAILED: "failed",
  NEEDS_CONFIRMATION: "needs_confirmation",
  NEEDS_CLARIFICATION: "needs_clarification",
  UNAVAILABLE: "capability_unavailable",
});

function cleanString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function cleanObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function errorMessage(error) {
  return (
    error?.message ||
    error?.reason ||
    String(error || "Unknown error")
  );
}

function callable(value, method) {
  return Boolean(
    value &&
    typeof value[method] === "function"
  );
}

class AgentCapabilityHub {
  constructor(options = {}) {
    this.name =
      "ALEX Agent Capability Hub";

    this.version =
      VERSION;

    /*
     * Existing ALEX services.
     *
     * These are injected optionally so the hub is easy to test
     * and does not create duplicate instances.
     */

    this.conversation =
      options.conversation ||
      getAgentConversationGateway();

    this.goalRouter =
      options.goalRouter ||
      getAgentGoalRouter();

    this.research =
      options.research ||
      getAgentResearchEngine();

    this.autonomous =
      options.autonomous ||
      getAgentAutonomousBridge();

    this.computer =
      options.computer ||
      getAgentComputerBridge();

    this.runtime =
      options.runtime ||
      getAgentRuntime();

    this.registry =
      options.registry ||
      getAgentToolRegistry();

    this.stats = {
      total: 0,

      chat: 0,

      research: 0,

      autonomous: 0,

      computer: 0,

      runtime: 0,

      failed: 0,

      confirmations: 0,
    };
  }

  // ============================================================
  // MAIN MESSAGE ENTRY
  // ============================================================

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

    const text =
      cleanString(message);

    if (!text) {
      return {
        success: true,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          "clarification",

        message:
          "ALEX ko message nahi mila.",
      };
    }

    /*
     * ConversationGateway is the primary entry point.
     *
     * It already knows how to use the current:
     *   GoalRouter
     *   IntentRouter
     *   ChatMemory
     *   AlexBrain
     *   Runtime
     */
    if (
      !callable(
        this.conversation,
        "handleMessage"
      )
    ) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          CAPABILITY.CHAT,

        error:
          "AgentConversationGateway is unavailable.",
      };
    }

    try {
      const result =
        await this.conversation.handleMessage({
          ownerId,

          ownerKey,

          sessionId,

          message: text,

          context:
            cleanObject(context),

          execute:
            execute !== false,

          confirmed:
            confirmed === true,

          confirmationReason:
            cleanString(
              confirmationReason
            ),

          useBrain:
            useBrain !== false,
        });

      if (
        result?.success === false
      ) {
        this.stats.failed += 1;
      }

      if (
        result?.status ===
        STATUS.NEEDS_CONFIRMATION
      ) {
        this.stats.confirmations += 1;
      }

      this.stats.chat += 1;

      return {
        success:
          result?.success !== false,

        status:
          result?.status ||
          STATUS.COMPLETED,

        route:
          result?.route ||
          CAPABILITY.CHAT,

        sessionId:
          result?.sessionId ||
          sessionId ||
          null,

        message:
          result?.message ||
          null,

        reply:
          result?.reply ||
          result?.response ||
          null,

        result:
          result || null,

        requiresConfirmation:
          result?.requiresConfirmation === true,

        confirmationReason:
          result?.confirmationReason ||
          null,

        error:
          result?.error ||
          null,
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          CAPABILITY.CHAT,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // DIRECT GOAL ROUTING
  // ============================================================

  async routeMessage({
    ownerId = null,
    ownerKey = null,
    sessionId = null,
    message = "",
    context = {},
    execute = true,
    confirmed = false,
    confirmationReason = "",
  } = {}) {
    const text =
      cleanString(message);

    if (!text) {
      return {
        success: true,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          "clarification",

        message:
          "Message empty hai.",
      };
    }

    if (
      !callable(
        this.goalRouter,
        "route"
      )
    ) {
      return this.handleMessage({
        ownerId,
        ownerKey,
        sessionId,
        message: text,
        context,
        execute,
        confirmed,
        confirmationReason,
      });
    }

    try {
      return await this.goalRouter.route({
        ownerId,

        ownerKey,

        message: text,

        context:
          cleanObject(context),

        sessionId,

        execute:
          execute !== false,

        confirmed:
          confirmed === true,

        confirmationReason:
          cleanString(
            confirmationReason
          ),
      });
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // PUBLIC WEB RESEARCH
  // ============================================================

  async researchWeb({
    question = "",

    urls = [],

    discover = false,

    options = {},
  } = {}) {
    const cleanQuestion =
      cleanString(question);

    if (!cleanQuestion) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          CAPABILITY.RESEARCH,

        error:
          "Research question is required.",
      };
    }

    if (
      !callable(
        this.research,
        "research"
      )
    ) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          CAPABILITY.RESEARCH,

        error:
          "AgentResearchEngine is unavailable.",
      };
    }

    try {
      const result =
        await this.research.research({
          question:
            cleanQuestion,

          urls:
            Array.isArray(urls)
              ? urls
              : [],

          discover:
            discover === true,

          options:
            cleanObject(options),
        });

      this.stats.research += 1;

      if (
        result?.success === false
      ) {
        this.stats.failed += 1;
      }

      return {
        success:
          result?.success !== false,

        status:
          result?.status ||
          (
            result?.success === false
              ? STATUS.FAILED
              : STATUS.COMPLETED
          ),

        route:
          CAPABILITY.RESEARCH,

        question:
          cleanQuestion,

        result:
          result || null,
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          CAPABILITY.RESEARCH,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // AUTONOMOUS TASK
  // ============================================================

  async runAutonomous({
    goal = "",

    ownerId = null,

    sessionId = null,

    metadata = {},

    confirmations = {},

    stopOnFailure = true,
  } = {}) {
    const cleanGoal =
      cleanString(goal);

    if (!cleanGoal) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          CAPABILITY.AUTONOMOUS,

        error:
          "Autonomous goal is required.",
      };
    }

    if (
      !callable(
        this.autonomous,
        "runGoal"
      )
    ) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          CAPABILITY.AUTONOMOUS,

        error:
          "AgentAutonomousBridge is unavailable.",
      };
    }

    try {
      const result =
        await this.autonomous.runGoal({
          goal:
            cleanGoal,

          ownerId:
            ownerId ||
            "owner",

          sessionId,

          metadata:
            cleanObject(metadata),

          confirmations:
            cleanObject(confirmations),

          stopOnFailure:
            stopOnFailure !== false,
        });

      this.stats.autonomous += 1;

      if (
        result?.success === false
      ) {
        this.stats.failed += 1;
      }

      return {
        success:
          result?.success === true,

        status:
          result?.status ||
          (
            result?.success === false
              ? STATUS.FAILED
              : STATUS.PROCESSING
          ),

        route:
          CAPABILITY.AUTONOMOUS,

        taskId:
          result?.taskId ||
          null,

        goal:
          cleanGoal,

        result:
          result || null,
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          CAPABILITY.AUTONOMOUS,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // AUTHORIZED COMPUTER USE
  // ============================================================

  async executeComputer({
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
    const toolName =
      cleanString(tool);

    if (!toolName) {
      return {
        success: false,

        status:
          STATUS.NEEDS_CLARIFICATION,

        route:
          CAPABILITY.COMPUTER,

        error:
          "Computer tool is required.",
      };
    }

    if (
      !callable(
        this.computer,
        "execute"
      )
    ) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.UNAVAILABLE,

        route:
          CAPABILITY.COMPUTER,

        error:
          "AgentComputerBridge is unavailable.",
      };
    }

    try {
      const result =
        await this.computer.execute({
          ownerId,

          sessionId,

          goal:
            cleanString(goal),

          agentToken,

          tool:
            toolName,

          args:
            cleanObject(args),

          confirmed:
            confirmed === true,

          confirmationReason:
            cleanString(
              confirmationReason
            ),

          metadata:
            cleanObject(metadata),
        });

      this.stats.computer += 1;

      if (
        result?.success === false
      ) {
        this.stats.failed += 1;
      }

      if (
        result?.requiresConfirmation === true ||
        result?.status ===
          "waiting_confirmation"
      ) {
        this.stats.confirmations += 1;
      }

      return {
        success:
          result?.success === true,

        status:
          result?.status ||
          (
            result?.success === true
              ? STATUS.COMPLETED
              : STATUS.FAILED
          ),

        route:
          CAPABILITY.COMPUTER,

        tool:
          toolName,

        result:
          result || null,

        requiresConfirmation:
          result?.requiresConfirmation === true ||
          result?.status ===
            "waiting_confirmation",

        error:
          result?.error ||
          null,
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          CAPABILITY.COMPUTER,

        tool:
          toolName,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // RUNTIME
  // ============================================================

  getRuntimeInfo() {
    this.stats.runtime += 1;

    try {
      const runtime =
        this.runtime;

      const registry =
        this.registry;

      let runtimeInfo =
        null;

      if (
        callable(
          runtime,
          "getInfo"
        )
      ) {
        runtimeInfo =
          runtime.getInfo();
      }

      let capabilities =
        [];

      if (
        callable(
          runtime,
          "getCapabilities"
        )
      ) {
        capabilities =
          runtime.getCapabilities() ||
          [];
      }

      let tools =
        [];

      if (
        callable(
          registry,
          "list"
        )
      ) {
        tools =
          registry.list() ||
          [];
      }

      return {
        success: true,

        status:
          STATUS.COMPLETED,

        route:
          CAPABILITY.RUNTIME,

        runtime:
          runtimeInfo,

        capabilities,

        tools,

        timestamp:
          new Date().toISOString(),
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          STATUS.FAILED,

        route:
          CAPABILITY.RUNTIME,

        error:
          errorMessage(error),
      };
    }
  }

  // ============================================================
  // CAPABILITY DISCOVERY
  // ============================================================

  getCapabilities() {
    return [
      {
        id:
          CAPABILITY.CHAT,

        name:
          "ALEX Conversation",

        available:
          callable(
            this.conversation,
            "handleMessage"
          ),

        description:
          "Natural conversation, context and memory.",
      },

      {
        id:
          CAPABILITY.RESEARCH,

        name:
          "Public Web Research",

        available:
          callable(
            this.research,
            "research"
          ),

        description:
          "Research public web information and synthesize sources.",
      },

      {
        id:
          CAPABILITY.AUTONOMOUS,

        name:
          "Autonomous Tasks",

        available:
          callable(
            this.autonomous,
            "runGoal"
          ),

        description:
          "Plan and execute multi-step authorized tasks.",
      },

      {
        id:
          CAPABILITY.COMPUTER,

        name:
          "Authorized Computer Use",

        available:
          callable(
            this.computer,
            "execute"
          ),

        description:
          "Interact with the authorized computer through the existing Agent Runtime.",
      },

      {
        id:
          CAPABILITY.RUNTIME,

        name:
          "Agent Runtime",

        available:
          Boolean(
            this.runtime
          ),

        description:
          "Sessions, tools, workflows and execution infrastructure.",
      },
    ];
  }

  // ============================================================
  // HEALTH
  // ============================================================

  health() {
    const capabilities =
      this.getCapabilities();

    const available =
      capabilities.filter(
        (item) =>
          item.available === true
      ).length;

    return {
      success: true,

      status:
        available ===
        capabilities.length
          ? "healthy"
          : available > 0
            ? "degraded"
            : "unavailable",

      name:
        this.name,

      version:
        this.version,

      availableCapabilities:
        available,

      totalCapabilities:
        capabilities.length,

      capabilities,

      stats:
        this.getStats(),

      timestamp:
        new Date().toISOString(),
    };
  }

  // ============================================================
  // STATS
  // ============================================================

  getStats() {
    return {
      total:
        this.stats.total,

      chat:
        this.stats.chat,

      research:
        this.stats.research,

      autonomous:
        this.stats.autonomous,

      computer:
        this.stats.computer,

      runtime:
        this.stats.runtime,

      failed:
        this.stats.failed,

      confirmations:
        this.stats.confirmations,
    };
  }

  resetStats() {
    this.stats = {
      total: 0,

      chat: 0,

      research: 0,

      autonomous: 0,

      computer: 0,

      runtime: 0,

      failed: 0,

      confirmations: 0,
    };

    return this.getStats();
  }

  // ============================================================
  // INFO
  // ============================================================

  getInfo() {
    return {
      success: true,

      name:
        this.name,

      version:
        this.version,

      capabilities:
        this.getCapabilities(),

      architecture: [
        "conversation-gateway",
        "goal-routing",
        "chat-memory",
        "web-research",
        "autonomous-planning",
        "computer-use",
        "agent-runtime",
        "tool-registry",
        "permission-enforcement",
        "execution-verification",
      ],

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

let singleton =
  null;

function createAgentCapabilityHub(
  options = {}
) {
  return new AgentCapabilityHub(
    options
  );
}

function getAgentCapabilityHub(
  options = {}
) {
  if (!singleton) {
    singleton =
      createAgentCapabilityHub(
        options
      );
  }

  return singleton;
}

function resetAgentCapabilityHub() {
  singleton =
    null;
}

function isAgentCapabilityHub(
  value
) {
  return Boolean(
    value &&
    typeof value.handleMessage ===
      "function" &&
    typeof value.getCapabilities ===
      "function" &&
    typeof value.getInfo ===
      "function"
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  CAPABILITY,

  STATUS,

  AgentCapabilityHub,

  createAgentCapabilityHub,

  getAgentCapabilityHub,

  resetAgentCapabilityHub,

  isAgentCapabilityHub,
};
