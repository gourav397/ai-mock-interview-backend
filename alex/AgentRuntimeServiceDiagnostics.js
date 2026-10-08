"use strict";

// ============================================================
// ALEX Agent Runtime Service Diagnostics
// File: backend/alex/AgentRuntimeServiceDiagnostics.js
//
// Purpose:
// Central diagnostic helper for the Agent Runtime Service.
// ============================================================

const {
  getAgentRuntimeService,
} = require("./AgentRuntimeService");

const {
  getAgentRuntimeServiceBootstrapStatus,
} = require("./AgentRuntimeServiceBootstrap");


// ============================================================
// SAFE METHOD CALL
// ============================================================

async function callMethod(
  target,
  method,
  fallback = null
) {
  try {
    if (
      !target ||
      typeof target[method] !== "function"
    ) {
      return fallback;
    }

    return await target[method]();
  } catch (error) {
    return {
      success: false,

      error:
        error?.message ||
        String(error),
    };
  }
}


// ============================================================
// FULL DIAGNOSTICS
// ============================================================

async function getDiagnostics(
  options = {}
) {
  const service =
    options.service ||
    getAgentRuntimeService(options);

  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  const [
    status,
    info,
    health,
    snapshot,
    capabilities,
    events,
  ] = await Promise.all([
    callMethod(
      service,
      "getStatus"
    ),

    callMethod(
      service,
      "getInfo"
    ),

    callMethod(
      service,
      "health"
    ),

    callMethod(
      service,
      "snapshot"
    ),

    callMethod(
      service,
      "capabilities"
    ),

    callMethod(
      service,
      "events"
    ),
  ]);

  return {
    success: true,

    service:
      "ALEX Agent Runtime Service",

    bootstrap: {
      bootstrapped:
        Boolean(
          bootstrap.bootstrapped
        ),

      bootstrapping:
        Boolean(
          bootstrap.bootstrapping
        ),
    },

    status,

    info,

    health,

    snapshot,

    capabilities,

    events,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// DIAGNOSTIC SUMMARY
// ============================================================

async function getDiagnosticSummary(
  options = {}
) {
  const data =
    await getDiagnostics(options);

  const health =
    data.health || {};

  const status =
    data.status || {};

  const capabilities =
    data.capabilities || {};

  return {
    success: data.success,

    service: data.service,

    healthy:
      health.healthy ??
      health.ok ??
      null,

    running:
      status.running ??
      status.started ??
      status.active ??
      null,

    bootstrapped:
      data.bootstrap?.bootstrapped ??
      false,

    bootstrapping:
      data.bootstrap?.bootstrapping ??
      false,

    capabilities:
      Array.isArray(capabilities)
        ? capabilities.length
        : Array.isArray(
            capabilities?.capabilities
          )
          ? capabilities.capabilities.length
          : null,

    timestamp:
      data.timestamp,
  };
}


// ============================================================
// DIAGNOSTIC HEALTH
// ============================================================

async function getDiagnosticHealth(
  options = {}
) {
  const service =
    options.service ||
    getAgentRuntimeService(options);

  const health =
    await callMethod(
      service,
      "health"
    );

  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  return {
    success: true,

    healthy:
      health?.healthy ??
      health?.ok ??
      Boolean(
        bootstrap.bootstrapped
      ),

    health,

    bootstrapped:
      Boolean(
        bootstrap.bootstrapped
      ),

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// RUNTIME INFORMATION
// ============================================================

async function getRuntimeInfo(
  options = {}
) {
  const service =
    options.service ||
    getAgentRuntimeService(options);

  return {
    success: true,

    service:
      await callMethod(
        service,
        "getInfo"
      ),

    status:
      await callMethod(
        service,
        "getStatus"
      ),

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// READINESS
// ============================================================

async function checkReadiness(
  options = {}
) {
  const service =
    options.service ||
    getAgentRuntimeService(options);

  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  const health =
    await callMethod(
      service,
      "health"
    );

  const healthy =
    health?.healthy ??
    health?.ok ??
    false;

  return {
    success: true,

    ready:
      Boolean(
        bootstrap.bootstrapped &&
        healthy
      ),

    bootstrapped:
      Boolean(
        bootstrap.bootstrapped
      ),

    healthy,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getDiagnostics,

  getDiagnosticSummary,

  getDiagnosticHealth,

  getRuntimeInfo,

  checkReadiness,
};