"use strict";

// ============================================================
// ALEX Agent Runtime Service Route Adapter
// File: backend/alex/AgentRuntimeServiceRouteAdapter.js
//
// Purpose:
// Converts AgentRuntimeServiceController methods into clean
// Express handlers.
//
// This file does NOT register routes and does NOT modify
// server.js.
// ============================================================

const {
  createAgentRuntimeServiceController,
} = require("./AgentRuntimeServiceController");


// ============================================================
// ADAPTER
// ============================================================

class AgentRuntimeServiceRouteAdapter {
  constructor(options = {}) {
    this.controller =
      options.controller ||
      createAgentRuntimeServiceController(options);
  }


  // ==========================================================
  // RESPONSE HELPERS
  // ==========================================================

  _send(res, result, statusCode = 200) {
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
  }


  _error(res, error, statusCode = 500) {
    const payload = {
      success: false,

      error: error?.message ||
        "Agent Runtime Service request failed",

      timestamp: new Date().toISOString(),
    };

    if (
      error?.code !== undefined
    ) {
      payload.code = error.code;
    }

    return this._send(
      res,
      payload,
      statusCode
    );
  }


  // ==========================================================
  // GENERIC HANDLER
  // ==========================================================

  _handler(
    methodName,
    options = {}
  ) {
    const {
      successStatus = 200,
      errorStatus = 500,
    } = options;

    return async (req, res, next) => {
      try {
        if (
          !this.controller ||
          typeof this.controller[methodName] !==
            "function"
        ) {
          throw new Error(
            `Controller method not available: ${methodName}`
          );
        }

        const result =
          await this.controller[methodName](
            req,
            res
          );

        return this._send(
          res,
          result,
          successStatus
        );
      } catch (error) {
        if (
          typeof next === "function" &&
          options.passToNext === true
        ) {
          return next(error);
        }

        return this._error(
          res,
          error,
          errorStatus
        );
      }
    };
  }


  // ==========================================================
  // HANDLERS
  // ==========================================================

  start() {
    return this._handler("start");
  }


  ensureStarted() {
    return this._handler("ensureStarted");
  }


  stop() {
    return this._handler("stop");
  }


  restart() {
    return this._handler("restart");
  }


  status() {
    return this._handler("status");
  }


  info() {
    return this._handler("info");
  }


  health() {
    return this._handler("health");
  }


  snapshot() {
    return this._handler("snapshot");
  }


  diagnostics() {
    return this._handler("diagnostics");
  }


  diagnosticSummary() {
    return this._handler(
      "diagnosticSummary"
    );
  }


  capabilities() {
    return this._handler(
      "capabilities"
    );
  }


  events() {
    return this._handler("events");
  }


  clearEvents() {
    return this._handler(
      "clearEvents"
    );
  }


  resetStatistics() {
    return this._handler(
      "resetStatistics"
    );
  }


  // ==========================================================
  // HANDLER MAP
  // ==========================================================

  handlers() {
    return {
      start: this.start(),

      ensureStarted:
        this.ensureStarted(),

      stop: this.stop(),

      restart: this.restart(),

      status: this.status(),

      info: this.info(),

      health: this.health(),

      snapshot: this.snapshot(),

      diagnostics:
        this.diagnostics(),

      diagnosticSummary:
        this.diagnosticSummary(),

      capabilities:
        this.capabilities(),

      events:
        this.events(),

      clearEvents:
        this.clearEvents(),

      resetStatistics:
        this.resetStatistics(),
    };
  }


  // ==========================================================
  // CONTROLLER ACCESS
  // ==========================================================

  getController() {
    return this.controller;
  }
}


// ============================================================
// FACTORY
// ============================================================

function createAgentRuntimeServiceRouteAdapter(
  options = {}
) {
  return new AgentRuntimeServiceRouteAdapter(
    options
  );
}


// ============================================================
// SINGLETON
// ============================================================

let singletonAdapter = null;


function getAgentRuntimeServiceRouteAdapter(
  options = {}
) {
  if (!singletonAdapter) {
    singletonAdapter =
      createAgentRuntimeServiceRouteAdapter(
        options
      );
  }

  return singletonAdapter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceRouteAdapter() {
  singletonAdapter = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeServiceRouteAdapter,

  createAgentRuntimeServiceRouteAdapter,
  getAgentRuntimeServiceRouteAdapter,

  resetAgentRuntimeServiceRouteAdapter,
};