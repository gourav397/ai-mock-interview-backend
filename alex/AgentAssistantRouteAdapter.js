/**
 * ============================================================
 * ALEX — Agent Assistant Route Adapter
 * ============================================================
 *
 * File:
 *   backend/alex/AgentAssistantRouteAdapter.js
 *
 * Purpose:
 * - Connect Express routes with AgentAssistantAPI
 * - Keep HTTP handling separate from assistant logic
 * - Normalize request data
 * - Never bypass ALEX permission/runtime layers
 *
 * This file does NOT mount routes itself.
 * ============================================================
 */

const {
  getAgentAssistantAPI,
} = require("./AgentAssistantAPI");

const VERSION = "1.0.0";

class AgentAssistantRouteAdapter {
  constructor(options = {}) {
    this.api = options.api || getAgentAssistantAPI();
  }

  /* ==========================================================
   * HELPERS
   * ========================================================== */

  _getOwnerId(req) {
  return (
    req?.user?.id ||
    req?.user?._id ||
    req?.owner?.userId ||
    req?.owner?.id ||
    req?.owner?._id ||
    null
  );
}

  _getOwnerKey(req) {
    return (
      req?.user?.ownerKey ||
      req?.user?.ownerId ||
      req?.ownerKey ||
      null
    );
  }

  _getSessionId(req) {
    return (
      req?.body?.sessionId ||
      req?.headers?.["x-alex-session-id"] ||
      req?.headers?.["x-session-id"] ||
      null
    );
  }

  _getContext(req) {
    const context =
      req?.body?.context &&
      typeof req.body.context === "object"
        ? req.body.context
        : {};

    return {
      ...context,
      ip:
        req?.ip ||
        req?.socket?.remoteAddress ||
        null,
      userAgent:
        req?.headers?.["user-agent"] ||
        null,
    };
  }

  _send(res, result, defaultStatus = 200) {
    const status =
      result?.status === "invalid_request"
        ? 400
        : result?.status === "failed"
          ? 500
          : defaultStatus;

    return res.status(status).json(result);
  }

  _handleError(res, error) {
    const message =
      error?.message ||
      "ALEX assistant request failed";

    return res.status(500).json({
      ok: false,
      success: false,
      status: "failed",
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /* ==========================================================
   * ASK
   * ========================================================== */

  async ask(req, res) {
    try {
      const result = await this.api.ask({
        ownerId: this._getOwnerId(req),
        ownerKey: this._getOwnerKey(req),
        sessionId: this._getSessionId(req),
        message: req?.body?.message || "",
        context: this._getContext(req),
        execute: req?.body?.execute === true,
        confirmed: req?.body?.confirmed === true,
        confirmationReason:
          req?.body?.confirmationReason || null,
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * PLAN
   * ========================================================== */

  async plan(req, res) {
    try {
      const result = await this.api.plan({
        ownerId: this._getOwnerId(req),
        ownerKey: this._getOwnerKey(req),
        sessionId: this._getSessionId(req),
        goal: req?.body?.goal || req?.body?.message || "",
        context: this._getContext(req),
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * INSPECT
   * ========================================================== */

  async inspect(req, res) {
    try {
      const result = await this.api.inspect({
        message:
          req?.body?.message ||
          req?.body?.goal ||
          "",
        context: this._getContext(req),
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * RESEARCH
   * ========================================================== */

  async research(req, res) {
    try {
      const result = await this.api.research({
        ownerId: this._getOwnerId(req),
        ownerKey: this._getOwnerKey(req),
        sessionId: this._getSessionId(req),
        question:
          req?.body?.question ||
          req?.body?.message ||
          "",
        context: this._getContext(req),
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * RUN TASK
   * ========================================================== */

  async runTask(req, res) {
    try {
      const result = await this.api.runTask({
        ownerId: this._getOwnerId(req),
        ownerKey: this._getOwnerKey(req),
        sessionId: this._getSessionId(req),
        goal:
          req?.body?.goal ||
          req?.body?.message ||
          "",
        context: this._getContext(req),
        execute: req?.body?.execute === true,
        confirmed: req?.body?.confirmed === true,
        confirmationReason:
          req?.body?.confirmationReason || null,
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * COMPUTER
   * ========================================================== */

  async computer(req, res) {
    try {
      const result = await this.api.computer({
        ownerId: this._getOwnerId(req),
        ownerKey: this._getOwnerKey(req),
        sessionId: this._getSessionId(req),
        action:
          req?.body?.action ||
          req?.body?.tool ||
          null,
        args:
          req?.body?.args &&
          typeof req.body.args === "object"
            ? req.body.args
            : {},
        context: this._getContext(req),
        confirmed: req?.body?.confirmed === true,
        confirmationReason:
          req?.body?.confirmationReason || null,
      });

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * CAPABILITIES
   * ========================================================== */

  async capabilities(req, res) {
    try {
      const result = await this.api.getCapabilities();

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * HEALTH
   * ========================================================== */

  async health(req, res) {
    try {
      const result = await this.api.health();

      return this._send(res, result);
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * INFO
   * ========================================================== */

  info(req, res) {
    try {
      return res.json({
        ok: true,
        success: true,
        status: "completed",
        data: this.api.getInfo(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * STATS
   * ========================================================== */

  stats(req, res) {
    try {
      return res.json({
        ok: true,
        success: true,
        status: "completed",
        data: this.api.getStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * RESET STATS
   * ========================================================== */

  resetStats(req, res) {
    try {
      return res.json(this.api.resetStats());
    } catch (error) {
      return this._handleError(res, error);
    }
  }

  /* ==========================================================
   * EXPRESS HANDLER FACTORY
   * ========================================================== */

  createHandlers() {
    return {
      ask: this.ask.bind(this),
      plan: this.plan.bind(this),
      inspect: this.inspect.bind(this),
      research: this.research.bind(this),
      runTask: this.runTask.bind(this),
      computer: this.computer.bind(this),
      capabilities: this.capabilities.bind(this),
      health: this.health.bind(this),
      info: this.info.bind(this),
      stats: this.stats.bind(this),
      resetStats: this.resetStats.bind(this),
    };
  }

  /* ==========================================================
   * INFO
   * ========================================================== */

  getInfo() {
    return {
      name: "ALEX Agent Assistant Route Adapter",
      version: VERSION,
      type: "route_adapter",
      api:
        this.api?.constructor?.name ||
        "AgentAssistantAPI",
      handlers: [
        "ask",
        "plan",
        "inspect",
        "research",
        "runTask",
        "computer",
        "capabilities",
        "health",
        "info",
        "stats",
        "resetStats",
      ],
    };
  }
}

/* ============================================================
 * SINGLETON
 * ============================================================ */

let routeAdapter = null;

function getAgentAssistantRouteAdapter(options = {}) {
  if (!routeAdapter) {
    routeAdapter = new AgentAssistantRouteAdapter(options);
  }

  return routeAdapter;
}

function resetAgentAssistantRouteAdapter() {
  routeAdapter = null;
  return getAgentAssistantRouteAdapter();
}

function createAgentAssistantRouteAdapter(options = {}) {
  return new AgentAssistantRouteAdapter(options);
}

/* ============================================================
 * EXPORTS
 * ============================================================ */

module.exports = {
  VERSION,
  AgentAssistantRouteAdapter,
  getAgentAssistantRouteAdapter,
  resetAgentAssistantRouteAdapter,
  createAgentAssistantRouteAdapter,
};
