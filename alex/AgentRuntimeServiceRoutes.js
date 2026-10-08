"use strict";

// ============================================================
// ALEX Agent Runtime Service Routes
// File: backend/alex/AgentRuntimeServiceRoutes.js
//
// Purpose:
// Express routes for the high-level Agent Runtime Service.
//
// This file does NOT modify server.js.
// ============================================================

const express = require("express");

const {
  getAgentRuntimeServiceAPI,
} = require("./AgentRuntimeServiceAPI");


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeServiceRouter(options = {}) {
  const router = express.Router();

  const api =
    options.api ||
    getAgentRuntimeServiceAPI(options);


  // ==========================================================
  // ROOT
  // ==========================================================

  router.get("/", (req, res) => {
    res.json({
      success: true,
      service: "ALEX Agent Runtime Service",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  });


  // ==========================================================
  // STATUS
  // ==========================================================

  router.get("/status", (req, res) => {
    try {
      res.json(api.getStatus());
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // INFO
  // ==========================================================

  router.get("/info", (req, res) => {
    try {
      res.json(api.getInfo());
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // START
  // ==========================================================

  router.post("/start", async (req, res) => {
    try {
      const result = await api.start();

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // ENSURE STARTED
  // ==========================================================

  router.post("/ensure-started", async (req, res) => {
    try {
      const result =
        await api.ensureStarted();

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // STOP
  // ==========================================================

  router.post("/stop", async (req, res) => {
    try {
      const result = await api.stop();

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // RESTART
  // ==========================================================

  router.post("/restart", async (req, res) => {
    try {
      const result =
        await api.restart();

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // HEALTH
  // ==========================================================

  router.get("/health", async (req, res) => {
    try {
      const result =
        await api.health();

      const status =
        result?.healthy === false
          ? 503
          : 200;

      res.status(status).json(result);
    } catch (error) {
      res.status(503).json({
        success: false,
        healthy: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  router.get("/snapshot", async (req, res) => {
    try {
      const result =
        await api.snapshot();

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  router.get(
    "/diagnostics",
    async (req, res) => {
      try {
        const result =
          await api.diagnostics();

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // DIAGNOSTIC SUMMARY
  // ==========================================================

  router.get(
    "/diagnostics/summary",
    async (req, res) => {
      try {
        const result =
          await api.diagnosticSummary();

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  router.get(
    "/capabilities",
    async (req, res) => {
      try {
        const result =
          await api.capabilities();

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // EVENTS
  // ==========================================================

  router.get(
    "/events",
    async (req, res) => {
      try {
        const result =
          await api.events(req.query || {});

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // CLEAR EVENTS
  // ==========================================================

  router.delete(
    "/events",
    async (req, res) => {
      try {
        const result =
          await api.clearEvents();

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // RESET SERVICE STATISTICS
  // ==========================================================

  router.post(
    "/statistics/reset",
    (req, res) => {
      try {
        const result =
          api.resetStatistics();

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );


  // ==========================================================
  // ROUTER INFORMATION
  // ==========================================================

  router.get(
    "/router-info",
    (req, res) => {
      res.json({
        success: true,
        service: "ALEX Agent Runtime Service Routes",
        version: "1.0.0",

        endpoints: [
          "GET /",
          "GET /status",
          "GET /info",
          "POST /start",
          "POST /ensure-started",
          "POST /stop",
          "POST /restart",
          "GET /health",
          "GET /snapshot",
          "GET /diagnostics",
          "GET /diagnostics/summary",
          "GET /capabilities",
          "GET /events",
          "DELETE /events",
          "POST /statistics/reset",
          "GET /router-info",
        ],

        timestamp: new Date().toISOString(),
      });
    }
  );


  return router;
}


// ============================================================
// SINGLETON
// ============================================================

let singletonRouter = null;


function getAgentRuntimeServiceRouter(
  options = {}
) {
  if (!singletonRouter) {
    singletonRouter =
      createAgentRuntimeServiceRouter(options);
  }

  return singletonRouter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeServiceRouter() {
  singletonRouter = null;
}


// ============================================================
// MOUNT HELPER
// ============================================================

function mountAgentRuntimeServiceRoutes(
  app,
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError(
      "mountAgentRuntimeServiceRoutes requires an Express app"
    );
  }

  const prefix =
    typeof options.prefix === "string" &&
    options.prefix.trim()
      ? options.prefix.trim()
      : "/api/alex/service";

  const router =
    options.router ||
    createAgentRuntimeServiceRouter(options);

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
// EXPORTS
// ============================================================

module.exports = {
  createAgentRuntimeServiceRouter,
  getAgentRuntimeServiceRouter,
  resetAgentRuntimeServiceRouter,
  mountAgentRuntimeServiceRoutes,
};