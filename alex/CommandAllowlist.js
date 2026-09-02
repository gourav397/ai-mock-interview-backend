// ============================================================
// ALEX COMMAND ALLOWLIST
// Secure workspace boundary for ALEX owner execution
// ============================================================

const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const ALLOWED_ACTIONS = {
  // ============================================================
  // READ / INSPECTION
  // ============================================================

  inspect: {
    allowed: true,
    requiresConfirmation: false,
    description: "Inspect project structure, files and code",
  },

  "find-bugs": {
    allowed: true,
    requiresConfirmation: false,
    description: "Find bugs and code problems",
  },

  "find-issues": {
    allowed: true,
    requiresConfirmation: false,
    description: "Alias for find-bugs",
  },

  "inspect-security": {
    allowed: true,
    requiresConfirmation: false,
    description: "Inspect project security",
  },

  "check-health": {
    allowed: true,
    requiresConfirmation: false,
    description: "Check ALEX/backend health",
  },

  "check-database": {
    allowed: true,
    requiresConfirmation: false,
    description: "Check database connection",
  },

  "inspect-logs": {
    allowed: true,
    requiresConfirmation: false,
    description: "Inspect audit logs",
  },

  status: {
    allowed: true,
    requiresConfirmation: false,
    description: "Get ALEX status",
  },


  "list-actions": {
    allowed: true,
    requiresConfirmation: false,
    description: "List all registered actions",
  },

  "list-incidents": {
    allowed: true,
    requiresConfirmation: false,
    description: "List recent incidents",
  },

  "list-history": {
    allowed: true,
    requiresConfirmation: false,
    description: "Show command execution history",
  },

  "security-scan": {
    allowed: true,
    requiresConfirmation: false,
    description: "Run full project security scan",
  },

  verify: {
    allowed: true,
    requiresConfirmation: false,
    description: "Verify all registered actions",
  },

  // ============================================================
  // TESTING
  // ============================================================

  "run-tests": {
    allowed: true,
    requiresConfirmation: false,
    description: "Run project tests",
  },

  test: {
    allowed: true,
    requiresConfirmation: false,
    description: "Alias for run-tests",
  },

  // ============================================================
  // CODE IMPROVEMENT
  // ============================================================

  "fix-bugs": {
    allowed: true,
    requiresConfirmation: false,
    description: "Find and fix code bugs",
  },

  "improve-code": {
    allowed: true,
    requiresConfirmation: false,
    description: "Improve code quality",
  },

  "improve-security": {
    allowed: true,
    requiresConfirmation: false,
    description: "Improve application security",
  },

  // ============================================================
  // FILE / DEVELOPMENT OPERATIONS
  // ============================================================

  "create-file": {
    allowed: true,
    requiresConfirmation: false,
    description: "Create a new project file with supplied content",
  },

  "modify-file": {
    allowed: true,
    requiresConfirmation: false,
    description: "Modify an existing project file",
  },

  "run-command": {
    allowed: true,
    requiresConfirmation: false,
    description: "Run an approved development command",
  },

  "prepare-deploy": {
    allowed: true,
    requiresConfirmation: false,
    description: "Prepare project for deployment",
  },

  // ============================================================
  // HIGH RISK
  // ============================================================

  "delete-file": {
    allowed: true,
    requiresConfirmation: true,
    description: "Delete a project file",
  },

  "delete-data": {
    allowed: true,
    requiresConfirmation: true,
    description: "Delete application data",
  },

  "drop-collection": {
    allowed: true,
    requiresConfirmation: true,
    description: "Drop database collection",
  },

  "modify-env": {
    allowed: true,
    requiresConfirmation: true,
    description: "Modify environment configuration",
  },

  "disable-auth": {
    allowed: true,
    requiresConfirmation: true,
    description: "Disable authentication",
  },

  migrate: {
    allowed: true,
    requiresConfirmation: true,
    description: "Run database migration",
  },

  rollback: {
    allowed: true,
    requiresConfirmation: true,
    description: "Rollback a change",
  },
};

// ============================================================
// APPROVED COMMAND BINARIES
// ============================================================

const ALLOWED_COMMANDS = new Set([
  "node",
  "npm",
  "npx",
  "ls",
  "cat",
  "grep",
  "find",
  "diff",
  "head",
  "tail",
  "wc",
  "echo",
  "mkdir",
  "cp",
  "mv",
  "touch",
  "pwd",
  "which",
  "dirname",
  "basename",
]);

// ============================================================
// BLOCKED COMMAND PATTERNS
// ============================================================

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/im,
  /dd\s+if=/im,

  />\s*\/(?:dev|etc|boot|proc|sys|root)\//im,

  /\bsudo\b/im,
  /\bsu\s+/im,

  /\bchmod\s+777\b/im,
  /\bchown\b/im,

  /\bmkfs\b/im,
  /\bfdisk\b/im,
  /\bparted\b/im,

  /\|\s*sh\b/im,
  /\|\s*bash\b/im,
  /\|\s*zsh\b/im,

  /\beval\s*\(/im,
  /\bexec\s*\(/im,

  /process\.env/im,

  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};?/im,
];

// ============================================================
// PROTECTED PATHS
// ============================================================

const PROTECTED_PATHS = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",

  "node_modules",
  ".git",

  ".alex-backups",

  "cache",

  "**/*.pem",
  "**/*.key",
  "**/*.cert",

  "**/credentials*",
  "**/secrets*",
];

// ============================================================
// HELPERS
// ============================================================

function normalizeForComparison(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

function globToRegex(glob) {
  const normalized = normalizeForComparison(glob);

  let regex = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLE_STAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLE_STAR___/g, ".*");

  return new RegExp(`^${regex}$`, "i");
}

// ============================================================
// CLASS
// ============================================================

class CommandAllowlist {
  static getProjectRoot() {
    return PROJECT_ROOT;
  }

  static isActionAllowed(action) {
    return ALLOWED_ACTIONS[action]?.allowed === true;
  }

  static requiresConfirmation(action) {
    return ALLOWED_ACTIONS[action]?.requiresConfirmation === true;
  }

  static getActionInfo(action) {
    return ALLOWED_ACTIONS[action] || null;
  }

  static getAllowedActions() {
    return Object.entries(ALLOWED_ACTIONS)
      .filter(([, info]) => info.allowed)
      .map(([action, info]) => ({
        action,
        requiresConfirmation: info.requiresConfirmation,
        description: info.description,
      }));
  }

  // ============================================================
  // COMMAND VALIDATION
  // ============================================================

  static getCommandName(command) {
    if (!command || typeof command !== "string") {
      return "";
    }

    return command.trim().split(/\s+/)[0] || "";
  }

  static isCommandAllowed(command) {
    const cmdName = this.getCommandName(command);
    return ALLOWED_COMMANDS.has(cmdName);
  }

  static containsBlockedPattern(command) {
    if (!command || typeof command !== "string") {
      return false;
    }

    return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
  }

  static getAllowedCommands() {
    return [...ALLOWED_COMMANDS];
  }

  static getBlockedCommands() {
    return [
      "sudo",
      "su",
      "chmod 777",
      "chown",
      "mkfs",
      "fdisk",
      "parted",
      "dd",
      "rm -rf /",
    ];
  }

  // ============================================================
  // PATH SECURITY
  // ============================================================

  static resolveProjectPath(filePath) {
    if (!filePath || typeof filePath !== "string") {
      return null;
    }

    const cleaned = filePath
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "");

    if (!cleaned) {
      return null;
    }

    const resolved = path.resolve(PROJECT_ROOT, cleaned);

    return resolved;
  }

  static isPathInProject(filePath) {
    const resolved = this.resolveProjectPath(filePath);

    if (!resolved) {
      return false;
    }

    const relative = path.relative(PROJECT_ROOT, resolved);

    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  static isPathProtected(filePath) {
    const resolved = this.resolveProjectPath(filePath);

    if (!resolved) {
      return true;
    }

    const relative = normalizeForComparison(
      path.relative(PROJECT_ROOT, resolved)
    );

    if (!relative || relative === ".") {
      return true;
    }

    for (const protectedPath of PROTECTED_PATHS) {
      const normalizedProtected = normalizeForComparison(protectedPath);

      if (normalizedProtected.includes("*")) {
        if (globToRegex(normalizedProtected).test(relative)) {
          return true;
        }
      } else {
        if (
          relative === normalizedProtected ||
          relative.startsWith(`${normalizedProtected}/`)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  static validateFilePath(filePath) {
    if (!filePath) {
      return {
        valid: false,
        error: "File path is required.",
      };
    }

    if (!this.isPathInProject(filePath)) {
      return {
        valid: false,
        error: "Path is outside the project workspace.",
      };
    }

    if (this.isPathProtected(filePath)) {
      return {
        valid: false,
        error: "This path is protected.",
      };
    }

    const resolved = this.resolveProjectPath(filePath);

    if (!resolved) {
      return {
        valid: false,
        error: "Invalid file path.",
      };
    }

    return {
      valid: true,
      resolved,
      relative: path.relative(PROJECT_ROOT, resolved),
    };
  }

  static getProtectedPaths() {
    return [
      ".env files",
      "node_modules",
      ".git",
      "SSL certificates and keys",
      "credentials and secrets",
      ".alex-backups",
      "cache",
    ];
  }
}

module.exports = {
  CommandAllowlist,
  ALLOWED_ACTIONS,
  ALLOWED_COMMANDS,
  BLOCKED_PATTERNS,
  PROTECTED_PATHS,
};

