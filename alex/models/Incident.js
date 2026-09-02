const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema({
  agent: { type: String, enum: ["security", "employee", "alex", "system"], required: true },
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  detail: { type: mongoose.Schema.Types.Mixed },
  result: { type: String, enum: ["success", "failure", "pending"] },
}, { _id: false });

const changeSchema = new mongoose.Schema({
  file: { type: String, required: true },
  changeType: { type: String, enum: ["create", "modify", "delete", "rollback"], required: true },
  backupPath: { type: String },
  summary: { type: String },
  testsPassed: { type: Boolean, default: false },
  appliedAt: { type: Date, default: Date.now },
}, { _id: false });

const incidentSchema = new mongoose.Schema({
  incidentId: {
    type: String,
    unique: true,
    required: true,
    default: () => `INC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
  },
  timestamp: { type: Date, default: Date.now },
  severity: {
    type: String,
    enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    required: true,
    default: "MEDIUM",
  },
  source: {
  type: String,
  enum: [
    "health_monitor",
    "security_agent",
    "employee_agent",
    "alex",
    "manual",
    "api",
    "system",

    // ALEX owner command / chat
    "owner_command",
  ],
  required: true,
  },
  component: {
  type: String,
  enum: [
    "backend",
    "frontend",
    "database",
    "ai",
    "auth",
    "security",
    "api",
    "deployment",
    "project",
    "unknown"
  ],
  required: true,
},
  category: {
  type: String,
  enum: [
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

    // ALEX analysis categories
    "code_review",
    "security",
    "warning",
    "info",

    "unknown"
  ],
  default: "unknown",
},
  description: { type: String, required: true },
  evidence: { type: mongoose.Schema.Types.Mixed },
  probableCause: { type: String },
  attemptedFix: { type: String },
  fixResult: { type: String },
  recommendedAction: { type: String },
  status: {
    type: String,
    enum: ["NEW", "INVESTIGATING", "SECURITY_HANDLING", "EMPLOYEE_HANDLING", "ALEX_REVIEW", "WAITING_FOR_USER", "RESOLVED", "ROLLED_BACK", "FAILED"],
    default: "NEW",
  },
  assignedAgent: {
    type: String,
    enum: ["security", "employee", "alex", "user", "unassigned"],
    default: "unassigned",
  },
  actions: [actionSchema],
  changes: [changeSchema],
  resolution: { type: String },
  rollbackStatus: { type: String, enum: ["none", "pending", "success", "failed"], default: "none" },
  resolvedAt: { type: Date },
  resolvedBy: { type: String },
  rootCauseHash: { type: String, index: true },
  // Track how many times this exact incident type has been created (for rate limiting)
  duplicateCount: { type: Number, default: 0 },
});

// Indexes for fast queries
incidentSchema.index({ timestamp: -1 });
incidentSchema.index({ status: 1, severity: -1, timestamp: -1 });
incidentSchema.index({ rootCauseHash: 1, timestamp: -1 });
incidentSchema.index({ source: 1, component: 1, category: 1, timestamp: -1 });

module.exports = mongoose.model("Incident", incidentSchema);