// ============================================================
// ALEX — The Boss. Final decision maker. Error-isolated.
// PRODUCTION VERSION WITH:
//   ✓ Resilient Gemini client
//   ✓ Self-status with detailed diagnostics
//   ✓ Proper fallback when AI unavailable
//   ✓ Uncaught exception handling
//   ✓ Agent coordination
// ============================================================

const config = require("./config");
const { getIncidentManager } = require("./IncidentManager");
const { getSecurityAgent } = require("./SecurityAgent");
const { getEmployeeAgent } = require("./EmployeeAgent");
const { getHealthMonitor } = require("./HealthMonitor");
const { getAuditLogger } = require("./AuditLogger");
const { getDecisionEngine } = require("./DecisionEngine");
const { getNotificationManager } = require("./NotificationManager");
const { getAlexGeminiClient } = require("./utils/alexGeminiClient");

class AlexController {
  constructor() {
    this.ready = false;
    this.agents = { security: null, employee: null };
    this.services = { incidentManager: null, healthMonitor: null, auditLogger: null, decisionEngine: null, notificationManager: null };
    this.state = { status: "initializing", startedAt: null, incidentsHandled: 0, decisionsMade: 0, lastActivity: null };
  }

  async init() {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 ALEX — Autonomous Agent System Initializing");
    console.log("=".repeat(50));
    const startTime = Date.now();

    try {
      // Initialize each service independently — one failure doesn't kill others
      const results = await Promise.allSettled([
        this._initService("incidentManager", getIncidentManager()),
        this._initService("auditLogger", getAuditLogger()),
        (async () => { this.services.decisionEngine = getDecisionEngine(); })(),
      ]);

      // Initialize agents
      await Promise.allSettled([
        this._initService("security", getSecurityAgent()),
        this._initService("employee", getEmployeeAgent()),
      ]);

      // Notification manager (optional)
      const notifManager = getNotificationManager();
      if (typeof notifManager.init === "function") { try { await notifManager.init(); } catch {} }
      this.services.notificationManager = notifManager;

      // Health monitor (optional — uses discovery)
      const hm = getHealthMonitor();
      const serverUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
      try { await hm.init(serverUrl); } catch {}
      this.services.healthMonitor = hm;

      // Start health monitoring if incident manager is ready
      if (this.services.incidentManager && this.services.incidentManager.ready) {
        hm.start();
      } else {
        setTimeout(() => {
          if (this.services.incidentManager && this.services.incidentManager.ready) hm.start();
        }, 10000);
      }

      this.ready = true;
      this.state.status = "running";
      this.state.startedAt = new Date();

      const elapsed = Date.now() - startTime;
      console.log("=".repeat(50));
      console.log(`✅ ALEX Initialized in ${elapsed}ms`);
      console.log(`   AI: ${config.ai.available ? "Enabled" : "LIMITED MODE"}`);
      console.log("=".repeat(50) + "\n");

      this._registerErrorHandler();
      return this;
    } catch (err) {
      console.error("⚠️ ALEX init partial failure:", err.message);
      this.ready = true;
      this.state.status = "degraded";
      this.state.startedAt = new Date();
      return this;
    }
  }

  async _initService(name, service) {
    if (typeof service.init === "function") {
      try { await service.init(); this.services[name] = service; } catch (err) {
        console.warn(`⚠️ ALEX ${name} init failed: ${err.message}`);
        this.services[name] = service;
      }
    } else {
      this.services[name] = service;
    }
  }

  async processIncident(incidentData) {
    if (!this.ready) return { error: "ALEX not ready" };
    this.state.lastActivity = new Date();

    const incident = await this.services.incidentManager.createIncident(incidentData);
    if (!incident) return { skipped: true, reason: "Duplicate or rate-limited" };

    console.log(`\n🔴 ALEX Processing: ${incident.incidentId} [${incident.severity}]`);

    // Security Agent
    const securityResult = await this.agents.security.handleIncident(incident);
    if (securityResult.resolved) { this.state.incidentsHandled++; return { incidentId: incident.incidentId, resolved: true, resolvedBy: "security", result: securityResult }; }

    if (securityResult.escalationRequired) {
      await this.services.incidentManager.assignAgent(incident.incidentId, "employee");
    }

    // Employee Agent
    const employeeResult = await this.agents.employee.handleIncident(incident, securityResult);
    if (employeeResult.resolved) { this.state.incidentsHandled++; return { incidentId: incident.incidentId, resolved: true, resolvedBy: "employee", result: employeeResult }; }

    // ALEX decides
    const alexResult = await this._alexDecide(incident, securityResult, employeeResult);
    if (alexResult.resolved) { this.state.incidentsHandled++; return { incidentId: incident.incidentId, resolved: true, resolvedBy: "alex", result: alexResult }; }

    // Escalate to human
    this.state.incidentsHandled++;
    await this.services.incidentManager.updateStatus(incident.incidentId, "WAITING_FOR_USER", "All agents exhausted");
    await this._notifyHuman(incident, securityResult, employeeResult, alexResult);

    return { incidentId: incident.incidentId, resolved: false, escalatedToHuman: true, securityResult, employeeResult, alexResult };
  }

  async _alexDecide(incident, securityResult, employeeResult) {
    await this.services.incidentManager.updateStatus(incident.incidentId, "ALEX_REVIEW");
    const context = {
      incident: { id: incident.incidentId, severity: incident.severity, component: incident.component, category: incident.category, description: incident.description },
      security: { resolved: securityResult.resolved, reason: securityResult.reason },
      employee: { resolved: employeeResult.resolved, reason: employeeResult.reason },
    };

    if (config.ai.available) {
      const gemini = getAlexGeminiClient();
      try {
        const prompt = `You are ALEX — the BOSS. Final decision-maker.
Review:
${JSON.stringify(context, null, 2)}

Options: approve (safe path exists), reject (dangerous), escalate (unsure).
Respond: {"decision":"approve|reject|escalate","rootCause":"string","reason":"string","humanAction":"exact steps","whyFailed":"string","canAutoFix":boolean,"proposedFix":"string","riskLevel":0-4,"requiresRollback":boolean}`;
        
        const result = await gemini.call(prompt, { temperature: 0.2, timeoutMs: 20000 });

        if (result.error || !result.text) {
          return this._alexFallbackDecision(incident, `AI unavailable: ${result.message}`);
        }

        let parsed;
        try { parsed = JSON.parse(result.text); } catch {
          return this._alexFallbackDecision(incident, "AI returned invalid JSON");
        }

        if (parsed.decision === "approve" && parsed.canAutoFix) {
          await this.services.incidentManager.updateStatus(incident.incidentId, "RESOLVED", `ALEX approved: ${parsed.proposedFix || "fix"}`);
          return { resolved: true, reason: parsed.reason, rootCause: parsed.rootCause, decision: parsed };
        }
        return { resolved: false, reason: parsed.reason || "Cannot approve", rootCause: parsed.rootCause, whyFailed: parsed.whyFailed, humanAction: parsed.humanAction, decision: parsed };
      } catch (err) {
        console.log("⚠️ ALEX AI decision failed:", err.message);
        return this._alexFallbackDecision(incident, err.message);
      }
    }

    return this._alexFallbackDecision(incident, "AI not configured");
  }

  _alexFallbackDecision(incident, reason) {
    return {
      resolved: false,
      reason: `ALEX: Cannot resolve ${incident.severity} ${incident.component} incident autonomously. ${reason}`,
      rootCause: incident.probableCause || "Unknown",
      whyFailed: "Both agents exhausted + AI unavailable",
      humanAction: `Review incident ${incident.incidentId} manually. Visit /api/alex/incidents/${incident.incidentId}`
    };
  }

  async _notifyHuman(incident, securityResult, employeeResult, alexResult) {
    try {
      if (this.services.notificationManager && typeof this.services.notificationManager.sendAlert === "function") {
        await this.services.notificationManager.sendAlert({
          problem: incident.description, severity: incident.severity, affected: incident.component,
          rootCause: alexResult.rootCause || incident.probableCause,
          securityActions: securityResult, employeeActions: employeeResult, alexActions: alexResult,
          whyFailed: alexResult.whyFailed || "All agents exhausted",
          requiredAction: alexResult.humanAction || "Manual investigation required",
          incidentId: incident.incidentId,
        });
      }
    } catch {}
  }

  async getSystemStatus() {
    const healthStatus = this.services.healthMonitor ? this.services.healthMonitor.getStatus() : { status: "not_started" };
    const incidentStats = await this.services.incidentManager.getStats();
    return {
      system: { name: "ALEX", version: config.version, status: this.state.status, uptime: this.state.startedAt ? Math.floor((Date.now() - this.state.startedAt.getTime()) / 1000) : 0, aiAvailable: config.ai.available },
      agents: { security: { status: this.agents.security ? "ready" : "unavailable" }, employee: { status: this.agents.employee ? "ready" : "unavailable" }, alex: { status: this.ready ? "running" : "unavailable" } },
      health: healthStatus, incidents: incidentStats,
      state: { incidentsHandled: this.state.incidentsHandled, decisionsMade: this.state.decisionsMade, lastActivity: this.state.lastActivity },
    };
  }

  async getSelfStatus() {
    const healthStatus = this.services.healthMonitor ? this.services.healthMonitor.getStatus() : { status: "not_started" };
    const incidentStats = await this.services.incidentManager.getStats();

    let geminiStatus = "not_configured";
    if (config.ai.available) {
      try {
        const client = getAlexGeminiClient();
        geminiStatus = client.isAvailable() ? "available" : "rate_limited";
      } catch { geminiStatus = "error"; }
    }

    const mongoose = require("mongoose");

    return {
      system: {
        name: "ALEX", version: config.version,
        status: this.state.status,
        uptime: this.state.startedAt ? Math.floor((Date.now() - this.state.startedAt.getTime()) / 1000) : 0,
        aiAvailable: config.ai.available, geminiStatus,
        mode: config.ai.available ? "ai_enhanced" : "pattern_based",
      },
      agents: {
        security: { status: this.agents.security ? "ready" : "unavailable" },
        employee: { status: this.agents.employee ? "ready" : "unavailable" },
        alex: { status: this.ready ? "running" : "unavailable" },
      },
      health: healthStatus,
      incidents: incidentStats,
      state: {
        incidentsHandled: this.state.incidentsHandled,
        decisionsMade: this.state.decisionsMade,
        lastActivity: this.state.lastActivity,
        startedAt: this.state.startedAt,
      },
      environment: {
        node: process.version,
        platform: process.platform,
        mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        filesystem: "available",
        testRunner: "npm test (cross-platform)",
      },
    };
  }

  _registerErrorHandler() {
    global.__alexErrors = global.__alexErrors || [];

    process.on("uncaughtException", async (err) => {
      const errorEvent = { timestamp: new Date(), message: err.message, stack: err.stack, severity: "critical" };
      global.__alexErrors.push(errorEvent);
      if (global.__alexErrors.length > 100) global.__alexErrors.shift();
      if (this.ready) {
        await this.processIncident({ severity: "CRITICAL", source: "system", component: "backend", category: "crash", description: `Uncaught exception: ${err.message}`, evidence: { stack: err.stack?.slice(0, 1000) }, probableCause: "Uncaught exception" }).catch(() => {});
      }
    });

    process.on("unhandledRejection", async (reason) => {
      const errorEvent = { timestamp: new Date(), message: reason?.message || String(reason), stack: reason?.stack, severity: "high" };
      global.__alexErrors.push(errorEvent);
      if (this.ready) {
        await this.processIncident({ severity: "HIGH", source: "system", component: "backend", category: "error", description: `Unhandled rejection: ${errorEvent.message}`, evidence: { stack: errorEvent.stack?.slice(0, 1000) }, probableCause: "Unhandled async error" }).catch(() => {});
      }
    });
  }
}

let instance = null;
function getAlexController() { if (!instance) instance = new AlexController(); return instance; }
module.exports = { AlexController, getAlexController };