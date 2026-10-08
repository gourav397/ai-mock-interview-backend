// ============================================================
// ALEX — Agent Runtime Diagnostics Route Adapter
// Version: 1.0.0
//
// Purpose:
//   HTTP/Express adapter for AgentRuntimeDiagnosticsController.
//
//   This file does NOT create or mount an Express router.
// ============================================================

"use strict";

const {
  getAgentRuntimeDiagnosticsController,
} = require("./AgentRuntimeDiagnosticsController");

const AGENT_RUNTIME_DIAGNOSTICS_ROUTE_ADAPTER_VERSION =
  "1.0.0";

class AgentRuntimeDiagnosticsRouteAdapter {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_DIAGNOSTICS_ROUTE_ADAPTER_VERSION;

    this.controller =
      options.controller ||
      getAgentRuntimeDiagnosticsController();
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
  // FULL SNAPSHOT
  // ==========================================================

  snapshot() {
    return this._handler(
      async (req) =>
        this.controller.snapshot(
          this._query(req)
        )
    );
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  summary() {
    return this._handler(
      async () =>
        this.controller.summary()
    );
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  health() {
    return this._handler(
      async () =>
        this.controller.health()
    );
  }

  // ==========================================================
  // HEALTH STATS
  // ==========================================================

  healthStats() {
    return this._handler(
      async () =>
        this.controller.healthStats()
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
  // CAPABILITIES
  // ==========================================================

  capabilities() {
    return this._handler(
      async () =>
        this.controller.capabilities()
    );
  }

  // ==========================================================
  // SESSIONS
  // ==========================================================

  sessions() {
    return this._handler(
      async () =>
        this.controller.sessions()
    );
  }

  // ==========================================================
  // WORKFLOWS
  // ==========================================================

  workflows() {
    return this._handler(
      async () =>
        this.controller.workflows()
    );
  }

  // ==========================================================
  // TOOLS
  // ==========================================================

  tools() {
    return this._handler(
      async () =>
        this.controller.tools()
    );
  }

  // ==========================================================
  // VERIFICATION
  // ==========================================================

  verification() {
    return this._handler(
      async () =>
        this.controller.verification()
    );
  }

  // ==========================================================
  // HANDLER MAP
  // ==========================================================

  handlers() {
    return {
      snapshot:
        this.snapshot(),

      summary:
        this.summary(),

      health:
        this.health(),

      healthStats:
        this.healthStats(),

      info:
        this.info(),

      capabilities:
        this.capabilities(),

      sessions:
        this.sessions(),

      workflows:
        this.workflows(),

      tools:
        this.tools(),

      verification:
        this.verification(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let adapterInstance =
  null;

function getAgentRuntimeDiagnosticsRouteAdapter(
  options = {}
) {
  if (
    !adapterInstance
  ) {
    adapterInstance =
      new AgentRuntimeDiagnosticsRouteAdapter(
        options
      );
  }

  return adapterInstance;
}

function resetAgentRuntimeDiagnosticsRouteAdapter(
  options = {}
) {
  adapterInstance =
    new AgentRuntimeDiagnosticsRouteAdapter(
      options
    );

  return adapterInstance;
}

function createAgentRuntimeDiagnosticsRouteAdapter(
  options = {}
) {
  return new AgentRuntimeDiagnosticsRouteAdapter(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeDiagnosticsRouteAdapter,

  getAgentRuntimeDiagnosticsRouteAdapter,
  resetAgentRuntimeDiagnosticsRouteAdapter,
  createAgentRuntimeDiagnosticsRouteAdapter,

  AGENT_RUNTIME_DIAGNOSTICS_ROUTE_ADAPTER_VERSION,
};