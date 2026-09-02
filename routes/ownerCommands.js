// ============================================================
// OWNER COMMAND API ROUTES — Mounted at /api/owner/*
// PREMIUM: All 24+ actions, security scan/fix, audit, incidents
// ============================================================

const express = require("express");
const { ownerAuth } = require("../middleware/ownerAuth");
const { getOwnerCommandHandler } = require("../alex/OwnerCommandHandler");
const { getIncidentManager } = require("../alex/IncidentManager");
const { getAuditLogger } = require("../alex/AuditLogger");
const { getAlexController } = require("../alex/AlexController");
const { CommandAllowlist } = require("../alex/CommandAllowlist");

async function createOwnerRouter() {
  const router = express.Router();

  // ALL ROUTES REQUIRE OWNER AUTHENTICATION
  router.use(ownerAuth);

  // ============================================
  // POST /api/owner/command — Natural language command
  // ============================================
  router.post("/command", async (req, res) => {
    try {
      const { command, confirmationId } = req.body;
      if (!command || typeof command !== "string" || command.trim().length === 0) {
        return res.status(400).json({ success: false, message: "Command is required and must be a non-empty string." });
      }
      if (command.length > 4000) {
        return res.status(400).json({ success: false, message: "Command too long (max 4000 characters)." });
      }

      const handler = getOwnerCommandHandler();
      const result = await handler.processCommand(command.trim(), req.owner, confirmationId || null);
      return res.json(result);
    } catch (err) {
      console.error("❌ Owner command error:", err.message);
      return res.status(500).json({ success: false, status: "error", message: "Command processing failed.", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
  });

  // ============================================
  // GET /api/owner/status
  // ============================================
  router.get("/status", async (req, res) => {
    try {
      const alex = getAlexController();
      const status = await alex.getSystemStatus();
      return res.json({ success: true, data: { ...status, owner: { authenticated: true, method: req.owner.method, role: req.owner.role } } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // GET /api/owner/self-status — Detailed ALEX diagnostics
  // ============================================
  router.get("/self-status", async (req, res) => {
    try {
      const alex = getAlexController();
      const status = await alex.getSelfStatus();
      return res.json({ success: true, data: status });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // GET /api/owner/history
  // ============================================
  router.get("/history", async (req, res) => {
    try {
      const handler = getOwnerCommandHandler();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const history = handler.getHistory(limit);
      return res.json({ success: true, data: history, count: history.length });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // GET /api/owner/actions
  // ============================================
  router.get("/actions", async (req, res) => {
    try {
      const actions = CommandAllowlist.getAllowedActions();
      const highRisk = actions.filter(a => a.requiresConfirmation);
      const standard = actions.filter(a => !a.requiresConfirmation);
      return res.json({ success: true, data: { totalActions: actions.length, standardActions: standard, highRiskActions: highRisk, security: { blockedCommands: CommandAllowlist.getBlockedCommands(), protectedPaths: CommandAllowlist.getProtectedPaths() } } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // GET /api/owner/incidents
  // ============================================
  router.get("/incidents", async (req, res) => {
    try {
      const im = getIncidentManager();
      const { status, severity, limit = 20 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (severity) filter.severity = severity;
      const incidents = await im.getAllIncidents(filter, parseInt(limit) || 20);
      const stats = await im.getStats();
      return res.json({ success: true, data: { incidents, stats }, count: incidents.length });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // GET /api/owner/audit
  // ============================================
  router.get("/audit", async (req, res) => {
    try {
      const auditLogger = getAuditLogger();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const events = await auditLogger.getRecent(limit);
      const sanitized = events.map(e => ({ timestamp: e.timestamp, agent: e.agent, action: e.action, target: e.target, result: e.result, description: (e.description || "").slice(0, 300) }));
      return res.json({ success: true, data: sanitized, count: sanitized.length });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // POST /api/owner/verify — Verify all registered actions
  // ============================================
  router.post("/verify", async (req, res) => {
    try {
      const handler = getOwnerCommandHandler();
      const result = await handler.verifyAllActions();
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // POST /api/owner/security/scan — Full vulnerability scan
  // ============================================
  router.post("/security/scan", async (req, res) => {
    try {
      const { getSecurityAgent } = require("../alex/SecurityAgent");
      const result = await getSecurityAgent().scanProject();
      return res.json({ success: true, message: `Security scan complete: ${result.totalVulnerabilities || 0} vulnerabilities`, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // POST /api/owner/security/fix — Auto-fix vulnerabilities
  // ============================================
  router.post("/security/fix", async (req, res) => {
    try {
      const { getSecurityAgent } = require("../alex/SecurityAgent");
      const { getVulnerabilityScanner } = require("../alex/utils/vulnerabilityScanner");
      const scanner = getVulnerabilityScanner();
      const scanResult = scanner.scanProject();
      const fixResult = await getSecurityAgent().autoFixVulnerabilities(scanResult);
      return res.json({ success: fixResult.fixResult.succeeded > 0, message: `Fixed ${fixResult.fixResult.succeeded}, failed ${fixResult.fixResult.failed}`, data: fixResult });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // POST /api/owner/security/audit — Full security audit
  // ============================================
  router.post("/security/audit", async (req, res) => {
    try {
      const { getIncidentManager } = require("../alex/IncidentManager");
      const { getVulnerabilityScanner } = require("../alex/utils/vulnerabilityScanner");
      const { getSecurityFixer } = require("../alex/utils/securityFixer");
      
      const scanner = getVulnerabilityScanner();
      const fixer = getSecurityFixer();
      const im = getIncidentManager();
      
      const scanResult = scanner.scanProject();
      for (const vuln of scanResult.vulnerabilities) {
        if (vuln.severity === "CRITICAL" || vuln.severity === "HIGH") {
          await im.createIncident({
            severity: vuln.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
            source: "security_agent", component: "security", category: "security_threat",
            description: `[${vuln.id}] ${vuln.name} in ${vuln.file}:${vuln.line}`,
            evidence: { vulnerability: vuln, match: vuln.match.slice(0, 500) },
            probableCause: `Security audit: ${vuln.description}`,
          });
        }
      }
      const fixResult = await fixer.applyFixes(scanResult);
      const rescanResult = scanner.scanProject();
      
      return res.json({
        success: true,
        message: `Security audit complete. Fixed ${fixResult.succeeded}/${fixResult.attempted} auto-fixable. ${rescanResult.totalVulnerabilities} vulnerabilities remain.`,
        data: {
          initialScan: { totalVulnerabilities: scanResult.totalVulnerabilities, critical: scanResult.criticalCount, high: scanResult.highCount, medium: scanResult.mediumCount, low: scanResult.lowCount },
          fixes: fixResult,
          rescan: { remainingVulnerabilities: rescanResult.totalVulnerabilities, critical: rescanResult.criticalCount, high: rescanResult.highCount, medium: rescanResult.mediumCount, low: rescanResult.lowCount },
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================
  // POST /api/owner/fix-loop — Auto-fix-retest workflow
  // ============================================
  router.post("/fix-loop", async (req, res) => {
    try {
      const { command } = req.body;
      if (!command || typeof command !== "string" || command.trim().length === 0) {
        return res.status(400).json({ success: false, message: "Command is required." });
      }
      if (command.length > 4000) return res.status(400).json({ success: false, message: "Command too long (max 4000 characters)." });

      const handler = getOwnerCommandHandler();
      const result = await handler.runErrorFixLoop(command.trim(), req.owner);
      return res.json({ success: result.success, ...result });
    } catch (err) {
      console.error("❌ Owner fix-loop error:", err.message);
      return res.status(500).json({ success: false, message: "Fix-loop processing failed." });
    }
  });

  return router;
}

module.exports = { createOwnerRouter };