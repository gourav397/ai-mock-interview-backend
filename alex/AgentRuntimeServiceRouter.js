"use strict";

// ============================================================
// ALEX Agent Runtime Service Router
// File: backend/alex/AgentRuntimeServiceRouter.js
//
// Purpose:
// Registers the Agent Runtime Service endpoints.
//
// This file does NOT modify server.js.
// ============================================================

const express = require("express");

const {
  createAgentRuntimeServiceRouteAdapter,
} = require("./AgentRuntimeServiceRouteAdapter");


// ============================================================
// DEFAULT PREFIX
// ============================================================

const DEFAULT_PREFIX = "/service";


// ============================================================
// PREFIX NORMALIZER
// ============================================================

function normalizePrefix(prefix) {
  let value =
    typeof prefix === "string"
      ? prefix.trim()
      : "";

  if (!value) {
    return DEFAULT_PREFIX;
  }

  if (!value.startsWith("/")) {
    value = `/${value}`;
  }

  value = value.replace(/\/+/g, "/");

  if (
    value.length > 1 &&
    value.endsWith("/")
  ) {
    value = value.slice(0, -1);
  }

  return value;
}


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeServiceRouter(
  options = {}
) {
  const router = express.Router();

  const adapter =
    options.adapter ||
    createAgentRuntimeServiceRouteAdapter(
      options
    );

  const handlers =
    adapter.handlers();


  // ==========================================================
  // ROOT
  // ==========================================================

  router.get("/", (req, res) => {
    res.json({
      success: true,

      service:
        "ALEX Agent Runtime Service",

      version: "1.0.0",

      timestamp:
        new Date().toISOString(),
    });
  });


  // ==========================================================
  // LIFECYCLE
  // ==========================================================

  router.post(
    "/start",
    handlers.start
  );

  router.post(
    "/ensure-started",
    handlers.ensureStarted
  );

  router.post(
    "/stop",
    handlers.stop
  );

  router.post(
    "/restart",
    handlers.restart
  );


  // ==========================================================
  // STATUS / INFO
  // ==========================================================

  router.get(
    "/status",
    handlers.status
  );

  router.get(
    "/info",
    handlers.info
  );


  // ==========================================================
  // HEALTH
  // ==========================================================

  router.get(
    "/health",
    handlers.health
  );


  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  router.get(
    "/snapshot",
    handlers.snapshot
  );


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  router.get(
    "/diagnostics",
    handlers.diagnostics
  );

  router.get(
    "/diagnostics/summary",
    handlers.diagnosticSummary
  );


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  router.get(
    "/capabilities",
    handlers.capabilities
  );


  // ==========================================================
  // EVENTS
  // ==========================================================

  router.get(
    "/events",
    handlers.events
  );

  router.delete(
    "/events",
    handlers.clearEvents
  );


  // ==========================================================
  // STATISTICS
  // ==========================================================

  router.post(
    "/statistics/reset",
    handlers.resetStatistics
  );


  // ==========================================================
  // ROUTER INFO
  // ==========================================================

  router.get(
    "/router-info",
    (req, res) => {
      res.json({
        success: true,

        service:
          "ALEX Agent Runtime Service Router",

        version: "1.0.0",

        endpoints: {
          lifecycle: [
            "POST /start",
            "POST /ensure-started",
            "POST /stop",
            "POST /restart",
          ],

          status: [
            "GET /status",
            "GET /info",
            "GET /health",
          ],

          runtime: [
            "GET /snapshot",
            "GET /capabilities",
          ],

          diagnostics: [
            "GET /diagnostics",
            "GET /diagnostics/summary",
          ],

          events: [
            "GET /events",
            "DELETE /events",
          ],

          statistics: [
            "POST /statistics/reset",
          ],
        },

        timestamp:
          new Date().toISOString(),
      });
    }
  );


  return router;
}


// ============================================================
// MOUNT HELPER
// ============================================================

function mountAgentRuntimeServiceRouter(
  app,
  options = {}
) {
  if (
    !app ||
    typeof app.use !== "function"
  ) {
    throw new TypeError(
      "mountAgentRuntimeServiceRouter requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix
  );

  const router =
    options.router ||
    createAgentRuntimeServiceRouter(
      options
    );

  app.use(
    prefix,
    router
  );

  return {
    success: true,
    mounted: true,
    prefix,
    router,
    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// SINGLETON
// ============================================================

let singletonRouter = null;


function getAgentRuntimeServiceRouter(
  options = {}
) {
  if (!singletonRouter) {
    singletonRouter =
      createAgentRuntimeServiceRouter(
        options
      );
  }

  return singletonRouter;
}


// ============================================================
// SINGLETON MOUNT
// ============================================================

function mountSingletonAgentRuntimeServiceRouter(
  app,
  options = {}
) {
  if (
    !app ||
    typeof app.use !== "function"
  ) {
    throw new TypeError(
      "mountSingletonAgentRuntimeServiceRouter requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix
  );

  const router =
    options.router ||
    getAgentRuntimeServiceRouter(
      options
    );

  app.use(
    prefix,
    router
  );

  return {
    success: true,
    mounted: true,
    singleton: true,
    prefix,
    router,
    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceRouter() {
  singletonRouter = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_PREFIX,

  normalizePrefix,

  createAgentRuntimeServiceRouter,

  mountAgentRuntimeServiceRouter,

  getAgentRuntimeServiceRouter,

  mountSingletonAgentRuntimeServiceRouter,

  resetAgentRuntimeServiceRouter,
};