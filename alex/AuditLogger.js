// ============================================================
// ALEX Audit Logger — Every action logged, non-blocking
// ============================================================

const AuditEvent = require("./models/AuditEvent");

class AuditLogger {
  constructor() {
    this.ready = false;
    this.buffer = [];
    this.flushInterval = null;
    this.maxBufferSize = 50;
  }

  async init() {
    try {
      await AuditEvent.createIndexes();
      this.ready = true;
      // Periodic buffer flush
      this.flushInterval = setInterval(() => this.flush(), 5000);
      console.log("📋 ALEX AuditLogger: Ready");
    } catch (err) {
      console.error("📋 ALEX AuditLogger init failed:", err.message);
    }
  }

  async log(eventData) {
    const { agent, action, file = "N/A", incidentId = null, reason = "", result = "success", detail = {}, tests = "not_run", rollbackAvailable = false, durationMs = null } = eventData;

    const event = { agent, action, file, result, reason, detail, tests, rollbackAvailable };
    if (incidentId) event.incidentId = incidentId;
    if (durationMs !== null) event.durationMs = durationMs;

    // Add to buffer
    this.buffer.push(event);

    // Immediate console output
    const icon = result === "success" ? "✅" : result === "failure" ? "❌" : result === "pending" ? "⏳" : "⏭️";
    console.log(`${icon} [AUDIT] ${agent} | ${action} | ${file} | ${result}${incidentId ? ` | ${incidentId}` : ""}`);

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  async flush() {
    if (!this.ready || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.maxBufferSize);
    try {
      await AuditEvent.insertMany(batch, { ordered: false });
    } catch (err) {
      // If insertMany fails, try individually to salvage as many as possible
      for (const event of batch) {
        try { await AuditEvent.create(event); } catch { /* skip failed */ }
      }
    }
  }

  async getRecent(limit = 50, filter = {}) {
    try { return await AuditEvent.find(filter).sort({ timestamp: -1 }).limit(limit).lean(); }
    catch { return []; }
  }

  async getByIncident(incidentId) {
    try { return await AuditEvent.find({ incidentId }).sort({ timestamp: -1 }).lean(); }
    catch { return []; }
  }

  async destroy() {
    if (this.flushInterval) { clearInterval(this.flushInterval); this.flushInterval = null; }
    await this.flush();
    this.ready = false;
  }
}

let instance = null;
function getAuditLogger() {
  if (!instance) instance = new AuditLogger();
  return instance;
}

module.exports = { AuditLogger, getAuditLogger };