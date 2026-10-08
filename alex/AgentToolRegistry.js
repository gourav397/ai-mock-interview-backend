// ============================================================
// ALEX AGENT TOOL REGISTRY
// Version: 1.0.0
//
// Purpose:
//   Central registry for ALEX's authorized external-agent tools.
//
// Current backend agent:
//   ../windowsAgentTool.js
//
// Current WindowsAgent modules:
//   fs
//   apps
//   sys
//   screen
//   input
//
// Design:
//   - No arbitrary tool names
//   - No arbitrary module/function execution
//   - Every tool must be explicitly registered
//   - Arguments are validated before reaching WindowsAgent
//   - Sensitive actions remain protected by WindowsAgent's gate
//   - Does NOT bypass confirmation/allowlist
// ============================================================

"use strict";

const {
  callAgent,
} = require("../windowsAgentTool");

// ============================================================
// CONSTANTS
// ============================================================

const REGISTRY_VERSION = "1.0.0";

const MAX_TEXT_LENGTH = 200000;
const MAX_ARRAY_ITEMS = 100;
const MAX_MACRO_STEPS = 50;

// ============================================================
// HELPERS
// ============================================================

function safeString(value, fallback = "") {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim();
}

function requireObject(value, name) {
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

function requireNumber(
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
  name,
  maxLength = MAX_TEXT_LENGTH
) {
  const result =
    safeString(value);

  if (!result) {
    throw new Error(
      `${name} is required.`
    );
  }

  if (
    result.length >
    maxLength
  ) {
    throw new Error(
      `${name} exceeds the maximum allowed length.`
    );
  }

  return result;
}

function optionalBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  if (
    typeof value !== "boolean"
  ) {
    throw new Error(
      "Boolean argument expected."
    );
  }

  return value;
}

function cleanArgs(args) {
  if (
    args === undefined ||
    args === null
  ) {
    return {};
  }

  requireObject(
    args,
    "Tool arguments"
  );

  return {
    ...args,
  };
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================
//
// IMPORTANT:
//
// These names MUST match the Python WindowsAgent modules:
//
//   fs.read
//   fs.write
//   fs.delete
//   fs.move
//   fs.search
//
//   apps.launch
//   apps.list_running
//   apps.close
//
//   sys.sysinfo
//   sys.battery
//   sys.top_processes
//   sys.network_status
//
//   screen.capture_and_analyze
//
//   input.click
//   input.double_click
//   input.right_click
//   input.move
//   input.scroll
//   input.drag
//   input.type_text
//   input.press
//   input.hotkey
//   input.run_macro
//
// No other WindowsAgent tool is accepted.
// ============================================================

const TOOL_DEFINITIONS = Object.freeze({
  // ==========================================================
  // FILE SYSTEM
  // ==========================================================

  "fs.read": {
    name: "fs.read",
    category: "filesystem",
    risk: "read",
    description:
      "Read an authorized Windows file.",
  },

  "fs.write": {
    name: "fs.write",
    category: "filesystem",
    risk: "sensitive",
    description:
      "Write content to an authorized Windows file.",
  },

  "fs.delete": {
    name: "fs.delete",
    category: "filesystem",
    risk: "destructive",
    description:
      "Delete an authorized Windows file.",
  },

  "fs.move": {
    name: "fs.move",
    category: "filesystem",
    risk: "sensitive",
    description:
      "Move an authorized Windows file.",
  },

  "fs.search": {
    name: "fs.search",
    category: "filesystem",
    risk: "read",
    description:
      "Search an authorized filesystem root for matching files.",
  },

  // ==========================================================
  // APPLICATIONS
  // ==========================================================

  "apps.launch": {
    name: "apps.launch",
    category: "applications",
    risk: "sensitive",
    description:
      "Launch an allowlisted Windows application.",
  },

  "apps.list_running": {
    name: "apps.list_running",
    category: "applications",
    risk: "read",
    description:
      "List currently running processes.",
  },

  "apps.close": {
    name: "apps.close",
    category: "applications",
    risk: "sensitive",
    description:
      "Close an application/process.",
  },

  // ==========================================================
  // SYSTEM
  // ==========================================================

  "sys.sysinfo": {
    name: "sys.sysinfo",
    category: "system",
    risk: "read",
    description:
      "Read system information.",
  },

  "sys.battery": {
    name: "sys.battery",
    category: "system",
    risk: "read",
    description:
      "Read battery status.",
  },

  "sys.top_processes": {
    name: "sys.top_processes",
    category: "system",
    risk: "read",
    description:
      "Read the top CPU processes.",
  },

  "sys.network_status": {
    name: "sys.network_status",
    category: "system",
    risk: "read",
    description:
      "Read local network interface status.",
  },

  // ==========================================================
  // SCREEN / VISION
  // ==========================================================

  "screen.capture_and_analyze": {
    name: "screen.capture_and_analyze",
    category: "screen",
    risk: "read",
    description:
      "Capture the authorized computer screen and analyze the visible UI.",
  },

  // ==========================================================
  // MOUSE
  // ==========================================================

  "input.click": {
    name: "input.click",
    category: "input",
    risk: "sensitive",
    description:
      "Click at a screen coordinate.",
  },

  "input.double_click": {
    name: "input.double_click",
    category: "input",
    risk: "sensitive",
    description:
      "Double-click at a screen coordinate.",
  },

  "input.right_click": {
    name: "input.right_click",
    category: "input",
    risk: "sensitive",
    description:
      "Right-click at a screen coordinate.",
  },

  "input.move": {
    name: "input.move",
    category: "input",
    risk: "read",
    description:
      "Move the mouse cursor.",
  },

  "input.scroll": {
    name: "input.scroll",
    category: "input",
    risk: "sensitive",
    description:
      "Scroll the mouse wheel.",
  },

  "input.drag": {
    name: "input.drag",
    category: "input",
    risk: "sensitive",
    description:
      "Drag from one screen coordinate to another.",
  },

  // ==========================================================
  // KEYBOARD
  // ==========================================================

  "input.type_text": {
    name: "input.type_text",
    category: "input",
    risk: "sensitive",
    description:
      "Type text into the currently focused application.",
  },

  "input.press": {
    name: "input.press",
    category: "input",
    risk: "sensitive",
    description:
      "Press a keyboard key.",
  },

  "input.hotkey": {
    name: "input.hotkey",
    category: "input",
    risk: "sensitive",
    description:
      "Press a keyboard key combination.",
  },

  "input.run_macro": {
    name: "input.run_macro",
    category: "input",
    risk: "sensitive",
    description:
      "Run an explicitly structured mouse/keyboard automation macro.",
  },
});

// ============================================================
// ARGUMENT VALIDATORS
// ============================================================

function validateToolArgs(
  tool,
  rawArgs = {}
) {
  const args =
    cleanArgs(rawArgs);

  switch (tool) {
    // ========================================================
    // FILE SYSTEM
    // ========================================================

    case "fs.read":
      return {
        path: requireString(
          args.path,
          "File path"
        ),
      };

    case "fs.write":
      return {
        path: requireString(
          args.path,
          "File path"
        ),

        content:
          typeof args.content ===
          "string"
            ? args.content
            : (() => {
                throw new Error(
                  "File content must be a string."
                );
              })(),
      };

    case "fs.delete":
      return {
        path: requireString(
          args.path,
          "File path"
        ),
      };

    case "fs.move":
      return {
        src: requireString(
          args.src,
          "Source path"
        ),

        dst: requireString(
          args.dst,
          "Destination path"
        ),
      };

    case "fs.search":
      return {
        root: requireString(
          args.root,
          "Search root"
        ),

        pattern: requireString(
          args.pattern,
          "Search pattern",
          500
        ),
      };

    // ========================================================
    // APPLICATIONS
    // ========================================================

    case "apps.launch": {
      const name =
        requireString(
          args.name,
          "Application name",
          300
        );

      let launchArgs =
        args.args;

      if (
        launchArgs ===
        undefined
      ) {
        launchArgs = [];
      }

      if (
        !Array.isArray(
          launchArgs
        )
      ) {
        throw new Error(
          "Application args must be an array."
        );
      }

      if (
        launchArgs.length >
        MAX_ARRAY_ITEMS
      ) {
        throw new Error(
          "Too many application arguments."
        );
      }

      launchArgs =
        launchArgs.map(
          (item) =>
            requireString(
              item,
              "Application argument",
              2000
            )
        );

      return {
        name,
        args: launchArgs,
      };
    }

    case "apps.list_running":
      return {};

    case "apps.close":
      return {
        name_or_pid:
          requireString(
            args.name_or_pid,
            "Application name or PID",
            300
          ),

        force:
          optionalBoolean(
            args.force,
            false
          ),
      };

    // ========================================================
    // SYSTEM
    // ========================================================

    case "sys.sysinfo":
      return {};

    case "sys.battery":
      return {};

    case "sys.top_processes": {
      let count =
        args.count ===
        undefined
          ? 10
          : requireNumber(
              args.count,
              "Process count"
            );

      count =
        Math.min(
          25,
          Math.max(
            1,
            Math.floor(count)
          )
        );

      return {
        count,
      };
    }

    case "sys.network_status":
      return {};

    // ========================================================
    // SCREEN
    // ========================================================

    case "screen.capture_and_analyze":
      return {
        question:
          safeString(
            args.question,
            "Describe the visible UI and relevant clickable elements."
          ).slice(
            0,
            4000
          ),
      };

    // ========================================================
    // MOUSE
    // ========================================================

    case "input.click":
      return {
        x: requireNumber(
          args.x,
          "X coordinate"
        ),

        y: requireNumber(
          args.y,
          "Y coordinate"
        ),

        button:
          safeString(
            args.button,
            "left"
          ).toLowerCase(),

        sensitive:
          optionalBoolean(
            args.sensitive,
            false
          ),
      };

    case "input.double_click":
      return {
        x: requireNumber(
          args.x,
          "X coordinate"
        ),

        y: requireNumber(
          args.y,
          "Y coordinate"
        ),
      };

    case "input.right_click":
      return {
        x: requireNumber(
          args.x,
          "X coordinate"
        ),

        y: requireNumber(
          args.y,
          "Y coordinate"
        ),
      };

    case "input.move":
      return {
        x: requireNumber(
          args.x,
          "X coordinate"
        ),

        y: requireNumber(
          args.y,
          "Y coordinate"
        ),

        duration:
          args.duration ===
          undefined
            ? 0.3
            : Math.max(
                0,
                Math.min(
                  5,
                  requireNumber(
                    args.duration,
                    "Mouse duration"
                  )
                )
              ),
      };

    case "input.scroll":
      return {
        amount:
          Math.max(
            -100,
            Math.min(
              100,
              Math.round(
                requireNumber(
                  args.amount,
                  "Scroll amount"
                )
              )
            )
          ),

        ...(args.x !==
        undefined
          ? {
              x: requireNumber(
                args.x,
                "X coordinate"
              ),
            }
          : {}),

        ...(args.y !==
        undefined
          ? {
              y: requireNumber(
                args.y,
                "Y coordinate"
              ),
            }
          : {}),
      };

    case "input.drag":
      return {
        x1: requireNumber(
          args.x1,
          "Start X"
        ),

        y1: requireNumber(
          args.y1,
          "Start Y"
        ),

        x2: requireNumber(
          args.x2,
          "End X"
        ),

        y2: requireNumber(
          args.y2,
          "End Y"
        ),

        duration:
          args.duration ===
          undefined
            ? 0.5
            : Math.max(
                0,
                Math.min(
                  10,
                  requireNumber(
                    args.duration,
                    "Drag duration"
                  )
                )
              ),
      };

    // ========================================================
    // KEYBOARD
    // ========================================================

    case "input.type_text": {
      const text =
        typeof args.text ===
        "string"
          ? args.text
          : "";

      if (!text) {
        throw new Error(
          "Text to type is required."
        );
      }

      if (
        text.length >
        MAX_TEXT_LENGTH
      ) {
        throw new Error(
          "Typed text exceeds maximum allowed length."
        );
      }

      return {
        text,

        sensitive:
          optionalBoolean(
            args.sensitive,
            false
          ),
      };
    }

    case "input.press":
      return {
        key: requireString(
          args.key,
          "Keyboard key",
          100
        ).toLowerCase(),
      };

    case "input.hotkey": {
      if (
        !Array.isArray(
          args.keys
        )
      ) {
        throw new Error(
          "Hotkey keys must be an array."
        );
      }

      if (
        args.keys.length < 1 ||
        args.keys.length > 8
      ) {
        throw new Error(
          "Hotkey must contain between 1 and 8 keys."
        );
      }

      return {
        keys:
          args.keys.map(
            (key) =>
              requireString(
                key,
                "Hotkey key",
                50
              ).toLowerCase()
          ),
      };
    }

    case "input.run_macro": {
      if (
        !Array.isArray(
          args.steps
        )
      ) {
        throw new Error(
          "Macro steps must be an array."
        );
      }

      if (
        args.steps.length < 1 ||
        args.steps.length >
          MAX_MACRO_STEPS
      ) {
        throw new Error(
          `Macro must contain between 1 and ${MAX_MACRO_STEPS} steps.`
        );
      }

      const steps =
        args.steps.map(
          (step, index) => {
            requireObject(
              step,
              `Macro step ${index + 1}`
            );

            const op =
              requireString(
                step.op,
                `Macro step ${index + 1} operation`,
                100
              );

            const stepArgs =
              step.args ===
              undefined
                ? {}
                : requireObject(
                    step.args,
                    `Macro step ${index + 1} arguments`
                  );

            return {
              op,
              args: stepArgs,
            };
          }
        );

      return {
        steps,

        step_delay:
          args.step_delay ===
          undefined
            ? 0.5
            : Math.max(
                0,
                Math.min(
                  10,
                  requireNumber(
                    args.step_delay,
                    "Macro step delay"
                  )
                )
              ),
      };
    }

    default:
      throw new Error(
        `Unknown ALEX agent tool: ${tool}`
      );
  }
}

// ============================================================
// REGISTRY CLASS
// ============================================================

class AgentToolRegistry {
  constructor(options = {}) {
    this.version =
      REGISTRY_VERSION;

    this.callAgentFn =
      options.callAgent ||
      callAgent;

    this.tools = {
      ...TOOL_DEFINITIONS,
    };
  }

  // ==========================================================
  // CHECK TOOL
  // ==========================================================

  has(tool) {
    return Boolean(
      this.tools[
        safeString(tool)
      ]
    );
  }

  // ==========================================================
  // GET TOOL DEFINITION
  // ==========================================================

  get(tool) {
    const name =
      safeString(tool);

    if (!this.tools[name]) {
      return null;
    }

    return {
      ...this.tools[name],
    };
  }

  // ==========================================================
  // LIST TOOLS
  // ==========================================================

  list(options = {}) {
    const category =
      safeString(
        options.category
      );

    const entries =
      Object.values(
        this.tools
      );

    return entries
      .filter(
        (tool) =>
          !category ||
          tool.category ===
            category
      )
      .map(
        (tool) => ({
          ...tool,
        })
      );
  }

  // ==========================================================
  // LIST NAMES
  // ==========================================================

  listNames(options = {}) {
    return this.list(
      options
    ).map(
      (tool) =>
        tool.name
    );
  }

  // ==========================================================
  // VALIDATE
  // ==========================================================

  validate(
    tool,
    args = {}
  ) {
    const name =
      safeString(tool);

    if (!this.has(name)) {
      throw new Error(
        `ALEX agent tool is not registered: ${name}`
      );
    }

    return validateToolArgs(
      name,
      args
    );
  }

  // ==========================================================
  // EXECUTE
  // ==========================================================

  async execute({
    tool,
    args = {},
    agentToken,
  } = {}) {
    const name =
      safeString(tool);

    if (!name) {
      throw new Error(
        "ALEX agent tool name is required."
      );
    }

    if (!agentToken) {
      throw new Error(
        "WindowsAgent token is required."
      );
    }

    const validatedArgs =
      this.validate(
        name,
        args
      );

    const definition =
      this.tools[name];

    let result;

    try {
      result =
        await this.callAgentFn(
          name,
          validatedArgs,
          agentToken
        );
    } catch (error) {
      throw new Error(
        `ALEX agent tool '${name}' failed: ${
          error?.message ||
          String(error)
        }`
      );
    }

    return {
      success: true,

      tool: name,

      category:
        definition.category,

      risk:
        definition.risk,

      result,
    };
  }

  // ==========================================================
  // TOOL DESCRIPTION FOR PLANNER
  // ==========================================================

  getPlannerTools(
    options = {}
  ) {
    return this.list(
      options
    ).map(
      (tool) => ({
        name:
          tool.name,

        category:
          tool.category,

        risk:
          tool.risk,

        description:
          tool.description,
      })
    );
  }
}

// ============================================================
// SINGLETON
// ============================================================

let registryInstance =
  null;

function getAgentToolRegistry(
  options = {}
) {
  if (!registryInstance) {
    registryInstance =
      new AgentToolRegistry(
        options
      );
  }

  return registryInstance;
}

// ============================================================
// RESET — TESTING ONLY
// ============================================================

function resetAgentToolRegistry() {
  registryInstance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  REGISTRY_VERSION,

  TOOL_DEFINITIONS,

  AgentToolRegistry,

  getAgentToolRegistry,

  resetAgentToolRegistry,

  validateToolArgs,
};