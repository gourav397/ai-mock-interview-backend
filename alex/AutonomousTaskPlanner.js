// ============================================================
// ALEX AUTONOMOUS TASK PLANNER
// Version: 1.0.0
//
// Purpose:
//   - Convert an autonomous task into an execution plan
//   - Use Gemini for planning
//   - Keep plans bounded and allowlisted
//   - Validate every planned action
//   - Never execute actions directly
//
// Architecture:
//
//   AutonomousTaskWorker
//          ↓
//   AutonomousTaskPlanner
//          ↓
//   TaskExecutionBridge
//          ↓
//   Actual execution
// ============================================================

"use strict";

const {
  callGemini,
} = require("./utils/gemini");

const {
  CommandAllowlist,
} = require("./CommandAllowlist");

// ============================================================
// CONSTANTS
// ============================================================

const MAX_PLAN_STEPS = 30;

const MAX_INPUT_LENGTH = 12000;

const ALLOWED_ACTIONS = new Set([
  "inspect-project",
  "inspect-file",
  "read-file",
  "create-file",
  "modify-file",
  "delete-file",
  "run-approved-command",
  "system-info",
  "verify-file",
  "verify-project",
  "verify-tests",
]);

const PROJECT_ROOT =
  CommandAllowlist.getProjectRoot();

// ============================================================
// HELPERS
// ============================================================

function safeString(
  value,
  fallback = ""
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
}

function safeObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function normalizeAction(
  value
) {
  return safeString(
    value
  )
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function safeRelativePath(
  filePath
) {
  if (
    typeof filePath !==
      "string" ||
    !filePath.trim()
  ) {
    return null;
  }

  const path =
    require("path");

  const absolute =
    path.resolve(
      PROJECT_ROOT,
      filePath
    );

  const relative =
    path.relative(
      PROJECT_ROOT,
      absolute
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  return relative;
}

// ============================================================
// PLANNER
// ============================================================

class AutonomousTaskPlanner {
  constructor(options = {}) {
    this.maxSteps =
      Math.max(
        1,
        Number(
          options.maxSteps ||
            MAX_PLAN_STEPS
        )
      );

    this.projectRoot =
      options.projectRoot ||
      PROJECT_ROOT;
  }

  // ==========================================================
  // CREATE PLAN
  // ==========================================================

  async plan({
    input,
    task = null,
    previousResult = null,
    failedPlan = null,
  } = {}) {
    const cleanInput =
      safeString(
        input ||
          (task &&
            task.input)
      ).trim();

    if (!cleanInput) {
      throw new Error(
        "Autonomous task input is required."
      );
    }

    if (
      cleanInput.length >
      MAX_INPUT_LENGTH
    ) {
      throw new Error(
        "Autonomous task input is too large."
      );
    }

    const prompt =
      this._buildPrompt({
        input:
          cleanInput,

        task,

        previousResult,

        failedPlan,
      });

    const raw =
      await callGemini(
        prompt
      );

    const parsed =
      this._parseResponse(
        raw
      );

    const validated =
      this._validatePlan(
        parsed
      );

    return {
      ...validated,

      input:
        cleanInput,

      generatedAt:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // PROMPT
  // ==========================================================

  _buildPrompt({
    input,
    task,
    previousResult,
    failedPlan,
  }) {
    const previous =
      previousResult
        ? JSON.stringify(
            this._sanitize(
              previousResult
            )
          )
        : "none";

    const failed =
      failedPlan
        ? JSON.stringify(
            this._sanitize(
              failedPlan
            )
          )
        : "none";

    return `
You are ALEX's autonomous task planner.

Your job is ONLY to create a safe execution plan.
Do NOT execute anything.
Do NOT claim the task is completed.
Do NOT invent results.

PROJECT ROOT:
${this.projectRoot}

OWNER TASK:
${input}

TASK CONTEXT:
${JSON.stringify(
  this._sanitize(task || {})
)}

PREVIOUS RESULT:
${previous}

PREVIOUS FAILED PLAN:
${failed}

ALLOWED ACTIONS ONLY:
${Array.from(
  ALLOWED_ACTIONS
).join(", ")}

Create a JSON execution plan.

Required JSON shape:

{
  "goal": "short description",
  "steps": [
    {
      "id": 1,
      "action": "allowed-action",
      "description": "what this step should accomplish",
      "path": "relative/path/or/null",
      "command": "approved command or null",
      "arguments": {},
      "verification": {
        "required": true,
        "type": "verify-file|verify-project|verify-tests|null"
      }
    }
  ]
}

Rules:

1. Maximum ${this.maxSteps} steps.
2. Use only allowed actions.
3. File paths must be relative to the project root.
4. Never use absolute file paths.
5. Never include API keys, passwords, tokens or secrets.
6. Never use arbitrary shell commands.
7. Use run-approved-command only for commands that the executor can allow.
8. Include verification for changes whenever possible.
9. Do not assume a file exists unless an inspection/read step establishes it.
10. Do not report success in the plan.
11. If information is missing, use an inspection step first.
12. Keep the plan focused on the owner's requested task.
13. Return JSON only.
`;
  }

  // ==========================================================
  // PARSE GEMINI RESPONSE
  // ==========================================================

  _parseResponse(
    raw
  ) {
    if (
      raw &&
      typeof raw === "object"
    ) {
      return raw;
    }

    const text =
      safeString(raw).trim();

    if (!text) {
      throw new Error(
        "Planner returned an empty response."
      );
    }

    let cleaned =
      text;

    // Remove markdown fences if Gemini
    // returned them despite the JSON request.
    cleaned =
      cleaned
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /\s*```$/i,
          ""
        )
        .trim();

    try {
      return JSON.parse(
        cleaned
      );
    } catch (error) {
      // Attempt to extract the outer JSON object.
      const first =
        cleaned.indexOf("{");

      const last =
        cleaned.lastIndexOf("}");

      if (
        first >= 0 &&
        last > first
      ) {
        try {
          return JSON.parse(
            cleaned.slice(
              first,
              last + 1
            )
          );
        } catch (
          nestedError
        ) {
          // Fall through.
        }
      }

      throw new Error(
        "Planner returned invalid JSON."
      );
    }
  }

  // ==========================================================
  // VALIDATE PLAN
  // ==========================================================

  _validatePlan(
    plan
  ) {
    if (
      !plan ||
      typeof plan !==
        "object"
    ) {
      throw new Error(
        "Planner response is invalid."
      );
    }

    if (
      !Array.isArray(
        plan.steps
      )
    ) {
      throw new Error(
        "Planner did not return a steps array."
      );
    }

    if (
      plan.steps.length === 0
    ) {
      throw new Error(
        "Planner returned an empty execution plan."
      );
    }

    if (
      plan.steps.length >
      this.maxSteps
    ) {
      throw new Error(
        `Planner exceeded maximum step limit of ${this.maxSteps}.`
      );
    }

    const steps =
      plan.steps.map(
        (
          step,
          index
        ) =>
          this._validateStep(
            step,
            index
          )
      );

    return {
      goal:
        safeString(
          plan.goal,
          "Autonomous task"
        ).slice(
          0,
          1000
        ),

      steps,

      totalSteps:
        steps.length,
    };
  }

  // ==========================================================
  // VALIDATE ONE STEP
  // ==========================================================

  _validateStep(
    step,
    index
  ) {
    if (
      !step ||
      typeof step !==
        "object"
    ) {
      throw new Error(
        `Planner step ${index + 1} is invalid.`
      );
    }

    const action =
      normalizeAction(
        step.action
      );

    if (
      !ALLOWED_ACTIONS.has(
        action
      )
    ) {
      throw new Error(
        `Planner step ${index + 1} contains unsupported action: ${action}`
      );
    }

    const normalized = {
      id:
        Number(
          step.id
        ) ||
        index + 1,

      action,

      description:
        safeString(
          step.description,
          action
        ).slice(
          0,
          2000
        ),

      path:
        null,

      command:
        null,

      arguments:
        safeObject(
          step.arguments
        ),

      verification: {
        required: false,
        type: null,
      },
    };

    // --------------------------------------------------------
    // PATH
    // --------------------------------------------------------

    if (
      step.path !==
        null &&
      step.path !==
        undefined
    ) {
      const relative =
        safeRelativePath(
          step.path
        );

      if (!relative) {
        throw new Error(
          `Planner step ${index + 1} contains an invalid file path.`
        );
      }

      normalized.path =
        relative;
    }

    // --------------------------------------------------------
    // COMMAND
    // --------------------------------------------------------

    if (
      step.command !==
        null &&
      step.command !==
        undefined
    ) {
      const command =
        safeString(
          step.command
        ).trim();

      if (
        command.length >
        1000
      ) {
        throw new Error(
          `Planner step ${index + 1} command is too long.`
        );
      }

      if (
        !this._isApprovedCommand(
          command
        )
      ) {
        throw new Error(
          `Planner step ${index + 1} contains a command that is not approved.`
        );
      }

      normalized.command =
        command;
    }

    // --------------------------------------------------------
    // COMMAND ACTION REQUIRES COMMAND
    // --------------------------------------------------------

    if (
      action ===
        "run-approved-command" &&
      !normalized.command
    ) {
      throw new Error(
        `Planner step ${index + 1} requires a command.`
      );
    }

    // --------------------------------------------------------
    // FILE ACTIONS REQUIRE PATH
    // --------------------------------------------------------

    const fileActions =
      new Set([
        "inspect-file",
        "read-file",
        "create-file",
        "modify-file",
        "delete-file",
        "verify-file",
      ]);

    if (
      fileActions.has(
        action
      ) &&
      !normalized.path
    ) {
      throw new Error(
        `Planner step ${index + 1} requires a valid file path.`
      );
    }

    // --------------------------------------------------------
    // VERIFICATION
    // --------------------------------------------------------

    if (
      step.verification &&
      typeof step.verification ===
        "object"
    ) {
      const type =
        safeString(
          step.verification.type
        )
          .trim()
          .toLowerCase();

      const allowedVerificationTypes =
        new Set([
          "verify-file",
          "verify-project",
          "verify-tests",
          null,
          "",
        ]);

      if (
        !allowedVerificationTypes.has(
          type
        )
      ) {
        throw new Error(
          `Planner step ${index + 1} contains an unsupported verification type.`
        );
      }

      normalized.verification = {
        required:
          step.verification.required ===
          true,

        type:
          type ||
          null,
      };
    }

    // --------------------------------------------------------
    // SAFETY RULE:
    // Destructive actions should require verification.
    // --------------------------------------------------------

    if (
      action ===
        "delete-file"
    ) {
      normalized.verification = {
        required: true,

        type:
          normalized.verification
            .type ||
          "verify-project",
      };
    }

    return normalized;
  }

  // ==========================================================
  // APPROVED COMMAND CHECK
  // ==========================================================

  _isApprovedCommand(
    command
  ) {
    try {
      if (
        typeof CommandAllowlist.isCommandAllowed ===
        "function"
      ) {
        const allowed =
          CommandAllowlist.isCommandAllowed(
            command
          );

        if (
          allowed ===
          false
        ) {
          return false;
        }
      }

      const first =
        safeString(
          command
        )
          .trim()
          .split(/\s+/)[0]
          .toLowerCase();

      const executable =
        first
          .replace(
            /^.*[\\/]/,
            ""
          )
          .replace(
            /\.cmd$/i,
            ""
          )
          .replace(
            /\.exe$/i,
            ""
          );

      return new Set([
        "node",
        "npm",
        "npx",
        "git",
      ]).has(
        executable
      );
    } catch (
      error
    ) {
      return false;
    }
  }

  // ==========================================================
  // SANITIZE DATA BEFORE GEMINI
  // ==========================================================

  _sanitize(
    value,
    depth = 0
  ) {
    if (
      depth > 4
    ) {
      return "[truncated]";
    }

    if (
      value === null ||
      value ===
        undefined
    ) {
      return value;
    }

    if (
      typeof value ===
      "string"
    ) {
      return value
        .replace(
          /AIza[0-9A-Za-z_-]{20,}/g,
          "[REDACTED]"
        )
        .replace(
          /Bearer\s+[A-Za-z0-9._-]+/gi,
          "Bearer [REDACTED]"
        )
        .slice(
          0,
          5000
        );
    }

    if (
      Array.isArray(value)
    ) {
      return value
        .slice(0, 50)
        .map(
          (item) =>
            this._sanitize(
              item,
              depth + 1
            )
        );
    }

    if (
      typeof value ===
      "object"
    ) {
      const output =
        {};

      for (
        const [
          key,
          item,
        ] of Object.entries(
          value
        )
      ) {
        const lower =
          key.toLowerCase();

        if (
          lower.includes(
            "password"
          ) ||
          lower.includes(
            "secret"
          ) ||
          lower.includes(
            "token"
          ) ||
          lower.includes(
            "api_key"
          ) ||
          lower.includes(
            "apikey"
          ) ||
          lower.includes(
            "gemini_api_keys"
          )
        ) {
          output[key] =
            "[REDACTED]";

          continue;
        }

        output[key] =
          this._sanitize(
            item,
            depth + 1
          );
      }

      return output;
    }

    return value;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskPlanner(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskPlanner(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskPlanner;

module.exports.AutonomousTaskPlanner =
  AutonomousTaskPlanner;

module.exports.getAutonomousTaskPlanner =
  getAutonomousTaskPlanner;