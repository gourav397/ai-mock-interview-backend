// ============================================================
// ALEX — Agent Capability Manager
// Version: 1.0.0
// Purpose:
//   Central registry for ALEX capabilities.
//
// This file does NOT execute tools.
// It only describes and manages what ALEX can do.
// Actual execution remains with:
//   AgentToolRegistry
//   AgentPermissionManager
//   AgentOrchestrator
// ============================================================

"use strict";

const CAPABILITY_MANAGER_VERSION = "1.0.0";

// ============================================================
// CAPABILITY STATUS
// ============================================================

const CAPABILITY_STATUS = Object.freeze({
  AVAILABLE: "available",
  PLANNED: "planned",
  DISABLED: "disabled",
  RESTRICTED: "restricted",
});

// ============================================================
// CAPABILITY CATEGORIES
// ============================================================

const CAPABILITY_CATEGORY = Object.freeze({
  COMPUTER: "computer",
  BROWSER: "browser",
  FILES: "files",
  DOCUMENTS: "documents",
  FORMS: "forms",
  WEB: "web",
  COMMUNICATION: "communication",
  SYSTEM: "system",
  MEMORY: "memory",
  AUTONOMOUS: "autonomous",
  VERIFICATION: "verification",
});

// ============================================================
// DEFAULT CAPABILITIES
// ============================================================

const DEFAULT_CAPABILITIES = [
  // ----------------------------------------------------------
  // COMPUTER
  // ----------------------------------------------------------

  {
    id: "computer",
    name: "Computer Control",
    category: CAPABILITY_CATEGORY.COMPUTER,
    description:
      "Interact with the authorized computer through mouse, keyboard, applications and screen.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [
      "apps.launch",
      "apps.list_running",
      "apps.close",
      "screen.capture_and_analyze",
      "input.click",
      "input.double_click",
      "input.right_click",
      "input.move",
      "input.scroll",
      "input.drag",
      "input.type_text",
      "input.press",
      "input.hotkey",
      "input.run_macro",
    ],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // FILES
  // ----------------------------------------------------------

  {
    id: "files",
    name: "File Management",
    category: CAPABILITY_CATEGORY.FILES,
    description:
      "Read, create, modify, search, move and delete authorized project files.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [
      "fs.read",
      "fs.write",
      "fs.delete",
      "fs.move",
      "fs.search",
    ],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // SYSTEM
  // ----------------------------------------------------------

  {
    id: "system",
    name: "System Information",
    category: CAPABILITY_CATEGORY.SYSTEM,
    description:
      "Inspect authorized system information, battery, processes and network status.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [
      "sys.sysinfo",
      "sys.battery",
      "sys.top_processes",
      "sys.network_status",
    ],
    requiresConfirmation: false,
  },

  // ----------------------------------------------------------
  // BROWSER
  // ----------------------------------------------------------

  {
    id: "browser",
    name: "Browser Agent",
    category: CAPABILITY_CATEGORY.BROWSER,
    description:
      "Future browser automation capability for navigating authorized websites and interacting with web pages.",
    status: CAPABILITY_STATUS.PLANNED,
    tools: [],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // WEB
  // ----------------------------------------------------------

  {
    id: "web",
    name: "Web Research",
    category: CAPABILITY_CATEGORY.WEB,
    description:
      "Future web research capability for collecting and analyzing information from authorized web sources.",
    status: CAPABILITY_STATUS.PLANNED,
    tools: [],
    requiresConfirmation: false,
  },

  // ----------------------------------------------------------
  // FORMS
  // ----------------------------------------------------------

  {
    id: "forms",
    name: "Form Agent",
    category: CAPABILITY_CATEGORY.FORMS,
    description:
      "Future capability for filling forms using information explicitly provided or authorized by the user.",
    status: CAPABILITY_STATUS.PLANNED,
    tools: [],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // DOCUMENTS
  // ----------------------------------------------------------

  {
    id: "documents",
    name: "Document Agent",
    category: CAPABILITY_CATEGORY.DOCUMENTS,
    description:
      "Future capability for creating, reading, editing and organizing authorized documents.",
    status: CAPABILITY_STATUS.PLANNED,
    tools: [],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // COMMUNICATION
  // ----------------------------------------------------------

  {
    id: "communication",
    name: "Communication Agent",
    category: CAPABILITY_CATEGORY.COMMUNICATION,
    description:
      "Future capability for preparing and, when explicitly authorized, sending communications.",
    status: CAPABILITY_STATUS.PLANNED,
    tools: [],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // MEMORY
  // ----------------------------------------------------------

  {
    id: "memory",
    name: "Persistent Memory",
    category: CAPABILITY_CATEGORY.MEMORY,
    description:
      "Use ALEX memory systems to retain useful task and conversation context.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [],
    requiresConfirmation: false,
  },

  // ----------------------------------------------------------
  // AUTONOMOUS TASKS
  // ----------------------------------------------------------

  {
    id: "autonomous",
    name: "Autonomous Task Execution",
    category: CAPABILITY_CATEGORY.AUTONOMOUS,
    description:
      "Plan and execute multi-step tasks with recovery and verification.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [],
    requiresConfirmation: true,
  },

  // ----------------------------------------------------------
  // VERIFICATION
  // ----------------------------------------------------------

  {
    id: "verification",
    name: "Task Verification",
    category: CAPABILITY_CATEGORY.VERIFICATION,
    description:
      "Verify whether completed actions produced the expected result.",
    status: CAPABILITY_STATUS.AVAILABLE,
    tools: [],
    requiresConfirmation: false,
  },
];

// ============================================================
// HELPERS
// ============================================================

function cloneCapability(capability) {
  return {
    ...capability,
    tools: Array.isArray(capability.tools)
      ? [...capability.tools]
      : [],
  };
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function assertCapabilityId(id) {
  const normalized = normalizeId(id);

  if (!normalized) {
    throw new Error("Capability id is required");
  }

  return normalized;
}

// ============================================================
// AGENT CAPABILITY MANAGER
// ============================================================

class AgentCapabilityManager {
  constructor(options = {}) {
    this.version = CAPABILITY_MANAGER_VERSION;

    this.capabilities = new Map();

    this.enabled = options.enabled !== false;

    this._loadDefaults();

    if (Array.isArray(options.capabilities)) {
      for (const capability of options.capabilities) {
        this.register(capability);
      }
    }
  }

  // ==========================================================
  // DEFAULT LOADER
  // ==========================================================

  _loadDefaults() {
    for (const capability of DEFAULT_CAPABILITIES) {
      this.register(capability);
    }
  }

  // ==========================================================
  // REGISTER
  // ==========================================================

  register(capability) {
    if (!capability || typeof capability !== "object") {
      throw new Error("Capability must be an object");
    }

    const id = assertCapabilityId(capability.id);

    if (!capability.name) {
      throw new Error(`Capability "${id}" requires a name`);
    }

    const normalized = {
      id,
      name: String(capability.name),
      category:
        capability.category ||
        CAPABILITY_CATEGORY.SYSTEM,
      description:
        capability.description ||
        "",
      status:
        capability.status ||
        CAPABILITY_STATUS.PLANNED,
      tools: Array.isArray(capability.tools)
        ? [...new Set(capability.tools.map(String))]
        : [],
      requiresConfirmation:
        capability.requiresConfirmation === true,
      metadata:
        capability.metadata &&
        typeof capability.metadata === "object"
          ? { ...capability.metadata }
          : {},
    };

    this.capabilities.set(id, normalized);

    return cloneCapability(normalized);
  }

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(id, updates = {}) {
    const normalizedId = assertCapabilityId(id);

    const existing = this.capabilities.get(normalizedId);

    if (!existing) {
      throw new Error(
        `Capability "${normalizedId}" does not exist`
      );
    }

    const updated = {
      ...existing,
      ...updates,
      id: normalizedId,
      tools: Array.isArray(updates.tools)
        ? [...new Set(updates.tools.map(String))]
        : [...existing.tools],
      metadata:
        updates.metadata &&
        typeof updates.metadata === "object"
          ? {
              ...existing.metadata,
              ...updates.metadata,
            }
          : {
              ...existing.metadata,
            },
    };

    this.capabilities.set(normalizedId, updated);

    return cloneCapability(updated);
  }

  // ==========================================================
  // REMOVE
  // ==========================================================

  remove(id) {
    const normalizedId = assertCapabilityId(id);

    return this.capabilities.delete(normalizedId);
  }

  // ==========================================================
  // GET
  // ==========================================================

  get(id) {
    const normalizedId = assertCapabilityId(id);

    const capability = this.capabilities.get(normalizedId);

    return capability
      ? cloneCapability(capability)
      : null;
  }

  // ==========================================================
  // HAS
  // ==========================================================

  has(id) {
    const normalizedId = normalizeId(id);

    if (!normalizedId) {
      return false;
    }

    return this.capabilities.has(normalizedId);
  }

  // ==========================================================
  // ENABLE / DISABLE MANAGER
  // ==========================================================

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  // ==========================================================
  // ENABLE CAPABILITY
  // ==========================================================

  enable(id) {
    return this.update(id, {
      status: CAPABILITY_STATUS.AVAILABLE,
    });
  }

  // ==========================================================
  // DISABLE CAPABILITY
  // ==========================================================

  disable(id) {
    return this.update(id, {
      status: CAPABILITY_STATUS.DISABLED,
    });
  }

  // ==========================================================
  // RESTRICT CAPABILITY
  // ==========================================================

  restrict(id) {
    return this.update(id, {
      status: CAPABILITY_STATUS.RESTRICTED,
    });
  }

  // ==========================================================
  // MARK AS PLANNED
  // ==========================================================

  markPlanned(id) {
    return this.update(id, {
      status: CAPABILITY_STATUS.PLANNED,
    });
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus(id) {
    const capability = this.get(id);

    return capability
      ? capability.status
      : null;
  }

  // ==========================================================
  // IS AVAILABLE
  // ==========================================================

  isAvailable(id) {
    if (!this.enabled) {
      return false;
    }

    return (
      this.getStatus(id) ===
      CAPABILITY_STATUS.AVAILABLE
    );
  }

  // ==========================================================
  // IS PLANNED
  // ==========================================================

  isPlanned(id) {
    return (
      this.getStatus(id) ===
      CAPABILITY_STATUS.PLANNED
    );
  }

  // ==========================================================
  // LIST
  // ==========================================================

  list(options = {}) {
    let capabilities = Array.from(
      this.capabilities.values()
    );

    if (options.category) {
      const category = String(options.category);

      capabilities = capabilities.filter(
        (item) => item.category === category
      );
    }

    if (options.status) {
      const status = String(options.status);

      capabilities = capabilities.filter(
        (item) => item.status === status
      );
    }

    return capabilities.map(cloneCapability);
  }

  // ==========================================================
  // LIST AVAILABLE
  // ==========================================================

  listAvailable() {
    return this.list({
      status: CAPABILITY_STATUS.AVAILABLE,
    });
  }

  // ==========================================================
  // LIST PLANNED
  // ==========================================================

  listPlanned() {
    return this.list({
      status: CAPABILITY_STATUS.PLANNED,
    });
  }

  // ==========================================================
  // LIST TOOLS
  // ==========================================================

  getTools(id) {
    const capability = this.get(id);

    if (!capability) {
      return [];
    }

    return [...capability.tools];
  }

  // ==========================================================
  // FIND CAPABILITY BY TOOL
  // ==========================================================

  findByTool(toolName) {
    const tool = String(toolName || "").trim();

    if (!tool) {
      return [];
    }

    return this.list().filter((capability) =>
      capability.tools.includes(tool)
    );
  }

  // ==========================================================
  // TOOL SUPPORT CHECK
  // ==========================================================

  supportsTool(capabilityId, toolName) {
    const capability = this.get(capabilityId);

    if (!capability) {
      return false;
    }

    return capability.tools.includes(
      String(toolName || "").trim()
    );
  }

  // ==========================================================
  // CONFIRMATION REQUIREMENT
  // ==========================================================

  requiresConfirmation(id) {
    const capability = this.get(id);

    return Boolean(
      capability &&
      capability.requiresConfirmation
    );
  }

  // ==========================================================
  // CAN USE CAPABILITY
  // ==========================================================

  canUse(id) {
    if (!this.enabled) {
      return {
        allowed: false,
        reason: "Capability manager is disabled",
      };
    }

    const capability = this.get(id);

    if (!capability) {
      return {
        allowed: false,
        reason: `Unknown capability: ${id}`,
      };
    }

    if (
      capability.status ===
      CAPABILITY_STATUS.AVAILABLE
    ) {
      return {
        allowed: true,
        capability,
      };
    }

    if (
      capability.status ===
      CAPABILITY_STATUS.RESTRICTED
    ) {
      return {
        allowed: false,
        reason: "Capability is restricted",
        capability,
      };
    }

    if (
      capability.status ===
      CAPABILITY_STATUS.DISABLED
    ) {
      return {
        allowed: false,
        reason: "Capability is disabled",
        capability,
      };
    }

    return {
      allowed: false,
      reason: "Capability is not implemented yet",
      capability,
    };
  }

  // ==========================================================
  // CAPABILITY SUMMARY
  // ==========================================================

  getSummary() {
    const all = this.list();

    const summary = {
      version: this.version,
      enabled: this.enabled,
      total: all.length,
      available: 0,
      planned: 0,
      disabled: 0,
      restricted: 0,
      categories: {},
    };

    for (const capability of all) {
      if (
        Object.prototype.hasOwnProperty.call(
          summary,
          capability.status
        )
      ) {
        summary[capability.status] += 1;
      }

      if (!summary.categories[capability.category]) {
        summary.categories[capability.category] = 0;
      }

      summary.categories[capability.category] += 1;
    }

    return summary;
  }

  // ==========================================================
  // EXPORT
  // ==========================================================

  toJSON() {
    return {
      version: this.version,
      enabled: this.enabled,
      capabilities: this.list(),
      summary: this.getSummary(),
    };
  }

  // ==========================================================
  // RESET TO DEFAULTS
  // ==========================================================

  reset() {
    this.capabilities.clear();

    this._loadDefaults();

    return this.toJSON();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let capabilityManagerInstance = null;

function getAgentCapabilityManager(options = {}) {
  if (!capabilityManagerInstance) {
    capabilityManagerInstance =
      new AgentCapabilityManager(options);
  }

  return capabilityManagerInstance;
}

function resetAgentCapabilityManager(options = {}) {
  capabilityManagerInstance =
    new AgentCapabilityManager(options);

  return capabilityManagerInstance;
}

// ============================================================
// FACTORY
// ============================================================

function createAgentCapabilityManager(options = {}) {
  return new AgentCapabilityManager(options);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentCapabilityManager,
  getAgentCapabilityManager,
  resetAgentCapabilityManager,
  createAgentCapabilityManager,

  CAPABILITY_MANAGER_VERSION,
  CAPABILITY_STATUS,
  CAPABILITY_CATEGORY,
  DEFAULT_CAPABILITIES,
};