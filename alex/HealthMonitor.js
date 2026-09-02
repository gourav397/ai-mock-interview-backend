// ============================================================
// ALEX Health Monitor — FIXED: no false positives, no spam
// ============================================================

const mongoose = require("mongoose");
const config = require("./config");
const { getAuditLogger } = require("./AuditLogger");
const { getIncidentManager } = require("./IncidentManager");

class HealthMonitor {
  constructor() {
    this.ready = false;
    this.monitoring = false;
    this.intervals = []; // Track all intervals for cleanup
    this.audit = getAuditLogger();
    this.incidentManager = getIncidentManager();
    this.lastHealth = { status: "unknown", timestamp: null, checks: {} };
    this.consecutiveFailures = 0;
    this.healthHistory = [];
    this.serverUrl = "";
    this.healthyThreshold = 3; // Number of consecutive successes to reset
    this.consecutiveSuccesses = 0;
  }

  async init(serverUrl = "http://localhost:5000") {
    this.serverUrl = serverUrl;
    this.ready = true;
    console.log("💚 ALEX HealthMonitor: Ready (server:", serverUrl + ")");
  }

  start() {
    if (this.monitoring) return;
    this.monitoring = true;

    console.log(`💚 ALEX HealthMonitor: Started (interval: ${config.monitoring.healthCheckIntervalMs}ms)`);

    // Run first check in 5 seconds (give server time to stabilize)
    const startupTimer = setTimeout(() => this.runHealthCheck(), 5000);
    this.intervals.push(startupTimer);

    // Periodic checks
    const checkInterval = setInterval(() => this.runHealthCheck(), config.monitoring.healthCheckIntervalMs);
    this.intervals.push(checkInterval);

    // Detailed inspection
    const detailInterval = setInterval(() => this.runDetailedInspection(), config.monitoring.detailedInspectionIntervalMs);
    this.intervals.push(detailInterval);

    // Periodic old backup cleanup
    const { cleanupOldBackups } = require("./utils/backupManager");
    const cleanupInterval = setInterval(() => cleanupOldBackups(), 24 * 60 * 60 * 1000);
    this.intervals.push(cleanupInterval);
  }

  stop() {
    for (const timer of this.intervals) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.intervals = [];
    this.monitoring = false;
    console.log("💚 ALEX HealthMonitor: Stopped");
  }

  /**
   * Run health check — FIXED: timestamp is separate, not in checks object.
   */
  async runHealthCheck() {
    if (!this.ready) return null;

    const timestamp = new Date();

    // Run individual checks — each returns { status, ... }
    const backendResult = await this._checkBackend();
    const dbResult = await this._checkDatabase();
    const memoryResult = this._checkMemory();

    // Store checks in a separate structure (NO timestamp mixed in)
    const checks = {
      backend: backendResult,
      database: dbResult,
      memory: memoryResult,
    };

    // Evaluate health — only iterate over actual check entries
    const results = Object.values(checks);
    const allHealthy = results.every(c => c.status === "ok" || c.status === "healthy");
    const anyCritical = results.some(c => c.status === "critical");
    const someDegraded = results.some(c => c.status === "degraded" || c.status === "warning");

    let overall = "healthy";
    if (anyCritical) overall = "critical";
    else if (someDegraded) overall = "degraded";

    this.lastHealth = { status: overall, timestamp, checks };
    this.healthHistory.push({ status: overall, timestamp, checks });
    if (this.healthHistory.length > 200) this.healthHistory.shift();

    if (overall !== "healthy") {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      // Only create incident after 3 consecutive failures
      if (this.consecutiveFailures === 3) {
        const degradedComponents = Object.entries(checks)
          .filter(([, c]) => c.status !== "ok" && c.status !== "healthy")
          .map(([name, c]) => `${name}: ${c.status}${c.error ? ` (${c.error})` : ""}`)
          .join("; ");

        await this.incidentManager.createIncident({
          severity: overall === "critical" ? "CRITICAL" : "HIGH",
          source: "health_monitor",
          component: "backend",
          category: "error",
          description: `HealthMonitor: ${overall} after ${this.consecutiveFailures} failures — ${degradedComponents}`,
          evidence: { checks, consecutiveFailures: this.consecutiveFailures },
          probableCause: "Health check failure — see evidence for details",
        });
      } else if (this.consecutiveFailures > 3) {
        console.log(`💚 Degraded (${this.consecutiveFailures}x): ${overall}`);
      }
    } else {
      this.consecutiveSuccesses++;
      // Reset failure counter after enough successes
      if (this.consecutiveSuccesses >= this.healthyThreshold) {
        if (this.consecutiveFailures >= 3) {
          console.log("💚 Health restored after degradation period");
        }
        this.consecutiveFailures = 0;
      }
    }

    return this.lastHealth;
  }

  async runDetailedInspection() {
    if (!this.ready) return;
    console.log("🔍 ALEX HealthMonitor: Detailed inspection...");
    const errors = global.__alexErrors || [];
    const recentErrors = errors.slice(-10);

    if (recentErrors.length > 0) {
      // Only report the latest critical error (don't spam)
      const latest = recentErrors[recentErrors.length - 1];
      if (latest.severity === "critical") {
        await this.incidentManager.createIncident({
          severity: "HIGH", source: "health_monitor", component: "backend", category: "error",
          description: `Application error: ${(latest.message || "").slice(0, 200)}`,
          evidence: { error: latest },
          probableCause: (latest.stack || "").slice(0, 500),
        });
      }
    }
  }

  getStatus() { return this.lastHealth; }
  getHistory(limit = 20) { return this.healthHistory.slice(-limit); }

  // ---- Check methods ----

  async _checkBackend() {
    try {
      const start = Date.now();
      const response = await fetch(`${this.serverUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;

      if (response.ok) {
        return { status: "ok", latency: `${latency}ms`, httpStatus: response.status };
      }
      return { status: "degraded", latency: `${latency}ms`, httpStatus: response.status };
    } catch (err) {
      return { status: "critical", error: err.message, httpStatus: null };
    }
  }

  async _checkDatabase() {
    try {
      const state = mongoose.connection.readyState;
      if (state === 1) {
        const admin = mongoose.connection.db.admin();
        await admin.ping();
        return { status: "healthy", state: "connected" };
      } else if (state === 2) {
        return { status: "degraded", state: "connecting" };
      } else {
        return { status: "critical", state: "disconnected" };
      }
    } catch (err) {
      return { status: "critical", state: "error", error: err.message };
    }
  }

  _checkMemory() {
    const os = require("os");
    const usage = process.memoryUsage();

    const totalSysMB = Math.round(os.totalmem() / 1024 / 1024);
    const freeSysMB = Math.round(os.freemem() / 1024 / 1024);
    const usedSysMB = totalSysMB - freeSysMB;
    const sysUsageRatio = usedSysMB / totalSysMB;

    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);

    // FIXED: Percentage-based thresholds
    const freeSysPercent = freeSysMB / totalSysMB;
    
    let status = "healthy";
    let reasons = [];

    // System memory: percentage-based
    if (freeSysPercent < 0.05 || freeSysMB < 100) {
      status = "critical";
      reasons.push(`system free ${freeSysMB}MB (${Math.round(freeSysPercent*100)}%) critically low`);
    } else if (freeSysPercent < 0.10 || freeSysMB < 256) {
      status = "warning";
      reasons.push(`system free ${freeSysMB}MB (${Math.round(freeSysPercent*100)}%) below threshold`);
    }

    // Process heap: percentage-based
    const heapRatio = heapTotalMB > 0 ? (heapUsedMB / heapTotalMB) : 0;
    if (heapRatio > 0.95) {
      status = "critical";
      reasons.push(`heap ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapRatio*100)}%) nearly full`);
    } else if (heapRatio > 0.85) {
      if (status === "healthy") status = "warning";
      reasons.push(`heap ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapRatio*100)}%) high`);
    }

    // RSS > 80% of system memory
    if (totalSysMB > 0 && rssMB > totalSysMB * 0.8) {
      status = "critical";
      reasons.push(`RSS ${rssMB}MB > 80% of system memory (${totalSysMB}MB)`);
    }

    return {
      status,
      heapUsedMB,
      heapTotalMB,
      rssMB,
      systemFreeMB: freeSysMB,
      systemTotalMB: totalSysMB,
      systemUsagePercent: Math.round(sysUsageRatio * 100),
      heapPercent: Math.round(heapRatio * 100),
      reason: reasons.length > 0 ? reasons.join("; ") : "All memory metrics within normal ranges",
    };
  }
}

let instance = null;
function getHealthMonitor() {
  if (!instance) instance = new HealthMonitor();
  return instance;
}

module.exports = { HealthMonitor, getHealthMonitor };