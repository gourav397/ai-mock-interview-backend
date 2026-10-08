"use strict";

// ============================================================
// ALEX Agent Runtime Service Controller Factory
// File: backend/alex/AgentRuntimeServiceControllerFactory.js
//
// Purpose:
// Central factory and singleton manager for the Agent Runtime
// Service Controller.
// ============================================================

const {
  AgentRuntimeServiceController,
} = require("./AgentRuntimeServiceController");


// ============================================================
// SINGLETON
// ============================================================

let singletonController = null;


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
// CREATE CONTROLLER
// ============================================================

function createAgentRuntimeServiceController(
  options = {}
) {
  const config =
    normalizeOptions(options);

  if (
    config.controller &&
    typeof config.controller === "object"
  ) {
    return config.controller;
  }

  return new AgentRuntimeServiceController(
    config
  );
}


// ============================================================
// GET SINGLETON
// ============================================================

function getAgentRuntimeServiceController(
  options = {}
) {
  if (!singletonController) {
    singletonController =
      createAgentRuntimeServiceController(
        options
      );
  }

  return singletonController;
}


// ============================================================
// RESET SINGLETON
// ============================================================

function resetAgentRuntimeServiceController() {
  singletonController = null;
}


// ============================================================
// CHECK CONTROLLER
// ============================================================

function isAgentRuntimeServiceController(
  value
) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.start === "function" &&
    typeof value.stop === "function" &&
    typeof value.status === "function"
  );
}


// ============================================================
// CONTROLLER INFO
// ============================================================

function getAgentRuntimeServiceControllerInfo(
  options = {}
) {
  const controller =
    options.controller ||
    getAgentRuntimeServiceController(
      options
    );

  return {
    success: true,

    controller:
      "AgentRuntimeServiceController",

    valid:
      isAgentRuntimeServiceController(
        controller
      ),

    methods: [
      "start",
      "ensureStarted",
      "stop",
      "restart",
      "status",
      "info",
      "health",
      "snapshot",
      "diagnostics",
      "diagnosticSummary",
      "capabilities",
      "events",
      "clearEvents",
      "resetStatistics",
    ],

    timestamp:
      new Date().toISOString(),
  };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createAgentRuntimeServiceController,

  getAgentRuntimeServiceController,

  resetAgentRuntimeServiceController,

  isAgentRuntimeServiceController,

  getAgentRuntimeServiceControllerInfo,
};