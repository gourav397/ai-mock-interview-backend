"use strict";

// ============================================================
// ALEX Agent Runtime Service Mount
// File: backend/alex/AgentRuntimeServiceMount.js
//
// Purpose:
// Small integration helper for mounting the Agent Runtime
// Service Router without changing server.js.
// ============================================================

const {
  createAgentRuntimeServiceRouter,
  getAgentRuntimeServiceRouter,
  normalizePrefix,
} = require("./AgentRuntimeServiceRouter");


// ============================================================
// DEFAULT CONFIG
// ============================================================

const DEFAULT_CONFIG = Object.freeze({
  prefix: "/api/alex/service",
});


// ============================================================
// CONFIG NORMALIZER
// ============================================================

function normalizeConfig(options = {}) {
  const input =
    options && typeof options === "object"
      ? options
      : {};

  return {
    ...DEFAULT_CONFIG,
    ...input,
    prefix: normalizePrefix(
      input.prefix || DEFAULT_CONFIG.prefix
    ),
  };
}


// ============================================================
// CREATE MOUNT
// ============================================================

function createAgentRuntimeServiceMount(
  options = {}
) {
  const config =
    normalizeConfig(options);

  const router =
    config.router ||
    createAgentRuntimeServiceRouter(
      config
    );

  return {
    success: true,

    router,

    prefix: config.prefix,

    config: {
      ...config,
      router: undefined,
    },

    mounted: false,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// MOUNT ON EXPRESS APP
// ============================================================

function mountAgentRuntimeService(
  app,
  options = {}
) {
  if (
    !app ||
    typeof app.use !== "function"
  ) {
    throw new TypeError(
      "mountAgentRuntimeService requires an Express app"
    );
  }

  const mount =
    createAgentRuntimeServiceMount(
      options
    );

  app.use(
    mount.prefix,
    mount.router
  );

  mount.mounted = true;

  mount.timestamp =
    new Date().toISOString();

  return mount;
}


// ============================================================
// SINGLETON MOUNT
// ============================================================

function mountSingletonAgentRuntimeService(
  app,
  options = {}
) {
  if (
    !app ||
    typeof app.use !== "function"
  ) {
    throw new TypeError(
      "mountSingletonAgentRuntimeService requires an Express app"
    );
  }

  const config =
    normalizeConfig(options);

  const router =
    config.router ||
    getAgentRuntimeServiceRouter(
      config
    );

  app.use(
    config.prefix,
    router
  );

  return {
    success: true,

    mounted: true,

    singleton: true,

    router,

    prefix: config.prefix,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// MOUNT MIDDLEWARE FACTORY
// ============================================================

function createAgentRuntimeServiceMountMiddleware(
  options = {}
) {
  const config =
    normalizeConfig(options);

  const router =
    config.router ||
    createAgentRuntimeServiceRouter(
      config
    );

  return function agentRuntimeServiceMountMiddleware(
    req,
    res,
    next
  ) {
    return router(req, res, next);
  };
}


// ============================================================
// MOUNT INFO
// ============================================================

function getAgentRuntimeServiceMountInfo(
  options = {}
) {
  const config =
    normalizeConfig(options);

  return {
    success: true,

    service:
      "ALEX Agent Runtime Service",

    prefix: config.prefix,

    endpoints: {
      root: `${config.prefix}/`,
      status: `${config.prefix}/status`,
      info: `${config.prefix}/info`,
      health: `${config.prefix}/health`,
      snapshot: `${config.prefix}/snapshot`,
      diagnostics:
        `${config.prefix}/diagnostics`,
      diagnosticSummary:
        `${config.prefix}/diagnostics/summary`,
      capabilities:
        `${config.prefix}/capabilities`,
      events:
        `${config.prefix}/events`,
      start:
        `${config.prefix}/start`,
      ensureStarted:
        `${config.prefix}/ensure-started`,
      stop:
        `${config.prefix}/stop`,
      restart:
        `${config.prefix}/restart`,
      resetStatistics:
        `${config.prefix}/statistics/reset`,
    },

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// READINESS
// ============================================================

function isAgentRuntimeServiceMountReady(
  app
) {
  return Boolean(
    app &&
    typeof app.use === "function"
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_CONFIG,

  normalizeConfig,

  createAgentRuntimeServiceMount,

  mountAgentRuntimeService,

  mountSingletonAgentRuntimeService,

  createAgentRuntimeServiceMountMiddleware,

  getAgentRuntimeServiceMountInfo,

  isAgentRuntimeServiceMountReady,
};