// ============================================================
// ALEX TASK EXECUTION BRIDGE
// VERSION 1.0.0
//
// PURPOSE:
//   Planner -> Action Executor -> Verifier
//
// Used by:
//   AutonomousTaskExecutor.js
//
// SAFETY:
//   - Never executes arbitrary shell commands.
//   - Uses only explicitly supported actions.
//   - File paths stay inside PROJECT_ROOT.
//   - Secrets are never returned by the planner.
//   - Verification decides whether a task is actually complete.
// ============================================================

const fs = require("fs");
const path = require("path");
// WindowsAgent is optional.
// Render/Linux par ALEX server startup ke time Windows bridge
// available hona zaroori nahi hai.
let callAgent = null;
let windowsAgentLoadError = null;

function getCallAgent() {
  if (typeof callAgent === "function") {
    return callAgent;
  }

  try {
    const windowsAgentTool = require("../windowsAgentTool");

    if (typeof windowsAgentTool?.callAgent !== "function") {
      windowsAgentLoadError = new Error(
        "windowsAgentTool.callAgent is not available."
      );
      return null;
    }

    callAgent = windowsAgentTool.callAgent;
    windowsAgentLoadError = null;

    return callAgent;
  } catch (error) {
    windowsAgentLoadError = error;
    return null;
  }
}
const { callGemini } = require("./utils/gemini");
const { CommandAllowlist } = require("./CommandAllowlist");
const { SystemControl } = require("./SystemControl");

const PROJECT_ROOT =
  CommandAllowlist.getProjectRoot();

const MAX_PLAN_STEPS = 30;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ============================================================
// HELPERS
// ============================================================

function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim();
}

function normalizeAction(action) {
  return safeString(action)
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function safeRelativePath(input) {
  const raw = safeString(input);

  if (!raw) {
    throw new Error("File path is required.");
  }

  const normalized = path.normalize(raw);

  if (
    path.isAbsolute(normalized) ||
    normalized.startsWith("..") ||
    normalized.includes(`..${path.sep}`)
  ) {
    throw new Error(
      "Path is outside the allowed project directory."
    );
  }

  const fullPath = path.resolve(
    PROJECT_ROOT,
    normalized
  );

  const root =
    path.resolve(PROJECT_ROOT) +
    path.sep;

  if (
    fullPath !== path.resolve(PROJECT_ROOT) &&
    !fullPath.startsWith(root)
  ) {
    throw new Error(
      "Path is outside the allowed project directory."
    );
  }

  return {
    relativePath: normalized,
    fullPath,
  };
}

function sanitizeForModel(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .replace(
      /\b(sk-|api[_-]?key|apikey|secret|password|token|bearer|authorization)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]"
    )
    .replace(
      /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
      "[PRIVATE KEY REDACTED]"
    )
    .slice(0, 12000);
}

function sanitizeObject(value, depth = 0) {
  if (depth > 6) {
    return "[depth-limit]";
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeForModel(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) =>
        sanitizeObject(item, depth + 1)
      );
  }

  if (typeof value === "object") {
    const output = {};

    for (const [key, val] of Object.entries(value)) {
      if (
        /^(password|secret|token|apikey|api_key|authorization|credential)$/i.test(
          key
        )
      ) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeObject(
          val,
          depth + 1
        );
      }
    }

    return output;
  }

  return value;
}

// ============================================================
// PLANNER
// ============================================================

function extractFileTask(input) {
  const text = safeString(input);

  if (!text) {
    return null;
  }

  // ----------------------------------------------------------
  // Extract filename
  // Supports:
  //   alex-test.txt
  //   file alex-test.txt
  //   alex-test.txt naam ki file
  // ----------------------------------------------------------

  const fileMatch =
    text.match(
      /\b([a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)\b/
    );

  if (!fileMatch) {
    return null;
  }

  const fileName = fileMatch[1];

  // ----------------------------------------------------------
  // Extract quoted content
  // Example:
  // "ALEX AUTONOMOUS TEST SUCCESS"
  // ----------------------------------------------------------

  let content = null;

  const quotedMatch =
    text.match(
      /["“”']([^"“”']+)["“”']/
    );

  if (quotedMatch) {
    content = quotedMatch[1].trim();
  }

  // ----------------------------------------------------------
  // Detect create/write requirement
  // ----------------------------------------------------------

  const wantsCreate =
    /\b(create|make|bana|banani|likh|write|create karo|file create)\b/i.test(
      text
    );

  const wantsVerify =
    /\b(verify|verification|check|confirm|exactly|complete hone tak)\b/i.test(
      text
    );

  if (!content && !wantsCreate && !wantsVerify) {
    return null;
  }

  return {
    fileName,
    content,
    wantsCreate,
    wantsVerify,
  };
}

function buildDeterministicFilePlan(input) {
  const task =
    extractFileTask(input);

  if (!task) {
    return null;
  }

  const {
    fileName,
    content,
  } = task;

  let safePath;

  try {
    safePath =
      safeRelativePath(
        fileName
      ).relativePath;
  } catch (error) {
    throw new Error(
      `Invalid file target: ${error.message}`
    );
  }

  const fullPath =
    path.resolve(
      PROJECT_ROOT,
      safePath
    );

  const exists =
    fs.existsSync(
      fullPath
    );

  const steps = [];

  // ----------------------------------------------------------
  // FILE DOES NOT EXIST
  // ----------------------------------------------------------

  if (!exists) {
    if (
      typeof content !== "string"
    ) {
      return null;
    }

    steps.push({
      id: "step-1",
      action: "create-file",
      target: safePath,
      description:
        `Create ${safePath} with the requested content.`,
      parameters: {
        path: safePath,
        content,
      },
    });

    steps.push({
      id: "step-2",
      action: "verify-file",
      target: safePath,
      description:
        `Verify that ${safePath} exists and contains the exact requested content.`,
      parameters: {
        path: safePath,
        expectedContent: content,
      },
    });
  }

  // ----------------------------------------------------------
  // FILE ALREADY EXISTS
  //
  // Do NOT try create-file again.
  // Verify the existing file directly.
  // If verification fails, Executor can replan.
  // ----------------------------------------------------------

  else {
    if (
      typeof content === "string"
    ) {
      steps.push({
        id: "step-1",
        action: "verify-file",
        target: safePath,
        description:
          `Verify that ${safePath} contains the exact requested content.`,
        parameters: {
          path: safePath,
          expectedContent: content,
        },
      });
    } else {
      steps.push({
        id: "step-1",
        action: "verify-file",
        target: safePath,
        description:
          `Verify that ${safePath} exists.`,
        parameters: {
          path: safePath,
        },
      });
    }
  }

  return {
    goal:
      typeof content === "string"
        ? `Ensure ${safePath} exists with the exact requested content and verify it.`
        : `Ensure ${safePath} exists and verify it.`,

    reason:
      exists
        ? "Deterministic recovery plan: target file already exists, so ALEX will verify it instead of attempting to create it again."
        : "Deterministic fallback plan created because the AI planner did not return executable steps.",

    steps,

    source:
      exists
        ? "DeterministicExistingFilePlanner"
        : "DeterministicFilePlanner",
  };
}

async function planner(context = {}) {
  const input =
    safeString(context.input) ||
    safeString(context.taskInput);

  if (!input) {
    throw new Error(
      "Autonomous task input is required."
    );
  }

  // ==========================================================
  // FIRST: DETERMINISTIC PLAN FOR SIMPLE FILE TASKS
  //
  // This prevents Gemini planner instability from breaking
  // simple authorized project operations.
  // ==========================================================

  const deterministicPlan =
    buildDeterministicFilePlan(
      input
    );

  if (
    deterministicPlan &&
    Array.isArray(
      deterministicPlan.steps
    ) &&
    deterministicPlan.steps.length > 0
  ) {
    for (
      const step of
      deterministicPlan.steps
    ) {
      validatePlannedAction(step);
    }

    return deterministicPlan;
  }

  // ==========================================================
  // AI PLANNER
  // ==========================================================

  const prompt = `
You are the planning brain of ALEX.

Create a safe, executable plan for the owner's authorized project task.

OWNER TASK:
${sanitizeForModel(input)}

PROJECT ROOT:
${sanitizeForModel(PROJECT_ROOT)}

AVAILABLE ACTIONS:

1. inspect-project
2. inspect-file
3. read-file
4. create-file
5. modify-file
6. delete-file
7. run-approved-command
8. system-info
9. verify-file
10. verify-project
11. verify-tests

IMPORTANT SAFETY RULES:

- Never invent an arbitrary shell command.
- Never request passwords, API keys, tokens or credentials.
- Never access files outside the project.
- Never delete protected/system files.
- Prefer inspection before modification.
- Prefer small deterministic steps.
- If a task needs information first, inspect first.
- A task is NOT complete merely because an action succeeded.
- The final step must normally be verification.
- For verify-file, if the owner specified exact content, include:
  "expectedContent": "exact content"
- Maximum ${MAX_PLAN_STEPS} steps.

Return ONLY valid JSON:

{
  "goal": "short goal",
  "steps": [
    {
      "id": "step-1",
      "action": "inspect-project",
      "target": "project",
      "description": "what this step does",
      "parameters": {}
    }
  ]
}
`;

  let result;

  try {
    result =
      await callGemini(
        prompt
      );
  } catch (error) {
    // --------------------------------------------------------
    // Gemini itself failed.
    // Try deterministic fallback one more time.
    // --------------------------------------------------------

    const fallback =
      buildDeterministicFilePlan(
        input
      );

    if (
      fallback &&
      Array.isArray(
        fallback.steps
      ) &&
      fallback.steps.length > 0
    ) {
      return fallback;
    }

    throw new Error(
      `Planner AI error: ${error?.message || String(error)}`
    );
  }

  let parsed = result;

  // ----------------------------------------------------------
  // Gemini wrappers sometimes return:
  //
  // { text: "..." }
  // { response: "..." }
  //
  // Support those forms too.
  // ----------------------------------------------------------

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    if (
      typeof parsed.text ===
      "string"
    ) {
      parsed =
        extractJson(
          parsed.text
        );
    } else if (
      typeof parsed.response ===
      "string"
    ) {
      parsed =
        extractJson(
          parsed.response
        );
    } else if (
      typeof parsed.output ===
      "string"
    ) {
      parsed =
        extractJson(
          parsed.output
        );
    }
  }

  if (
    typeof parsed === "string"
  ) {
    try {
      parsed =
        extractJson(
          parsed
        );
    } catch (error) {
      // ------------------------------------------------------
      // AI returned unusable output.
      // Deterministic fallback gets final chance.
      // ------------------------------------------------------

      const fallback =
        buildDeterministicFilePlan(
          input
        );

      if (
        fallback &&
        Array.isArray(
          fallback.steps
        ) &&
        fallback.steps.length > 0
      ) {
        return fallback;
      }

      throw new Error(
        "Planner returned invalid JSON."
      );
    }
  }

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    const fallback =
      buildDeterministicFilePlan(
        input
      );

    if (
      fallback &&
      Array.isArray(
        fallback.steps
      ) &&
      fallback.steps.length > 0
    ) {
      return fallback;
    }

    throw new Error(
      "Planner returned an invalid plan."
    );
  }

  const steps =
    Array.isArray(
      parsed.steps
    )
      ? parsed.steps
      : [];

  // ==========================================================
  // IMPORTANT:
  // Empty AI plan MUST NOT immediately fail the task.
  // ==========================================================

  if (
    steps.length === 0
  ) {
    const fallback =
      buildDeterministicFilePlan(
        input
      );

    if (
      fallback &&
      Array.isArray(
        fallback.steps
      ) &&
      fallback.steps.length > 0
    ) {
      return fallback;
    }

    throw new Error(
      "Planner returned no executable steps and no safe deterministic fallback was available."
    );
  }

  if (
    steps.length > MAX_PLAN_STEPS
  ) {
    throw new Error(
      `Planner returned too many steps. Maximum is ${MAX_PLAN_STEPS}.`
    );
  }

  const safeSteps =
    steps.map(
      (step, index) => ({
        id:
          safeString(
            step?.id
          ) ||
          `step-${index + 1}`,

        action:
          normalizeAction(
            step?.action
          ),

        target:
          safeString(
            step?.target,
            "project"
          ),

        description:
          safeString(
            step?.description
          ),

        parameters:
          step?.parameters &&
          typeof step.parameters ===
            "object"
            ? sanitizeObject(
                step.parameters
              )
            : {},
      })
    );

  for (
    const step of safeSteps
  ) {
    validatePlannedAction(
      step
    );
  }

  return {
    goal:
      safeString(
        parsed.goal,
        input
      ),

    reason:
      safeString(
        parsed.reason
      ),

    steps:
      safeSteps,

    source:
      "GeminiPlanner",
  };
}

// ============================================================
// PLANNED ACTION VALIDATION
// ============================================================

function validatePlannedAction(step) {
  const allowed = new Set([
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

  if (!allowed.has(step.action)) {
    throw new Error(
      `Planner action is not allowed: ${step.action}`
    );
  }

  if (
    [
      "inspect-file",
      "read-file",
      "create-file",
      "modify-file",
      "delete-file",
      "verify-file",
    ].includes(step.action)
  ) {
    if (!step.parameters?.path) {
      throw new Error(
        `Action ${step.action} requires a file path.`
      );
    }

    safeRelativePath(
      step.parameters.path
    );
  }

  if (
    step.action ===
    "run-approved-command"
  ) {
    const command =
      safeString(
        step.parameters?.command
      );

    if (!command) {
      throw new Error(
        "Approved command is required."
      );
    }

    if (
      !CommandAllowlist.isCommandAllowed(
        command
      )
    ) {
      throw new Error(
        "Planner requested a command that is not allowlisted."
      );
    }

    if (
      CommandAllowlist.containsBlockedPattern(
        command
      )
    ) {
      throw new Error(
        "Planner requested a blocked command."
      );
    }
  }
}

// ============================================================
// ACTION EXECUTOR
// ============================================================

async function actionExecutor(
  step,
  context = {}
) {
  if (!step || typeof step !== "object") {
    throw new Error(
      "Invalid autonomous task step."
    );
  }

  validatePlannedAction(step);

  const action =
    normalizeAction(
      step.action
    );

  switch (action) {
    // --------------------------------------------------------
    // PROJECT INSPECTION
    // --------------------------------------------------------

    case "inspect-project":
      return inspectProject();

    // --------------------------------------------------------
    // FILE INSPECTION
    // --------------------------------------------------------

    case "inspect-file":
    case "read-file":
      return readFileStep(
        step.parameters?.path
      );

    // --------------------------------------------------------
    // CREATE FILE
    // --------------------------------------------------------

    case "create-file":
      return createFileStep(
        step.parameters
      );

    // --------------------------------------------------------
    // MODIFY FILE
    // --------------------------------------------------------

    case "modify-file":
      return modifyFileStep(
        step.parameters
      );

    // --------------------------------------------------------
    // DELETE FILE
    // --------------------------------------------------------

    case "delete-file":
      return deleteFileStep(
        step.parameters
      );

    // --------------------------------------------------------
    // APPROVED COMMAND
    // --------------------------------------------------------

    case "run-approved-command":
      return runApprovedCommand(
        step.parameters
      );

    // --------------------------------------------------------
    // SYSTEM INFO
    // --------------------------------------------------------

    case "system-info":
      return systemInfoStep(
        context
      );

    // --------------------------------------------------------
    // VERIFICATION
    // --------------------------------------------------------

    case "verify-file":
  return verifyFileStep(
    step.parameters?.path,
    step.parameters?.expectedContent
  );

    case "verify-project":
      return verifyProject();

    case "verify-tests":
      return verifyTests(
        step.parameters
      );

    default:
      throw new Error(
        `Unsupported autonomous action: ${action}`
      );
  }
}

// ============================================================
// PROJECT INSPECTION
// ============================================================

function inspectProject() {
  const entries =
    fs.readdirSync(
      PROJECT_ROOT,
      {
        withFileTypes: true,
      }
    );

  const files = [];
  const directories = [];

  for (const entry of entries) {
    if (
      entry.name ===
        "node_modules" ||
      entry.name ===
        ".git" ||
      entry.name ===
        ".alex-data" ||
      entry.name ===
        ".alex-backups"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      directories.push(
        entry.name
      );
    } else {
      files.push(
        entry.name
      );
    }
  }

  return {
    success: true,
    action:
      "inspect-project",
    projectRoot:
      PROJECT_ROOT,
    files,
    directories,
    counts: {
      files:
        files.length,
      directories:
        directories.length,
    },
  };
}

// ============================================================
// READ FILE
// ============================================================

function readFileStep(relativePath) {
  const {
    fullPath,
    relativePath:
      safePath,
  } =
    safeRelativePath(
      relativePath
    );

  if (!fs.existsSync(fullPath)) {
    return {
      success: false,
      action:
        "read-file",
      path:
        safePath,
      error:
        "File does not exist.",
    };
  }

  const stat =
    fs.statSync(fullPath);

  if (!stat.isFile()) {
    return {
      success: false,
      action:
        "read-file",
      path:
        safePath,
      error:
        "Target is not a file.",
    };
  }

  if (
    stat.size >
    MAX_FILE_SIZE
  ) {
    return {
      success: false,
      action:
        "read-file",
      path:
        safePath,
      error:
        "File is too large to inspect safely.",
    };
  }

  const content =
    fs.readFileSync(
      fullPath,
      "utf8"
    );

  return {
    success: true,
    action:
      "read-file",
    path:
      safePath,
    size:
      stat.size,
    content:
      content.slice(
        0,
        MAX_FILE_SIZE
      ),
  };
}

// ============================================================
// CREATE FILE
// ============================================================

function createFileStep(parameters = {}) {
  const {
    fullPath,
    relativePath:
      safePath,
  } =
    safeRelativePath(
      parameters.path
    );

  if (
    fs.existsSync(fullPath)
  ) {
    return {
      success: false,
      action:
        "create-file",
      path:
        safePath,
      error:
        "File already exists.",
    };
  }

  const content =
    typeof parameters.content ===
    "string"
      ? parameters.content
      : "";

  if (
    Buffer.byteLength(
      content,
      "utf8"
    ) > MAX_FILE_SIZE
  ) {
    throw new Error(
      "File content exceeds maximum allowed size."
    );
  }

  fs.mkdirSync(
    path.dirname(fullPath),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    fullPath,
    content,
    "utf8"
  );

  return {
    success: true,
    action:
      "create-file",
    path:
      safePath,
    bytes:
      Buffer.byteLength(
        content,
        "utf8"
      ),
    message:
      `Created ${safePath}`,
  };
}

// ============================================================
// MODIFY FILE
// ============================================================

function modifyFileStep(parameters = {}) {
  const {
    fullPath,
    relativePath:
      safePath,
  } =
    safeRelativePath(
      parameters.path
    );

  if (
    !fs.existsSync(fullPath)
  ) {
    return {
      success: false,
      action:
        "modify-file",
      path:
        safePath,
      error:
        "File does not exist.",
    };
  }

  const stat =
    fs.statSync(fullPath);

  if (!stat.isFile()) {
    throw new Error(
      "Target is not a file."
    );
  }

  if (
    stat.size >
    MAX_FILE_SIZE
  ) {
    throw new Error(
      "File is too large to modify safely."
    );
  }

  const current =
    fs.readFileSync(
      fullPath,
      "utf8"
    );

  let next;

  if (
    typeof parameters.content ===
    "string"
  ) {
    next =
      parameters.content;
  } else if (
    typeof parameters.search ===
      "string" &&
    typeof parameters.replace ===
      "string"
  ) {
    if (
      !current.includes(
        parameters.search
      )
    ) {
      return {
        success: false,
        action:
          "modify-file",
        path:
          safePath,
        error:
          "Search text was not found.",
      };
    }

    next =
      current.replace(
        parameters.search,
        parameters.replace
      );
  } else {
    return {
      success: false,
      action:
        "modify-file",
      path:
        safePath,
      error:
        "Modify requires either content or search/replace.",
    };
  }

  if (
    Buffer.byteLength(
      next,
      "utf8"
    ) > MAX_FILE_SIZE
  ) {
    throw new Error(
      "Modified file exceeds maximum allowed size."
    );
  }

  fs.writeFileSync(
    fullPath,
    next,
    "utf8"
  );

  return {
    success: true,
    action:
      "modify-file",
    path:
      safePath,
    bytes:
      Buffer.byteLength(
        next,
        "utf8"
      ),
    changed:
      current !== next,
    message:
      `Modified ${safePath}`,
  };
}

// ============================================================
// DELETE FILE
// ============================================================

function deleteFileStep(parameters = {}) {
  const {
    fullPath,
    relativePath:
      safePath,
  } =
    safeRelativePath(
      parameters.path
    );

  if (
    !fs.existsSync(fullPath)
  ) {
    return {
      success: false,
      action:
        "delete-file",
      path:
        safePath,
      error:
        "File does not exist.",
    };
  }

  const baseName =
    path.basename(
      fullPath
    ).toLowerCase();

  const protectedNames = [
    ".env",
    ".env.local",
    ".env.production",
    "package.json",
    "package-lock.json",
  ];

  if (
    protectedNames.includes(
      baseName
    )
  ) {
    return {
      success: false,
      action:
        "delete-file",
      path:
        safePath,
      error:
        "Protected file cannot be deleted automatically.",
    };
  }

  const stat =
    fs.statSync(fullPath);

  if (!stat.isFile()) {
    return {
      success: false,
      action:
        "delete-file",
      path:
        safePath,
      error:
        "Only files can be deleted by this bridge.",
    };
  }

  fs.unlinkSync(
    fullPath
  );

  return {
    success: true,
    action:
      "delete-file",
    path:
      safePath,
    message:
      `Deleted ${safePath}`,
  };
}

// ============================================================
// APPROVED COMMAND
// ============================================================

async function runApprovedCommand(
  parameters = {}
) {
  const command =
    safeString(
      parameters.command
    );

  if (!command) {
    throw new Error(
      "Command is required."
    );
  }

  if (
    !CommandAllowlist.isCommandAllowed(
      command
    )
  ) {
    throw new Error(
      "Command is not approved by ALEX CommandAllowlist."
    );
  }

  if (
    CommandAllowlist.containsBlockedPattern(
      command
    )
  ) {
    throw new Error(
      "Command contains a blocked pattern."
    );
  }

  const parts =
    command.match(
      /(?:[^\s"]+|"[^"]*")+/g
    ) || [];

  if (
    parts.length === 0
  ) {
    throw new Error(
      "Command could not be parsed."
    );
  }

  const executable =
    parts[0];

    const resolvedExecutable =
  process.platform === "win32"
    ? ({
        npm: "npm.cmd",
        npx: "npx.cmd",
      }[executable] || executable)
    : executable;

  const args =
    parts
      .slice(1)
      .map((value) =>
        value.replace(
          /^"(.*)"$/,
          "$1"
        )
      );

  const allowedExecutables =
    new Set([
      "node",
      "npm",
      "npx",
      "git",
    ]);

  if (
    !allowedExecutables.has(
      executable
    )
  ) {
    throw new Error(
      `Executable '${executable}' is not supported by the autonomous bridge.`
    );
  }

  const { execFile } =
    require("child_process");

  return new Promise(
    (resolve) => {
      execFile(
  resolvedExecutable,
  args,
        {
          cwd:
            PROJECT_ROOT,
          windowsHide:
            true,
          timeout:
            10 * 60 * 1000,
          maxBuffer:
            5 * 1024 * 1024,
        },
        (
          error,
          stdout,
          stderr
        ) => {
          const exitCode =
            error?.code ??
            0;

          resolve({
            success:
              !error,
            action:
              "run-approved-command",
            command,
            exitCode,
            stdout:
              safeString(
                stdout
              ).slice(
                0,
                12000
              ),
            stderr:
              safeString(
                stderr
              ).slice(
                0,
                12000
              ),
          });
        }
      );
    }
  );
}

// ============================================================
// SYSTEM INFO
// ============================================================

async function systemInfoStep(
  context = {}
) {
  const token =
    safeString(
      context.windowsAgentToken ||
      context.agentToken
    );

  if (!token) {
    return {
      success: false,
      action:
        "system-info",
      error:
        "WindowsAgent token is not available for this autonomous step.",
    };
  }

  const agentCaller =
    getCallAgent();

  if (!agentCaller) {
    return {
      success: false,
      action:
        "system-info",
      error:
        "WindowsAgent is unavailable on this server. This Windows-only action cannot run on Render/Linux.",
      code:
        "WINDOWS_AGENT_UNAVAILABLE",
      details:
        windowsAgentLoadError?.message ||
        "WindowsAgent bridge could not be loaded.",
    };
  }

  const result =
    await agentCaller(
      "system-info",
      {},
      token
    );

  return {
    success: result?.status === "ok",
    action:
      "system-info",
    result:
      result?.result ?? result,
    error:
      result?.status !== "ok"
        ? result?.reason ||
          "WindowsAgent system-info action failed."
        : undefined,
  };
}
// ============================================================
// VERIFY FILE
// ============================================================

function verifyFileStep(
  relativePath,
  expectedContent = undefined
) {
  const {
    fullPath,
    relativePath: safePath,
  } = safeRelativePath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return {
      complete: false,
      verified: false,
      action: "verify-file",
      path: safePath,
      reason: "File does not exist.",
    };
  }

  const stat = fs.statSync(fullPath);

  if (!stat.isFile()) {
    return {
      complete: false,
      verified: false,
      action: "verify-file",
      path: safePath,
      reason: "Target is not a file.",
    };
  }

  if (stat.size > MAX_FILE_SIZE) {
    return {
      complete: false,
      verified: false,
      action: "verify-file",
      path: safePath,
      reason: "File is too large to verify safely.",
    };
  }

  const actualContent = fs.readFileSync(
    fullPath,
    "utf8"
  );

  const hasExpectedContent =
    typeof expectedContent === "string";

  if (hasExpectedContent) {
    const verified =
      actualContent === expectedContent;

    return {
      complete: verified,
      verified,
      action: "verify-file",
      path: safePath,
      isFile: true,
      size: stat.size,
      contentVerified: verified,
      reason: verified
        ? "File exists and content matches exactly."
        : "File exists, but its content does not match the expected content.",
    };
  }

  return {
    complete: true,
    verified: true,
    action: "verify-file",
    path: safePath,
    isFile: true,
    size: stat.size,
    contentVerified: false,
    reason:
      "File existence verified. No expected content was supplied.",
  };
}

// ============================================================
// VERIFY PROJECT
// ============================================================

function verifyProject() {
  const packageJson =
    path.join(
      PROJECT_ROOT,
      "package.json"
    );

  if (
    !fs.existsSync(
      packageJson
    )
  ) {
    return {
      complete: false,
      verified: false,
      action:
        "verify-project",
      reason:
        "package.json not found.",
    };
  }

  try {
    const raw =
      fs.readFileSync(
        packageJson,
        "utf8"
      );

    const pkg =
      JSON.parse(raw);

    return {
      complete: true,
      verified: true,
      action:
        "verify-project",
      packageName:
        pkg.name || null,
      version:
        pkg.version || null,
    };
  } catch (error) {
    return {
      complete: false,
      verified: false,
      action:
        "verify-project",
      reason:
        `package.json is invalid: ${error.message}`,
    };
  }
}

// ============================================================
// VERIFY TESTS
// ============================================================

async function verifyTests(
  parameters = {}
) {
  const command =
    safeString(
      parameters.command,
      "npm test"
    );

  const result =
    await runApprovedCommand({
      command,
    });

  return {
    ...result,

    complete:
      result.success === true,

    verified:
      result.success === true,

    action:
      "verify-tests",
  };
}

// ============================================================
// JSON EXTRACTION
// ============================================================

function extractJson(text) {
  const value =
    String(text || "").trim();

  if (!value) {
    throw new Error(
      "Empty planner response."
    );
  }

  try {
    return JSON.parse(value);
  } catch (_) {}

  const fenced =
    value.match(
      /```(?:json)?\s*([\s\S]*?)\s*```/i
    );

  if (fenced) {
    return JSON.parse(
      fenced[1]
    );
  }

  const start =
    value.indexOf("{");

  const end =
    value.lastIndexOf("}");

  if (
    start !== -1 &&
    end > start
  ) {
    return JSON.parse(
      value.slice(
        start,
        end + 1
      )
    );
  }

  throw new Error(
    "No JSON object found."
  );
}

// ============================================================
// TASK COMPLETION VERIFIER
// ============================================================

async function verifier(
  context = {}
) {
  const history =
    Array.isArray(
      context.executionHistory
    )
      ? context.executionHistory
      : [];

  if (
    history.length === 0
  ) {
    return {
      complete: false,
      verified: false,
      reason:
        "No execution history exists.",
    };
  }

 const failed =
  history.find(
    (item) =>
      item &&
      (
        item.success === false ||
        item.result?.success === false ||
        item.result?.complete === false ||
        item.result?.verified === false
      )
  );

  if (failed) {
    return {
      complete: false,
      verified: false,
      reason:
        "One or more execution steps failed.",
      failedStep:
        failed.stepId ||
        failed.action ||
        null,
    };
  }

  const last =
    history[
      history.length - 1
    ];

  if (
    last?.result?.complete ===
      true ||
    last?.result?.verified ===
      true
  ) {
    return {
      complete: true,
      verified: true,
      reason:
        "Final execution step reported verified completion.",
    };
  }

  const hasVerificationStep =
    history.some(
      (item) =>
        [
          "verify-file",
          "verify-project",
          "verify-tests",
        ].includes(
          normalizeAction(
            item?.action
          )
        )
    );

  if (
    hasVerificationStep
  ) {
    const verification =
      history.findLast(
        (item) =>
          [
            "verify-file",
            "verify-project",
            "verify-tests",
          ].includes(
            normalizeAction(
              item?.action
            )
          )
      );

    if (
      verification?.result?.verified ===
        true
    ) {
      return {
        complete: true,
        verified: true,
        reason:
          "Verification step succeeded.",
      };
    }
  }

  return {
    complete: false,
    verified: false,
    reason:
      "Task actions completed, but completion has not been independently verified.",
  };
}

// ============================================================
// FACTORY
// ============================================================

function createTaskExecutionBridge() {
  return {
    planner,
    actionExecutor,
    verifier,
  };
}

module.exports = {
  createTaskExecutionBridge,
  planner,
  actionExecutor,
  verifier,
};