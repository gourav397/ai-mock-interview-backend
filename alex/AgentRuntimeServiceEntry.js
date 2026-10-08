"use strict";

// ============================================================
// ALEX Agent Runtime Service Entry
// File: backend/alex/AgentRuntimeServiceEntry.js
//
// Purpose:
// Single entry point for starting, stopping, checking and
// accessing the Agent Runtime Service.
// ============================================================

const {
  bootstrapAgentRuntimeService,
  ensureAgentRuntimeService,
  getAgentRuntimeServiceBootstrapStatus,
  stopAgentRuntimeServiceBootstrap,
  restartAgentRuntimeServiceBootstrap,
} = require("./AgentRuntimeServiceBootstrap");

const {
  getAgentRuntimeService,
} = require("./AgentRuntimeService");

const {
  mountAgentRuntimeService,
  mountSingletonAgentRuntimeService,
  getAgentRuntimeServiceMountInfo,
} = require("./AgentRuntimeServiceMount");


// ============================================================
// START
// ============================================================

async function start(options = {}) {
  return bootstrapAgentRuntimeService(
    options
  );
}


// ============================================================
// ENSURE STARTED
// ============================================================

async function ensureStarted(options = {}) {
  return ensureAgentRuntimeService(
    options
  );
}


// ============================================================
// STOP
// ============================================================

async function stop() {
  return stopAgentRuntimeServiceBootstrap();
}


// ============================================================
// RESTART
// ============================================================

async function restart(options = {}) {
  return restartAgentRuntimeServiceBootstrap(
    options
  );
}


// ============================================================
// SERVICE
// ============================================================

function service(options = {}) {
  return getAgentRuntimeService(
    options
  );
}


// ============================================================
// STATUS
// ============================================================

function status() {
  return getAgentRuntimeServiceBootstrapStatus();
}


// ============================================================
// MOUNT
// ============================================================

function mount(app, options = {}) {
  return mountAgentRuntimeService(
    app,
    options
  );
}


// ============================================================
// SINGLETON MOUNT
// ============================================================

function mountSingleton(
  app,
  options = {}
) {
  return mountSingletonAgentRuntimeService(
    app,
    options
  );
}


// ============================================================
// MOUNT INFO
// ============================================================

function mountInfo(options = {}) {
  return getAgentRuntimeServiceMountInfo(
    options
  );
}


// ============================================================
// READY CHECK
// ============================================================

function isReady() {
  const current =
    getAgentRuntimeServiceBootstrapStatus();

  return Boolean(
    current &&
    current.bootstrapped === true
  );
}


// ============================================================
// API OBJECT
// ============================================================

const AgentRuntimeServiceEntry = {
  start,

  ensureStarted,

  stop,

  restart,

  service,

  status,

  mount,

  mountSingleton,

  mountInfo,

  isReady,
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ...AgentRuntimeServiceEntry,

  AgentRuntimeServiceEntry,
};