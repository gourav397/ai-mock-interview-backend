// ============================================================
// ALEX AGENT PERMISSION MANAGER
// Version: 1.0.0
//
// Purpose:
//   Central permission/risk policy for ALEX agent actions.
//
// Flow:
//
//   ALEX Planner
//       ↓
//   AgentPermissionManager
//       ↓
//   AgentToolRegistry
//       ↓
//   WindowsAgent / Future BrowserAgent / Future DocumentAgent
//
// IMPORTANT:
//   This layer does NOT bypass the WindowsAgent CapabilityGate.
//   It provides ALEX-level policy before an external tool runs.
// ============================================================

"use strict";

// ============================================================
// CONSTANTS
// ============================================================

const PERMISSION_VERSION = "1.0.0";

const RISK = Object.freeze({
  READ: "read",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  DESTRUCTIVE: "destructive",
});

const DECISION = Object.freeze({
  ALLOW: "allow",
  CONFIRM: "confirm",
  DENY: "deny",
});

// ============================================================
// TOOL RISK POLICY
// ============================================================
//
// READ:
//   Safe observation.
//
// LOW:
//   Reversible, low-impact interaction.
//
// MEDIUM:
//   Can change user/application state.
//
// HIGH:
//   Can create meaningful external consequences.
//
// DESTRUCTIVE:
//   Deletes/destroys data or performs irreversible action.
// ============================================================

const DEFAULT_TOOL_POLICY = Object.freeze({
  // ----------------------------------------------------------
  // FILESYSTEM
  // ----------------------------------------------------------

  "fs.read": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Read an authorized file.",
  },

  "fs.search": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Search authorized filesystem locations.",
  },

  "fs.write": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Write or replace file content.",
  },

  "fs.move": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: true,
    description: "Move a file.",
  },

  "fs.delete": {
    risk: RISK.DESTRUCTIVE,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Delete a file.",
  },

  // ----------------------------------------------------------
  // APPLICATIONS
  // ----------------------------------------------------------

  "apps.list_running": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Inspect running applications.",
  },

  "apps.launch": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Launch an allowlisted application.",
  },

  "apps.close": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: true,
    description: "Close an application.",
  },

  // ----------------------------------------------------------
  // SYSTEM
  // ----------------------------------------------------------

  "sys.sysinfo": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Read system information.",
  },

  "sys.battery": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Read battery information.",
  },

  "sys.top_processes": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Inspect running processes.",
  },

  "sys.network_status": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Inspect network status.",
  },

  // ----------------------------------------------------------
  // SCREEN
  // ----------------------------------------------------------

  "screen.capture_and_analyze": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Inspect the authorized computer screen.",
  },

  // ----------------------------------------------------------
  // MOUSE
  // ----------------------------------------------------------

  "input.move": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Move the mouse cursor.",
  },

  "input.click": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Click an interface element.",
  },

  "input.double_click": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Double-click an interface element.",
  },

  "input.right_click": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Open a context menu.",
  },

  "input.scroll": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Scroll an interface.",
  },

  "input.drag": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Drag an interface element.",
  },

  // ----------------------------------------------------------
  // KEYBOARD
  // ----------------------------------------------------------

  "input.type_text": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Type text into the focused application.",
  },

  "input.press": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Press a keyboard key.",
  },

  "input.hotkey": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Press a keyboard shortcut.",
  },

  "input.run_macro": {
    risk: RISK.HIGH,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Execute multiple computer interactions.",
  },

  // ----------------------------------------------------------
  // FUTURE BROWSER TOOLS
  // ----------------------------------------------------------
  //
  // These are policy definitions only.
  // They are NOT executable until a browser tool is registered.
  //

  "browser.open": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Open an authorized web page.",
  },

  "browser.navigate": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Navigate a browser session.",
  },

  "browser.read": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Read visible webpage content.",
  },

  "browser.click": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Click a webpage element.",
  },

  "browser.type": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Type into a webpage field.",
  },

  "browser.download": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: true,
    description: "Download a file from a webpage.",
  },

  "browser.submit": {
    risk: RISK.HIGH,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: false,
    description: "Submit a webpage form.",
  },

  "browser.purchase": {
    risk: RISK.DESTRUCTIVE,
    defaultDecision: DECISION.DENY,
    requiresConfirmation: true,
    reversible: false,
    description: "Purchase or payment action.",
  },

  // ----------------------------------------------------------
  // FUTURE DOCUMENT TOOLS
  // ----------------------------------------------------------

  "document.read": {
    risk: RISK.READ,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Read an authorized document.",
  },

  "document.create": {
    risk: RISK.LOW,
    defaultDecision: DECISION.ALLOW,
    requiresConfirmation: false,
    reversible: true,
    description: "Create a document.",
  },

  "document.modify": {
    risk: RISK.MEDIUM,
    defaultDecision: DECISION.CONFIRM,
    requiresConfirmation: true,
    reversible: true,
    description: "Modify a document.",
  },
});

// ============================================================
// HIGH IMPACT ACTION DETECTION
// ============================================================
//
// Even if a generic tool looks safe, certain arguments can make
// it high impact.
//
// Example:
//   input.click
//
// Clicking a harmless UI button and clicking "Delete account"
// are not equivalent.
// ============================================================

const HIGH_IMPACT_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bcancel subscription\b/i,
  /\bclose account\b/i,
  /\bsubmit\b/i,
  /\bconfirm purchase\b/i,
  /\bbuy\b/i,
  /\border\b/i,
  /\bpay\b/i,
  /\bpayment\b/i,
  /\btransfer\b/i,
  /\bsend money\b/i,
  /\bpublish\b/i,
  /\bpost\b/i,
  /\bsend\b/i,
  /\bdeploy\b/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\bformat\b/i,
];

// ============================================================
// SENSITIVE DATA PATTERNS
// ============================================================

const SENSITIVE_DATA_PATTERNS = [
  /\bpassword\b/i,
  /\botp\b/i,
  /\bone[- ]time password\b/i,
  /\bapi[-_ ]?key\b/i,
  /\bsecret\b/i,
  /\baccess[-_ ]?token\b/i,
  /\bauth[-_ ]?token\b/i,
  /\bbearer\b/i,
  /\bprivate[-_ ]?key\b/i,
  /\bcredit[-_ ]?card\b/i,
  /\bcard[-_ ]?number\b/i,
  /\bcvv\b/i,
];

// ============================================================
// HELPERS
// ============================================================

function normalizeTool(tool) {
  return String(
    tool || ""
  )
    .trim()
    .toLowerCase();
}

function safeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value);
}

function safeObject(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {};
  }

  return value;
}

function flattenValues(value, output = []) {
  if (
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    output.push(
      String(value)
    );

    return output;
  }

  if (Array.isArray(value)) {
    for (
      const item of value
    ) {
      flattenValues(
        item,
        output
      );
    }

    return output;
  }

  if (
    typeof value === "object"
  ) {
    for (
      const [key, item] of Object.entries(
        value
      )
    ) {
      output.push(
        String(key)
      );

      flattenValues(
        item,
        output
      );
    }
  }

  return output;
}

function containsPattern(
  text,
  patterns
) {
  return patterns.some(
    (pattern) =>
      pattern.test(text)
  );
}

// ============================================================
// PERMISSION MANAGER
// ============================================================

class AgentPermissionManager {
  constructor(options = {}) {
    this.version =
      PERMISSION_VERSION;

    this.policy = {
      ...DEFAULT_TOOL_POLICY,
      ...(options.policy || {}),
    };

    this.defaultUnknownDecision =
      options.defaultUnknownDecision ||
      DECISION.DENY;

    this.allowHighImpact =
      options.allowHighImpact === true;

    this.allowDestructive =
      options.allowDestructive === true;

    this.allowSensitiveInput =
      options.allowSensitiveInput === true;
  }

  // ==========================================================
  // GET POLICY
  // ==========================================================

  getPolicy(tool) {
    const name =
      normalizeTool(tool);

    const policy =
      this.policy[name];

    if (!policy) {
      return null;
    }

    return {
      tool: name,
      ...policy,
    };
  }

  // ==========================================================
  // CHECK IF REGISTERED IN POLICY
  // ==========================================================

  hasPolicy(tool) {
    return Boolean(
      this.policy[
        normalizeTool(tool)
      ]
    );
  }

  // ==========================================================
  // LIST POLICIES
  // ==========================================================

  listPolicies() {
    return Object.entries(
      this.policy
    ).map(
      ([tool, policy]) => ({
        tool,
        ...policy,
      })
    );
  }

  // ==========================================================
  // RISK CALCULATION
  // ==========================================================

  calculateRisk(
    tool,
    args = {}
  ) {
    const name =
      normalizeTool(tool);

    const policy =
      this.policy[name];

    if (!policy) {
      return RISK.HIGH;
    }

    let risk =
      policy.risk;

    const flattened =
      flattenValues(
        safeObject(args)
      ).join(" ");

    // --------------------------------------------------------
    // Sensitive information
    // --------------------------------------------------------

    if (
      containsPattern(
        flattened,
        SENSITIVE_DATA_PATTERNS
      )
    ) {
      if (
        !this.allowSensitiveInput
      ) {
        return RISK.HIGH;
      }
    }

    // --------------------------------------------------------
    // High-impact action
    // --------------------------------------------------------

    if (
      containsPattern(
        flattened,
        HIGH_IMPACT_PATTERNS
      )
    ) {
      if (
        risk === RISK.READ ||
        risk === RISK.LOW ||
        risk === RISK.MEDIUM
      ) {
        risk =
          RISK.HIGH;
      }
    }

    return risk;
  }

  // ==========================================================
  // DECISION
  // ==========================================================

  decide({
    tool,
    args = {},
    confirmed = false,
    executionContext = {},
  } = {}) {
    const name =
      normalizeTool(tool);

    const policy =
      this.policy[name];

    // --------------------------------------------------------
    // Unknown tool = deny
    // --------------------------------------------------------

    if (!policy) {
      return {
        allowed: false,
        decision:
          this.defaultUnknownDecision,
        reason:
          `No permission policy exists for tool '${name}'.`,
        tool: name,
        risk: RISK.HIGH,
        requiresConfirmation: true,
      };
    }

    const risk =
      this.calculateRisk(
        name,
        args
      );

    // --------------------------------------------------------
    // Destructive
    // --------------------------------------------------------

    if (
      risk ===
      RISK.DESTRUCTIVE
    ) {
      if (
        !this.allowDestructive
      ) {
        return {
          allowed: false,
          decision:
            confirmed
              ? DECISION.DENY
              : DECISION.CONFIRM,
          reason:
            confirmed
              ? "Destructive action is disabled by ALEX policy."
              : "Destructive action requires explicit confirmation.",
          tool: name,
          risk,
          requiresConfirmation: true,
        };
      }

      if (!confirmed) {
        return {
          allowed: false,
          decision:
            DECISION.CONFIRM,
          reason:
            "Explicit confirmation is required for destructive action.",
          tool: name,
          risk,
          requiresConfirmation: true,
        };
      }
    }

    // --------------------------------------------------------
    // High impact
    // --------------------------------------------------------

    if (
      risk ===
      RISK.HIGH
    ) {
      if (
        !this.allowHighImpact
      ) {
        return {
          allowed: false,
          decision:
            confirmed
              ? DECISION.DENY
              : DECISION.CONFIRM,
          reason:
            confirmed
              ? "High-impact action is disabled by ALEX policy."
              : "High-impact action requires explicit confirmation.",
          tool: name,
          risk,
          requiresConfirmation: true,
        };
      }

      if (!confirmed) {
        return {
          allowed: false,
          decision:
            DECISION.CONFIRM,
          reason:
            "Explicit confirmation is required for high-impact action.",
          tool: name,
          risk,
          requiresConfirmation: true,
        };
      }
    }

    // --------------------------------------------------------
    // Medium
    // --------------------------------------------------------

    if (
      risk ===
      RISK.MEDIUM
    ) {
      if (
        !confirmed &&
        policy.requiresConfirmation
      ) {
        return {
          allowed: false,
          decision:
            DECISION.CONFIRM,
          reason:
            "This action requires confirmation before execution.",
          tool: name,
          risk,
          requiresConfirmation: true,
        };
      }
    }

    // --------------------------------------------------------
    // Normal allow
    // --------------------------------------------------------

    return {
      allowed: true,
      decision:
        DECISION.ALLOW,
      reason:
        "Action is permitted by ALEX policy.",
      tool: name,
      risk,
      requiresConfirmation: false,
      executionContext:
        executionContext || {},
    };
  }

  // ==========================================================
  // ASSERT
  // ==========================================================

  assertAllowed(options = {}) {
    const result =
      this.decide(
        options
      );

    if (
      !result.allowed
    ) {
      const error =
        new Error(
          result.reason
        );

      error.code =
        result.decision ===
        DECISION.CONFIRM
          ? "ALEX_CONFIRMATION_REQUIRED"
          : "ALEX_PERMISSION_DENIED";

      error.permission =
        result;

      throw error;
    }

    return result;
  }

  // ==========================================================
  // CAN EXECUTE
  // ==========================================================

  canExecute(options = {}) {
    return this.decide(
      options
    ).allowed;
  }

  // ==========================================================
  // CONFIRMATION PAYLOAD
  // ==========================================================

  buildConfirmationRequest({
    tool,
    args = {},
    reason = "",
  } = {}) {
    const name =
      normalizeTool(tool);

    const risk =
      this.calculateRisk(
        name,
        args
      );

    const policy =
      this.policy[name];

    return {
      type:
        "agent-action-confirmation",

      version:
        this.version,

      tool:
        name,

      risk,

      reason:
        safeString(
          reason
        ) ||
        policy?.description ||
        "ALEX wants to execute an agent action.",

      action:
        policy?.description ||
        "Agent action",

      requiresExplicitConfirmation:
        true,

      createdAt:
        new Date().toISOString(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAgentPermissionManager(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentPermissionManager(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET FOR TESTS
// ============================================================

function resetAgentPermissionManager() {
  instance = null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  PERMISSION_VERSION,

  RISK,

  DECISION,

  DEFAULT_TOOL_POLICY,

  AgentPermissionManager,

  getAgentPermissionManager,

  resetAgentPermissionManager,
};