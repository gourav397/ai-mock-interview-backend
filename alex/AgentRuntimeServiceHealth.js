"use strict";

// ============================================================
// ALEX Agent Runtime Service Health
// File: backend/alex/AgentRuntimeServiceHealth.js
//
// Purpose:
// Central health/status helper for the Agent Runtime Service.
// ============================================================

const {
  getAgentRuntimeService,
} = require("./AgentRuntimeService");

const {
  getAgentRuntimeServiceBootstrapStatus,
} = require("./AgentRuntimeServiceBootstrap");


// ============================================================
// SAFE CALL
// ============================================================

async function safeCall(fn, fallback = null) {
  try {
    if (typeof fn !== "function") {
      return fallback;
    }

    return await fn();
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
// SERVICE HEALTH
// ============================================================

async function getServiceHealth(
  options = {}
) {
  const service =
    options.service ||
    getAgentRuntimeService(options);

  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  const health =
    await safeCall(
      () =>
        service &&
        typeof service.health === "function"
          ? service.health()
          : null,
      null
    );

  const status =
    await safeCall(
      () =>
        service &&
        typeof service.getStatus === "function"
          ? service.getStatus()
          : null,
      null
    );

  return {
    success: true,

    service:
      "ALEX Agent Runtime Service",

    healthy:
      health?.healthy ??
      health?.ok ??
      Boolean(
        bootstrap.bootstrapped
      ),

    bootstrapped:
      Boolean(
        bootstrap.bootstrapped
      ),

    bootstrapping:
      Boolean(
        bootstrap.bootstrapping
      ),

    health,

    status,

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// QUICK HEALTH
// ============================================================

async function getQuickHealth(
  options = {}
) {
  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  return {
    success: true,

    healthy:
      Boolean(
        bootstrap.bootstrapped
      ),

    bootstrapped:
      Boolean(
        bootstrap.bootstrapped
      ),

    bootstrapping:
      Boolean(
        bootstrap.bootstrapping
      ),

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// READINESS
// ============================================================

function isReady() {
  const bootstrap =
    getAgentRuntimeServiceBootstrapStatus();

  return Boolean(
    bootstrap.bootstrapped === true &&
    bootstrap.bootstrapping !== true
  );
}


// ============================================================
// LIVENESS
// ============================================================

function isAlive() {
  return true;
}


// ============================================================
// HEALTH SUMMARY
// ============================================================

async function getHealthSummary(
  options = {}
) {
  const result =
    await getServiceHealth(
      options
    );

  return {
    success: result.success,

    service: result.service,

    healthy: result.healthy,

    ready: isReady(),

    alive: isAlive(),

    bootstrapped:
      result.bootstrapped,

    timestamp:
      result.timestamp,
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getServiceHealth,

  getQuickHealth,

  getHealthSummary,

  isReady,

  isAlive,
};