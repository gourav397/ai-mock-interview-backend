"use strict";

// ============================================================
// ALEX Agent Runtime Service Bootstrap
// File: backend/alex/AgentRuntimeServiceBootstrap.js
//
// Purpose:
// Initializes the Agent Runtime Service once and provides
// lifecycle helpers for the rest of ALEX.
// ============================================================

const {
  getAgentRuntimeService,
  resetAgentRuntimeService,
} = require("./AgentRuntimeService");


// ============================================================
// BOOTSTRAP STATE
// ============================================================

let bootstrapPromise = null;
let bootstrapResult = null;
let bootstrapped = false;


// ============================================================
// OPTIONS NORMALIZER
// ============================================================

function normalizeOptions(options = {}) {
  if (
    !options ||
    typeof options !== "object"
  ) {
    return {};
  }

  return {
    ...options,
  };
}


// ============================================================
// START
// ============================================================

async function bootstrapAgentRuntimeService(
  options = {}
) {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const config =
    normalizeOptions(options);

  bootstrapPromise = (async () => {
    try {
      const service =
        config.service ||
        getAgentRuntimeService(
          config
        );

      let status = null;

      if (
        typeof service.ensureStarted ===
        "function"
      ) {
        status =
          await service.ensureStarted();
      } else if (
        typeof service.start ===
        "function"
      ) {
        status =
          await service.start();
      }

      bootstrapResult = {
        success: true,

        bootstrapped: true,

        service,

        status,

        timestamp:
          new Date().toISOString(),
      };

      bootstrapped = true;

      return bootstrapResult;
    } catch (error) {
      bootstrapResult = {
        success: false,

        bootstrapped: false,

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString(),
      };

      bootstrapped = false;

      throw error;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}


// ============================================================
// ENSURE BOOTSTRAPPED
// ============================================================

async function ensureAgentRuntimeService(
  options = {}
) {
  if (bootstrapped) {
    const service =
      options.service ||
      getAgentRuntimeService(
        options
      );

    return {
      success: true,

      bootstrapped: true,

      service,

      status:
        bootstrapResult?.status ||
        null,

      timestamp:
        new Date().toISOString(),
    };
  }

  return bootstrapAgentRuntimeService(
    options
  );
}


// ============================================================
// GET BOOTSTRAP STATUS
// ============================================================

function getAgentRuntimeServiceBootstrapStatus() {
  return {
    success: true,

    bootstrapped,

    bootstrapping:
      Boolean(bootstrapPromise),

    result:
      bootstrapResult,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// STOP
// ============================================================

async function stopAgentRuntimeServiceBootstrap() {
  const service =
    getAgentRuntimeService();

  try {
    let result = null;

    if (
      service &&
      typeof service.stop ===
      "function"
    ) {
      result =
        await service.stop();
    }

    bootstrapped = false;

    bootstrapResult = {
      success: true,

      bootstrapped: false,

      stopped: true,

      result,

      timestamp:
        new Date().toISOString(),
    };

    return bootstrapResult;
  } catch (error) {
    bootstrapped = false;

    throw error;
  }
}


// ============================================================
// RESTART
// ============================================================

async function restartAgentRuntimeServiceBootstrap(
  options = {}
) {
  await stopAgentRuntimeServiceBootstrap();

  return bootstrapAgentRuntimeService(
    options
  );
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceBootstrap() {
  bootstrapPromise = null;
  bootstrapResult = null;
  bootstrapped = false;

  try {
    resetAgentRuntimeService();
  } catch {
    // Reset must remain safe even if the
    // underlying service has already been reset.
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  bootstrapAgentRuntimeService,

  ensureAgentRuntimeService,

  getAgentRuntimeServiceBootstrapStatus,

  stopAgentRuntimeServiceBootstrap,

  restartAgentRuntimeServiceBootstrap,

  resetAgentRuntimeServiceBootstrap,
};