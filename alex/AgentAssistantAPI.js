/*
 * ============================================================
 * ALEX — AGENT ASSISTANT API
 * Version: 2.0.0
 * ============================================================
 *
 * PURPOSE
 * -------
 * Stable service API over AgentAssistantCore.
 *
 * This layer:
 *
 *   • normalizes requests
 *   • preserves session context
 *   • preserves authenticated user context
 *   • keeps route adapters independent
 *   • exposes CHAT / MEMORY / RESEARCH / TASK / COMPUTER
 *
 * SECURITY
 * --------
 * This file does NOT bypass authentication,
 * authorization, allowlists or runtime security.
 *
 * ============================================================
 */

"use strict";

const {
  getAgentAssistantCore,
} = require("./AgentAssistantCore");

const VERSION = "2.0.0";

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

function arrayValue(value) {
  return Array.isArray(value)
    ? value
    : [];
}

// ============================================================
// API
// ============================================================

class AgentAssistantAPI {
  constructor(options = {}) {
    this.core =
      options.core ||
      getAgentAssistantCore();

    this.stats = {
      requests: 0,

      successes: 0,

      failures: 0,

      lastRequestAt: null,

      lastSuccessAt: null,

      lastFailureAt: null,
    };
  }

  // ==========================================================
  // INTERNAL HELPERS
  // ==========================================================

  _startRequest() {
    this.stats.requests += 1;

    this.stats.lastRequestAt =
      new Date().toISOString();
  }

  _success(result) {
    this.stats.successes += 1;

    this.stats.lastSuccessAt =
      new Date().toISOString();

    return this._normalizeResult(
      result
    );
  }

  _failure(error) {
    this.stats.failures += 1;

    this.stats.lastFailureAt =
      new Date().toISOString();

    const message =
      error?.message ||
      error?.error ||
      String(
        error ||
        "Agent assistant request failed"
      );

    return {
      ok: false,

      success: false,

      status: "failed",

      error: message,

      timestamp:
        new Date().toISOString(),
    };
  }

  _normalizeResult(result) {
    if (
      result === undefined ||
      result === null
    ) {
      return {
        ok: true,

        success: true,

        status: "completed",

        data: null,

        timestamp:
          new Date().toISOString(),
      };
    }

    if (
      typeof result === "object" &&
      !Array.isArray(result)
    ) {
      return {
        ok:
          result.ok !== false,

        success:
          result.success !== false,

        ...result,

        timestamp:
          result.timestamp ||
          new Date().toISOString(),
      };
    }

    return {
      ok: true,

      success: true,

      status: "completed",

      data: result,

      timestamp:
        new Date().toISOString(),
    };
  }

  async _execute(
    method,
    payload = {}
  ) {
    this._startRequest();

    try {
      if (!this.core) {
        throw new Error(
          "AgentAssistantCore is not available"
        );
      }

      if (
        typeof this.core[method] !==
        "function"
      ) {
        throw new Error(
          `AgentAssistantCore method "${method}" is not available`
        );
      }

      const result =
        await this.core[method](
          payload
        );

      return this._success(
        result
      );
    } catch (error) {
      return this._failure(
        error
      );
    }
  }

  // ==========================================================
  // ASK
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
    const text =
      stringValue(message);

    if (!text) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Message is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    return this._execute(
      "ask",
      {
        ownerId,

        ownerKey,

        sessionId,

        message: text,

        context:
          objectValue(context),

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
      }
    );
  }

  // ==========================================================
  // PLAN
  // ==========================================================

  async plan({
    ownerId = null,

    ownerKey = null,

    sessionId = null,

    goal = "",

    context = {},
  } = {}) {
    const text =
      stringValue(goal);

    if (!text) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Goal is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    return this._execute(
      "plan",
      {
        ownerId,

        ownerKey,

        sessionId,

        message: text,

        context:
          objectValue(context),
      }
    );
  }

  // ==========================================================
  // INSPECT
  // ==========================================================

  async inspect({
    message = "",

    context = {},
  } = {}) {
    const text =
      stringValue(message);

    if (!text) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Message is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    return this._execute(
      "inspect",
      {
        message: text,

        context:
          objectValue(context),
      }
    );
  }

  // ==========================================================
  // RESEARCH
  // ==========================================================

  async research({
    ownerId = null,

    ownerKey = null,

    sessionId = null,

    question = "",

    urls = [],

    discover = false,

    options = {},

    context = {},
  } = {}) {
    const text =
      stringValue(question);

    if (
      !text &&
      arrayValue(urls).length === 0
    ) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Research question or URL is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    /*
     * AgentAssistantCore.research()
     * direct research API expects:
     *
     * question
     * urls
     * discover
     * options
     *
     * Context is intentionally kept
     * inside options so existing
     * CapabilityHub contracts remain intact.
     */

    return this._execute(
      "research",
      {
        question: text,

        urls:
          arrayValue(urls),

        discover:
          discover === true,

        options: {
          ...objectValue(
            options
          ),

          context:
            objectValue(
              context
            ),

          ownerId,

          ownerKey,

          sessionId,
        },
      }
    );
  }

  // ==========================================================
  // RUN AUTONOMOUS TASK
  // ==========================================================

  async runTask({
    ownerId = null,

    ownerKey = null,

    sessionId = null,

    goal = "",

    context = {},

    metadata = {},

    confirmations = {},

    execute = true,

    confirmed = false,

    confirmationReason = "",

    stopOnFailure = true,
  } = {}) {
    const text =
      stringValue(goal);

    if (!text) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Task goal is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    /*
     * Autonomous execution is an
     * owner-level capability.
     *
     * Actual authorization is still
     * enforced by downstream layers.
     */

    return this._execute(
      "runTask",
      {
        ownerId,

        sessionId,

        goal: text,

        metadata: {
          ...objectValue(
            metadata
          ),

          ownerKey,

          context:
            objectValue(
              context
            ),
        },

        confirmations: {
          ...objectValue(
            confirmations
          ),

          confirmed:
            confirmed === true,

          confirmationReason:
            stringValue(
              confirmationReason
            ),
        },

        stopOnFailure:
          stopOnFailure !== false,

        execute:
          execute !== false,
      }
    );
  }

  // ==========================================================
  // COMPUTER
  // ==========================================================

  async computer({
    ownerId = null,

    ownerKey = null,

    sessionId = null,

    action = null,

    goal = "",

    agentToken = "",

    tool = "",

    args = {},

    context = {},

    confirmed = false,

    confirmationReason = "",

    metadata = {},
  } = {}) {
    const normalizedAction =
      stringValue(action);

    const normalizedTool =
      stringValue(tool);

    const selectedTool =
      normalizedTool ||
      normalizedAction;

    if (!selectedTool) {
      return {
        ok: false,

        success: false,

        status:
          "invalid_request",

        error:
          "Computer action is required",

        timestamp:
          new Date().toISOString(),
      };
    }

    return this._execute(
      "computer",
      {
        ownerId,

        sessionId,

        goal:
          stringValue(
            goal
          ),

        agentToken:
          stringValue(
            agentToken
          ),

        tool:
          selectedTool,

        args:
          objectValue(args),

        confirmed:
          confirmed === true,

        confirmationReason:
          stringValue(
            confirmationReason
          ),

        metadata: {
          ...objectValue(
            metadata
          ),

          ownerKey,

          context:
            objectValue(
              context
            ),
        },
      }
    );
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  async getCapabilities() {
    return this._execute(
      "getCapabilities"
    );
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  async health() {
    return this._execute(
      "health"
    );
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    const total =
      this.stats.requests;

    return {
      ...this.stats,

      successRate:
        total > 0
          ? Number(
              (
                (
                  this.stats
                    .successes /
                  total
                ) * 100
              ).toFixed(2)
            )
          : 0,

      failureRate:
        total > 0
          ? Number(
              (
                (
                  this.stats
                    .failures /
                  total
                ) * 100
              ).toFixed(2)
            )
          : 0,
    };
  }

  resetStats() {
    this.stats = {
      requests: 0,

      successes: 0,

      failures: 0,

      lastRequestAt: null,

      lastSuccessAt: null,

      lastFailureAt: null,
    };

    return {
      ok: true,

      success: true,

      status: "completed",

      message:
        "AgentAssistantAPI statistics reset",

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      name:
        "ALEX Agent Assistant API",

      version:
        VERSION,

      type:
        "assistant_api",

      core:
        this.core?.constructor?.name ||
        "AgentAssistantCore",

      capabilities: [
        "ask",

        "plan",

        "inspect",

        "research",

        "runTask",

        "computer",

        "getCapabilities",

        "health",
      ],

      stats:
        this.getStats(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let assistantAPI = null;

function getAgentAssistantAPI(
  options = {}
) {
  if (!assistantAPI) {
    assistantAPI =
      new AgentAssistantAPI(
        options
      );
  }

  return assistantAPI;
}

function resetAgentAssistantAPI() {
  assistantAPI = null;

  return getAgentAssistantAPI();
}

function createAgentAssistantAPI(
  options = {}
) {
  return new AgentAssistantAPI(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  AgentAssistantAPI,

  getAgentAssistantAPI,

  resetAgentAssistantAPI,

  createAgentAssistantAPI,
};