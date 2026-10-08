"use strict";

// ============================================================
// ALEX Agent Runtime Service Facade
// File: backend/alex/AgentRuntimeServiceFacade.js
//
// Purpose:
// Provides one clean programmatic interface over the
// Agent Runtime Service.
//
// This file does not modify server.js.
// ============================================================

const {
  getAgentRuntimeService,
} = require("./AgentRuntimeService");

const {
  ensureAgentRuntimeService,
  getAgentRuntimeServiceBootstrapStatus,
} = require("./AgentRuntimeServiceBootstrap");


// ============================================================
// SERVICE RESOLVER
// ============================================================

function resolveService(options = {}) {
  if (
    options &&
    options.service &&
    typeof options.service === "object"
  ) {
    return options.service;
  }

  return getAgentRuntimeService(
    options
  );
}


// ============================================================
// START
// ============================================================

async function start(options = {}) {
  return ensureAgentRuntimeService(
    options
  );
}


// ============================================================
// STATUS
// ============================================================

async function status(options = {}) {
  const service =
    resolveService(options);

  if (
    service &&
    typeof service.getStatus ===
    "function"
  ) {
    return service.getStatus();
  }

  return getAgentRuntimeServiceBootstrapStatus();
}


// ============================================================
// INFO
// ============================================================

async function info(options = {}) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.getInfo !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support getInfo()"
    );
  }

  return service.getInfo();
}


// ============================================================
// HEALTH
// ============================================================

async function health(options = {}) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.health !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support health()"
    );
  }

  return service.health();
}


// ============================================================
// SNAPSHOT
// ============================================================

async function snapshot(options = {}) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.snapshot !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support snapshot()"
    );
  }

  return service.snapshot();
}


// ============================================================
// DIAGNOSTICS
// ============================================================

async function diagnostics(options = {}) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.diagnostics !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support diagnostics()"
    );
  }

  return service.diagnostics();
}


// ============================================================
// DIAGNOSTIC SUMMARY
// ============================================================

async function diagnosticSummary(
  options = {}
) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.diagnosticSummary !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support diagnosticSummary()"
    );
  }

  return service.diagnosticSummary();
}


// ============================================================
// CAPABILITIES
// ============================================================

async function capabilities(
  options = {}
) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.capabilities !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support capabilities()"
    );
  }

  return service.capabilities();
}


// ============================================================
// EVENTS
// ============================================================

async function events(options = {}) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.events !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support events()"
    );
  }

  return service.events();
}


// ============================================================
// CLEAR EVENTS
// ============================================================

async function clearEvents(
  options = {}
) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.clearEvents !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support clearEvents()"
    );
  }

  return service.clearEvents();
}


// ============================================================
// RESET STATISTICS
// ============================================================

async function resetStatistics(
  options = {}
) {
  const service =
    resolveService(options);

  if (
    !service ||
    typeof service.resetStatistics !==
      "function"
  ) {
    throw new Error(
      "Agent Runtime Service does not support resetStatistics()"
    );
  }

  return service.resetStatistics();
}


// ============================================================
// FACADE OBJECT
// ============================================================

const AgentRuntimeServiceFacade = {
  start,

  status,

  info,

  health,

  snapshot,

  diagnostics,

  diagnosticSummary,

  capabilities,

  events,

  clearEvents,

  resetStatistics,
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ...AgentRuntimeServiceFacade,

  AgentRuntimeServiceFacade,
};