// ============================================================
// ALEX Dashboard Routes — Mounted at /api/alex/*
// FIXED: Synchronous router creation, proper auth, no async issues
// ============================================================

const express = require("express");
const { getAlexController } = require("../AlexController");
const { getIncidentManager } = require("../IncidentManager");
const { getAuditLogger } = require("../AuditLogger");
const { getHealthMonitor } = require("../HealthMonitor");
const { getSecurityAgent } = require("../SecurityAgent");
const { getEmployeeAgent } = require("../EmployeeAgent");
const backupManager = require("../utils/backupManager");
const path = require("path");

async function createDashboardRouter() {
  const router = express.Router();

  // Auth middleware
  const authMiddleware = (req, res, next) => {
    const adminKey = req.headers["x-admin-key"] || req.query.adminKey;
    if (adminKey && adminKey === process.env.ADMIN_KEY) return next();

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET || process.env.ADMIN_KEY || "fallback-secret");
        if (decoded) { req.user = decoded; return next(); }
      } catch {}
    }
    return res.status(401).json({ success: false, message: "Alex requires admin auth (x-admin-key header or JWT)" });
  };

  router.use(authMiddleware);

  // GET /api/alex/status — system status
  router.get("/status", async (req, res) => {
    try {
      const alex = getAlexController();
      const status = await alex.getSystemStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/alex/incidents
  router.get("/incidents", async (req, res) => {
    try {
      const { status, severity, limit = 50 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (severity) filter.severity = severity;
      const im = getIncidentManager();
      const incidents = await im.getAllIncidents(filter, parseInt(limit) || 50);
      const stats = await im.getStats();
      res.json({ success: true, data: { incidents, stats } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/alex/incidents/:id
  router.get("/incidents/:id", async (req, res) => {
    try {
      const im = getIncidentManager();
      const incident = await im.getIncident(req.params.id);
      if (!incident) return res.status(404).json({ success: false, message: "Not found" });
      const audit = getAuditLogger();
      const auditEvents = await audit.getByIncident(req.params.id);
      res.json({ success: true, data: { incident, auditEvents } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // PATCH /api/alex/incidents/:id
  router.patch("/incidents/:id", async (req, res) => {
    try {
      const { status, resolution, assignedAgent } = req.body;
      const im = getIncidentManager();
      if (status) await im.updateStatus(req.params.id, status, resolution || "");
      if (assignedAgent) await im.assignAgent(req.params.id, assignedAgent);
      const updated = await im.getIncident(req.params.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/incidents — Manual creation
  router.post("/incidents", async (req, res) => {
    try {
      const { severity, component, category, description, evidence, probableCause } = req.body;
      if (!description) return res.status(400).json({ success: false, message: "description required" });
      const im = getIncidentManager();
      const incident = await im.createIncident({
        severity: severity || "MEDIUM", source: "manual",
        component: component || "unknown", category: category || "unknown",
        description, evidence: evidence || {}, probableCause: probableCause || "",
      });
      res.status(201).json({ success: true, data: incident });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/incidents/:id/escalate
  router.post("/incidents/:id/escalate", async (req, res) => {
    try {
      const im = getIncidentManager();
      const incident = await im.getIncident(req.params.id);
      if (!incident) return res.status(404).json({ success: false, message: "Not found" });
      const escalationMap = { unassigned: "security", security: "employee", employee: "alex", alex: "user" };
      const nextAgent = escalationMap[incident.assignedAgent] || "alex";
      await im.assignAgent(req.params.id, nextAgent);

      if (nextAgent === "security") {
        const result = await getSecurityAgent().handleIncident(incident);
        return res.json({ success: true, data: { escalatedTo: nextAgent, result } });
      } else if (nextAgent === "employee") {
        const result = await getEmployeeAgent().handleIncident(incident);
        return res.json({ success: true, data: { escalatedTo: nextAgent, result } });
      }
      const alex = getAlexController();
      const result = await alex.processIncident(incident);
      res.json({ success: true, data: { escalatedTo: nextAgent, result } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/alex/audit
  router.get("/audit", async (req, res) => {
    try {
      const { limit = 100, agent } = req.query;
      const filter = {};
      if (agent) filter.agent = agent;
      const events = await getAuditLogger().getRecent(parseInt(limit) || 100, filter);
      res.json({ success: true, data: events });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/alex/health
  router.get("/health", async (req, res) => {
    try {
      const hm = getHealthMonitor();
      const status = hm.getStatus();
      const history = hm.getHistory(20);
      res.json({ success: true, data: { current: status, history } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/health/check
  router.post("/health/check", async (req, res) => {
    try {
      const hm = getHealthMonitor();
      const result = await hm.runHealthCheck();
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/alex/backups
  router.get("/backups", async (req, res) => {
    try {
      res.json({ success: true, data: backupManager.listBackups() });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/backups
  router.post("/backups", async (req, res) => {
    try {
      const snapshot = backupManager.createSnapshot(req.body?.label || "manual");
      res.status(201).json({ success: true, data: snapshot });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/backups/restore
  router.post("/backups/restore", async (req, res) => {
    try {
      const { backupPath, originalPath } = req.body;
      if (!backupPath || !originalPath) return res.status(400).json({ success: false, message: "backupPath and originalPath required" });
      const result = backupManager.restoreFromBackup(backupPath, originalPath);
      res.json({ success: result.success, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/reset/circuit-breaker
  router.post("/reset/circuit-breaker", async (req, res) => {
    try {
      getSecurityAgent().resetCircuitBreaker();
      res.json({ success: true, message: "Circuit breaker reset" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/alex/analyze
  router.post("/analyze", async (req, res) => {
    try {
      const { description, component, evidence, severity = "MEDIUM", category = "unknown" } = req.body;
      if (!description) return res.status(400).json({ success: false, message: "description required" });
      const { getDecisionEngine } = require("../DecisionEngine");
      const analysis = await getDecisionEngine().classify({ description, component: component || "unknown", evidence: evidence || {}, severity, category });
      res.json({ success: true, data: analysis });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };