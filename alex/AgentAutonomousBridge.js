// ============================================================
// ALEX AUTONOMOUS BRIDGE
// File: backend/alex/AgentAutonomousBridge.js
//
// Purpose:
//   Connect ALEX's natural-language goal with the REAL Agent
//   Runtime tools already present in this project.
//
// Flow:
//
//   User Goal
//      ↓
//   Tool Discovery
//      ↓
//   Gemini Plan
//      ↓
//   Validate Real Tools
//      ↓
//   Permission / Confirmation
//      ↓
//   AgentRuntime
//      ↓
//   Sequential Execution
//      ↓
//   Results
//      ↓
//   Final Report
//
// IMPORTANT:
//   - Never invents a tool.
//   - Never calls WindowsAgent directly.
//   - Uses AgentRuntime → AgentOrchestrator → ToolRegistry.
//   - Confirmation remains enforced for sensitive tools.
//   - Browser tools are NOT fabricated if unavailable.
// ============================================================

const {
  getAgentRuntime,
} = require("./AgentRuntime");

const {
  getAgentToolRegistry,
} = require("./AgentToolRegistry");

const {
  getAgentPermissionManager,
} = require("./AgentPermissionManager");

const {
  createAgentExecutionContext,
} = require("./AgentExecutionContext");

const {
  callGemini,
} = require("./utils/gemini");


// ============================================================
// CONSTANTS
// ============================================================

const BRIDGE_VERSION = "1.0.0";

const MAX_STEPS = 30;

const MAX_GOAL_LENGTH = 12000;

const MAX_RESULT_LENGTH = 30000;

const DEFAULT_OWNER = "owner";


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

  return String(value).trim();
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


function truncate(
  value,
  max = MAX_RESULT_LENGTH
) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(
          value
        );

  if (!text) {
    return "";
  }

  return text.length > max
    ? `${text.slice(0, max)}...[truncated]`
    : text;
}


function clone(value) {
  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}


function parseJson(text) {
  if (
    typeof text !== "string"
  ) {
    return null;
  }

  const cleaned =
    text
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
    return JSON.parse(cleaned);
  } catch {
    // Try extracting the first JSON object.
    const start =
      cleaned.indexOf("{");

    const end =
      cleaned.lastIndexOf("}");

    if (
      start >= 0 &&
      end > start
    ) {
      try {
        return JSON.parse(
          cleaned.slice(
            start,
            end + 1
          )
        );
      } catch {
        return null;
      }
    }

    return null;
  }
}


// ============================================================
// TOOL DESCRIPTION
// ============================================================

function buildToolCatalog(
  registry
) {
  if (
    !registry ||
    typeof registry.list !==
      "function"
  ) {
    return [];
  }

  const tools =
    registry.list();

  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.map(
    (tool) => ({
      name:
        tool.name,

      category:
        tool.category ||
        "unknown",

      risk:
        tool.risk ||
        "unknown",

      description:
        tool.description ||
        "",
    })
  );
}


// ============================================================
// PLAN SANITIZER
// ============================================================

function sanitizePlan(
  rawPlan,
  registry
) {
  if (
    !rawPlan ||
    typeof rawPlan !==
      "object"
  ) {
    return {
      feasible: false,

      reason:
        "Planner returned an invalid response.",

      steps: [],
    };
  }

  if (
    rawPlan.feasible === false
  ) {
    return {
      feasible: false,

      reason:
        safeString(
          rawPlan.reason,
          "Goal cannot be planned with current capabilities."
        ),

      steps: [],
    };
  }

  const rawSteps =
    Array.isArray(
      rawPlan.steps
    )
      ? rawPlan.steps
      : [];

  if (
    rawSteps.length === 0
  ) {
    return {
      feasible: false,

      reason:
        "Planner returned no executable steps.",

      steps: [],
    };
  }

  if (
    rawSteps.length >
    MAX_STEPS
  ) {
    return {
      feasible: false,

      reason:
        `Plan exceeds maximum of ${MAX_STEPS} steps.`,

      steps: [],
    };
  }

  const steps = [];

  for (
    let index = 0;
    index < rawSteps.length;
    index++
  ) {
    const raw =
      safeObject(
        rawSteps[index]
      );

    const tool =
      safeString(
        raw.tool ||
        raw.action
      );

    if (!tool) {
      return {
        feasible: false,

        reason:
          `Plan step ${index + 1} has no tool.`,

        steps: [],
      };
    }

    if (
      !registry.has(tool)
    ) {
      return {
        feasible: false,

        reason:
          `Planner requested unavailable tool: ${tool}`,

        steps: [],
      };
    }

    steps.push({
      id:
        raw.id ||
        `step-${index + 1}`,

      tool,

      description:
        safeString(
          raw.description,
          tool
        ),

      args:
        safeObject(
          raw.args ||
          raw.parameters
        ),

      verification:
        safeString(
          raw.verification,
          ""
        ),

      requiresConfirmation:
        raw.requiresConfirmation === true,
    });
  }

  return {
    feasible: true,

    reason:
      safeString(
        rawPlan.reason,
        ""
      ),

    verification:
      safeString(
        rawPlan.verification,
        ""
      ),

    steps,
  };
}


// ============================================================
// BRIDGE
// ============================================================

class AgentAutonomousBridge {
  constructor(options = {}) {
    this.version =
      BRIDGE_VERSION;

    this.runtime =
      options.runtime ||
      getAgentRuntime();

    this.registry =
      options.registry ||
      getAgentToolRegistry();

    this.permissionManager =
      options.permissionManager ||
      getAgentPermissionManager();

    this.gemini =
      options.gemini ||
      {
        call: callGemini,
      };

    this.maxSteps =
      Number.isFinite(
        Number(
          options.maxSteps
        )
      )
        ? Math.max(
            1,
            Math.min(
              MAX_STEPS,
              Math.floor(
                Number(
                  options.maxSteps
                )
              )
            )
          )
        : MAX_STEPS;
  }


  // ==========================================================
  // CREATE CONTEXT
  // ==========================================================

  createContext(
    options = {}
  ) {
    return createAgentExecutionContext(
      {
        ownerId:
          options.ownerId ||
          DEFAULT_OWNER,

        sessionId:
          options.sessionId ||
          null,

        goal:
          options.goal ||
          "",

        metadata:
          options.metadata ||
          {},
      }
    );
  }


  // ==========================================================
  // GET REAL TOOLS
  // ==========================================================

  getAvailableTools() {
    return buildToolCatalog(
      this.registry
    );
  }


  // ==========================================================
  // BUILD PLAN
  // ==========================================================

  async planGoal({
    goal,
    context = {},
  } = {}) {
    const cleanGoal =
      safeString(goal);

    if (!cleanGoal) {
      return {
        success: false,

        feasible: false,

        reason:
          "Goal is required.",

        steps: [],
      };
    }

    if (
      cleanGoal.length >
      MAX_GOAL_LENGTH
    ) {
      return {
        success: false,

        feasible: false,

        reason:
          "Goal is too long.",

        steps: [],
      };
    }

    const tools =
      this.getAvailableTools();

    if (
      tools.length === 0
    ) {
      return {
        success: false,

        feasible: false,

        reason:
          "No registered agent tools are available.",

        steps: [],
      };
    }

    const toolCatalog =
      tools
        .map(
          (tool) =>
            `- ${tool.name} | category=${tool.category} | risk=${tool.risk} | ${tool.description}`
        )
        .join("\n");

    const systemPrompt = `
You are ALEX's autonomous task planner.

Your job is to convert the owner's goal into a SAFE,
EXECUTABLE sequence using ONLY the tools listed below.

STRICT RULES:

1. Never invent a tool.
2. Never use a tool that is not in the catalog.
3. Never output shell commands.
4. Never output JavaScript or Python for execution.
5. Use the smallest number of steps needed.
6. Keep arguments JSON-compatible.
7. Do not claim browser automation exists unless a browser
   tool is actually present in the catalog.
8. If the goal cannot be completed with the available tools,
   return feasible=false.
9. Do not bypass permissions or confirmations.
10. For destructive actions, keep the step explicit.
11. Each step must contain:
    tool
    description
    args
12. Maximum ${this.maxSteps} steps.

AVAILABLE REAL TOOLS:

${toolCatalog}

Return JSON ONLY:

{
  "feasible": true,
  "reason": "...",
  "verification": "...",
  "steps": [
    {
      "id": "step-1",
      "tool": "real.tool.name",
      "description": "...",
      "args": {},
      "verification": "...",
      "requiresConfirmation": false
    }
  ]
}
`.trim();

    const userPrompt = `
OWNER GOAL:
${cleanGoal}

CONTEXT:
${truncate(
  context,
  10000
)}
`.trim();

    try {
      const response =
        await this.gemini.call({
          systemPrompt,

          userPrompt,

          responseMimeType:
            "application/json",
        });

      if (
        !response?.ok ||
        !response?.text
      ) {
        return {
          success: false,

          feasible: false,

          reason:
            "Planner did not return a usable response.",

          steps: [],
        };
      }

      const parsed =
        parseJson(
          response.text
        );

      const plan =
        sanitizePlan(
          parsed,
          this.registry
        );

      if (
        !plan.feasible
      ) {
        return {
          success: true,
          ...plan,
        };
      }

      return {
        success: true,
        ...plan,
      };
    } catch (error) {
      return {
        success: false,

        feasible: false,

        reason:
          error?.message ||
          String(error),

        steps: [],
      };
    }
  }


  // ==========================================================
  // CHECK PERMISSION
  // ==========================================================

  inspectStep(
    step,
    context
  ) {
    try {
      if (
        !this.runtime ||
        typeof this.runtime.inspectTool !==
          "function"
      ) {
        return {
          success: false,

          allowed: false,

          error:
            "AgentRuntime.inspectTool is unavailable.",
        };
      }

      return this.runtime.inspectTool(
        step.tool,
        step.args,
        context
      );
    } catch (error) {
      return {
        success: false,

        allowed: false,

        error:
          error?.message ||
          String(error),
      };
    }
  }


  // ==========================================================
  // EXECUTE ONE STEP
  // ==========================================================

  async executeStep({
    step,
    context,
    confirmed = false,
    confirmationReason = "",
  }) {
    const inspection =
      this.inspectStep(
        step,
        context
      );

    if (
      inspection?.requiresConfirmation ===
        true &&
      confirmed !== true
    ) {
      return {
        success: false,

        status:
          "waiting_confirmation",

        requiresConfirmation:
          true,

        tool:
          step.tool,

        stepId:
          step.id,

        description:
          step.description,

        confirmationReason:
          inspection.reason ||
          confirmationReason ||
          "This action requires owner confirmation.",

        inspection,
      };
    }

    try {
      const result =
        await this.runtime.executeTool(
          context,
          step.tool,
          step.args,
          {
            confirmed:
              confirmed === true,

            confirmationReason:
              confirmationReason ||
              "",
          }
        );

      return {
        success:
          result?.success !== false,

        status:
          result?.status ||
          "completed",

        stepId:
          step.id,

        tool:
          step.tool,

        description:
          step.description,

        result:
          clone(result),
      };
    } catch (error) {
      return {
        success: false,

        status:
          "failed",

        stepId:
          step.id,

        tool:
          step.tool,

        description:
          step.description,

        error:
          error?.message ||
          String(error),
      };
    }
  }


  // ==========================================================
  // EXECUTE PLAN
  // ==========================================================

  async executePlan({
    plan,
    context,
    confirmations = {},
    stopOnFailure = true,
  } = {}) {
    if (
      !plan ||
      plan.feasible !== true ||
      !Array.isArray(
        plan.steps
      )
    ) {
      return {
        success: false,

        status:
          "invalid_plan",

        results: [],
      };
    }

    const results = [];

    for (
      const step of plan.steps
    ) {
      const confirmation =
        confirmations?.[step.id] ||
        confirmations?.[step.tool] ||
        {};

      const confirmed =
        confirmation === true ||
        confirmation?.confirmed === true;

      const confirmationReason =
        typeof confirmation === "object"
          ? safeString(
              confirmation.reason,
              ""
            )
          : "";

      const result =
        await this.executeStep({
          step,

          context,

          confirmed,

          confirmationReason,
        });

      results.push(
        result
      );

      if (
        result.status ===
        "waiting_confirmation"
      ) {
        return {
          success: false,

          status:
            "waiting_confirmation",

          results,

          waitingFor:
            step.id,

          waitingTool:
            step.tool,
        };
      }

      if (
        !result.success &&
        stopOnFailure
      ) {
        return {
          success: false,

          status:
            "failed",

          results,
        };
      }
    }

    return {
      success:
        results.every(
          (item) =>
            item.success
        ),

      status:
        results.every(
          (item) =>
            item.success
        )
          ? "completed"
          : "failed",

      results,
    };
  }


  // ==========================================================
  // COMPLETE GOAL
  // ==========================================================

  async runGoal({
    goal,
    ownerId = DEFAULT_OWNER,
    sessionId = null,
    metadata = {},
    confirmations = {},
    stopOnFailure = true,
  } = {}) {
    const cleanGoal =
      safeString(goal);

    if (!cleanGoal) {
      return {
        success: false,

        status:
          "invalid_goal",

        message:
          "Goal is required.",
      };
    }

    const context =
      this.createContext({
        ownerId,

        sessionId,

        goal:
          cleanGoal,

        metadata,
      });

    const plan =
      await this.planGoal({
        goal:
          cleanGoal,

        context: {
          ownerId,

          sessionId,

          metadata,
        },
      });

    if (
      !plan.success ||
      !plan.feasible
    ) {
      return {
        success:
          false,

        status:
          "cannot_plan",

        message:
          plan.reason ||
          "Goal cannot be planned.",

        plan,
      };
    }

    const execution =
      await this.executePlan({
        plan,

        context,

        confirmations,

        stopOnFailure,
      });

    return {
      success:
        execution.success,

      status:
        execution.status,

      goal:
        cleanGoal,

      plan,

      execution,

      timestamp:
        new Date().toISOString(),
    };
  }
}


// ============================================================
// SINGLETON
// ============================================================

let singletonBridge = null;


function getAgentAutonomousBridge(
  options = {}
) {
  if (!singletonBridge) {
    singletonBridge =
      new AgentAutonomousBridge(
        options
      );
  }

  return singletonBridge;
}


function resetAgentAutonomousBridge() {
  singletonBridge = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  BRIDGE_VERSION,

  AgentAutonomousBridge,

  getAgentAutonomousBridge,

  resetAgentAutonomousBridge,
};