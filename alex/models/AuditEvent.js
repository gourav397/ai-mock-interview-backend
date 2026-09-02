const mongoose = require("mongoose");

const auditEventSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  agent: { type: String, enum: ["security", "employee", "alex", "system", "user"], required: true },
  action: { type: String, required: true },
  file: { type: String, default: "N/A" },
  incidentId: { type: String },
  reason: { type: String },
  result: { type: String, enum: ["success", "failure", "pending", "skipped"], default: "success" },
  detail: { type: mongoose.Schema.Types.Mixed },
  tests: { type: String, enum: ["passed", "failed", "not_run", "not_applicable"], default: "not_run" },
  rollbackAvailable: { type: Boolean, default: false },
  durationMs: { type: Number },
});

auditEventSchema.index({ timestamp: -1 });
auditEventSchema.index({ incidentId: 1, timestamp: -1 });
auditEventSchema.index({ agent: 1, timestamp: -1 });

module.exports = mongoose.model("AuditEvent", auditEventSchema);