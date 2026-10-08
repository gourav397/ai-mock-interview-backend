"use strict";

// ============================================================
// ALEX Agent Runtime App Integration
// File: backend/alex/AgentRuntimeApp.js
//
// Purpose:
// Provides a clean integration layer between the ALEX Agent
// Runtime and an existing Express application.
//
// This file does NOT automatically modify server.js.
// ============================================================

const {
  createAgentRuntimeRootRouter,
  getAgentRuntimeRootRouter,
} = require("./AgentRuntimeRouter");


// ============================================================
// DEFAULT CONFIGURATION
// ============================================================

const DEFAULT_CONFIG = Object.freeze({
  prefix: "/api/alex/runtime",
  runtimePrefix: "/runtime",
  healthPrefix: "/health",
  diagnosticsPrefix: "/diagnostics",
});


// ============================================================
// CONFIG NORMALIZER
// ============================================================

function normalizeConfig(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
  };

  if (
    typeof config.prefix !== "string" ||
    !config.prefix.trim()
  ) {
    config.prefix = DEFAULT_CONFIG.prefix;
  }

  if (
    typeof config.runtimePrefix !== "string" ||
    !config.runtimePrefix.trim()
  ) {
    config.runtimePrefix = DEFAULT_CONFIG.runtimePrefix;
  }

  if (
    typeof config.healthPrefix !== "string" ||
    !config.healthPrefix.trim()
  ) {
    config.healthPrefix = DEFAULT_CONFIG.healthPrefix;
  }

  if (
    typeof config.diagnosticsPrefix !== "string" ||
    !config.diagnosticsPrefix.trim()
  ) {
    config.diagnosticsPrefix =
      DEFAULT_CONFIG.diagnosticsPrefix;
  }

  return config;
}


// ============================================================
// PREFIX NORMALIZER
// ============================================================

function normalizePrefix(prefix) {
  let value = String(prefix || "").trim();

  if (!value) {
    return "/";
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
// ROUTER CREATOR
// ============================================================

function createRuntimeRouter(options = {}) {
  const config = normalizeConfig(options);

  return createAgentRuntimeRootRouter({
    ...config,
    prefix: normalizePrefix(config.prefix),
    runtimePrefix: normalizePrefix(
      config.runtimePrefix
    ),
    healthPrefix: normalizePrefix(
      config.healthPrefix
    ),
    diagnosticsPrefix: normalizePrefix(
      config.diagnosticsPrefix
    ),
  });
}


// ============================================================
// EXPRESS APP MOUNT
// ============================================================

function mountAgentRuntime(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountAgentRuntime requires an Express app"
    );
  }

  const config = normalizeConfig(options);

  const prefix = normalizePrefix(
    config.prefix
  );

  const router =
    options.router ||
    createRuntimeRouter(config);

  app.use(prefix, router);

  return {
    success: true,
    mounted: true,
    prefix,
    router,
    config,
    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// SINGLETON MOUNT
// ============================================================

function mountSingletonAgentRuntime(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountSingletonAgentRuntime requires an Express app"
    );
  }

  const config = normalizeConfig(options);

  const prefix = normalizePrefix(
    config.prefix
  );

  const router =
    options.router ||
    getAgentRuntimeRootRouter(config);

  app.use(prefix, router);

  return {
    success: true,
    mounted: true,
    singleton: true,
    prefix,
    router,
    config,
    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// MOUNT MIDDLEWARE
// ============================================================

function createRuntimeMountMiddleware(
  options = {}
) {
  const config = normalizeConfig(options);

  const prefix = normalizePrefix(
    config.prefix
  );

  const router =
    options.router ||
    createRuntimeRouter(config);

  return {
    prefix,
    router,

    middleware(req, res, next) {
      return router(req, res, next);
    },
  };
}


// ============================================================
// ROUTE INFORMATION
// ============================================================

function getRuntimeRouteInfo(
  options = {}
) {
  const config = normalizeConfig(options);

  return {
    service: "ALEX Agent Runtime",

    version: "1.0.0",

    prefix: normalizePrefix(
      config.prefix
    ),

    routes: {
      runtime: normalizePrefix(
        config.runtimePrefix
      ),

      health: normalizePrefix(
        config.healthPrefix
      ),

      diagnostics: normalizePrefix(
        config.diagnosticsPrefix
      ),
    },

    timestamp: new Date().toISOString(),
  };
}


// ============================================================
// READY CHECK
// ============================================================

function isRuntimeAppReady(app) {
  return !!(
    app &&
    typeof app.use === "function"
  );
}


// ============================================================
// FACTORY
// ============================================================

function createAgentRuntimeApp(options = {}) {
  const config = normalizeConfig(options);

  let router = null;

  return {
    config: {
      ...config,
    },

    getRouter() {
      if (!router) {
        router = createRuntimeRouter(config);
      }

      return router;
    },

    mount(app, mountOptions = {}) {
      return mountAgentRuntime(
        app,
        {
          ...config,
          ...mountOptions,
          router:
            mountOptions.router ||
            this.getRouter(),
        }
      );
    },

    mountSingleton(
      app,
      mountOptions = {}
    ) {
      return mountSingletonAgentRuntime(
        app,
        {
          ...config,
          ...mountOptions,
        }
      );
    },

    getRouteInfo() {
      return getRuntimeRouteInfo(config);
    },

    isReady(app) {
      return isRuntimeAppReady(app);
    },
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  DEFAULT_CONFIG,

  normalizeConfig,
  normalizePrefix,

  createRuntimeRouter,

  mountAgentRuntime,
  mountSingletonAgentRuntime,

  createRuntimeMountMiddleware,

  getRuntimeRouteInfo,

  isRuntimeAppReady,

  createAgentRuntimeApp,
};