"use strict";

// ============================================================
// ALEX Agent Runtime Service Controller
// File: backend/alex/AgentRuntimeServiceController.js
//
// Purpose:
// Controller layer between Express adapters and the
// AgentRuntimeService API.
//
// This file does NOT modify server.js.
// ============================================================

const {
  getAgentRuntimeServiceAPI,
} = require("./AgentRuntimeServiceAPI");


// ============================================================
// CONTROLLER
// ============================================================

class AgentRuntimeServiceController {
  constructor(options = {}) {
    this.api =
      options.api ||
      getAgentRuntimeServiceAPI(options);
  }


  // ==========================================================
  // LIFECYCLE
  // ==========================================================

  async start(req = {}, res = null) {
    return this.api.start();
  }


  async ensureStarted(req = {}, res = null) {
    return this.api.ensureStarted();
  }


  async stop(req = {}, res = null) {
    return this.api.stop();
  }


  async restart(req = {}, res = null) {
    return this.api.restart();
  }


  // ==========================================================
  // STATUS
  // ==========================================================

  status(req = {}, res = null) {
    return this.api.getStatus();
  }


  info(req = {}, res = null) {
    return this.api.getInfo();
  }


  // ==========================================================
  // HEALTH
  // ==========================================================

  async health(req = {}, res = null) {
    return this.api.health();
  }


  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  async snapshot(req = {}, res = null) {
    return this.api.snapshot();
  }


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  async diagnostics(req = {}, res = null) {
    return this.api.diagnostics();
  }


  async diagnosticSummary(req = {}, res = null) {
    return this.api.diagnosticSummary();
  }


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  async capabilities(req = {}, res = null) {
    return this.api.capabilities();
  }


  // ==========================================================
  // EVENTS
  // ==========================================================

  async events(req = {}, res = null) {
    const query =
      req && req.query
        ? req.query
        : {};

    return this.api.events(query);
  }


  async clearEvents(req = {}, res = null) {
    return this.api.clearEvents();
  }


  // ==========================================================
  // STATISTICS
  // ==========================================================

  resetStatistics(req = {}, res = null) {
    return this.api.resetStatistics();
  }


  // ==========================================================
  // EXPRESS HANDLER WRAPPER
  // ==========================================================

  _handler(methodName, statusCode = 200) {
    return async (req, res, next) => {
      try {
        const method =
          this[methodName];

        if (typeof method !== "function") {
          throw new Error(
            `Controller method not found: ${methodName}`
          );
        }

        const result =
          await method.call(
            this,
            req,
            res
          );

        if (
          res &&
          typeof res.status === "function" &&
          typeof res.json === "function"
        ) {
          return res
            .status(statusCode)
            .json(result);
        }

        return result;
      } catch (error) {
        if (
          res &&
          typeof res.status === "function" &&
          typeof res.json === "function"
        ) {
          return res
            .status(500)
            .json({
              success: false,
              error: error.message,
            });
        }

        if (typeof next === "function") {
          return next(error);
        }

        throw error;
      }
    };
  }


  // ==========================================================
  // HANDLER MAP
  // ==========================================================

  handlers() {
    return {
      start: this._handler("start"),
      ensureStarted:
        this._handler("ensureStarted"),

      stop: this._handler("stop"),
      restart: this._handler("restart"),

      status: this._handler("status"),
      info: this._handler("info"),

      health: this._handler("health"),
      snapshot: this._handler("snapshot"),

      diagnostics:
        this._handler("diagnostics"),

      diagnosticSummary:
        this._handler("diagnosticSummary"),

      capabilities:
        this._handler("capabilities"),

      events:
        this._handler("events"),

      clearEvents:
        this._handler("clearEvents"),

      resetStatistics:
        this._handler("resetStatistics"),
    };
  }
}


// ============================================================
// FACTORY
// ============================================================

function createAgentRuntimeServiceController(
  options = {}
) {
  return new AgentRuntimeServiceController(
    options
  );
}


// ============================================================
// SINGLETON
// ============================================================

let singletonController = null;


function getAgentRuntimeServiceController(
  options = {}
) {
  if (!singletonController) {
    singletonController =
      createAgentRuntimeServiceController(
        options
      );
  }

  return singletonController;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceController() {
  singletonController = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeServiceController,

  createAgentRuntimeServiceController,
  getAgentRuntimeServiceController,

  resetAgentRuntimeServiceController,
};