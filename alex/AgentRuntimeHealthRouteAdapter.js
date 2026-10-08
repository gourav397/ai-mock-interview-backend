// ============================================================
// ALEX — Agent Runtime Health Route Adapter
// Version: 1.0.0
//
// Purpose:
//   Thin HTTP/Express adapter for AgentRuntimeHealthController.
//
//   This file does NOT create or mount an Express router.
// ============================================================

"use strict";

const {
  getAgentRuntimeHealthController,
} = require("./AgentRuntimeHealthController");

const AGENT_RUNTIME_HEALTH_ROUTE_ADAPTER_VERSION =
  "1.0.0";

class AgentRuntimeHealthRouteAdapter {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_HEALTH_ROUTE_ADAPTER_VERSION;

    this.controller =
      options.controller ||
      getAgentRuntimeHealthController();
  }

  // ==========================================================
  // COMMON HELPERS
  // ==========================================================

  _query(req) {
    if (
      req &&
      req.query &&
      typeof req.query === "object"
    ) {
      return req.query;
    }

    return {};
  }

  _send(res, result) {
    if (
      res &&
      typeof res.status === "function" &&
      typeof res.json === "function"
    ) {
      return res
        .status(
          result?.success === false
            ? 500
            : 200
        )
        .json(result);
    }

    return result;
  }

  _handler(fn) {
    return async (req, res, next) => {
      try {
        const result =
          await fn.call(
            this,
            req,
            res,
            next
          );

        if (
          res &&
          res.headersSent
        ) {
          return result;
        }

        return this._send(
          res,
          result
        );
      } catch (error) {
        if (
          typeof next === "function"
        ) {
          return next(error);
        }

        return this._send(
          res,
          {
            success: false,

            adapterVersion:
              this.version,

            error: {
              name:
                error?.name ||
                "Error",

              message:
                error?.message ||
                String(error),

              code:
                error?.code ||
                null,
            },
          }
        );
      }
    };
  }

  // ==========================================================
  // FULL HEALTH
  // ==========================================================

  check() {
    return this._handler(
      async (req) =>
        this.controller.check(
          this._query(req)
        )
    );
  }

  // ==========================================================
  // QUICK HEALTH
  // ==========================================================

  quickCheck() {
    return this._handler(
      async () =>
        this.controller.quickCheck()
    );
  }

  // ==========================================================
  // LAST RESULT
  // ==========================================================

  lastResult() {
    return this._handler(
      async () =>
        this.controller.lastResult()
    );
  }

  // ==========================================================
  // STATISTICS
  // ==========================================================

  stats() {
    return this._handler(
      async () =>
        this.controller.stats()
    );
  }

  // ==========================================================
  // RESET STATISTICS
  // ==========================================================

  resetStats() {
    return this._handler(
      async () =>
        this.controller.resetStats()
    );
  }

  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  diagnostics() {
    return this._handler(
      async () =>
        this.controller.diagnostics()
    );
  }

  // ==========================================================
  // INFO
  // ==========================================================

  info() {
    return this._handler(
      async () =>
        this.controller.info()
    );
  }

  // ==========================================================
  // HANDLER MAP
  // ==========================================================

  handlers() {
    return {
      check:
        this.check(),

      quickCheck:
        this.quickCheck(),

      lastResult:
        this.lastResult(),

      stats:
        this.stats(),

      resetStats:
        this.resetStats(),

      diagnostics:
        this.diagnostics(),

      info:
        this.info(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let adapterInstance =
  null;

function getAgentRuntimeHealthRouteAdapter(
  options = {}
) {
  if (
    !adapterInstance
  ) {
    adapterInstance =
      new AgentRuntimeHealthRouteAdapter(
        options
      );
  }

  return adapterInstance;
}

function resetAgentRuntimeHealthRouteAdapter(
  options = {}
) {
  adapterInstance =
    new AgentRuntimeHealthRouteAdapter(
      options
    );

  return adapterInstance;
}

function createAgentRuntimeHealthRouteAdapter(
  options = {}
) {
  return new AgentRuntimeHealthRouteAdapter(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeHealthRouteAdapter,

  getAgentRuntimeHealthRouteAdapter,
  resetAgentRuntimeHealthRouteAdapter,
  createAgentRuntimeHealthRouteAdapter,

  AGENT_RUNTIME_HEALTH_ROUTE_ADAPTER_VERSION,
};