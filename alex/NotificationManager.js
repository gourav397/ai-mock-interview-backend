// ============================================================
// ALEX Notification Manager — Console + email alerts
// ============================================================

const config = require("./config");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch {}

class NotificationManager {
  constructor() {
    this.ready = false;
    this.transporter = null;
  }

  async init() {
    if (config.notifications.emailEnabled && config.notifications.emailAddress && nodemailer) {
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        try {
          this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE || "gmail",
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
          });
          console.log("📧 ALEX NotificationManager: Email configured");
        } catch { console.log("📧 ALEX NotificationManager: Email setup failed"); }
      }
    }
    this.ready = true;
    console.log("🔔 ALEX NotificationManager: Ready");
  }

  async sendAlert(alertData) {
    console.log("\n" + "🚨".repeat(20));
    console.log("🚨 ALEX — HUMAN ATTENTION REQUIRED");
    console.log("🚨".repeat(20));
    console.log(`PROBLEM:    ${alertData.problem}`);
    console.log(`SEVERITY:   ${alertData.severity}`);
    console.log(`AFFECTED:   ${alertData.affected}`);
    console.log(`ROOT CAUSE: ${alertData.rootCause || "Unknown"}`);
    console.log(`INCIDENT:   ${alertData.incidentId || "N/A"}`);
    console.log("── WHY IT FAILED ──");
    console.log(alertData.whyFailed || "Unknown");
    console.log("── REQUIRED ACTION ──");
    console.log(alertData.requiredAction);
    console.log("🚨".repeat(20) + "\n");

    if (this.transporter && config.notifications.emailAddress) {
      try {
        await this.transporter.sendMail({
          from: `"ALEX System" <${process.env.EMAIL_USER}>`,
          to: config.notifications.emailAddress,
          subject: `🚨 [ALEX] ${alertData.severity} — ${(alertData.problem || "").slice(0, 80)}`,
          text: `ALERT: ${alertData.severity}\nProblem: ${alertData.problem}\nRoot Cause: ${alertData.rootCause}\nAction Required: ${alertData.requiredAction}\nIncident: ${alertData.incidentId}`,
        });
      } catch {}
    }
    return { sent: true };
  }
}

let instance = null;
function getNotificationManager() { if (!instance) instance = new NotificationManager(); return instance; }
module.exports = { NotificationManager, getNotificationManager };