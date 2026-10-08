"use strict";

// ============================================================
// ALEX Agent Runtime Router
// File: backend/alex/AgentRuntimeRouter.js
//
// Purpose:
// Combines the Agent Runtime, Health, and Diagnostics routers
// into one router.
//
// This file does NOT modify server.js.
// ============================================================

const express = require("express");

const {
  createAgentRuntimeRouter,
} = require("./AgentRuntimeRoutes");

const {
  createAgentRuntimeHealthRouter,
} = require("./AgentRuntimeHealthRoutes");

const {
  createAgentRuntimeDiagnosticsRouter,
} = require("./AgentRuntimeDiagnosticsRoutes");


// ============================================================
// DEFAULT ROUTE PREFIXES
// ============================================================

const DEFAULT_RUNTIME_PREFIX = "/runtime";
const DEFAULT_HEALTH_PREFIX = "/health";
const DEFAULT_DIAGNOSTICS_PREFIX = "/diagnostics";


// ============================================================
// PREFIX NORMALIZER
// ============================================================

function normalizePrefix(prefix, fallback) {
  if (!prefix || typeof prefix !== "string") {
    return fallback;
  }

  let value = prefix.trim();

  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/")) {
    value = `/${value}`;
  }

  value = value.replace(/\/+/g, "/");

  if (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }

  return value;
}


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeRootRouter(options = {}) {
  const router = express.Router();

  const runtimePrefix = normalizePrefix(
    options.runtimePrefix,
    DEFAULT_RUNTIME_PREFIX
  );

  const healthPrefix = normalizePrefix(
    options.healthPrefix,
    DEFAULT_HEALTH_PREFIX
  );

  const diagnosticsPrefix = normalizePrefix(
    options.diagnosticsPrefix,
    DEFAULT_DIAGNOSTICS_PREFIX
  );


  // ==========================================================
  // CHILD ROUTERS
  // ==========================================================

  const runtimeRouter =
    options.runtimeRouter ||
    createAgentRuntimeRouter(options);

  const healthRouter =
    options.healthRouter ||
    createAgentRuntimeHealthRouter(options);

  const diagnosticsRouter =
    options.diagnosticsRouter ||
    createAgentRuntimeDiagnosticsRouter(options);


  // ==========================================================
  // MOUNT CHILD ROUTERS
  // ==========================================================

  router.use(
    runtimePrefix,
    runtimeRouter
  );

  router.use(
    healthPrefix,
    healthRouter
  );

  router.use(
    diagnosticsPrefix,
    diagnosticsRouter
  );


  // ==========================================================
  // ROOT INFORMATION
  // ==========================================================

  router.get("/", (req, res) => {
    res.json({
      success: true,

      service: "ALEX Agent Runtime",

      version: "1.0.0",

      routes: {
        runtime: runtimePrefix,
        health: healthPrefix,
        diagnostics: diagnosticsPrefix,
      },

      timestamp: new Date().toISOString(),
    });
  });


  // ==========================================================
  // ROUTER INFORMATION
  // ==========================================================

  router.get("/router-info", (req, res) => {
    res.json({
      success: true,

      service: "ALEX Agent Runtime Router",

      version: "1.0.0",

      mountedRouters: {
        runtime: {
          prefix: runtimePrefix,
          enabled: true,
        },

        health: {
          prefix: healthPrefix,
          enabled: true,
        },

        diagnostics: {
          prefix: diagnosticsPrefix,
          enabled: true,
        },
      },

      timestamp: new Date().toISOString(),
    });
  });


  return router;
}


// ============================================================
// SINGLETON
// ============================================================

let singletonRouter = null;


function getAgentRuntimeRootRouter(options = {}) {
  if (!singletonRouter) {
    singletonRouter =
      createAgentRuntimeRootRouter(options);
  }

  return singletonRouter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeRootRouter() {
  singletonRouter = null;
}


// ============================================================
// MOUNT HELPER
// ============================================================

function mountAgentRuntimeRootRouter(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountAgentRuntimeRootRouter requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix,
    "/api/alex"
  );

  const router =
    options.router ||
    createAgentRuntimeRootRouter(options);

  app.use(prefix, router);

  return {
    success: true,
    mounted: true,
    prefix,
    router,
    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// SINGLETON MOUNT
// ============================================================

function mountSingletonAgentRuntimeRootRouter(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountSingletonAgentRuntimeRootRouter requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix,
    "/api/alex"
  );

  const router =
    options.router ||
    getAgentRuntimeRootRouter(options);

  app.use(prefix, router);

  return {
    success: true,
    mounted: true,
    singleton: true,
    prefix,
    router,
    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// CONFIGURATION INFO
// ============================================================

function getAgentRuntimeRouterInfo(options = {}) {
  return {
    service: "ALEX Agent Runtime Router",

    version: "1.0.0",

    prefixes: {
      root: normalizePrefix(
        options.prefix,
        "/api/alex"
      ),

      runtime: normalizePrefix(
        options.runtimePrefix,
        DEFAULT_RUNTIME_PREFIX
      ),

      health: normalizePrefix(
        options.healthPrefix,
        DEFAULT_HEALTH_PREFIX
      ),

      diagnostics: normalizePrefix(
        options.diagnosticsPrefix,
        DEFAULT_DIAGNOSTICS_PREFIX
      ),
    },

    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_RUNTIME_PREFIX,
  DEFAULT_HEALTH_PREFIX,
  DEFAULT_DIAGNOSTICS_PREFIX,

  normalizePrefix,

  createAgentRuntimeRootRouter,
  getAgentRuntimeRootRouter,

  resetAgentRuntimeRootRouter,

  mountAgentRuntimeRootRouter,
  mountSingletonAgentRuntimeRootRouter,

  getAgentRuntimeRouterInfo,
};