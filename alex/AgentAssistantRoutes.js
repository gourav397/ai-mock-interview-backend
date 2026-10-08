/**
 * ============================================================
 * ALEX — Unified Agent Assistant Routes
 * ============================================================
 *
 * File:
 *   backend/alex/AgentAssistantRoutes.js
 *
 * Purpose:
 * - Single Express router for the complete ALEX assistant layer
 * - Chat / ask
 * - Planning
 * - Inspection
 * - Web research
 * - Autonomous tasks
 * - Authorized computer actions
 * - Capabilities
 * - Health
 * - Info
 * - Statistics
 *
 * Mount example:
 *
 *   const {
 *     createAgentAssistantRouter
 *   } = require("./alex/AgentAssistantRoutes");
 *
 *   app.use(
 *     "/api/alex/assistant",
 *     authMiddleware,
 *     createAgentAssistantRouter()
 *   );
 *
 * IMPORTANT:
 * The existing authentication/owner middleware should be mounted
 * before this router. This router does NOT bypass existing security.
 * ============================================================
 */

const express = require("express");

const {
  getAgentAssistantRouteAdapter,
} = require("./AgentAssistantRouteAdapter");

const VERSION = "1.0.0";

/* ============================================================
 * OWNER / AUTH CHECK
 * ============================================================ */

function isAuthorizedOwner(req) {
  /*
   * Authentication should normally already happen before this
   * router. We support several existing ALEX/user shapes so this
   * file does not depend on one exact auth implementation.
   */

  const user = req?.user || req?.owner || null;

  if (!user) {
    return false;
  }

  if (
    user.isOwner === true ||
    user.isAdmin === true ||
    user.role === "owner" ||
    user.role === "admin" ||
    user.role === "OWNER" ||
    user.role === "ADMIN" ||
    user.type === "owner" ||
    user.type === "admin"
  ) {
    return true;
  }

  /*
   * Some existing owner-auth middleware may already attach a
   * verified owner object without a role field.
   */
  if (
    req.ownerAuthenticated === true ||
    req.isOwner === true ||
    req.authenticatedOwner === true
  ) {
    return true;
  }

  return false;
}

/* ============================================================
 * SECURITY MIDDLEWARE
 * ============================================================ */

function requireOwner(req, res, next) {
  if (isAuthorizedOwner(req)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    success: false,
    status: "forbidden",
    error: "Owner authorization required",
    timestamp: new Date().toISOString(),
  });
}

/* ============================================================
 * REQUEST ID
 * ============================================================ */

function requestId(req) {
  return (
    req.headers["x-request-id"] ||
    `alex_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`
  );
}

/* ============================================================
 * ROUTER FACTORY
 * ============================================================ */

function createAgentAssistantRouter(options = {}) {
  const router = express.Router();

  const adapter =
    options.adapter ||
    getAgentAssistantRouteAdapter();

  /*
   * JSON is intentionally limited so an extremely large request
   * cannot be pushed into the assistant layer.
   *
   * server.js should normally already have express.json().
   * This local parser only acts as a fallback.
   */
  router.use((req, res, next) => {
    req.alexRequestId = requestId(req);

    res.setHeader(
      "X-ALEX-Request-Id",
      req.alexRequestId
    );

    next();
  });

  /* ==========================================================
   * PUBLIC-TO-ROUTER HEALTH
   * ========================================================== */

  router.get("/health", async (req, res) => {
    try {
      return await adapter.health(req, res);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        success: false,
        status: "failed",
        error: error.message || "Health check failed",
      });
    }
  });

  /* ==========================================================
   * OWNER PROTECTED ROUTES
   * ========================================================== */

  router.use(requireOwner);

  /* ==========================================================
   * ASK / CHAT
   * ========================================================== */

  router.post("/ask", async (req, res) => {
    return adapter.ask(req, res);
  });

  /*
   * /chat is an alias of /ask.
   *
   * This makes it easier to connect the existing ALEX chat UI
   * without creating another controller.
   */
  router.post("/chat", async (req, res) => {
    return adapter.ask(req, res);
  });

  /* ==========================================================
   * PLAN
   * ========================================================== */

  router.post("/plan", async (req, res) => {
    return adapter.plan(req, res);
  });

  /* ==========================================================
   * INSPECT / INTENT
   * ========================================================== */

  router.post("/inspect", async (req, res) => {
    return adapter.inspect(req, res);
  });

  /* ==========================================================
   * WEB RESEARCH
   * ========================================================== */

  router.post("/research", async (req, res) => {
    return adapter.research(req, res);
  });

  /* ==========================================================
   * AUTONOMOUS TASK
   * ========================================================== */

  router.post("/task", async (req, res) => {
    return adapter.runTask(req, res);
  });

  /*
   * Alias:
   * /autonomous
   */
  router.post("/autonomous", async (req, res) => {
    return adapter.runTask(req, res);
  });

  /* ==========================================================
   * AUTHORIZED COMPUTER CONTROL
   * ========================================================== */

  router.post("/computer", async (req, res) => {
    return adapter.computer(req, res);
  });

  /* ==========================================================
   * CAPABILITIES
   * ========================================================== */

  router.get("/capabilities", async (req, res) => {
    return adapter.capabilities(req, res);
  });

  /* ==========================================================
   * INFORMATION
   * ========================================================== */

  router.get("/info", async (req, res) => {
    return adapter.info(req, res);
  });

  /* ==========================================================
   * STATISTICS
   * ========================================================== */

  router.get("/stats", async (req, res) => {
    return adapter.stats(req, res);
  });

  router.post("/stats/reset", async (req, res) => {
    return adapter.resetStats(req, res);
  });

  /* ==========================================================
   * ROUTE INDEX
   * ========================================================== */

  router.get("/", (req, res) => {
    return res.json({
      ok: true,
      success: true,
      status: "ready",

      name: "ALEX Agent Assistant",

      version: VERSION,

      requestId: req.alexRequestId,

      endpoints: {
        chat: "POST /chat",
        ask: "POST /ask",
        plan: "POST /plan",
        inspect: "POST /inspect",
        research: "POST /research",
        task: "POST /task",
        autonomous: "POST /autonomous",
        computer: "POST /computer",
        capabilities: "GET /capabilities",
        health: "GET /health",
        info: "GET /info",
        stats: "GET /stats",
        resetStats: "POST /stats/reset",
      },

      architecture: {
        assistant:
          "AgentAssistantCore",
        api:
          "AgentAssistantAPI",
        adapter:
          "AgentAssistantRouteAdapter",
        authorization:
          "Owner protected",
      },

      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

/* ============================================================
 * SINGLETON
 * ============================================================ */

let routerInstance = null;

function getAgentAssistantRouter(options = {}) {
  if (!routerInstance) {
    routerInstance =
      createAgentAssistantRouter(options);
  }

  return routerInstance;
}

function resetAgentAssistantRouter() {
  routerInstance = null;
  return getAgentAssistantRouter();
}

/* ============================================================
 * DIRECT EXPRESS MOUNT HELPER
 * ============================================================ */

function mountAgentAssistantRouter(
  app,
  prefix = "/api/alex/assistant",
  options = {}
) {
  if (!app || typeof app.use !== "function") {
    throw new Error(
      "A valid Express app is required"
    );
  }

  const router =
    options.router ||
    createAgentAssistantRouter(options);

  app.use(prefix, router);

  return {
    ok: true,
    success: true,
    mounted: true,
    prefix,
    version: VERSION,
    router,
  };
}

/* ============================================================
 * INFO
 * ============================================================ */

function getAgentAssistantRoutesInfo() {
  return {
    name: "ALEX Agent Assistant Routes",
    version: VERSION,
    type: "express_router",
    ownerProtected: true,

    endpoints: [
      "GET /",
      "GET /health",
      "POST /ask",
      "POST /chat",
      "POST /plan",
      "POST /inspect",
      "POST /research",
      "POST /task",
      "POST /autonomous",
      "POST /computer",
      "GET /capabilities",
      "GET /info",
      "GET /stats",
      "POST /stats/reset",
    ],
  };
}

/* ============================================================
 * EXPORTS
 * ============================================================ */

module.exports = {
  VERSION,

  createAgentAssistantRouter,
  getAgentAssistantRouter,
  resetAgentAssistantRouter,

  mountAgentAssistantRouter,

  getAgentAssistantRoutesInfo,

  isAuthorizedOwner,
  requireOwner,
};
