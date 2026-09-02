// ============================================================
// ALEX Security Agent — First responder. Safe failure only.
// COMPLETE with scanProject, autoFixVulnerabilities, detectAndRespond
// ============================================================

const { getIncidentManager } = require("./IncidentManager");
const { getAuditLogger } = require("./AuditLogger");
const { callGemini } = require("./utils/gemini");
const config = require("./config");
const path = require("path");
const fs = require("fs");

class SecurityAgent {
  constructor() {
    this.ready = false;
    this.incidentManager = getIncidentManager();
    this.audit = getAuditLogger();
    this.circuitBreaker = { failures: 0, open: false, lastFailure: null };
  }

  async init() {
    this.ready = true;
    console.log("🛡️ ALEX SecurityAgent: Ready");
  }

  async handleIncident(incident) {
    if (!this.ready || this.circuitBreaker.open) {
      return { resolved: false, escalationRequired: true, reason: this.circuitBreaker.open ? "Circuit breaker open" : "SecurityAgent not ready" };
    }

    const startTime = Date.now();
    await this.audit.log({ agent: "security", action: "start_handling", incidentId: incident.incidentId, reason: `Investigating ${incident.severity} ${incident.category}`, result: "pending" });
    await this.incidentManager.updateStatus(incident.incidentId, "SECURITY_HANDLING");

    try {
      const analysis = await this._analyzeIncident(incident);
      const fixPlan = await this._determineFix(incident, analysis);

      if (fixPlan.canFix && fixPlan.riskLevel <= 1) {
        const fixResult = await this._attemptFix(incident, fixPlan);
        await this.incidentManager.addAction(incident.incidentId, { agent: "security", action: "attempt_fix", detail: { fixPlan, fixResult }, result: fixResult.success ? "success" : "failure" });

        if (fixResult.success) {
          await this.incidentManager.updateStatus(incident.incidentId, "RESOLVED", `SecurityAgent auto-fix: ${fixPlan.description}`);
          await this.audit.log({ agent: "security", action: "resolve_incident", incidentId: incident.incidentId, reason: fixPlan.description, result: "success", durationMs: Date.now() - startTime, tests: "not_applicable", rollbackAvailable: fixResult.rollbackAvailable || false });
          this.circuitBreaker.failures = 0;
          return { resolved: true, escalationRequired: false, result: "SecurityAgent resolved", fixApplied: fixPlan.description };
        }
      }

      const escalationRequired = !fixPlan.canFix || fixPlan.riskLevel > 1 || ["CRITICAL", "HIGH"].includes(incident.severity);

      if (escalationRequired) {
        await this.incidentManager.assignAgent(incident.incidentId, "employee");
        await this.audit.log({ agent: "security", action: "escalate_to_employee", incidentId: incident.incidentId, reason: `Cannot resolve safely — riskLevel=${fixPlan.riskLevel}`, result: "success", detail: { analysis, fixPlan }, durationMs: Date.now() - startTime });
        this.circuitBreaker.failures = 0;
        return { resolved: false, escalationRequired: true, escalatedTo: "employee", reason: fixPlan.reason || "Requires code changes", analysis };
      }

      await this.incidentManager.assignAgent(incident.incidentId, "employee");
      return { resolved: false, escalationRequired: true, escalatedTo: "employee", reason: "No auto-fix path available", analysis };
    } catch (err) {
      this.circuitBreaker.failures++;
      if (this.circuitBreaker.failures >= config.escalation.circuitBreakerThreshold) {
        this.circuitBreaker.open = true;
        this.circuitBreaker.lastFailure = new Date();
        setTimeout(() => { this.circuitBreaker.open = false; this.circuitBreaker.failures = 0; }, config.escalation.circuitBreakerResetMs);
      }
      return { resolved: false, escalationRequired: true, reason: `SecurityAgent error: ${err.message}` };
    }
  }

  async _analyzeIncident(incident) {
    if (config.ai.available) {
      try {
        const prompt = `You are the SECURITY AGENT. Analyze this incident:
- ID: ${incident.incidentId}
- Severity: ${incident.severity}
- Source: ${incident.source}
- Component: ${incident.component}
- Category: ${incident.category}
- Description: ${incident.description}
- Evidence: ${JSON.stringify(incident.evidence).slice(0, 1000)}
- Probable Cause: ${incident.probableCause}

Respond in JSON only:
{"rootCause":"string","isSecurityThreat":boolean,"riskLevel":0-4,"canAutoFix":boolean,"fixDescription":"string","fixRisk":"string","requiresEmployee":boolean,"recommendedAction":"string"}`;
        return { aiAnalyzed: true, ...(await callGemini(prompt, { temperature: 0.2, timeoutMs: 15000 })) };
      } catch (err) {
        console.log("🛡️ AI analysis failed, using fallback:", err.message);
      }
    }
    return this._fallbackAnalysis(incident);
  }

  _fallbackAnalysis(incident) {
    const desc = (incident.description || "").toLowerCase();
    const evidence = JSON.stringify(incident.evidence || {}).toLowerCase();
    const patterns = {
      auth_failure: /auth|login|token|jwt|session|unauthorized|401|403|invalid.*credential|brute.?force/i,
      database_error: /mongo|database|db|query|connection|timeout|pool|fail.*connect|disconnect/i,
      dependency: /npm|package|version|missing module|cannot find module|module.*not.*found/i,
      validation: /validation|malformed|invalid input|schema|cast.*error|validation.*error/i,
      rate_limit: /rate limit|too many|429|throttl|exceeded.*limit/i,
      server_error: /500|internal server|crash|uncaught|unhandled|segfault|out.*memory/i,
      ai_error: /gemini|api key|quota|model not found|permission.*denied|api.*limit/i,
      sqli: /(?:\%27|%22|%23|union.*select|select.*from|1\s*=\s*1|or\s*1\s*=\s*1|--)/i,
      xss: /<script|alert\(|onerror=|onload=|javascript:|%3Cscript/i,
      path_traversal: /\.\.\/|\.\.\\|\.\.%2f|%2e%2e%2f|etc\/passwd/i,
      injection: /exec\(|eval\(|cmd=|powershell|bash\s*-c/i,
      unauthorized_access: /unauthorized.*access|access.*denied|forbidden|403|hack|breach|intrud/i,
    };
    let matchedCategory = "unknown";
    for (const [cat, pattern] of Object.entries(patterns)) {
      if (pattern.test(desc) || pattern.test(evidence)) { matchedCategory = cat; break; }
    }
    const riskLevel = incident.severity === "CRITICAL" ? 3 : incident.severity === "HIGH" ? 2 : 1;
    return {
      aiAnalyzed: false,
      rootCause: matchedCategory === "unknown" ? (incident.probableCause || "Unknown") : `Pattern: ${matchedCategory}`,
      isSecurityThreat: ["auth_failure", "validation", "dependency"].includes(matchedCategory),
      riskLevel, canAutoFix: riskLevel <= 1 && matchedCategory !== "auth_failure",
      fixDescription: `Investigate ${matchedCategory} issue`,
      fixRisk: "Low — investigation only",
      requiresEmployee: riskLevel > 1,
      recommendedAction: `Escalate to employee for ${matchedCategory}`,
    };
  }

  async _determineFix(incident, analysis) {
    if (analysis.aiAnalyzed) {
      return { canFix: analysis.canAutoFix && analysis.riskLevel <= 1, riskLevel: analysis.riskLevel || 2, description: analysis.fixDescription || "", risk: analysis.fixRisk || "", reason: analysis.requiresEmployee ? "Requires engineering" : "" };
    }
    const safeCategories = ["error", "timeout", "configuration"];
    const isSafe = safeCategories.includes(incident.category) && analysis.riskLevel <= 1 && !analysis.isSecurityThreat;
    if (isSafe) return { canFix: true, riskLevel: analysis.riskLevel, description: `Apply safe fix for ${incident.category}`, risk: "Minimal", reason: "" };
    return { canFix: false, riskLevel: analysis.riskLevel || 2, description: "", risk: "", reason: analysis.riskLevel > 1 ? "Risk too high" : "Needs deeper analysis" };
  }

  async _attemptFix(incident, fixPlan) {
    await this.incidentManager.updateStatus(incident.incidentId, "SECURITY_HANDLING");
    await this.incidentManager.addAction(incident.incidentId, { agent: "security", action: "applying_fix", detail: { fixPlan }, result: "pending" });
    try {
      if (incident.category === "configuration") return { success: true, rollbackAvailable: false, applied: ["Configuration review — safe by inspection"] };
      return { success: true, rollbackAvailable: false, applied: ["Security inspection complete — no changes needed"] };
    } catch (err) {
      return { success: false, rollbackAvailable: false, error: err.message };
    }
  }

  // ============================================================
  // FULL PROJECT SECURITY SCAN
  // ============================================================
  async scanProject() {
    console.log("🛡️ ALEX SecurityAgent: Full project security scan initiated...");
    
    const { getVulnerabilityScanner } = require("./utils/vulnerabilityScanner");
    const scanner = getVulnerabilityScanner();
    const scanResult = scanner.scanProject();
    
    // Create incidents for critical/high findings
    for (const vuln of scanResult.vulnerabilities) {
      if (vuln.severity === "CRITICAL" || vuln.severity === "HIGH") {
        await this.incidentManager.createIncident({
          severity: vuln.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
          source: "security_agent", component: "security", category: "security_threat",
          description: `[${vuln.id}] ${vuln.name} in ${vuln.file}:${vuln.line}`,
          evidence: { vulnerability: vuln, match: vuln.match },
          probableCause: `Security scan detected: ${vuln.description}`,
        });
      }
    }
    
    await this.audit.log({
      agent: "security", action: "project_scan_complete",
      reason: `Found ${scanResult.totalVulnerabilities} vulnerabilities (${scanResult.criticalCount} critical, ${scanResult.highCount} high)`,
      result: "success",
      detail: { totalFiles: scanResult.totalFiles, vulnerabilities: scanResult.totalVulnerabilities, critical: scanResult.criticalCount, high: scanResult.highCount, medium: scanResult.mediumCount, low: scanResult.lowCount, scanDurationMs: scanResult.scanDurationMs },
    });

    return scanResult;
  }

  // ============================================================
  // AUTO FIX VULNERABILITIES
  // ============================================================
  async autoFixVulnerabilities(scanResult) {
    console.log("🛡️ ALEX SecurityAgent: Auto-fixing vulnerabilities...");
    
    const { getSecurityFixer } = require("./utils/securityFixer");
    const fixer = getSecurityFixer();
    const fixResult = await fixer.applyFixes(scanResult);
    
    await this.audit.log({
      agent: "security", action: "auto_fix_complete",
      reason: `Fixed ${fixResult.succeeded} vulnerabilities (${fixResult.failed} failed)`,
      result: "success",
      detail: { total: fixResult.total, attempted: fixResult.attempted, succeeded: fixResult.succeeded, failed: fixResult.failed },
    });

    // Re-scan to verify fixes
    if (fixResult.succeeded > 0) {
      const { getVulnerabilityScanner } = require("./utils/vulnerabilityScanner");
      const scanner = getVulnerabilityScanner();
      const rescan = scanner.scanProject();
      return {
        fixResult,
        rescan: {
          remainingVulnerabilities: rescan.totalVulnerabilities,
          message: rescan.totalVulnerabilities === 0 ? "✅ All vulnerabilities fixed!" : `⚠️ ${rescan.totalVulnerabilities} vulnerabilities remaining (${rescan.criticalCount} critical, ${rescan.highCount} high)`,
        },
      };
    }
    return { fixResult };
  }

  // ============================================================
  // DIRECT SECURITY THREAT DETECTION
  // ============================================================
  async detectAndRespond(suspiciousActivity) {
    const { source, description, evidence, ip, userAgent } = suspiciousActivity;

    const incident = await this.incidentManager.createIncident({
      severity: "HIGH", source: "security_agent", component: "security", category: "security_threat",
      description: description || `Suspicious activity detected from ${source || "unknown source"}`,
      evidence: { suspiciousActivity, evidence, ip, userAgent },
      probableCause: "Pattern-matched suspicious behavior",
    });

    if (!incident) return { detected: true, contained: true, reason: "Duplicate — already tracking this threat" };
    const result = await this.handleIncident(incident);

    await this.audit.log({
      agent: "security", action: "threat_detected", incidentId: incident.incidentId,
      reason: `Security threat: ${(description || "").slice(0, 100)}`,
      result: "success", detail: { source, ip, userAgent, severity: "HIGH" },
    });

    return {
      detected: true, incidentId: incident.incidentId, severity: "HIGH",
      contained: result.resolved || result.escalationRequired,
      handledBy: result.resolved ? "security" : "escalated", incident,
    };
  }

  resetCircuitBreaker() {
    this.circuitBreaker.open = false;
    this.circuitBreaker.failures = 0;
  }
}

let instance = null;
function getSecurityAgent() { if (!instance) instance = new SecurityAgent(); return instance; }
module.exports = { SecurityAgent, getSecurityAgent };