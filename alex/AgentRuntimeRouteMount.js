"use strict";

// ============================================================
// ALEX Agent Runtime Route Mount
// File: backend/alex/AgentRuntimeRouteMount.js
//
// Purpose:
// Mount AgentRuntimeRoutes onto an existing Express app.
//
// This file does NOT modify server.js automatically.
// The exported functions can be used later from server.js.
// ============================================================

const {
  createAgentRuntimeRouter,
  getAgentRuntimeRouter,
} = require("./AgentRuntimeRoutes");


// ============================================================
// DEFAULT PREFIX
// ============================================================

const DEFAULT_PREFIX = "/api/alex/runtime";


// ============================================================
// NORMALIZE PREFIX
// ============================================================

function normalizePrefix(prefix) {
  if (!prefix || typeof prefix !== "string") {
    return DEFAULT_PREFIX;
  }

  let value = prefix.trim();

  if (!value) {
    return DEFAULT_PREFIX;
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
// MOUNT ROUTER
// ============================================================

function mountAgentRuntimeRoutes(app, options = {}) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountAgentRuntimeRoutes requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix || DEFAULT_PREFIX
  );

  const router =
    options.router ||
    createAgentRuntimeRouter(options);

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
// MOUNT SINGLETON ROUTER
// ============================================================

function mountSingletonAgentRuntimeRoutes(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountSingletonAgentRuntimeRoutes requires an Express app"
    );
  }

  const prefix = normalizePrefix(
    options.prefix || DEFAULT_PREFIX
  );

  const router =
    options.router ||
    getAgentRuntimeRouter(options);

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
// UNMOUNT HELPER
//
// Express does not provide a reliable public remove-router API.
// This helper only returns information for callers that maintain
// their own mounting references.
// ============================================================

function getMountInfo(prefix = DEFAULT_PREFIX) {
  return {
    prefix: normalizePrefix(prefix),
    service: "ALEX Agent Runtime",
    type: "express-router",
  };
}


// ============================================================
// CREATE MOUNT FUNCTION
// ============================================================

function createAgentRuntimeRouteMount(options = {}) {
  const config = {
    ...options,
    prefix: normalizePrefix(
      options.prefix || DEFAULT_PREFIX
    ),
  };

  return {
    prefix: config.prefix,

    mount(app, mountOptions = {}) {
      return mountAgentRuntimeRoutes(app, {
        ...config,
        ...mountOptions,
      });
    },

    mountSingleton(app, mountOptions = {}) {
      return mountSingletonAgentRuntimeRoutes(app, {
        ...config,
        ...mountOptions,
      });
    },

    getInfo() {
      return getMountInfo(config.prefix);
    },
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_PREFIX,
  normalizePrefix,
  mountAgentRuntimeRoutes,
  mountSingletonAgentRuntimeRoutes,
  getMountInfo,
  createAgentRuntimeRouteMount,
};