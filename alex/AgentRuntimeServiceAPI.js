"use strict";

// ============================================================
// ALEX Agent Runtime Service API
// File: backend/alex/AgentRuntimeServiceAPI.js
//
// Purpose:
// Stable programmatic API over AgentRuntimeService.
//
// This layer keeps consumers independent from the internal
// service implementation.
// ============================================================

const {
  createAgentRuntimeService,
  getAgentRuntimeService,
} = require("./AgentRuntimeService");


// ============================================================
// API CLASS
// ============================================================

class AgentRuntimeServiceAPI {
  constructor(options = {}) {
    this.service =
      options.service ||
      createAgentRuntimeService(options);
  }


  // ==========================================================
  // LIFECYCLE
  // ==========================================================

  async start() {
    return this.service.start();
  }


  async ensureStarted() {
    return this.service.ensureStarted();
  }


  async stop() {
    return this.service.stop();
  }


  async restart() {
    return this.service.restart();
  }


  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus() {
    return this.service.getStatus();
  }


  getInfo() {
    return this.service.getInfo();
  }


  // ==========================================================
  // HEALTH
  // ==========================================================

  async health() {
    return this.service.health();
  }


  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  async snapshot() {
    return this.service.snapshot();
  }


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  async diagnostics() {
    return this.service.diagnostics();
  }


  async diagnosticSummary() {
    return this.service.diagnosticSummary();
  }


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  async capabilities() {
    return this.service.capabilities();
  }


  // ==========================================================
  // EVENTS
  // ==========================================================

  async events(options = {}) {
    return this.service.events(options);
  }


  async clearEvents() {
    return this.service.clearEvents();
  }


  // ==========================================================
  // STATISTICS
  // ==========================================================

  resetStatistics() {
    return this.service.resetStatistics();
  }


  // ==========================================================
  // SERVICE ACCESS
  // ==========================================================

  getService() {
    return this.service;
  }
}


// ============================================================
// FACTORY
// ============================================================

function createAgentRuntimeServiceAPI(options = {}) {
  return new AgentRuntimeServiceAPI(options);
}


// ============================================================
// SINGLETON
// ============================================================

let singletonAPI = null;


function getAgentRuntimeServiceAPI(options = {}) {
  if (!singletonAPI) {
    singletonAPI =
      createAgentRuntimeServiceAPI({
        ...options,
        service:
          options.service ||
          getAgentRuntimeService(options),
      });
  }

  return singletonAPI;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceAPI() {
  singletonAPI = null;
}


// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

async function startAgentRuntime(options = {}) {
  return getAgentRuntimeServiceAPI(options).start();
}


async function ensureAgentRuntime(options = {}) {
  return getAgentRuntimeServiceAPI(options).ensureStarted();
}


async function stopAgentRuntime() {
  return getAgentRuntimeServiceAPI().stop();
}


async function restartAgentRuntime() {
  return getAgentRuntimeServiceAPI().restart();
}


function getAgentRuntimeStatus() {
  return getAgentRuntimeServiceAPI().getStatus();
}


async function getAgentRuntimeHealth() {
  return getAgentRuntimeServiceAPI().health();
}


async function getAgentRuntimeDiagnostics() {
  return getAgentRuntimeServiceAPI().diagnostics();
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeServiceAPI,

  createAgentRuntimeServiceAPI,
  getAgentRuntimeServiceAPI,

  resetAgentRuntimeServiceAPI,

  startAgentRuntime,
  ensureAgentRuntime,
  stopAgentRuntime,
  restartAgentRuntime,

  getAgentRuntimeStatus,
  getAgentRuntimeHealth,
  getAgentRuntimeDiagnostics,
};