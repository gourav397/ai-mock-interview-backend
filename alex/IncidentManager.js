// ============================================================
// ALEX Incident Manager
// Centralized + Deduplicated + Rate-Limited
// SAFE ENUM NORMALIZATION
// ============================================================

const Incident = require("./models/Incident");
const config = require("./config");
const { getAuditLogger } = require("./AuditLogger");

class IncidentManager {
  constructor() {
    this.ready = false;
    this.audit = getAuditLogger();

    // Prevent repeated identical incidents in memory
    this.lastCreationBySignature = new Map();

    // MUST match models/Incident.js enums
    this.validComponents = new Set([
      "backend",
      "frontend",
      "database",
      "ai",
      "auth",
      "security",
      "api",
      "deployment",
      "project",
      "unknown",
    ]);

    this.validSources = new Set([
      "health_monitor",
      "security_agent",
      "employee_agent",
      "alex",
      "manual",
      "api",
      "system",
      "owner_command",
    ]);

    this.validCategories = new Set([
      "error",
      "auth_failure",
      "performance",
      "security_threat",
      "dependency",
      "deployment",
      "configuration",
      "crash",
      "timeout",
      "data_issue",
      "code_review",
      "security",
      "warning",
      "info",
      "unknown",
    ]);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async init() {
    try {
      await Incident.createIndexes();

      this.ready = true;

      console.log("ALEX IncidentManager: Ready");
    } catch (err) {
      this.ready = false;

      console.error(
        "ALEX IncidentManager init failed:",
        err.message
      );
    }
  }

  // ============================================================
  // COMPONENT NORMALIZATION
  // ============================================================

  _normalizeComponent(component, description, evidence) {
    const raw = String(component || "")
      .trim()
      .toLowerCase();

    // Already valid
    if (this.validComponents.has(raw)) {
      return raw;
    }

    const evidenceText =
      typeof evidence === "object"
        ? JSON.stringify(evidence)
        : String(evidence || "");

    const text = [
      raw,
      String(description || "").toLowerCase(),
      evidenceText.toLowerCase(),
    ].join(" ");

    // Frontend
    if (
      /\b(frontend|react|vite|browser|ui|jsx|tsx|navigate|navigation|react router|route not found|category click)\b/i.test(
        text
      )
    ) {
      return "frontend";
    }

    // Backend
    if (
      /\b(backend|express|node|server|controller|middleware|router|route|endpoint)\b/i.test(
        text
      )
    ) {
      return "backend";
    }

    // Database
    if (
      /\b(database|mongodb|mongoose|mongo|schema|collection|query|model)\b/i.test(
        text
      )
    ) {
      return "database";
    }

    // Authentication
    if (
      /\b(auth|authentication|authorization|jwt|token|login|signup|password|permission)\b/i.test(
        text
      )
    ) {
      return "auth";
    }

    // AI
    if (
      /\b(ai|gemini|llm|model|generation|generative|prompt)\b/i.test(
        text
      )
    ) {
      return "ai";
    }

    // Security
    if (
      /\b(security|vulnerability|xss|sqli|injection|attack|threat|securityagent)\b/i.test(
        text
      )
    ) {
      return "security";
    }

    // Deployment
    if (
      /\b(deployment|deploy|railway|production|build|hosting)\b/i.test(
        text
      )
    ) {
      return "deployment";
    }

    // General project/ALEX
    if (
      /\b(project|alex|incident|goal|task|system)\b/i.test(
        text
      )
    ) {
      return "project";
    }

    return "unknown";
  }

  // ============================================================
  // SOURCE NORMALIZATION
  // ============================================================

  _normalizeSource(source) {
    const raw = String(source || "")
      .trim()
      .toLowerCase();

    if (this.validSources.has(raw)) {
      return raw;
    }

    if (raw.includes("health")) {
      return "health_monitor";
    }

    if (raw.includes("security")) {
      return "security_agent";
    }

    if (raw.includes("employee")) {
      return "employee_agent";
    }

    if (raw.includes("owner")) {
      return "owner_command";
    }

    if (raw.includes("api")) {
      return "api";
    }

    if (raw.includes("manual")) {
      return "manual";
    }

    if (raw.includes("alex")) {
      return "alex";
    }

    return "system";
  }

  // ============================================================
  // CATEGORY NORMALIZATION
  // ============================================================

  _normalizeCategory(category) {
    const raw = String(category || "")
      .trim()
      .toLowerCase();

    if (this.validCategories.has(raw)) {
      return raw;
    }

    if (raw.includes("auth")) {
      return "auth_failure";
    }

    if (raw.includes("security")) {
      return "security";
    }

    if (raw.includes("performance")) {
      return "performance";
    }

    if (raw.includes("timeout")) {
      return "timeout";
    }

    if (raw.includes("dependency")) {
      return "dependency";
    }

    if (raw.includes("deploy")) {
      return "deployment";
    }

    if (raw.includes("config")) {
      return "configuration";
    }

    if (raw.includes("warning")) {
      return "warning";
    }

    if (raw.includes("info")) {
      return "info";
    }

    if (raw.includes("review")) {
      return "code_review";
    }

    if (raw.includes("error")) {
      return "error";
    }

    return "unknown";
  }

  // ============================================================
  // SEVERITY NORMALIZATION
  // ============================================================

  _normalizeSeverity(severity) {
    const value = String(severity || "")
      .trim()
      .toUpperCase();

    if (
      ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
        value
      )
    ) {
      return value;
    }

    return "MEDIUM";
  }

  // ============================================================
  // CREATE INCIDENT
  // ============================================================

  async createIncident({
    severity = "MEDIUM",
    source,
    component,
    category = "unknown",
    description,
    evidence = {},
    probableCause = "",
  }) {
    try {
      if (!this.ready) {
        console.warn(
          "ALEX IncidentManager: manager not initialized"
        );
      }

      // Normalize all enum-controlled fields
      const normalizedComponent =
        this._normalizeComponent(
          component,
          description,
          evidence
        );

      const normalizedSource =
        this._normalizeSource(source);

      const normalizedCategory =
        this._normalizeCategory(category);

      const normalizedSeverity =
        this._normalizeSeverity(severity);

      const safeDescription =
        String(description || "").trim() ||
        "ALEX detected an incident requiring investigation.";

      // Diagnostic logging
      const originalComponent = String(
        component || ""
      )
        .trim()
        .toLowerCase();

      if (
        originalComponent !== normalizedComponent
      ) {
        console.warn(
          "ALEX IncidentManager: normalized invalid component " +
            JSON.stringify(component) +
            " -> " +
            JSON.stringify(normalizedComponent)
        );
      }

      // ========================================================
      // SIGNATURE
      // ========================================================

      const signature = this._makeSignature(
        normalizedComponent,
        normalizedCategory,
        safeDescription
      );

      // ========================================================
      // MEMORY RATE LIMIT
      // ========================================================

      const lastTime =
        this.lastCreationBySignature.get(
          signature
        );

      const minInterval =
        config &&
        config.incidents &&
        Number(
          config.incidents
            .minIntervalBetweenSameIncidentMs
        );

      const safeMinInterval =
        Number.isFinite(minInterval)
          ? minInterval
          : 60000;

      if (
        lastTime &&
        Date.now() - lastTime <
          safeMinInterval
      ) {
        console.log(
          "ALEX Rate-limited: skipping duplicate incident for " +
            normalizedCategory +
            "/" +
            normalizedComponent
        );

        return null;
      }

      // ========================================================
      // DATABASE DEDUPLICATION
      // ========================================================

      const existing =
        await this._findDuplicate(signature);

      if (existing) {
        console.log(
          "ALEX Duplicate detected: " +
            existing.incidentId
        );

        await Incident.findOneAndUpdate(
          {
            incidentId:
              existing.incidentId,
          },
          {
            $set: {
              timestamp: new Date(),
            },
            $inc: {
              duplicateCount: 1,
            },
          },
          {
            returnDocument: "after",
          }
        );

        this.lastCreationBySignature.set(
          signature,
          Date.now()
        );

        return null;
      }

      // ========================================================
      // CREATE INCIDENT
      // ========================================================

      const incident =
        await Incident.create({
          severity: normalizedSeverity,
          source: normalizedSource,
          component: normalizedComponent,
          category: normalizedCategory,
          description: safeDescription,
          evidence: evidence || {},
          probableCause:
            String(probableCause || ""),
          status: "NEW",
          assignedAgent: "unassigned",
          rootCauseHash: signature,
        });

      this.lastCreationBySignature.set(
        signature,
        Date.now()
      );

      // ========================================================
      // AUDIT
      // ========================================================

      if (
        this.audit &&
        typeof this.audit.log === "function"
      ) {
        try {
          await this.audit.log({
            agent: "system",
            action: "create_incident",
            incidentId:
              incident.incidentId,
            reason:
              "New " +
              normalizedSeverity +
              " incident: " +
              safeDescription.slice(0, 100),
            result: "success",
            detail: {
              severity:
                normalizedSeverity,
              component:
                normalizedComponent,
              category:
                normalizedCategory,
              source:
                normalizedSource,
            },
          });
        } catch (auditError) {
          console.error(
            "ALEX AuditLogger error:",
            auditError.message
          );
        }
      }

      console.log(
        "ALEX Incident " +
          incident.incidentId +
          " [" +
          normalizedSeverity +
          "] " +
          safeDescription.slice(0, 120)
      );

      // ========================================================
      // AUTO ESCALATION
      // ========================================================

      if (
        normalizedSeverity === "HIGH" ||
        normalizedSeverity === "CRITICAL"
      ) {
        await this.assignAgent(
          incident.incidentId,
          "security"
        );
      }

      return incident;
    } catch (err) {
      console.error(
        "ALEX IncidentManager createIncident failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // ASSIGN AGENT
  // ============================================================

  async assignAgent(incidentId, agent) {
    const statusMap = {
      security:
        "SECURITY_HANDLING",
      employee:
        "EMPLOYEE_HANDLING",
      alex:
        "ALEX_REVIEW",
      user:
        "WAITING_FOR_USER",
    };

    const status =
      statusMap[agent] ||
      "INVESTIGATING";

    try {
      return await Incident.findOneAndUpdate(
        {
          incidentId,
        },
        {
          $set: {
            assignedAgent: agent,
            status,
          },
          $push: {
            actions: {
              agent: "system",
              action:
                "assigned_to_" +
                agent,
              timestamp: new Date(),
              result: "success",
              detail: {
                status,
              },
            },
          },
        },
        {
          returnDocument: "after",
        }
      );
    } catch (err) {
      console.error(
        "ALEX assignAgent failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // ADD ACTION
  // ============================================================

  async addAction(
    incidentId,
    action
  ) {
    try {
      return await Incident.findOneAndUpdate(
        {
          incidentId,
        },
        {
          $push: {
            actions: {
              ...action,
              timestamp: new Date(),
            },
          },
        },
        {
          returnDocument: "after",
        }
      );
    } catch (err) {
      console.error(
        "ALEX addAction failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // ADD CHANGE
  // ============================================================

  async addChange(
    incidentId,
    change
  ) {
    try {
      return await Incident.findOneAndUpdate(
        {
          incidentId,
        },
        {
          $push: {
            changes: {
              ...change,
              appliedAt: new Date(),
            },
          },
        },
        {
          returnDocument: "after",
        }
      );
    } catch (err) {
      console.error(
        "ALEX addChange failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // UPDATE STATUS
  // ============================================================

  async updateStatus(
    incidentId,
    status,
    resolution = ""
  ) {
    const update = {
      status,
    };

    if (
      [
        "RESOLVED",
        "ROLLED_BACK",
        "FAILED",
      ].includes(status)
    ) {
      update.resolvedAt = new Date();
    }

    if (resolution) {
      update.resolution =
        resolution;
    }

    try {
      const incident =
        await Incident.findOneAndUpdate(
          {
            incidentId,
          },
          update,
          {
            returnDocument: "after",
          }
        );

      if (
        this.audit &&
        typeof this.audit.log === "function"
      ) {
        try {
          await this.audit.log({
            agent: "system",
            action:
              "status_" + status,
            incidentId,
            reason:
              resolution ||
              "Status changed to " +
                status,
            result:
              status === "FAILED"
                ? "failure"
                : "success",
          });
        } catch (auditError) {
          console.error(
            "ALEX AuditLogger error:",
            auditError.message
          );
        }
      }

      return incident;
    } catch (err) {
      console.error(
        "ALEX updateStatus failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // GET SINGLE INCIDENT
  // ============================================================

  async getIncident(
    incidentId
  ) {
    try {
      return await Incident.findOne({
        incidentId,
      }).lean();
    } catch (err) {
      console.error(
        "ALEX getIncident failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // GET ACTIVE INCIDENTS
  // ============================================================

  async getActiveIncidents() {
    try {
      return await Incident.find({
        status: {
          $nin: [
            "RESOLVED",
            "ROLLED_BACK",
            "FAILED",
          ],
        },
      })
        .sort({
          severity: -1,
          timestamp: -1,
        })
        .lean();
    } catch (err) {
      console.error(
        "ALEX getActiveIncidents failed:",
        err.message
      );

      return [];
    }
  }

  // ============================================================
  // GET ALL INCIDENTS
  // ============================================================

  async getAllIncidents(
    filter = {},
    limit = 100
  ) {
    try {
      const safeLimit =
        Math.min(
          Math.max(
            Number(limit) || 100,
            1
          ),
          500
        );

      return await Incident.find(
        filter
      )
        .sort({
          timestamp: -1,
        })
        .limit(safeLimit)
        .lean();
    } catch (err) {
      console.error(
        "ALEX getAllIncidents failed:",
        err.message
      );

      return [];
    }
  }

  // ============================================================
  // GET STATISTICS
  // ============================================================

  async getStats() {
    try {
      const stats =
        await Incident.aggregate([
          {
            $group: {
              _id: null,

              total: {
                $sum: 1,
              },

              open: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [
                          "NEW",
                          "INVESTIGATING",
                          "SECURITY_HANDLING",
                          "EMPLOYEE_HANDLING",
                          "ALEX_REVIEW",
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              resolved: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        "$status",
                        [
                          "RESOLVED",
                          "ROLLED_BACK",
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              failed: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$status",
                        "FAILED",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              critical: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$severity",
                        "CRITICAL",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              high: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$severity",
                        "HIGH",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              medium: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$severity",
                        "MEDIUM",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              low: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$severity",
                        "LOW",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

      return (
        stats[0] || {
          total: 0,
          open: 0,
          resolved: 0,
          failed: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        }
      );
    } catch (err) {
      console.error(
        "ALEX getStats failed:",
        err.message
      );

      return {
        total: 0,
        open: 0,
        resolved: 0,
        failed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
    }
  }

  // ============================================================
  // SIGNATURE
  // ============================================================

  _makeSignature(
    component,
    category,
    description
  ) {
    const normalized =
      String(component) +
      ":" +
      String(category) +
      ":" +
      String(
        description || ""
      ).slice(0, 300);

    let hash = 0;

    for (
      let i = 0;
      i < normalized.length;
      i++
    ) {
      const char =
        normalized.charCodeAt(i);

      hash =
        (hash << 5) -
        hash +
        char;

      hash |= 0;
    }

    return Math.abs(hash).toString(
      16
    );
  }

  // ============================================================
  // FIND DUPLICATE
  // ============================================================

  async _findDuplicate(
    signature
  ) {
    const configuredWindow =
      config &&
      config.incidents &&
      Number(
        config.incidents
          .dedupWindowMs
      );

    const windowMs =
      Number.isFinite(
        configuredWindow
      )
        ? configuredWindow
        : 300000;

    const since = new Date(
      Date.now() - windowMs
    );

    try {
      return await Incident.findOne({
        rootCauseHash:
          signature,

        timestamp: {
          $gte: since,
        },

        status: {
          $nin: [
            "RESOLVED",
            "ROLLED_BACK",
            "FAILED",
          ],
        },
      }).lean();
    } catch (err) {
      console.error(
        "ALEX duplicate lookup failed:",
        err.message
      );

      return null;
    }
  }

  // ============================================================
  // DESTROY
  // ============================================================

  async destroy() {
    this.lastCreationBySignature.clear();
    this.ready = false;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getIncidentManager() {
  if (!instance) {
    instance =
      new IncidentManager();
  }

  return instance;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  IncidentManager,
  getIncidentManager,
};
