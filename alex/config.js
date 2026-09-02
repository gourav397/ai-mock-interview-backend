// ============================================================
// ALEX — Multi-Agent System Configuration (Production Ready)
// FIXED: shared key pool (config/geminiKeys) — single source ✅
// ============================================================

require("dotenv").config();

const { API_KEYS } = require("../config/geminiKeys"); // same folder — config/geminiKeys.js

const config = {
  systemName: "ALEX",
  version: "1.0.0",

  agents: {
    security: { enabled: true },
    employee: { enabled: true },
    alex: { enabled: true },
  },

  // ============================================
  // 👑 OWNER CONFIGURATION — Strict access control
  // ============================================
  owner: {
    // JWT secret for token verification — MUST be set via env
    jwtSecret: process.env.JWT_SECRET || null,

    // ADMIN_KEY as alternative auth for API/phone access
    adminKey: process.env.ADMIN_KEY || null,

    // Required roles for owner access
    allowedRoles: ["admin", "owner"],

    // Command configuration
    commandMaxLength: 4000,
    commandHistoryMax: 1000,
    confirmationTimeoutMs: 300000, // 5 minutes
  },

  escalation: {
    autoFixLevel0: true,
    autoFixLevel1: true,
    autoFixLevel2: false,
    autoFixLevel3: false,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 300000,
  },

  monitoring: {
    healthCheckIntervalMs: 60000,
    detailedInspectionIntervalMs: 600000,
    logAnalysisIntervalMs: 120000,
    maxLogLines: 500,
  },

  incidents: {
    dedupWindowMs: 600000,
    maxActiveIncidents: 100,
    autoResolveAfterMs: 86400000,
    minIntervalBetweenSameIncidentMs: 120000,
  },

  codeChange: {
    backupEnabled: true,
    backupDir: "./.alex-backups",
    maxBackups: 50,
    validateBeforeApply: true,
    runTestsAfterChange: true,
    runLintAfterChange: true,
    autoRollbackOnFailure: true,
  },

  ai: {
    // FIXED: shared pool — ALEX ab wahi keys dekhta hai jo baaki system dekhta hai
    model: process.env.ALEX_GEMINI_MODEL || "gemini-3.5-flash",
    keys: API_KEYS,
    temperature: 0.3,
    maxTokens: 4096,
    timeoutMs: 30000,
    retryDelayMs: 2000,
  },

  storage: {
    memoryCollection: "alex_memory",
    incidentCollection: "alex_incidents",
    auditCollection: "alex_audit",
  },

  notifications: {
    emailEnabled: !!process.env.ALEX_NOTIFICATION_EMAIL,
    emailAddress: process.env.ALEX_NOTIFICATION_EMAIL || "",
    consoleEnabled: true,
  },

  // Strictly protected — ALEX will NEVER read or modify these
  protectedGlobs: [
    ".env*",
    "node_modules/**",
    ".git/**",
    "**/*.pem",
    "**/*.cert",
    "**/*.key",
    "**/credentials*",
    "**/secrets*",
    ".alex-backups/**",
    "cache/**",
  ],

  // Read-only — inspect but never modify
  readOnlyGlobs: [
    ".git/**",
    "node_modules/**",
  ],

  commands: {
    allowlist: [
      "node", "npm", "npx", "ls", "cat", "grep", "find",
      "diff", "head", "tail", "wc", "echo", "mkdir", "cp", "mv", "touch",
    ],
    blockPatterns: [
      /rm\s+(-rf\s+)?\s*\/\s*$/,
      /dd\s+if=/,
      /:\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
      />(?:\s*\/dev\/|\s*\/etc\/|\s*\/boot\/)/,
      /sudo/,
      /su\s+/,
      /chmod\s+777/,
      /chown/,
      /mkfs/,
    ],
  },
};

if (!config.ai.keys.length) {
  console.warn("⚠️ ALEX: No Gemini API keys. Running in LIMITED (pattern-based) mode.");
  config.ai.available = false;
} else {
  config.ai.available = true;
}

// Startup validation — warn if owner auth isn't properly configured
if (!config.owner.jwtSecret) {
  console.warn("⚠️ ALEX OWNER: JWT_SECRET not set. Owner authentication requires JWT_SECRET environment variable.");
}
if (!config.owner.adminKey) {
  console.warn("⚠️ ALEX OWNER: ADMIN_KEY not set. Phone/API fallback auth will be unavailable.");
}

module.exports = config;
