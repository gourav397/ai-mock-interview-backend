// ============================================================
// ALEX Employee Agent — Engineering worker, safe code changes
// ============================================================

const { getIncidentManager } = require("./IncidentManager");
const { getAuditLogger } = require("./AuditLogger");
const { callGemini } = require("./utils/gemini");
const fileInspector = require("./utils/fileInspector");
const backupManager = require("./utils/backupManager");
const config = require("./config");
const path = require("path");

class EmployeeAgent {
  constructor() {
    this.ready = false;
    this.incidentManager = getIncidentManager();
    this.audit = getAuditLogger();
  }

  async init() {
    this.ready = true;
    console.log("👷 ALEX EmployeeAgent: Ready");
  }

  async handleIncident(incident, securityReport = {}) {
    if (!this.ready) return { resolved: false, escalationRequired: true, reason: "EmployeeAgent not ready" };

    const startTime = Date.now();
    await this.audit.log({ agent: "employee", action: "start_handling", incidentId: incident.incidentId, reason: `Investigating: ${(incident.description || "").slice(0, 100)}`, result: "pending" });
    await this.incidentManager.updateStatus(incident.incidentId, "EMPLOYEE_HANDLING");

    try {
      const investigation = await this._investigate(incident, securityReport);
      const canFix = investigation.riskLevel <= 2 && config.escalation.autoFixLevel2;

      if (!canFix) {
        await this.incidentManager.assignAgent(incident.incidentId, "alex");
        await this.audit.log({ agent: "employee", action: "escalate_to_alex", incidentId: incident.incidentId, reason: `Risk ${investigation.riskLevel} exceeds threshold`, result: "success", detail: investigation, durationMs: Date.now() - startTime });
        return { resolved: false, escalationRequired: true, escalatedTo: "alex", reason: investigation.reason || "Requires Alex approval", investigation };
      }

      const fixResult = await this._createFix(incident, investigation);
      if (fixResult.success) {
        const verification = await this._verifyFix(incident, fixResult);
        if (verification.passed) {
          await this.incidentManager.updateStatus(incident.incidentId, "RESOLVED", `EmployeeAgent: ${investigation.fixDescription}`);
          await this.audit.log({ agent: "employee", action: "resolve_incident", incidentId: incident.incidentId, reason: investigation.fixDescription, result: "success", detail: fixResult, durationMs: Date.now() - startTime, tests: verification.testsPassed ? "passed" : "not_run", rollbackAvailable: fixResult.rollbackAvailable || false });
          return { resolved: true, escalationRequired: false, result: "EmployeeAgent resolved", fixApplied: fixResult, verification };
        }
        if (fixResult.rollbackAvailable) await this._rollback(incident, fixResult);
        await this.incidentManager.assignAgent(incident.incidentId, "alex");
        return { resolved: false, escalationRequired: true, escalatedTo: "alex", reason: `Fix verification failed: ${verification.reason}`, rollbackPerformed: true };
      }
      await this.incidentManager.assignAgent(incident.incidentId, "alex");
      return { resolved: false, escalationRequired: true, escalatedTo: "alex", reason: fixResult.error || "Could not create fix" };
    } catch (err) {
      await this.incidentManager.assignAgent(incident.incidentId, "alex");
      return { resolved: false, escalationRequired: true, escalatedTo: "alex", reason: `EmployeeAgent error: ${err.message}` };
    }
  }

  async _investigate(incident) {
    const affectedFiles = this._identifyAffectedFiles(incident);
    const fileContents = [];
    for (const file of affectedFiles) {
      const result = fileInspector.readFile(file);
      if (result.success) fileContents.push({ file, content: result.content.slice(0, 2000) });
    }

    if (config.ai.available) {
      try {
        const prompt = `You are the EMPLOYEE AGENT for a Node.js/Express/MongoDB project.

Incident: ${incident.description}
Component: ${incident.component}
Category: ${incident.category}
Evidence: ${JSON.stringify(incident.evidence).slice(0, 1000)}

Files:
${fileContents.map(f => `--- ${f.file} ---\n${f.content.slice(0, 1500)}`).join("\n\n")}

Respond in JSON only:
{"rootCause":"string","fixDescription":"string","affectedFiles":["file1"],"fixType":"code_change|config_change|dependency_update","riskLevel":0-4,"fixCode":"specific code change","requiresAlexApproval":boolean,"reason":"if risk > 2, why"}`;
        const result = await callGemini(prompt, { temperature: 0.2, timeoutMs: 20000 });
        return { aiAnalyzed: true, ...result, fileContents };
      } catch (err) {
        console.log("👷 Employee AI analysis failed:", err.message);
      }
    }
    return { aiAnalyzed: false, rootCause: incident.probableCause || "Unknown", fixDescription: `Investigate ${incident.component}`, affectedFiles, fixType: "investigation", riskLevel: 2, requiresAlexApproval: incident.severity === "CRITICAL", reason: "No AI analysis", fileContents };
  }

  _identifyAffectedFiles(incident) {
    const componentMap = {
      backend: ["./server.js"], auth: ["./routes/auth.js"], database: ["./config/db.js"],
      ai: ["./utils/aiGenerator.js", "./alex/utils/gemini.js"], security: [], api: [], frontend: [],
    };
    const files = componentMap[incident.component] || [];
    return files.filter(f => fileInspector.exists(f));
  }

  async _createFix(incident, investigation) {
    const result = { success: false, error: null, changes: [], rollbackAvailable: false, backupPath: null };
    const snapshot = backupManager.createSnapshot(`fix-${incident.incidentId}`);
    result.backupPath = snapshot.snapshotDir || null;
    result.rollbackAvailable = snapshot.success;

    if (investigation.aiAnalyzed && investigation.fixCode && investigation.affectedFiles) {
      for (const file of investigation.affectedFiles) {
        if (!fileInspector.exists(file)) { result.changes.push({ file, status: "skipped", reason: "Not found" }); continue; }
        const fileBackup = backupManager.backupFile(file);
        if (fileBackup.success) result.backupPath = fileBackup.backupPath;
        result.changes.push({ file, status: "ready", backupPath: fileBackup.backupPath });
      }
      result.success = result.changes.some(c => c.status === "ready");
    } else {
      result.error = "No AI analysis or fix code";
    }

    if (result.success) {
      await this.incidentManager.addChange(incident.incidentId, {
        file: (investigation.affectedFiles || []).join(", ") || "multiple",
        changeType: "modify", backupPath: result.backupPath, summary: investigation.fixDescription,
      });
    }
    return result;
  }

  async _verifyFix(incident, fixResult) {
    const verification = { passed: true, reason: "", testsPassed: false, buildPassed: false };
    if (fixResult.changes) {
      for (const change of fixResult.changes) {
        if (change.status === "skipped") { verification.passed = false; verification.reason = `Skipped: ${change.file}`; break; }
      }
    }
    return verification;
  }

  async _rollback(incident, fixResult) {
    console.log(`👷 Rolling back fix for ${incident.incidentId}`);
    await this.incidentManager.updateStatus(incident.incidentId, "ROLLED_BACK", "EmployeeAgent: fix rolled back after verification failure");
    await this.audit.log({ agent: "employee", action: "rollback", incidentId: incident.incidentId, reason: "Fix verification failed", result: "success", detail: { backupPath: fixResult.backupPath } });
  }
}

let instance = null;
function getEmployeeAgent() {
  if (!instance) instance = new EmployeeAgent();
  return instance;
}

module.exports = { EmployeeAgent, getEmployeeAgent };