// ============================================================
// ALEX — COMPUTER USE BRIDGE
// Version: 1.0.0
//
// PURPOSE:
//   ALEX ke new Agent Runtime ko authorized Windows computer
//   capabilities ke saath connect karna.
//
// ARCHITECTURE:
//
//   ALEX
//     ↓
//   AgentComputerBridge
//     ↓
//   AgentRuntime
//     ↓
//   AgentOrchestrator
//     ↓
//   PermissionManager
//     ↓
//   AgentToolRegistry
//     ↓
//   WindowsAgent
//
// SUPPORTED CAPABILITIES:
//
//   • Screen capture / screen analysis
//   • Mouse click
//   • Double click
//   • Right click
//   • Mouse move
//   • Scroll
//   • Drag
//   • Type text
//   • Keyboard press
//   • Keyboard hotkey
//   • Structured macro
//   • Open application
//   • Close application
//   • Running applications
//   • File read/write/search/move/delete
//   • System information
//   • Battery
//   • Network status
//   • Top processes
//
// SECURITY:
//
//   • No arbitrary Windows commands.
//   • No arbitrary Python execution.
//   • No arbitrary shell execution.
//   • All tools pass through AgentRuntime.
//   • PermissionManager remains authoritative.
//   • Confirmation is preserved.
// ============================================================

"use strict";

const {
  getAgentRuntime,
} = require("./AgentRuntime");

const {
  getAgentExecutionContext,
} = require("./AgentExecutionContext");

const {
  getAgentToolRegistry,
} = require("./AgentToolRegistry");

// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "1.0.0";

const MAX_TEXT_LENGTH = 200000;
const MAX_MACRO_STEPS = 50;

const SUPPORTED_TOOLS = Object.freeze([
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

  "apps.launch",
  "apps.list_running",
  "apps.close",

  "fs.read",
  "fs.write",
  "fs.search",
  "fs.move",
  "fs.delete",

  "sys.sysinfo",
  "sys.battery",
  "sys.top_processes",
  "sys.network_status",
]);

// ============================================================
// HELPERS
// ============================================================

function safeString(
  value,
  fallback = ""
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value);
}

function cleanText(
  value,
  maxLength = MAX_TEXT_LENGTH
) {
  return safeString(value)
    .replace(/\u0000/g, "")
    .slice(0, maxLength);
}

function requireFiniteNumber(
  value,
  name
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(
      `${name} must be a valid number.`
    );
  }

  return number;
}

function requireString(
  value,
  name
) {
  const result =
    cleanText(value).trim();

  if (!result) {
    throw new Error(
      `${name} is required.`
    );
  }

  return result;
}

function requireObject(
  value,
  name
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `${name} must be an object.`
    );
  }

  return value;
}

function requireArray(
  value,
  name
) {
  if (!Array.isArray(value)) {
    throw new Error(
      `${name} must be an array.`
    );
  }

  return value;
}

// ============================================================
// COMPUTER BRIDGE
// ============================================================

class AgentComputerBridge {
  constructor(options = {}) {
    this.version =
      VERSION;

    this.runtime =
      options.runtime ||
      getAgentRuntime();

    this.registry =
      options.registry ||
      getAgentToolRegistry();

    this.executionContextFactory =
      options.executionContextFactory ||
      getAgentExecutionContext;

    this.stats = {
      calls: 0,
      successful: 0,
      failed: 0,
      confirmations: 0,
      denied: 0,
    };
  }

  // ==========================================================
  // CONTEXT
  // ==========================================================

  createContext({
    ownerId = null,
    sessionId = null,
    goal = "",
    agentToken = "",
    metadata = {},
  } = {}) {
    const safeGoal =
      cleanText(
        goal,
        10000
      ).trim();

    return this.executionContextFactory({
      ownerId:
        ownerId || null,

      sessionId:
        sessionId || null,

      goal:
        safeGoal ||
        "ALEX computer action",

      agentToken:
        safeString(
          agentToken
        ),

      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {},
    });
  }

  // ==========================================================
  // GENERIC TOOL EXECUTION
  // ==========================================================

  async execute({
    ownerId = null,
    sessionId = null,
    goal = "",
    agentToken = "",
    tool,
    args = {},
    confirmed = false,
    confirmationReason = "",
    metadata = {},
  } = {}) {
    this.stats.calls += 1;

    const toolName =
      requireString(
        tool,
        "Computer tool"
      );

    if (
      !SUPPORTED_TOOLS.includes(
        toolName
      )
    ) {
      throw new Error(
        `Computer tool '${toolName}' is not supported.`
      );
    }

    if (
      !agentToken
    ) {
      throw new Error(
        "WindowsAgent token is required."
      );
    }

    requireObject(
      args,
      "Tool arguments"
    );

    const context =
      this.createContext({
        ownerId,
        sessionId,
        goal:
          goal ||
          `ALEX computer action: ${toolName}`,
        agentToken,
        metadata,
      });

    try {
      const result =
        await this.runtime.executeTool(
          context,
          toolName,
          args,
          {
            confirmed:
              confirmed === true,

            confirmationReason:
              confirmationReason ||
              "",
          }
        );

      if (
        result?.requiresConfirmation
      ) {
        this.stats.confirmations += 1;

        return {
          success: false,

          status:
            "waiting_confirmation",

          requiresConfirmation:
            true,

          tool:
            toolName,

          result,
        };
      }

      if (
        result?.decision ===
        "deny"
      ) {
        this.stats.denied += 1;

        return {
          success: false,

          status:
            "denied",

          tool:
            toolName,

          result,
        };
      }

      if (
        result?.success === true
      ) {
        this.stats.successful += 1;
      } else {
        this.stats.failed += 1;
      }

      return {
        success:
          result?.success === true,

        status:
          result?.success === true
            ? "completed"
            : "failed",

        tool:
          toolName,

        result,
      };
    } catch (error) {
      this.stats.failed += 1;

      return {
        success: false,

        status:
          "failed",

        tool:
          toolName,

        error:
          error?.message ||
          String(error),
      };
    }
  }

  // ==========================================================
  // SCREEN
  // ==========================================================

  async captureScreen({
    ownerId,
    sessionId,
    agentToken,
    question = "Describe the current visible screen.",
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Capture and analyze the current screen.",

      tool:
        "screen.capture_and_analyze",

      args: {
        question:
          cleanText(
            question,
            5000
          ) ||
          "Describe the current visible screen.",
      },

      confirmed,
    });
  }

  // ==========================================================
  // MOUSE
  // ==========================================================

  async click({
    ownerId,
    sessionId,
    agentToken,
    x,
    y,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Click the authorized computer screen.",

      tool:
        "input.click",

      args: {
        x:
          requireFiniteNumber(
            x,
            "x"
          ),

        y:
          requireFiniteNumber(
            y,
            "y"
          ),
      },

      confirmed,
    });
  }

  async doubleClick({
    ownerId,
    sessionId,
    agentToken,
    x,
    y,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Double-click the authorized computer screen.",

      tool:
        "input.double_click",

      args: {
        x:
          requireFiniteNumber(
            x,
            "x"
          ),

        y:
          requireFiniteNumber(
            y,
            "y"
          ),
      },

      confirmed,
    });
  }

  async rightClick({
    ownerId,
    sessionId,
    agentToken,
    x,
    y,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Right-click the authorized computer screen.",

      tool:
        "input.right_click",

      args: {
        x:
          requireFiniteNumber(
            x,
            "x"
          ),

        y:
          requireFiniteNumber(
            y,
            "y"
          ),
      },

      confirmed,
    });
  }

  async moveMouse({
    ownerId,
    sessionId,
    agentToken,
    x,
    y,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Move the mouse on the authorized computer.",

      tool:
        "input.move",

      args: {
        x:
          requireFiniteNumber(
            x,
            "x"
          ),

        y:
          requireFiniteNumber(
            y,
            "y"
          ),
      },

      confirmed,
    });
  }

  async scroll({
    ownerId,
    sessionId,
    agentToken,
    amount,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Scroll the authorized computer.",

      tool:
        "input.scroll",

      args: {
        amount:
          requireFiniteNumber(
            amount,
            "amount"
          ),
      },

      confirmed,
    });
  }

  async drag({
    ownerId,
    sessionId,
    agentToken,
    fromX,
    fromY,
    toX,
    toY,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Drag on the authorized computer.",

      tool:
        "input.drag",

      args: {
        from_x:
          requireFiniteNumber(
            fromX,
            "fromX"
          ),

        from_y:
          requireFiniteNumber(
            fromY,
            "fromY"
          ),

        to_x:
          requireFiniteNumber(
            toX,
            "toX"
          ),

        to_y:
          requireFiniteNumber(
            toY,
            "toY"
          ),
      },

      confirmed,
    });
  }

  // ==========================================================
  // KEYBOARD
  // ==========================================================

  async typeText({
    ownerId,
    sessionId,
    agentToken,
    text,
    confirmed = false,
  } = {}) {
    const value =
      cleanText(
        text
      );

    if (!value) {
      throw new Error(
        "Text is required."
      );
    }

    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Type text into the currently focused authorized application.",

      tool:
        "input.type_text",

      args: {
        text:
          value,
      },

      confirmed,
    });
  }

  async pressKey({
    ownerId,
    sessionId,
    agentToken,
    key,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Press a keyboard key on the authorized computer.",

      tool:
        "input.press",

      args: {
        key:
          requireString(
            key,
            "key"
          ),
      },

      confirmed,
    });
  }

  async hotkey({
    ownerId,
    sessionId,
    agentToken,
    keys,
    confirmed = false,
  } = {}) {
    const keyList =
      requireArray(
        keys,
        "keys"
      );

    if (
      keyList.length ===
      0
    ) {
      throw new Error(
        "At least one key is required."
      );
    }

    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Press a keyboard shortcut on the authorized computer.",

      tool:
        "input.hotkey",

      args: {
        keys:
          keyList,
      },

      confirmed,
    });
  }

  // ==========================================================
  // MACRO
  // ==========================================================

  async runMacro({
    ownerId,
    sessionId,
    agentToken,
    steps,
    confirmed = false,
  } = {}) {
    const macro =
      requireArray(
        steps,
        "steps"
      );

    if (
      macro.length ===
      0
    ) {
      throw new Error(
        "Macro must contain at least one step."
      );
    }

    if (
      macro.length >
      MAX_MACRO_STEPS
    ) {
      throw new Error(
        `Macro cannot contain more than ${MAX_MACRO_STEPS} steps.`
      );
    }

    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Run a structured automation macro on the authorized computer.",

      tool:
        "input.run_macro",

      args: {
        steps:
          macro,
      },

      confirmed,
    });
  }

  // ==========================================================
  // APPLICATIONS
  // ==========================================================

  async launchApp({
    ownerId,
    sessionId,
    agentToken,
    name,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        `Open the authorized application ${safeString(name)}.`,

      tool:
        "apps.launch",

      args: {
        name:
          requireString(
            name,
            "Application name"
          ),
      },

      confirmed,
    });
  }

  async listRunningApps({
    ownerId,
    sessionId,
    agentToken,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "List currently running applications.",

      tool:
        "apps.list_running",

      args: {},
    });
  }

  async closeApp({
    ownerId,
    sessionId,
    agentToken,
    nameOrPid,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        `Close the authorized application ${safeString(nameOrPid)}.`,

      tool:
        "apps.close",

      args: {
        name_or_pid:
          requireString(
            nameOrPid,
            "Application or PID"
          ),
      },

      confirmed,
    });
  }

  // ==========================================================
  // FILES
  // ==========================================================

  async readFile({
    ownerId,
    sessionId,
    agentToken,
    path,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Read an authorized file.",

      tool:
        "fs.read",

      args: {
        path:
          requireString(
            path,
            "File path"
          ),
      },
    });
  }

  async writeFile({
    ownerId,
    sessionId,
    agentToken,
    path,
    content,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Write an authorized file.",

      tool:
        "fs.write",

      args: {
        path:
          requireString(
            path,
            "File path"
          ),

        content:
          cleanText(
            content
          ),
      },

      confirmed,
    });
  }

  async searchFiles({
    ownerId,
    sessionId,
    agentToken,
    root = ".",
    pattern,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Search authorized files.",

      tool:
        "fs.search",

      args: {
        root:
          requireString(
            root,
            "Search root"
          ),

        pattern:
          requireString(
            pattern,
            "Search pattern"
          ),
      },
    });
  }

  async moveFile({
    ownerId,
    sessionId,
    agentToken,
    src,
    dst,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Move an authorized file.",

      tool:
        "fs.move",

      args: {
        src:
          requireString(
            src,
            "Source path"
          ),

        dst:
          requireString(
            dst,
            "Destination path"
          ),
      },

      confirmed,
    });
  }

  async deleteFile({
    ownerId,
    sessionId,
    agentToken,
    path,
    confirmed = false,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Delete an authorized file.",

      tool:
        "fs.delete",

      args: {
        path:
          requireString(
            path,
            "File path"
          ),
      },

      confirmed,
    });
  }

  // ==========================================================
  // SYSTEM
  // ==========================================================

  async systemInfo({
    ownerId,
    sessionId,
    agentToken,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Read authorized system information.",

      tool:
        "sys.sysinfo",

      args: {},
    });
  }

  async battery({
    ownerId,
    sessionId,
    agentToken,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Read authorized battery information.",

      tool:
        "sys.battery",

      args: {},
    });
  }

  async topProcesses({
    ownerId,
    sessionId,
    agentToken,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Inspect top authorized system processes.",

      tool:
        "sys.top_processes",

      args: {},
    });
  }

  async networkStatus({
    ownerId,
    sessionId,
    agentToken,
  } = {}) {
    return this.execute({
      ownerId,
      sessionId,
      agentToken,

      goal:
        "Read authorized local network status.",

      tool:
        "sys.network_status",

      args: {},
    });
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  getCapabilities() {
    if (
      this.registry &&
      typeof this.registry.list ===
        "function"
    ) {
      return this.registry.list({
        includeSensitive: true,
      });
    }

    return SUPPORTED_TOOLS.map(
      (name) => ({
        name,
      })
    );
  }

  hasTool(tool) {
    return SUPPORTED_TOOLS.includes(
      safeString(tool)
    );
  }

  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      version:
        this.version,

      capabilities:
        SUPPORTED_TOOLS.slice(),

      runtime:
        Boolean(this.runtime),

      registry:
        Boolean(this.registry),

      stats:
        {
          ...this.stats,
        },
    };
  }

  getStats() {
    return {
      version:
        this.version,

      ...this.stats,
    };
  }

  resetStats() {
    this.stats = {
      calls: 0,
      successful: 0,
      failed: 0,
      confirmations: 0,
      denied: 0,
    };

    return this.getStats();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let singleton = null;

function createAgentComputerBridge(
  options = {}
) {
  return new AgentComputerBridge(
    options
  );
}

function getAgentComputerBridge(
  options = {}
) {
  if (!singleton) {
    singleton =
      createAgentComputerBridge(
        options
      );
  }

  return singleton;
}

function resetAgentComputerBridge() {
  singleton = null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  SUPPORTED_TOOLS,

  AgentComputerBridge,

  createAgentComputerBridge,

  getAgentComputerBridge,

  resetAgentComputerBridge,
};