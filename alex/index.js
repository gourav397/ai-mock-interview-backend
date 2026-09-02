// ============================================================
// ALEX — Main entry point. Mountable synchronously.
// ============================================================

const { getAlexController } = require("./AlexController");
const { getSecurityAgent } = require("./SecurityAgent");
const { getEmployeeAgent } = require("./EmployeeAgent");
const { getIncidentManager } = require("./IncidentManager");
const { getHealthMonitor } = require("./HealthMonitor");
const { getAuditLogger } = require("./AuditLogger");
const { getNotificationManager } = require("./NotificationManager");
const backupManager = require("./utils/backupManager");
const config = require("./config");

let alexInstance = null;

async function initAlex() {
  if (alexInstance) return alexInstance;
  alexInstance = getAlexController();
  await alexInstance.init();
  return alexInstance;
}

function getAlex() { return alexInstance || getAlexController(); }

// EXPORT: Create dashboard router synchronously for early mounting
let dashboardRouter = null;
let dashboardRouterPromise = null;

async function _buildRouter() {
  const { createDashboardRouter } = require("./routes/alexDashboard");
  dashboardRouter = await createDashboardRouter();
  return dashboardRouter;
}

function getDashboardRouter() {
  if (dashboardRouter) return Promise.resolve(dashboardRouter);
  if (!dashboardRouterPromise) dashboardRouterPromise = _buildRouter();
  return dashboardRouterPromise;
}

// Synchronous version for use before await
// Returns null if not yet built — caller must handle
function getDashboardRouterSync() {
  return dashboardRouter;
}

module.exports = {
  initAlex, getAlex, getDashboardRouter, getDashboardRouterSync,
  getSecurityAgent, getEmployeeAgent, getIncidentManager,
  getHealthMonitor, getAuditLogger, getNotificationManager,
  backupManager, config,
};