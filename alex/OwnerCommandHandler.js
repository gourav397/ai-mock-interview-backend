// ============================================================
// ALEX OWNER COMMAND HANDLER — PREMIUM PRODUCTION VERSION 3.7.1
// COMPLETE FILE:
//   ✓ Natural language parsing (50+ variations)
//   ✓ Goal Classifier + requirement-needed guard (no fake modules)
//   ✓ Deep Analysis (read-only) + CACHE + "report dikhao"
//   ✓ Remediation-plan intent (read-only) + plan-execute
//   ✓ Casual chat parser (Hinglish aware) + ChatGPT-style general chat
//   ✓ Conversation context + follow-up resolution
//   ✓ Owner-scoped memory isolation (ownerKey namespacing)
//   ✓ Reliable confirmation system (token + pending action store,
//           owner identity, TTL, consume-once, cleanup)
//   ✓ Evidence-based changed-file detection (read-only git)
//   ✓ AI parser safety — allowlist + path validation
//   ✓ Confirmation-aware fix-loop with full transaction rollback
//   ✓ Honest test verdicts (pass/fail/unavailable/no-suite)
//   ✓ Recursive audit sanitization, secret masking everywhere
//   ✓ File create/modify/delete with backups + protected paths
//   ✓ Cross-platform test execution, audit logging, self-verification
//
// FIXES IN 3.7.1:
//   ✓ Fixed fatal ReferenceError: `ownerId` in processCommand STEP 1
//     (every command previously crashed with "ownerId is not defined")
//   ✓ Removed ~450 lines of accidentally duplicated methods
//     (confirmation tokens, git detection, analysis, remediation plan,
//      findings verification were each defined twice)
//   ✓ _runTests: successful runs now report verdict "pass"
//     (exit code was never set to 0 on success)
//   ✓ _verifyFindings: "test script" verdict was inverted — fixed
//   ✓ _applyAutoFix: empty-catch fix now reuses the actual catch
//     parameter (previously injected a reference to undefined `err`)
//   ✓ _handleCreateFile: creates parent directories (recursive)
//   ✓ commandHistory trim now respects maxHistory
//   ✓ list-history is owner-scoped (matches v3.7 isolation claim)
//   ✓ PROTECTED_DIRS cleaned (.env is a file, protected by name-regex)
// ============================================================

const chatMemory = require("./ChatMemory");
const { systemPrompt } = require("./alexPersonality");
const { SystemControl } = require("./SystemControl");
const {
  CommandAllowlist,
} = require("./CommandAllowlist");

const {
  getDecisionEngine,
} = require("./DecisionEngine");

const {
  getAlexController,
} = require("./AlexController");

const {
  getAuditLogger,
} = require("./AuditLogger");

const {
  getIncidentManager,
} = require("./IncidentManager");

const {
  getHealthMonitor,
} = require("./HealthMonitor");

const {
  getSecurityAgent,
} = require("./SecurityAgent");

const {
  getEmployeeAgent,
} = require("./EmployeeAgent");

const {
  callGemini,
} = require("./utils/gemini");

const config = require("./config");
// WindowsAgent is optional at server startup.
// Render/Linux par normal ALEX chat ke liye ye module required nahi hai.
let callAgent = null;
let windowsAgentLoadError = null;

function getCallAgent() {
  if (typeof callAgent === "function") return callAgent;

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
const {
  getAutonomousTaskService,
} = require("./AutonomousTaskService");

const {
  detectAutonomousTaskIntent,
} = require("./AutonomousTaskIntent");

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = CommandAllowlist.getProjectRoot();
const { IntentRouter } = require("./IntentRouter");

const BACKUP_DIR = path.join(
  PROJECT_ROOT,
  ".alex-backups",
  "owner-commands"
);

const MAX_FIX_LOOP_ITERATIONS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALEX_VERSION = "3.8.0";

// ============================================================
// OWNER COMMAND HANDLER
// ============================================================

class OwnerCommandHandler {
  constructor() {
  this.ready = true;

  this.intentRouter = new IntentRouter();

  this.commandHistory = [];

  // token -> pending confirmation record (with full original action)
  this.pendingConfirmations = new Map();

  // ownerId -> conversation context (lastAction, lastTarget, lastFilePath…)
  this.ownerContexts = new Map();

  this.maxHistory = config.owner?.commandHistoryMax || 1000;
  this._skipVerification = false;
  this.lastAnalysis = null; // cached deep-analysis report
  this.autonomousTaskService =
  getAutonomousTaskService();
}

  // ============================================================
  // OWNER / SESSION KEY HELPERS (owner-scoped isolation)
  // ============================================================

  _ownerIdOf(owner) {
    return String(owner?.userId || owner?.method || "anonymous");
  }

  _ownerKey(owner, sessionId) {
    return `${this._ownerIdOf(owner)}:${String(sessionId || "default")}`;
  }

  _getContext(owner) {
    const oid = this._ownerIdOf(owner);
    if (!this.ownerContexts.has(oid)) {
      this.ownerContexts.set(oid, {
        lastAction: null,
        lastTarget: null,
        lastFilePath: null,
        lastFiles: [],
        lastInput: null,
        updatedAt: null,
      });
    }
    return this.ownerContexts.get(oid);
  }

  _updateContext(owner, { action, target, parameters }) {
    const ctx = this._getContext(owner);
    ctx.lastAction = action || ctx.lastAction;
    ctx.lastTarget = target || ctx.lastTarget;
    if (parameters?.path && typeof parameters.path === "string") {
      ctx.lastFilePath = parameters.path;
      ctx.lastFiles = [parameters.path, ...(ctx.lastFiles || [])].slice(0, 10);
    }
    ctx.lastInput = parameters?.originalInput || ctx.lastInput;
    ctx.updatedAt = new Date().toISOString();
  }

  // ============================================================
  // PUBLIC COMMAND PROCESSOR
  // ============================================================

 async processCommand(
  input,
  owner,
  confirmationId = null,
  sessionId = null,
  windowsAgentToken = ""
) {
    const commandId = this._generateCommandId();
    const startTime = Date.now();

    try {
      if (!input || typeof input !== "string") {
        return this._buildResult(commandId, "error", {
          error: "Command input is required.",
        });
      }

      const trimmed = input.trim();

      if (!trimmed) {
        return this._buildResult(commandId, "error", {
          error: "Command input is empty.",
        });
      }

      const ownerId = this._ownerIdOf(owner);
      const activeSessionId = sessionId || "default";

      // ==========================================================
      // STEP 0A ? CONFIRMATION
      // ==========================================================
      const confirmResolution =
        this._resolveConfirmationIntent(trimmed, owner);

      if (confirmResolution) {
        if (confirmResolution.status === "executed") {
          const pending = confirmResolution.pending;

          const executionResult = await this._execute(
            pending.action,
            pending.target,
            pending.parameters,
            owner,
            trimmed
          );

          await this._auditLog({
            commandId,
            owner: this._sanitizeOwnerForLog(owner),
            input: this._sanitizeForAudit(trimmed),
            action: pending.action,
            target: pending.target,
            parameters: this._sanitizeParams(pending.parameters),
            riskLevel: pending.riskLevel,
            executionResult,
            durationMs: Date.now() - startTime,
          });

          this.commandHistory.push({
            commandId,
            timestamp: new Date().toISOString(),
            action: pending.action,
            target: pending.target,
            success: executionResult?.success === true,
            owner: ownerId,
            summary: String(
              executionResult?.message ||
              executionResult?.error ||
              "Completed"
            ).slice(0, 200),
          });

          if (this.commandHistory.length > this.maxHistory) {
            this.commandHistory =
              this.commandHistory.slice(-this.maxHistory);
          }

          this._updateContext(owner, {
            action: pending.action,
            target: pending.target,
            parameters: pending.parameters,
          });

          return this._buildResult(
            commandId,
            executionResult?.success === true
              ? "completed"
              : "failed",
            {
              understood: trimmed,
              action: pending.action,
              target: pending.target,
              ...executionResult,
              confirmedVia: "pending-confirmation",
              durationMs: Date.now() - startTime,
            }
          );
        }

        return this._buildResult(
          commandId,
          confirmResolution.status,
          {
            understood: trimmed,
            error: confirmResolution.error,
            action: confirmResolution.action || undefined,
          }
        );
      }

      // ==========================================================
      // STEP 0B ? FOLLOW-UP
      // ==========================================================
      const followUp = this._resolveFollowUp(trimmed, owner);

      if (followUp) {
        const followUpResult = await this._handleFollowUp(
          followUp,
          owner,
          commandId,
          startTime,
          trimmed
        );

        if (followUpResult) {
          return followUpResult;
        }
      }

      // ==========================================================
      // STEP 0C ? MEMORY QUESTION
      // IMPORTANT:
      // Memory question MUST happen before command AI parsing.
      // ==========================================================
      const memoryAnswer =
        await this._answerMemoryQuestion(trimmed, owner);

      if (memoryAnswer) {
        return this._buildResult(commandId, "completed", {
          understood: trimmed,
          ...memoryAnswer,
          durationMs: Date.now() - startTime,
        });
      }

      // ==========================================================
      // STEP 0D ? PERSONAL MEMORY WRITE
      // ==========================================================
      const remembered =
        await this._rememberPersonalStatement(
          trimmed,
          owner,
          activeSessionId
        );

      if (remembered) {
        return this._buildResult(commandId, "completed", {
          understood: trimmed,
          ...remembered,
          durationMs: Date.now() - startTime,
        });
      }


      // ==========================================================
// STEP 0E — AUTONOMOUS LONG-RUNNING TASK
// ==========================================================
//
// Examples:
//
// "Alex ye kaam complete hone tak karte rehna"
// "background mein kaam karte raho"
// "jab tak project fix na ho tab tak continue karo"
// "don't stop until the task is complete"
//
// IMPORTANT:
// Only strong autonomous language triggers this.
// Normal words like "task" alone do NOT trigger it.
// ==========================================================

const autonomousIntent =
  detectAutonomousTaskIntent(
    trimmed
  );

if (
  autonomousIntent &&
  autonomousIntent.autonomous === true &&
  Number(
    autonomousIntent.confidence || 0
  ) >= 0.75
) {
  try {
    const autonomousTask =
      await this.autonomousTaskService.startTask({
        input:
          autonomousIntent.taskInput ||
          trimmed,

        ownerId,

        sessionId:
          activeSessionId,

        windowsAgentToken:
  windowsAgentToken || "",

        action:
          "autonomous-task",

        target:
          "project",

        resumeOnRestart:
          true,

        metadata: {
          originalInput:
            trimmed,

          intentReason:
            autonomousIntent.reason,

          intentConfidence:
            autonomousIntent.confidence,

          background:
            autonomousIntent.background === true,

          keepWorking:
            autonomousIntent.keepWorking === true,

          untilComplete:
            autonomousIntent.untilComplete === true,

          startedBy:
            "OwnerCommandHandler",
        },
      });

    // --------------------------------------------------------
    // AUDIT
    // --------------------------------------------------------

    await this._auditLog({
      commandId,

      owner:
        this._sanitizeOwnerForLog(
          owner
        ),

      input:
        this._sanitizeForAudit(
          trimmed
        ),

      action:
        "autonomous-task",

      target:
        "project",

      parameters: {
        autonomous: true,

        confidence:
          autonomousIntent.confidence,

        reason:
          autonomousIntent.reason,
      },

      riskLevel: 3,

      executionResult: {
        success: true,

        status:
          "processing",

        taskId:
          autonomousTask?.id ||
          null,
      },

      durationMs:
        Date.now() - startTime,
    });

    // --------------------------------------------------------
    // HISTORY
    // --------------------------------------------------------

    this.commandHistory.push({
      commandId,

      timestamp:
        new Date().toISOString(),

      action:
        "autonomous-task",

      target:
        "project",

      success: true,

      owner: ownerId,

      summary:
        "Autonomous task started and will continue until verified complete.",
    });

    if (
      this.commandHistory.length >
      this.maxHistory
    ) {
      this.commandHistory =
        this.commandHistory.slice(
          -this.maxHistory
        );
    }

    // --------------------------------------------------------
    // CONTEXT
    // --------------------------------------------------------

    this._updateContext(
      owner,
      {
        action:
          "autonomous-task",

        target:
          "project",

        parameters: {
          originalInput:
            trimmed,

          taskId:
            autonomousTask?.id ||
            null,
        },
      }
    );

    // --------------------------------------------------------
    // RETURN PROCESSING STATUS
    // --------------------------------------------------------

    return this._buildResult(
      commandId,
      "processing",
      {
        understood:
          trimmed,

        action:
          "autonomous-task",

        target:
          "project",

        success: true,

        status:
          "processing",

        processing: true,

        taskId:
          autonomousTask?.id ||
          null,

        message:
          "ALEX ne autonomous task start kar diya hai. Main ise background mein continue karunga aur verification ke bina completed nahi maanunga.",

        autonomous: true,

        confidence:
          autonomousIntent.confidence,

        reason:
          autonomousIntent.reason,

        durationMs:
          Date.now() - startTime,
      }
    );
  } catch (error) {
    console.error(
      "[ALEX] Autonomous task start failed:",
      error
    );

    return this._buildResult(
      commandId,
      "failed",
      {
        understood:
          trimmed,

        action:
          "autonomous-task",

        success: false,

        error:
          error?.message ||
          "Autonomous task could not be started.",

        autonomous: true,

        durationMs:
          Date.now() - startTime,
      }
    );
  }
}

      // ==========================================================
      // STEP 1 ? PARSE
      // ==========================================================
      const parsed = await this._parseCommand(trimmed, {
        owner,
        ownerId,
        sessionId: activeSessionId,
      });

      if (parsed && parsed.success) {
        parsed.parameters = parsed.parameters || {};

        parsed.parameters.sessionId =
          activeSessionId ||
          parsed.parameters.sessionId ||
          "default";

        parsed.parameters.ownerId = ownerId;
        parsed.parameters.windowsAgentToken = windowsAgentToken || "";
        parsed.parameters.currentMessage = trimmed;

        parsed.parameters.originalInput =
          parsed.parameters.originalInput ||
          trimmed;
          parsed.parameters.windowsAgentToken =
  windowsAgentToken || "";
      }

      
      // ==========================================================
      // STEP 2 ? PARSE FAILURE
      // ==========================================================
      if (!parsed || !parsed.success) {
        return this._buildResult(commandId, "error", {
          understood: trimmed,
          error: "Could not understand the command.",
          details:
            parsed?.error ||
            "No parser matched the input.",
          diagnostics:
            parsed?.diagnostics || null,
          suggestion:
            parsed?.suggestion ||
            "Try: inspect project, run tests, check health, show actions, fix bugs, show incidents, show history",
        });
      }

      const {
        action,
        target,
        parameters,
        riskLevel,
      } = parsed;

      // ==========================================================
      // STEP 3 ? ACTION ALLOWLIST
      // ==========================================================
      if (!CommandAllowlist.isActionAllowed(action)) {
        return this._buildResult(commandId, "denied", {
          understood: trimmed,
          action,
          target,
          error: `Action "${action}" is not allowed.`,
          allowedActions:
            CommandAllowlist.getAllowedActions(),
        });
      }

      // ==========================================================
      // STEP 4 ? HIGH-RISK CONFIRMATION
      // ==========================================================
      if (CommandAllowlist.requiresConfirmation(action)) {
        if (!confirmationId) {
          const token =
            this._generateConfirmationToken(
              commandId,
              owner,
              {
                action,
                target,
                parameters,
                riskLevel: riskLevel || 2,
              }
            );

          return this._buildResult(
            commandId,
            "confirmation_required",
            {
              understood: trimmed,
              action,
              target,
              parameters,
              riskLevel: riskLevel || 4,
              message:
                "This action requires explicit confirmation. Reply with 'confirm' or 'plan approve karo'.",
              confirmationId: token,
            }
          );
        }

        if (
          !this._verifyConfirmation(
            confirmationId,
            commandId,
            owner
          )
        ) {
          return this._buildResult(
            commandId,
            "denied",
            {
              understood: trimmed,
              action,
              target,
              error:
                "Invalid or expired confirmation.",
            }
          );
        }
      }

      // ==========================================================
      // STEP 5 ? EXECUTE
      // ==========================================================
      const executionResult =
        await this._execute(
          action,
          target,
          parameters,
          owner,
          trimmed
        );

      const executionSuccess = executionResult?.success === true;
      const executionProcessing =
  executionResult?.status === "processing" ||
  executionResult?.processing === true ||
  executionResult?.reel?.status === "processing";

const finalExecutionStatus = executionProcessing
  ? "processing"
  : executionSuccess
    ? "completed"
    : "failed";


      // ==========================================================
      // STEP 6 ? AUDIT
      // ==========================================================
      await this._auditLog({
        commandId,
        owner: this._sanitizeOwnerForLog(owner),
        input: this._sanitizeForAudit(trimmed),
        action,
        target,
        parameters:
          this._sanitizeParams(parameters),
        riskLevel,
        executionResult,
        durationMs:
          Date.now() - startTime,
      });

      // ==========================================================
      // STEP 7 ? HISTORY
      // ==========================================================
      this.commandHistory.push({
        commandId,
        timestamp: new Date().toISOString(),
        action,
        target,
        success: executionSuccess,
        owner: ownerId,
        summary: String(
          executionResult?.message ||
          executionResult?.error ||
          "Completed"
        ).slice(0, 200),
      });

      if (this.commandHistory.length > this.maxHistory) {
        this.commandHistory =
          this.commandHistory.slice(-this.maxHistory);
      }

      // ==========================================================
      // STEP 8 ? CONTEXT
      // ==========================================================
      this._updateContext(owner, {
        action,
        target,
        parameters,
      });

      // ==========================================================
      // STEP 9 ? HONEST RESULT
      // ==========================================================
      return this._buildResult(
  commandId,
  finalExecutionStatus,
  {
          understood: trimmed,
          action,
          target,
          parameters,
          ...(executionResult || {
            success: false,
            error:
              "Executor returned no result.",
          }),
          durationMs:
            Date.now() - startTime,
        }
      );
    } catch (error) {
      console.error(
        "[ALEX] Owner command fatal error:",
        error
      );

      return this._buildResult(
        commandId,
        "error",
        {
          understood: input,
          error:
            error?.message ||
            "Unexpected command execution error.",
          durationMs:
            Date.now() - startTime,
        }
      );
    }
  }

  // ============================================================
  // MAIN EXECUTOR — dispatches validated actions
  // ============================================================
  async _execute(action, target, parameters, owner, originalInput) {
    parameters = parameters || {};

    switch (action) {

      // ==========================================================
      // CHAT
      // ==========================================================
      case "chat":
        return this._handleChat(
          parameters,
          originalInput,
          owner
        );

      case "general-chat":
        return this._handleGeneralChat(
          parameters,
          originalInput,
          owner
        );

      // ==========================================================
      // LAPTOP / SYSTEM CONTROL
      // ==========================================================
      case "system-control":
        return this._handleSystemControl(parameters);

      // ==========================================================
      // FILE OPERATIONS
      // ==========================================================
      case "create-file":
        return this._handleCreateFile(parameters);

      case "modify-file":
        return this._handleModifyFile(parameters);

      case "delete-file":
        return this._handleDeleteFile(parameters);

      // ==========================================================
      // ANALYSIS / INSPECTION
      // ==========================================================
      case "inspect": {
        if (parameters.remediationPlan) {
          return this._buildRemediationPlan(
            originalInput
          );
        }

        if (parameters.verifyFindings) {
          return this._verifyFindings(5);
        }

        if (parameters.showLast) {

          if (parameters.changedFiles) {
            const changed =
              this._detectChangedFiles();

            return {
              success: true,
              message: changed.verified
                ? `Changed files: ${changed.changedFiles.length} (read-only git evidence, nothing modified).`
                : changed.reason,
              changedFiles:
                changed.changedFiles,
              diffStat:
                changed.diffStat || undefined,
              note: changed.note,
            };
          }

          return (
            this._findingsByFile() || {
              success: false,
              error:
                "No cached analysis report. Run 'deep analysis karo' first.",
            }
          );
        }

        if (parameters.deep) {
          return this._analyzeProject(
            originalInput
          );
        }

        return {
          success: true,
          message:
            "Project inspection (read-only). Tip: 'deep analysis karo' for a full findings report.",
          mode: "inspect",
          projectRoot:
            path.basename(PROJECT_ROOT),
        };
      }

      // ==========================================================
      // SECURITY
      // ==========================================================
      case "inspect-security":
        return {
          success: true,
          message:
            "Security inspection scheduled via read-only analysis. Use 'security-scan' for a deep scan.",
          mode: "inspect-security",
        };

      case "inspect-logs":
        return {
          success: true,
          message:
            "Audit log entries are sanitized and available via the AuditLogger.",
          mode: "inspect-logs",
        };

      // ==========================================================
      // BUG / FIX
      // ==========================================================
      case "find-bugs":
        return this._analyzeProject(
          originalInput
        );

      case "fix-bugs":
        return this._runFixLoop(
          parameters,
          owner,
          this._generateCommandId()
        );

      case "security-scan":
        return this._analyzeProject(
          originalInput
        );

      // ==========================================================
      // CODE QUALITY
      // ==========================================================
      case "improve-code":
        return {
          success: true,
          message:
            "Code improvement requires an explicit target. Specify a file: 'modify file <path> with content: ...'. ALEX will not guess modifications.",
          mode: "improve-code",
        };

      case "improve-security":
        return this._buildRemediationPlan(
          originalInput
        );

      // ==========================================================
      // HEALTH
      // ==========================================================
      case "status":
        return this._handleStatus();

      case "check-health":
  try {
    return await getHealthMonitor().runHealthCheck();
  } catch (e) {
    return {
      success: false,
      error:
        `Health check unavailable. Real reason: ${e.message}`,
    };
  }

      case "check-database":
        try {
          const health =
  await getHealthMonitor().runHealthCheck();

          const db =
            health?.services?.database ||
            health?.database;

          return {
            success: true,
            message: db
              ? `Database status: ${JSON.stringify(db).slice(0, 300)}`
              : "Database status not reported by HealthMonitor.",
            database: db || null,
          };
        } catch (e) {
          return {
            success: false,
            error:
              `Database check unavailable. Real reason: ${e.message}`,
          };
        }

      // ==========================================================
      // TESTS
      // ==========================================================
      case "run-tests":
        return this._runTests();

      // ==========================================================
      // COMMAND EXECUTION
      // ==========================================================
      case "run-command": {
        const cmd =
          parameters.command || target;

        if (
          !cmd ||
          !CommandAllowlist.isCommandAllowed(cmd) ||
          CommandAllowlist.containsBlockedPattern(cmd)
        ) {
          return {
            success: false,
            error:
              "Command rejected by allowlist ? execution blocked.",
          };
        }

        try {
          const isWin =
            process.platform === "win32";

          const output =
            execFileSync(
              cmd.split(" ")[0],
              cmd.split(" ").slice(1),
              {
                cwd: PROJECT_ROOT,
                encoding: "utf8",
                timeout: 30000,
                stdio: [
                  "pipe",
                  "pipe",
                  "pipe",
                ],
                ...(isWin
                  ? { shell: true }
                  : {}),
              }
            );

          return {
            success: true,
            message:
              "Command executed.",
            output:
              String(output).slice(
                0,
                4000
              ),
          };
        } catch (e) {
          return {
            success: false,
            error:
              `Command failed (exit ${e.status ?? "unknown"}). Real reason: ${String(
                e.stderr ||
                e.message
              ).slice(0, 400)}`,
          };
        }
      }

      // ==========================================================
      // DEPLOY
      // ==========================================================
      case "prepare-deploy":
        return {
          success: true,
          message:
            "Deploy readiness: run 'run-tests' + 'deep analysis karo' first. Env-var names are listed in the remediation plan ? secret values are never displayed.",
          mode: "prepare-deploy",
        };

      // ==========================================================
      // INCIDENTS / HISTORY
      // ==========================================================
      case "list-incidents":
        try {
          return getIncidentManager()
            .listIncidents();
        } catch (e) {
          return {
            success: false,
            error:
              `Incident manager unavailable. Real reason: ${e.message}`,
          };
        }

      case "list-history":
        return this._handleListHistory(
          parameters,
          owner
        );

      // ==========================================================
      // META
      // ==========================================================
      case "list-actions":
        return this._handleListActions();

      case "verify":
        return this._verifyActions();

      // ==========================================================
      // REEL
      // ==========================================================
      case "generate-reel":
        return this._handleGenerateReel(
          parameters,
          originalInput
        );

      default:
        return {
          success: false,
          error:
            `Action "${action}" is recognized but has no executor wired. This is an internal routing gap ? action was parsed and allowlisted correctly.`,
        };
    }
  }

    // ============================================================
  // LAPTOP CONTROL — WINDOWS AGENT BRIDGE
  // ============================================================
  async _handleSystemControl(parameters) {
    const { systemAction, systemParams } = parameters || {};

    if (!systemAction) {
      return {
        success: false,
        error: "System action required.",
      };
    }

    try {
      // ----------------------------------------------------------
      // WINDOWS AGENT
      // ----------------------------------------------------------
      const agentToolMap = {
        "system-info": "sys.sysinfo",

        "open-app": "apps.launch",
        "close-app": "apps.close",

        "screen-analyze": "screen.capture_and_analyze",

        "click": "input.click",
        "type-text": "input.type",
        "scroll": "input.scroll",
        "hotkey": "input.hotkey",

        "read-file": "fs.read",
        "write-file": "fs.write",
        "delete-file": "fs.delete",
        "move-file": "fs.move",
        "search-files": "fs.search",
      };

      const agentTool = agentToolMap[systemAction];

      if (agentTool) {
        const agentToken =
  parameters?.windowsAgentToken ||
  parameters?.agentToken ||
  systemParams?.windowsAgentToken ||
  systemParams?.agentToken;
        if (!agentToken) {
          return {
            success: false,
            error:
              "WindowsAgent connected hai, lekin pairing token available nahi hai.",
            code: "WINDOWS_AGENT_TOKEN_REQUIRED",
          };
        }

        const cleanParams = {
          ...(systemParams || {}),
        };

        delete cleanParams.agentToken;

        const agentCaller = getCallAgent();

if (!agentCaller) {
  return {
    success: false,
    source: "windows-agent",
    systemAction,
    error:
      "WindowsAgent is unavailable on this server. " +
      "Normal ALEX chat can continue, but Windows-only controls " +
      "require the WindowsAgent bridge on a Windows machine.",
    code: "WINDOWS_AGENT_UNAVAILABLE",
    details:
      windowsAgentLoadError?.message ||
      "WindowsAgent bridge not loaded.",
  };
}

const result = await agentCaller(
  agentTool,
  cleanParams,
  agentToken
);

        return {
          success: result?.status === "ok",
          source: "windows-agent",
          systemAction,
          tool: agentTool,
          result: result?.result ?? result,
          error:
            result?.status !== "ok"
              ? result?.reason || "WindowsAgent action failed."
              : undefined,
        };
      }

      // ----------------------------------------------------------
      // EXISTING SYSTEM CONTROL FALLBACK
      // ----------------------------------------------------------
      return await SystemControl.execute(
        systemAction,
        systemParams || {}
      );

    } catch (e) {
      return {
        success: false,
        error:
          "System control failed: " +
          (e?.message || String(e)),
      };
    }
  }

  // ============================================================
  // CONFIRMATION INTENT RESOLUTION
  // Matches "confirm", "haan confirm", "plan approve karo" etc.
  // against the stored pending action for this owner.
  // ============================================================

  _resolveConfirmationIntent(input, owner) {
    this._cleanupExpiredConfirmations();

    const lower = input.toLowerCase().trim();

    const isConfirmIntent =
      /^(confirm(ed)?|haan\s*confirm|confirm\s*karo|ok\s*confirm|yes\s*confirm|plan\s+approve\s+karo|plan\s+manzoor|approve\s+karo|ab\s+fix\s+karo|ab\s+fixes?\s+apply|haan\s*kar\s*do|haanji\s*confirm)\b[\s\S]{0,20}$/i.test(lower) ||
      /^(haan|han|yes|ok(ay)?|theek\s*hai|thik\s*hai)\s*[.!]?\s*$/i.test(lower) && this._pendingCountForOwner(owner) > 0;

    if (!isConfirmIntent) return null;

    const pending = this._latestPendingForOwner(owner);
    if (!pending) {
      return {
        status: "denied",
        error: "Koi pending action nahi mila jise confirm kiya ja sake.",
      };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(pending.token);
      return {
        status: "denied",
        error: "Confirmation expired. Please issue the original command again.",
        action: pending.action,
      };
    }

    // Owner identity must match
    if (pending.ownerId !== this._ownerIdOf(owner)) {
      return {
        status: "denied",
        error: "This confirmation belongs to a different owner session.",
      };
    }

    // Consume-once: remove before execution so it cannot be reused
    this.pendingConfirmations.delete(pending.token);

    return { status: "executed", pending };
  }

  _generateConfirmationToken(commandId, owner, pendingAction = null) {
    const token = `${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
    const ownerId = this._ownerIdOf(owner);
    this.pendingConfirmations.set(token, {
      token, commandId, ownerId,
      action: pendingAction?.action || "unknown",
      target: pendingAction?.target || "project",
      parameters: pendingAction?.parameters || {},
      riskLevel: pendingAction?.riskLevel || 2,
      createdAt: Date.now(),
      expiresAt: Date.now() + (config.owner?.confirmationTimeoutMs || 300000),
    });
    return token;
  }

  _verifyConfirmation(confirmationId, commandId, owner) {
    this._cleanupExpiredConfirmations();
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) return false;
    const ownerId = this._ownerIdOf(owner);
    if (pending.ownerId !== ownerId) return false;
    if (Date.now() > pending.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      return false;
    }
    this.pendingConfirmations.delete(confirmationId); // consume-once
    return true;
  }

  _latestPendingForOwner(owner) {
    const ownerId = this._ownerIdOf(owner);
    let latest = null;
    for (const p of this.pendingConfirmations.values()) {
      if (p.ownerId === ownerId && (!latest || p.createdAt > latest.createdAt)) {
        latest = p;
      }
    }
    return latest;
  }

  _pendingCountForOwner(owner) {
    const ownerId = this._ownerIdOf(owner);
    let n = 0;
    for (const p of this.pendingConfirmations.values()) {
      if (p.ownerId === ownerId) n++;
    }
    return n;
  }

  _cleanupExpiredConfirmations() {
    const now = Date.now();
    for (const [token, p] of this.pendingConfirmations) {
      if (now > p.expiresAt) this.pendingConfirmations.delete(token);
    }
  }

  // ============================================================
  // CONTEXT-AWARE FOLLOW-UP RESOLUTION
  // Resolves short follow-ups against owner conversation context.
  // Returns null when the input is NOT a follow-up.
  // ============================================================

  _resolveFollowUp(input, owner) {
    const lower = input.toLowerCase().trim();

    // Never treat explicit full commands as follow-ups
    if (this._parseFileCommand(input)) return null;
    if (lower.length > 120) return null;

    const ctx = this._getContext(owner);

    const isBareAck =
      /^(haan|han|ha\s*ji|haanji|haan\s*ji|yes|ok(ay)?|ohk|theek|thik|theek\s*hai|thik\s*hai|sahi|sahi\s*hai|acha|accha|go\s*ahead|proceed|continue|carry\s*on|aage\s*badho|karo)\s*[.!]?\s*$/i.test(lower);

    const isWhyFollowUp =
      /^(kyu|kyun|kyon|why|fir\s*kya\s*hua|kya\s*hua|aur\s*batao|or\s*batao|aur\?)\s*[?.!]*$/i.test(lower);

    const isAnaphora =
      /(wahi|usi|usi\s*file|previous\s*file|pichli\s*file|jo\s*file\s*maine\s*(abhi\s*)?(batayi|batai|bataya|boli)\s*thi|that\s*file|this\s*file|it\b|isko|isme|is\s*file\s*mein|ab\s*isko\s*thik\s*karo|jo\s*maine\s*abhi\s*bola|jo\s*maine\s*kaha)/i.test(lower);

    const isFileRefQuery =
      /(file\s*ka\s*naam\s*bata|which\s*file|previous\s*wali\s*file|usi\s*file\s*ko\s*change\s*karo|is\s*file\s*mein\s*wahi\s*change)/i.test(lower);

    if (!isBareAck && !isWhyFollowUp && !isAnaphora && !isFileRefQuery) return null;

    // "file ka naam bata" — pure reference query
    if (isFileRefQuery && !/(change|modify|fix|delete|karo)/i.test(lower)) {
      if (ctx.lastFilePath) {
        return {
          type: "file-reference-query",
          reply: `Sabse recent referenced file: "${ctx.lastFilePath}". Purani references: ${(ctx.lastFiles || []).slice(0, 5).join(", ")}`,
        };
      }
      return {
        type: "file-reference-query",
        reply: "Abhi tak conversation mein koi specific file reference nahi hui. File ka naam bata do, ya 'deep analysis karo' chala do.",
      };
    }

    if (!ctx.lastAction) return null;

    // Bare "haan/ok/continue" on a pending high-risk lastAction →
    // route through confirmation intent if a pending exists (handled
    // earlier); otherwise clarify.
    if (isBareAck || isWhyFollowUp) {
      if (ctx.lastAction === "fix-bugs" || ctx.lastAction === "modify-file" || ctx.lastAction === "delete-file") {
        return {
          type: "clarify-risk",
          reply: `Pichla action tha "${ctx.lastAction}" (${ctx.lastTarget || "project"}). Ye safe/confirm-required action hai — explicit bolo: "plan approve karo" ya "fix bugs", ya exact command do.`,
        };
      }
      return {
        type: "re-run",
        action: ctx.lastAction,
        target: ctx.lastTarget || "project",
        parameters: {
          originalInput: input,
          sessionId: "default",
          source: "context-follow-up",
        },
      };
    }

    // Anaphora — e.g. "usi file ko change karo", "is file mein wahi change karo"
    if (isAnaphora && ctx.lastFilePath) {
      const changeIntent = /(change|modify|update|fix|thik|edit|rewrite)/i.test(lower);
      const showIntent = /(bata|dikha|show|path|naam)/i.test(lower);
      if (showIntent && !changeIntent) {
        return {
          type: "file-reference-query",
          reply: `Aap "us" file ka reference kar rahe ho: "${ctx.lastFilePath}"`,
        };
      }
      if (changeIntent) {
        return {
          type: "modify-last-file",
          filePath: ctx.lastFilePath,
          hint: input,
        };
      }
      return null;
    }

    return null;
  }

  async _handleFollowUp(followUp, owner, commandId, startTime, understood) {
    if (followUp.type === "file-reference-query" || followUp.type === "clarify-risk") {
      return this._buildResult(commandId, "completed", {
        understood, message: followUp.reply,
        mode: "context-follow-up",
        durationMs: Date.now() - startTime,
      });
    }

    if (followUp.type === "re-run") {
      const allowed = CommandAllowlist.isActionAllowed(followUp.action);
      if (!allowed) {
        return this._buildResult(commandId, "denied", {
          understood, error: `Action "${followUp.action}" is not allowed.`,
        });
      }
      const executionResult = await this._execute(
        followUp.action, followUp.target, followUp.parameters, owner, understood
      );
      await this._auditLog({
        commandId, owner: this._sanitizeOwnerForLog(owner),
        input: this._sanitizeForAudit(understood), action: followUp.action,
        target: followUp.target,
        parameters: this._sanitizeParams(followUp.parameters),
        riskLevel: 1, executionResult, durationMs: Date.now() - startTime,
      });
      this.commandHistory.push({
        commandId, timestamp: new Date().toISOString(),
        action: followUp.action, target: followUp.target,
        success: executionResult.success === true,
        owner: this._ownerIdOf(owner),
        summary: String(executionResult.message || "").slice(0, 200),
      });
      return this._buildResult(commandId,
        executionResult.success ? "completed" : "failed",
        { understood, action: followUp.action, ...executionResult,
          durationMs: Date.now() - startTime });
    }

    if (followUp.type === "modify-last-file") {
      // Read current content; require explicit replacement content from
      // the follow-up text — we never guess file contents.
      return this._buildResult(commandId, "error", {
        understood,
        error: `File "${followUp.filePath}" modify karni hai — naya content bhi bhejo (e.g. modify file "${followUp.filePath}" with content: ...). Security ke liye ALEX file ka content khud guess nahi karta.`,
        filePath: followUp.filePath,
        suggestion: `modify file "${followUp.filePath}" with exactly this content: <naya content>`,
      });
    }

    return null;
  }

  // ============================================================
  // EVIDENCE-BASED CHANGED-FILE DETECTION (READ-ONLY GIT)
  // Never guesses. Never prints secret values.
  // ============================================================

  _detectChangedFiles() {
    const hasGit = fs.existsSync(path.join(PROJECT_ROOT, ".git"));
    if (!hasGit) {
      return {
        verified: false,
        reason: "Git repository not found in project root — changed files cannot be verified.",
        changedFiles: [],
      };
    }

    let statusOut = "";
    try {
      statusOut = execFileSync("git", ["status", "--porcelain"],
        { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 8000, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return { verified: false, reason: `git status failed: ${e.message}`, changedFiles: [] };
    }

    const changedFiles = statusOut
      .split("\n").map(l => l.trim()).filter(Boolean)
      .map(l => {
        const status = l.slice(0, 2).trim();
        const file = l.slice(3).trim().replace(/^"|"$/g, "");
        return { status, file };
      });

    // Diff stat (names + line counts only — never raw diff content,
    // so secrets inside changed files are never exposed)
    let diffStat = null;
    if (changedFiles.length) {
      try {
        diffStat = execFileSync("git", ["diff", "--stat"],
          { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 8000, stdio: ["pipe", "pipe", "pipe"] })
          .split("\n").slice(-5).join("\n").trim();
      } catch {
        diffStat = null;
      }
    }

    return {
      verified: true,
      changedFiles,
      diffStat,
      note: changedFiles.length === 0
        ? "Git reports NO uncommitted changes — nothing was modified since the last commit."
        : undefined,
    };
  }

  // ============================================================
  // COMMAND PARSER — COMPREHENSIVE NLU
  // Order: chat → file parser → AI parser → regex NLU → goal
  // classifier → general-chat fallback
  // ============================================================
  _intentToCommand(routed, originalInput) {
    if (!routed || typeof routed !== "object") {
      return null;
    }

    const intent = String(routed.intent || "").toUpperCase();
    const params = routed.parameters || routed.params || {};

    const intentMap = {
      SYSTEM_INFO: {
        action: "system-control",
        target: "system",
        parameters: {
          systemAction: "system-info",
          systemParams: params,
        },
      },

      OPEN_APP: {
        action: "system-control",
        target: "app",
        parameters: {
          systemAction: "open-app",
          systemParams: params,
        },
      },

      CLOSE_APP: {
        action: "system-control",
        target: "app",
        parameters: {
          systemAction: "close-app",
          systemParams: params,
        },
      },

      SYSTEM_CONTROL: {
        action: "system-control",
        target: "system",
        parameters: {
          systemAction: params.systemAction || params.action || "unknown",
          systemParams: params,
        },
      },
    };

    const mapped = intentMap[intent];

    if (!mapped) {
      return null;
    }

    return {
      success: true,
      ...mapped,
      parameters: {
        ...mapped.parameters,
        originalInput,
        currentMessage: originalInput,
      },
      riskLevel: Number(routed.riskLevel ?? 0),
      confidence: Number(routed.confidence ?? 0.9),
      parsedBy: "intent-router",
      intent,
    };
  }

  async _parseCommand(input, context = {}) {
    if (!input || typeof input !== "string") {
      return {
        success: false,
        error: "No command supplied.",
      };
    }

    const trimmed = input.trim();

    if (!trimmed) {
      return {
        success: false,
        error: "Empty command.",
      };
    }

    // ==========================================================
// CENTRAL INTENT ROUTER
// Existing deterministic parsers remain first-class.
// AI router is used only when they cannot understand input.
// ==========================================================

const routerContext = {
  ownerId: context.ownerId || "anonymous",
  sessionId: context.sessionId || "default",
  ownerContext: this._getContext(context.owner),
};

const routed = await this.intentRouter.route(
  trimmed,
  routerContext
);

if (routed?.success && routed.intent !== "UNKNOWN") {
  const routedCommand = this._intentToCommand(routed, trimmed);

  if (routedCommand) {
    return routedCommand;
  }
}


    // ==========================================================
      // PRIORITY -1 ? REEL DETECTION (highest priority)
      // "reel" word + any generation verb/misspelling = generate-reel.
      // Kabhi general-chat ya script-writer me nahi jana chahiye.
      // ==========================================================
      const reelCmd = this._parseReelCommand(trimmed);
      if (reelCmd) {
        return reelCmd;
      }

    // ==========================================================
    // PRIORITY 0 ? SIMPLE CHAT
    // ==========================================================
    const chat = this._parseChat(trimmed);

    if (chat) {
      return chat;
    }

    // ==========================================================
    // PRIORITY 1 ? DETERMINISTIC FILE PARSER
    // ==========================================================
    const deterministic =
      this._parseFileCommand(trimmed);

      // ==========================================================
// PRIORITY 1A — LAPTOP / SYSTEM INFO
// Natural-language laptop info requests -> system-info
// ==========================================================
const laptopInfoIntent =
  /\b(laptop|computer|pc|system|machine|windows)\b[\s\S]{0,100}\b(cpu|processor|ram|memory|disk|storage|hard\s*disk|os|operating\s*system|complete\s*info|system\s*info|specs?|specifications?)\b/i.test(trimmed) ||
  /\b(cpu|processor|ram|memory|disk|storage|hard\s*disk|os|operating\s*system)\b[\s\S]{0,100}\b(laptop|computer|pc|system|machine)\b/i.test(trimmed);

if (laptopInfoIntent) {
  return {
    success: true,
    action: "system-control",
    target: "system",
    parameters: {
      systemAction: "system-info",
      systemParams: {},
      originalInput: trimmed,
      currentMessage: trimmed,
      sessionId: context.sessionId || "default",
      ownerId: context.ownerId || this._ownerIdOf(context.owner),
    },
    riskLevel: 0,
    confidence: 1,
    parsedBy: "deterministic-system-info",
  };
}

    let fileCommandHint = null;

    if (deterministic) {
      if (deterministic.success) {
        return deterministic;
      }

      const isExplicitFileCommand =
        /^\s*(create|make|add|generate|write|save|build)\b[\s\S]{0,100}\bfile\b/i.test(trimmed) ||
        /^\s*(modify|edit|update|rewrite|change|replace)\b[\s\S]{0,100}\b(file|code)\b/i.test(trimmed);

      if (isExplicitFileCommand) {
        return deterministic;
      }

      fileCommandHint =
        deterministic.error || null;
    }


    // ==========================================================
// PRIORITY 1B — APP / WEBSITE OPEN
// Natural language -> system-control
// ==========================================================
const openTargetMatch = trimmed.match(
  /^\s*(?:(?:please|plz)\s+)?(.+?)\s+(?:open|khol(?:o|na)?|chala(?:o|na)?)(?:\s+(?:karo|kar|kr|do|de|dena|kro))?\s*$/i
);
if (openTargetMatch) {
  const target = openTargetMatch[1].trim().toLowerCase();

  // Instagram
  if (
    /\binstagram\b|\binsta\b/i.test(target)
  ) {
    return {
      success: true,
      action: "system-control",
      target: "system",
      parameters: {
        systemAction: "open-url",
        systemParams: {
          url: "https://www.instagram.com"
        },
        originalInput: trimmed,
        currentMessage: trimmed,
        sessionId: context.sessionId || "default",
        ownerId: context.ownerId || this._ownerIdOf(context.owner),
      },
      riskLevel: 0,
      confidence: 1,
      parsedBy: "deterministic-open-url",
    };
  }

  // Chrome
  if (/\bchrome\b|\bgoogle chrome\b/i.test(target)) {
    return {
      success: true,
      action: "system-control",
      target: "system",
      parameters: {
        systemAction: "open-path",
        systemParams: {
          path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        },
        originalInput: trimmed,
        currentMessage: trimmed,
        sessionId: context.sessionId || "default",
        ownerId: context.ownerId || this._ownerIdOf(context.owner),
      },
      riskLevel: 0,
      confidence: 1,
      parsedBy: "deterministic-open-app",
    };
  }
}

    // ==========================================================
// PRIORITY 2 ? GOAL CLASSIFIER
// AUTO-REPAIR MUST RUN BEFORE GENERIC REGEX NLU
// ==========================================================
// Important:
// Long commands like:
// "Complete project scan karo, saari real problems
// automatically fix karo, har fix ke baad re-scan..."
//
// contain words such as "scan" + "problems", so the
// generic _fallbackParse() can incorrectly classify them
// as "find-bugs" before _parseGoal() sees autoRepairIntent.
//
// Therefore goal classification gets first chance here.
// ==========================================================
const goal = this._parseGoal(
  trimmed,
  null,
  null,
  fileCommandHint
);

if (goal) {
  return goal;
}

// ==========================================================
// PRIORITY 3 ? REGEX NLU
// ==========================================================
const fallback =
  this._fallbackParse(trimmed);

if (fallback?.success) {
  return fallback;
}

    // ==========================================================
    // PRIORITY 4 ? GENERAL CHAT DETECTOR
    // ==========================================================
    // Normal questions/conversation NEVER need command-AI.
    if (this._looksLikeGeneralChat(trimmed)) {
      return {
        success: true,
        action: "general-chat",
        target: "project",
        parameters: {
          originalInput: trimmed,
          currentMessage: trimmed,
          sessionId:
            context.sessionId ||
            "default",
          ownerId:
            context.ownerId ||
            this._ownerIdOf(
              context.owner
            ),
        },
        riskLevel: 1,
        confidence: 0.95,
        parsedBy:
          "general-chat-detector",
      };
    }

    // ==========================================================
    // PRIORITY 5 ? AI COMMAND PARSER
    // ONLY FOR GENUINELY AMBIGUOUS COMMANDS
    // ==========================================================
    let aiParseError = null;

    if (config.ai?.available) {
      try {
        const allowedActions =
          CommandAllowlist
            .getAllowedActions()
            .map(
              (a) =>
                `${a.action}: ${a.description}`
            )
            .join("\n");

        const prompt = `You are ALEX's command parser.

Convert the OWNER command into strict JSON.

ALLOWED ACTIONS:
${allowedActions}

OWNER COMMAND:
${JSON.stringify(trimmed)}

IMPORTANT RULES:
1. Never invent a filename.
2. If the owner gives a filename, preserve it exactly.
3. For create-file: target MUST be the filename/path.
4. For create-file, parameters.path MUST contain the filename.
5. For create-file, parameters.content MUST contain the complete requested content.
6. For modify-file, parameters.path MUST contain the existing file.
7. For modify-file, parameters.content MUST contain the complete replacement content if supplied.
8. Never use "project" as a filename when a filename exists.
9. Explicit analysis, testing, health, security, history, incident, deployment and fix commands must use their matching allowed action.
10. Normal questions and conversation must use "general-chat".
11. Never claim an action was performed.
12. Return JSON only.

FORMAT:
{"action":"create-file","target":"example.js","parameters":{"path":"example.js","content":"console.log('hello');"},"riskLevel":1,"confidence":1}`;

        const result =
  await callGemini(
    prompt,
    {
      temperature: 0,
      timeoutMs: 45000,
      retries: 5,
      chatMode: false,
    }
  );   

        const normalized =
          this._normalizeAIParse(
            result,
            trimmed
          );

        if (
          normalized &&
          normalized.success
        ) {
          normalized.parameters =
            normalized.parameters ||
            {};

          normalized.parameters.currentMessage =
            trimmed;

          normalized.parameters.sessionId =
            context.sessionId ||
            "default";

          normalized.parameters.ownerId =
            context.ownerId ||
            this._ownerIdOf(
              context.owner
            );

          return normalized;
        }

        aiParseError =
          "AI parser returned no usable action (malformed JSON, quota, unavailable, or unknown action).";
      } catch (error) {
        aiParseError =
          `AI parser error: ${error.message}`;

        console.log(
          "[ALEX] AI parser fallback:",
          error.message
        );
      }
    } else {
      aiParseError =
        "AI parser unavailable (config.ai.available = false).";
    }

    // ==========================================================
    // PRIORITY 6 ? FINAL GENERAL CHAT FALLBACK
    // ==========================================================
    if (config.ai?.available) {
      return {
        success: true,
        action: "general-chat",
        target: "project",
        parameters: {
          originalInput: trimmed,
          currentMessage: trimmed,
          sessionId:
            context.sessionId ||
            "default",
          ownerId:
            context.ownerId ||
            this._ownerIdOf(
              context.owner
            ),
        },
        riskLevel: 1,
        confidence: 0.55,
        parsedBy:
          "general-fallback",
      };
    }

    return {
      ...(fallback || {
        success: false,
        error:
          "No parser matched.",
      }),

      diagnostics: {
        reason:
          "Command matched no parser and AI chat fallback is unavailable.",

        aiParser:
          aiParseError,

        regexNlu:
          fallback?.success
            ? "Regex NLU matched."
            : "No regex pattern matched.",

        goalClassifier:
          goal
            ? "Goal classifier matched."
            : "No build/analysis/remediation intent detected.",

        fileCommandHint,

        inputLength:
          trimmed.length,

        isMultiLine:
          trimmed.includes("\n"),
      },
    };
  }

  

  // ============================================================
  // ALEX MEMORY QUESTION HANDLER (owner-scoped)
  // "mera naam kya hai?" — answered ONLY from the current owner's memory
  // ============================================================

  async _answerMemoryQuestion(input, owner = null) {
    const text =
      String(input || "").trim();

    const isNameQuestion =
  /^(?:mera|meri)\s+(?:naam|name)\s+(?:kya\s+(?:hai|h)|btao|batao|bata\s+do|bta\s+do)\s*[?!?.]*$/i.test(text) ||
  /^my\s+name\s+(?:kya\s+hai|what\s+is\s+it|batao|tell\s+me)\s*[?!?.]*$/i.test(text) ||
  /^what\s+is\s+my\s+name\s*[?!?.]*$/i.test(text);
    const isAgeQuestion =
      /^(?:meri|mera)\s+(?:age|umar)\s+(?:kya\s+(?:hai|h)|kitni\s+(?:hai|h))\s*[?!?.]*$/i.test(text) ||
      /^my\s+age\s+(?:kya\s+hai|kitni\s+hai|what\s+is\s+it)\s*[?!?.]*$/i.test(text) ||
      /^how\s+old\s+am\s+i\s*[?!?.]*$/i.test(text) ||
      /^what\s+is\s+my\s+age\s*[?!?.]*$/i.test(text);

    if (!isNameQuestion && !isAgeQuestion) {
      return null;
    }

    const ownerId =
      this._ownerIdOf(owner);

    let facts = [];

    try {
      facts =
        await chatMemory.getFacts(
          50,
          { ownerId }
        );
    } catch (error) {
      console.warn(
        "[ALEX] owner-scoped getFacts unavailable:",
        error?.message || error
      );

      // SECURITY:
      // NEVER fall back to unscoped memory.
      facts = [];
    }

    const safeFacts =
      Array.isArray(facts)
        ? facts.map((f) => String(f))
        : [];

    // ==========================================================
    // NAME
    // ==========================================================
    if (isNameQuestion) {
      const nameFact =
        safeFacts.find((fact) =>
          /^(owner'?s?\s+name|owner\s+name)\s+is\s+/i.test(
            fact
          )
        );

      if (!nameFact) {
        return {
          success: true,
          message:
            "Abhi mujhe aapka naam memory mein nahi mila.",
          mode: "memory",
          memoryFound: false,
        };
      }

      const name =
        nameFact
          .replace(
            /^(owner'?s?\s+name|owner\s+name)\s+is\s+/i,
            ""
          )
          .trim();

      return {
        success: true,
        message:
          `Aapka naam ${name} hai. Mujhe yaad hai.`,
        mode: "memory",
        memoryFound: true,
      };
    }

    // ==========================================================
    // AGE
    // ==========================================================
    const ageFact =
      safeFacts.find((fact) =>
        /^(owner'?s?\s+age|owner\s+age)\s+is\s+\d{1,3}\b/i.test(
          fact
        )
      );

    if (!ageFact) {
      return {
        success: true,
        message:
          "Abhi mujhe aapki age memory mein nahi mili.",
        mode: "memory",
        memoryFound: false,
      };
    }

    const ageMatch =
      ageFact.match(
        /\b(\d{1,3})\b/
      );

    return {
      success: true,
      message:
        `Aapki age ${ageMatch ? ageMatch[1] : "available"} saal hai. Mujhe yaad hai.`,
      mode: "memory",
      memoryFound: true,
    };
  }

  async _rememberPersonalStatement(
    input,
    owner = null,
    sessionId = "default"
  ) {
    const text =
      String(input || "").trim();

    let name = null;
    let age = null;

    // ==========================================================
    // NAME PATTERNS
    // ==========================================================
    const namePatterns = [
  /^\s*(?:(?:hye|hyy|hey|hi|hello|helo)\s+)?mera\s+naam\s+(.+?)\s+(?:hai|h)\s*[.!?]*\s*$/,
  /^\s*(?:(?:hye|hyy|hey|hi|hello|helo)\s+)?my\s+name\s+is\s+(.+?)\s*[.!?]*\s*$/i,
  /^\s*(?:(?:hye|hyy|hey|hi|hello|helo)\s+)?i(?:'m| am)\s+([A-Za-z][A-Za-z .'-]{1,60})\s*[.!?]*\s*$/i,
];

    for (const pattern of namePatterns) {
      const match =
        text.match(pattern);

      if (!match) continue;

      const candidate =
        String(match[1] || "")
          .trim();

      if (
        candidate &&
        candidate.length <= 60 &&
        !/\b(age|umar|years?\s*old|saal)\b/i.test(
          candidate
        )
      ) {
        name =
          candidate.replace(
            /\s+/g,
            " "
          );

        break;
      }
    }

    // ==========================================================
    // AGE PATTERNS
    // ==========================================================
    const agePatterns = [
      /^\s*meri\s+age\s+(\d{1,3})\s*(?:hai|h|saal(?:\s+hai)?)?\s*[.!?]*\s*$/i,
      /^\s*meri\s+umar\s+(\d{1,3})\s*(?:saal)?\s*(?:hai|h)?\s*[.!?]*\s*$/i,
      /^\s*my\s+age\s+is\s+(\d{1,3})\s*(?:years?\s*old)?\s*[.!?]*\s*$/i,
      /^\s*i\s+am\s+(\d{1,3})\s+years?\s+old\s*[.!?]*\s*$/i,
      /^\s*i['?]?m\s+(\d{1,3})\s*[.!?]*\s*$/i,
    ];

    for (const pattern of agePatterns) {
      const match =
        text.match(pattern);

      if (!match) continue;

      const candidate =
        Number(match[1]);

      if (
        Number.isInteger(candidate) &&
        candidate >= 1 &&
        candidate <= 120
      ) {
        age = candidate;
        break;
      }
    }

    if (
      name === null &&
      age === null
    ) {
      return null;
    }

    const ownerId =
      this._ownerIdOf(owner);

    const remembered = [];

    // ==========================================================
    // SAVE STRUCTURED FACTS
    // ==========================================================
    try {
      if (
        typeof chatMemory.remember ===
        "function"
      ) {
        if (name !== null) {
          await chatMemory.remember(
            `owner's name is ${name}`,
            { ownerId }
          );

          remembered.push("name");
        }

        if (age !== null) {
          await chatMemory.remember(
            `owner's age is ${age}`,
            { ownerId }
          );

          remembered.push("age");
        }
      }
    } catch (error) {
      console.warn(
        "[ALEX] personal fact remember failed:",
        error?.message || error
      );
    }

    // ==========================================================
    // SAVE ORIGINAL MESSAGE
    // ==========================================================
    try {
      if (
        typeof chatMemory.saveMessage ===
        "function"
      ) {
        await chatMemory.saveMessage(
          sessionId || "default",
          "owner",
          text.slice(0, 2000),
          { ownerId }
        );
      }
    } catch (error) {
      console.warn(
        "[ALEX] personal statement memory save failed:",
        error?.message || error
      );
    }

    // ==========================================================
    // RESPONSE
    // ==========================================================
    if (
      name !== null &&
      age !== null
    ) {
      return {
        success: true,
        message:
          `Theek hai, ${name}. Naam aur age dono yaad rakh li.`,
        mode: "memory-write",
        remembered: [
          "name",
          "age",
        ],
      };
    }

    if (name !== null) {
      return {
        success: true,
        message:
          `Theek hai, ${name}. Naam yaad rakh liya.`,
        mode: "memory-write",
        remembered: [
          "name",
        ],
      };
    }

    return {
      success: true,
      message:
        "Theek hai, age yaad rakh li.",
      mode: "memory-write",
      remembered: [
        "age",
      ],
    };
  }

  _looksLikeGeneralChat(input) {
    const lower =
      String(input || "")
        .toLowerCase()
        .trim();

    if (!lower) {
      return false;
    }

    // ==========================================================
    // EXPLICIT COMMANDS ALWAYS WIN
    // ==========================================================
    const explicitCommand =
      /\b(deep\s+analysis|analysis|analyze|analyse|inspect|audit|review|report|findings|fix\s+bugs?|fixes?\s+apply|security[\s-]?scan|run\s+tests?|check\s+health|check\s+database|show\s+(history|actions|incidents|report)|list\s+(history|actions|incidents)|create\s+file|make\s+file|modify\s+file|edit\s+file|delete\s+file|rewrite\s+file|generate\s+reel|reel|reels|prepare\s+deploy|verify|remediation|plan\s+approve|build\s+(?:a\s+)?(?:module|feature|component|system|service|class|api|dashboard|script|tool|handler|manager))\b/i.test(lower) ||
      /^\s*(create|make|add|generate|write|save|build|modify|edit|update|rewrite|change|replace|delete|remove|run|check|show|list|fix|scan|deploy|verify)\b/i.test(lower);

    if (explicitCommand) {
      return false;
    }

    // ==========================================================
    // QUESTION MARK = GENERAL CONVERSATION
    // ==========================================================
    if (/[??]/.test(lower)) {
      return true;
    }

    // ==========================================================
    // HINGLISH / ENGLISH CONVERSATIONAL SIGNALS
    // ==========================================================
    return /\b(kya|kyu|kyun|kyon|ku|kaise|kaisa|kis|kise|kahan|kab|kaunsa|kaunsi|what|why|how|who|when|where|which|can\s+you|could\s+you|would\s+you|explain|tell\s+me|samjha|samjho|samjhe|samajh|samajh\s+gaye|batao|btao|bata\s+do|mujhe\s+bata|tum\s+kya|mere\s+liye|same\s+reply|same\s+response|abhi\s+jo|jo\s+mne|jo\s+maine|message|msg|bheja|dekha|dheka|huaa|hua|kyu\s+same)\b/i.test(lower);
  }


  // ============================================================
  // REEL COMMAND PARSER — catches ALL spellings/phrasings
  // ============================================================
  _parseReelCommand(input) {
    const lower = input.toLowerCase().trim();

    // Core: agar "reel"/"video"/"short" word hai
    const hasReelWord = /\b(reel|reels|video|videos|short|shorts|instagram\s*reel)\b/i.test(lower);
    if (!hasReelWord) return null;

    // Generation intent — typos included (genrate, genret, banav, bna, etc.)
    const genIntent =
      /\b(genrat\w*|generat\w*|creat\w*|mak\w*|bana\w*|bna\w*|banav\w*|banade|bana\s*de|bana\s*do|kr\s*do|kar\s*do|kardo|chahiye|banwa\w*|render)\b/i.test(lower) ||
      /\breel\s+(bana|genrat|generat|banade)\b/i.test(lower);

    if (!genIntent) return null;

    // Safety guard: agar owner explicitly "script/idea/text likho" bol raha hai
    // tab video nahi, script chahiye
    if (/\b(script|idea\s+only|text\s+likho|likh\s+do|likho\s+only)\b/i.test(lower) &&
        !/\b(video|render)\b/i.test(lower)) {
      return null;
    }

    return {
      success: true,
      action: "generate-reel",
      target: input.trim(),
      parameters: {
        prompt: input.trim(),
        originalInput: input,
      },
      riskLevel: 1,
      confidence: 0.99,
      parsedBy: "reel-command-parser",
    };
  }

  // ============================================================
  // CASUAL CHAT PARSER
  // ============================================================

  _parseChat(input) {
    const lower =
      input.toLowerCase().trim();

    const isGreeting =
      /^(hye|hey|hi+|hlo|hello+|namaste|namaskar|salam|aoa|yo|oye|hellos?|greetings?)\b/i.test(lower) ||
      /^(good\s+(morning|afternoon|evening|night))\b/i.test(lower) ||
      /^(alex)\s*[.!]?\s*$/i.test(lower);

    const isHowAreYou =
      /^(kaise\s*ho|kaisa\s*hai|kya\s*haal|how\s*(are|r)\s*(you|u)|hows?\s*it\s*going|sup|whats?\s*up|sab\s*theek)\b/i.test(lower) ||
      /(kaise\s*ho|kaisa\s*hai|kya\s*haal)\s*(alex|bhai)?\s*[?!?.]*$/i.test(lower);

    const isAck =
      /^(theek|thik|acha|accha|sahi|ok(ay)?|ohk|haan|han|ha|nahi|nhi|no|yes|haanji|ji|sahi\s*hai|theek\s*hai|thik\s*hai)\s*[.!]?\s*$/i.test(lower);

    const isThanks =
      /^(shukriya|dhanyavad|dhanyawad|thank(s|\s*you)?|thx|tysm|thanks\s*(a\s*lot|bhai|alex)?)\b/i.test(lower);

    const isBye =
      /^(bye|alvida|good\s*bye|goodbye|see\s*you|tata|gn|good\s*night|phir\s*milenge|chalta\s*hun|chalta\s*hu)\b/i.test(lower);

    if (
      !isGreeting &&
      !isHowAreYou &&
      !isAck &&
      !isThanks &&
      !isBye
    ) {
      return null;
    }

    // ==========================================================
    // REAL COMMAND GUARD
    // ==========================================================
    const hasCommandIntent =
      /\b(analysis|inspect|fix|test|status|health|database|incident|history|log|deploy|scan|security|report|findings|verify|remediation|plan|run|check|show|list|create|file|command|banao|bana|karo|kar\s*do)\b/i.test(lower);

    if (
      hasCommandIntent &&
      (isGreeting || isHowAreYou)
    ) {
      return null;
    }

    // ==========================================================
    // LONG GREETING GUARD
    // ==========================================================
    if (
      (isGreeting || isHowAreYou) &&
      input.length > 60
    ) {
      return null;
    }

    // ==========================================================
    // PERSONAL MEMORY GUARD
    // ==========================================================
    const personalIntent =
      /(mera\s+(naam|name)|meri\s+(age|umar)|my\s+name|my\s+age|how\s+old\s+am\s+i|mujh?e\s+yaad|meri\s+baat|mera\s+bare|mere\s+bare)/i.test(lower);

    if (personalIntent) {
      return null;
    }

    const chatType =
      isThanks
        ? "thanks"
        : isBye
          ? "bye"
          : isHowAreYou
            ? "howAreYou"
            : isAck
              ? "ack"
              : "greeting";

    return {
      success: true,
      action: "chat",
      target: "project",
      parameters: {
        chatType,
        originalInput: input,
      },
      riskLevel: 1,
      confidence: 0.95,
      parsedBy: "chat-parser",
    };
  }

  // ============================================================
  // GOAL CLASSIFIER — natural-language build/implement/analysis goals
  // ============================================================

  _parseGoal(input, aiParseError = null, regexError = null, fileCommandHint = null) {
    const lower = input.toLowerCase();

    // ---------------------------------------------------------
    // REMEDIATION EXECUTE intent (plan approved → fix)
    // ---------------------------------------------------------
    const planExecuteIntent =
      /(plan\s+(approve|approved|accept|apply|execute|shuru|start|confirm))/.test(lower) ||
      /(approve\s+kar|apply\s+kar|execute\s+the\s+plan|plan\s+manzoor)/.test(lower) ||
      /(ab\s+fix\s+karo|ab\s+fixes?\s+apply|fixes?\s+apply\s+karo)/.test(lower);

    if (planExecuteIntent) {
      return {
        success: true,
        action: "fix-bugs",
        target: "project",
        parameters: {
          originalInput: input,
          source: "goal-classifier",
          remediation: true,
        },
        riskLevel: 2,
        confidence: 0.85,
        reason: "Detected plan-approval/execute intent → routed to fix-bugs (requires confirmation, creates backups before any modification).",
        parsedBy: "goal-classifier",
      };
    }

    // ---------------------------------------------------------
// AUTO REPAIR intent
// Fresh scan -> safe fixes -> verify -> re-scan -> next fix
// ---------------------------------------------------------
const autoRepairIntent =
  /(complete|full|poora|pura|saara|saari|all|entire)\b[\s\S]{0,80}\b(project|code|codebase|app|system)\b[\s\S]{0,100}\b(scan|check|inspect|audit|analy[sz]e)\b[\s\S]{0,120}\b(fix|repair|resolve|patch|correct)\b/i.test(lower) ||

  /\b(scan|check|inspect|audit|analy[sz]e)\b[\s\S]{0,100}\b(all|saari|saare|real|actual)\b[\s\S]{0,100}\b(problem|problems|bug|bugs|issue|issues|finding|findings)\b[\s\S]{0,100}\b(automatically|auto|khud|apne\s+aap|fix|repair|solve|resolve)\b/i.test(lower) ||

  /\b(saari|saare|sab|all)\b[\s\S]{0,100}\b(real\s+)?(problem|problems|bug|bugs|issue|issues|finding|findings)\b[\s\S]{0,100}\b(auto|automatically|khud|apne\s+aap)\b[\s\S]{0,100}\b(fix|repair|solve|resolve|patch)\b/i.test(lower) ||

  /\b(har|each|every)\b[\s\S]{0,80}\b(fix|problem|issue|bug|finding)\b[\s\S]{0,100}\b(re-?scan|rescan|verify|check)\b/i.test(lower) ||

  /\b(safely\s+fix|safe\s+fix)\b[\s\S]{0,100}\b(skip|skipped|nahi\s+ho\s+sakti|manual)\b/i.test(lower);

if (autoRepairIntent) {
  return {
    success: true,
    action: "fix-bugs",
    target: "project",
    parameters: {
      originalInput: input,
      autoRepair: true,
      freshScan: true,
      verifyAfterFix: true,
      rescanAfterFix: true,
      skipUnsafe: true,
    },
    riskLevel: 2,
    confidence: 0.98,
    reason:
      "Detected automatic project repair intent -> fresh scan, safe repair, verification and re-scan.",
    parsedBy: "goal-classifier-auto-repair",
  };
}

    // ---------------------------------------------------------
    // REMEDIATION PLAN intent (read-only fix planning)
    // ---------------------------------------------------------
    const fixIntent =
      /(findings?\s+(fix|repair|resolve|patch|hal))/.test(lower) ||
      /(fix|repair|resolve|patch|auto[\s-]?fix)[a-z]*\s+[\s\S]{0,30}\b(karo|kar|do|dena|apply|hal|kam)\b/.test(lower) &&
        /(finding|kami|issue|bug|vulnerabilit|problem|critical|security|error)/.test(lower) ||
      /(safe\s+fixes|security\s+fixes|critical\s+security\s+fixes)/.test(lower) ||
      /(production[\s-]*ready\s+(bana|ban|karo|karna|banana))/i.test(lower) ||
      /(systematically\s+(karo|fix))/.test(lower) && /(fix|finding|kami|issue|repair)/.test(lower);

    if (fixIntent) {
      return {
        success: true,
        action: "inspect",
        target: "project",
        parameters: {
          remediationPlan: true,
          originalInput: input,
          source: "goal-classifier",
        },
        riskLevel: 1,
        confidence: 0.85,
        reason: "Detected remediation/production-readiness goal → routed to inspect (READ-ONLY fix plan). No file will be modified without explicit plan approval.",
        parsedBy: "goal-classifier",
      };
    }

    // ---------------------------------------------------------
    // DEEP ANALYSIS intent — read-only project analysis report
    // ---------------------------------------------------------
    const analysisIntent =
  (/(analysis|analyze|analyse|inspect|audit|review|report|scan|check)\b/.test(lower) &&
   /(karo|kar|do|dijiye|perform|run|give|provide|dedo|dena|chahiye|report|findings|detailed|deep|complete|full|poora|pura|saare|sab)/.test(lower)) ||

  /(har\s+(bug|problem|issue|vulnerability|finding))/.test(lower) ||

  /((bug|issue|problem|vulnerabilit)\S*\s+(dhundo|khojo|find|check))/.test(lower) ||

  /(dhundo|khojo)\b/.test(lower) ||

  (
    /(project|code|system|app|application)\b/.test(lower) &&
    /(scan|check|inspect|review|audit|analy[sz]e|analysis|dekho|karo|kr|dhundo|khojo)/.test(lower)
  ) ||

  (
    /(complete|full|deep|detailed|poora|pura|saara|sab|har)\b/.test(lower) &&
    /(project|code|system|app|application|files?|codebase)\b/.test(lower) &&
    /(scan|check|inspect|review|audit|analysis|analy[sz]e|dekho|karo|kr)/.test(lower)
  ) ||

  (/sirf\s+.{0,30}(inspect|analysis|report|review)/.test(lower)) ||

  (/modify\/?delete\s+mat\s+karo/.test(lower)) ||

  (/mat\s+bolo\s+.{0,20}(inspection|analysis)/.test(lower)) ||

  /(change\s+kiya|kiye\s+the|kaunsa\s*code\s*change|kya\s*change\s*kiya|what\s+did\s+i\s+change|changed\s+files)/i.test(lower);
  
  if (analysisIntent && !this._parseFileCommand(input)) {
      // Changed-file question → dedicated read-only git evidence action
      const changedFilesIntent =
        /(change\s+kiya|kiye\s+the|kaunsa\s*code\s*change|kya\s*change\s*kiya|what\s+did\s+i\s+change|changed\s+files)/i.test(lower);

      return {
        success: true,
        action: "inspect",
        target: "project",
        parameters: {
          deep: !changedFilesIntent,
          changedFiles: changedFilesIntent,
          originalInput: input,
          source: "goal-classifier",
        },
        riskLevel: 1,
        confidence: 0.85,
        reason: changedFilesIntent
          ? "Detected changed-files question → routed to read-only git evidence check (no guessing)."
          : "Detected read-only deep-analysis goal → routed to inspect (deep analysis report). No files will be modified.",
        parsedBy: "goal-classifier",
      };
    }

    // ---------------------------------------------------------
    // BUILD / IMPLEMENT intent
    // ---------------------------------------------------------
    const buildIntent = /\b(build|create|implement|develop|scaffold|generate|write|make|add)\b[\s\S]{0,40}\b(module|feature|component|system|service|class|library|controller|api|dashboard|script|utility|tool|handler|manager)\b/.test(lower);
    const modifyIntent = /\b(update|extend|refactor|improve|rewrite)\b[\s\S]{0,30}\b(module|feature|component|class|service|handler|manager)\b/.test(lower);

    if (!buildIntent && !modifyIntent) return null;

    const moduleName = this._extractModuleName(input);
    const existing = modifyIntent ? this._guessExistingFile(moduleName) : null;

    let fileName;
    let action;
    if (modifyIntent && existing) {
      action = "modify-file";
      fileName = existing;
    } else {
      action = "create-file";
      fileName = `modules/${this._toSnakeCase(moduleName)}.js`;
    }

    const requirements = this._parseRequirements(input);
    const content = this._buildModuleScaffold(moduleName, requirements, input);

    const reasonBits = [];
    reasonBits.push(`Detected natural-language ${modifyIntent ? "modification" : "build"} goal → routed to ${action} with generated scaffold for "${moduleName}".`);
    if (aiParseError) reasonBits.push(`(AI parser: ${aiParseError})`);
    if (regexError) reasonBits.push(`(Regex NLU: ${String(regexError).slice(0, 120)})`);
    if (fileCommandHint) reasonBits.push(`(File parser hint: ${String(fileCommandHint).slice(0, 120)})`);

    return {
      success: true,
      action,
      target: fileName,
      parameters: {
        path: fileName,
        content,
        originalInput: input,
        source: "goal-classifier",
        requirementsProvided: requirements.length > 0,
        moduleName,
      },
      riskLevel: action === "modify-file" ? 2 : 1,
      confidence: 0.8,
      reason: reasonBits.join(" "),
      parsedBy: "goal-classifier",
    };
  }

  _extractModuleName(input) {
    const quoted = input.match(/["'`]([A-Za-z][A-Za-z0-9 _-]{2,40})["'`]/);
    if (quoted) return quoted[1].trim();

    const title = input.match(/\b([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*){1,5})\b/);
    if (title && !/^(the|this|owner|alex)/i.test(title[1])) return title[1];

    const forMatch = input.match(/\b(?:module|system|service|component|handler|manager)\b[\s\S]{0,30}\bfor\b\s+(?:my\s+|the\s+)?([A-Za-z0-9 _-]{3,40})/i);
    if (forMatch) {
      const cleaned = forMatch[1].trim().replace(/\s+(system|cameras?|devices?).*$/i, "").trim();
      if (cleaned) return cleaned;
    }

    return "CustomModule";
  }

  _toSnakeCase(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "custom_module";
  }

  _guessExistingFile(moduleName) {
    const candidates = [
      `modules/${this._toSnakeCase(moduleName)}.js`,
      `${this._toSnakeCase(moduleName)}.js`,
      `${this._toSnakeCase(moduleName)}.ts`,
    ];
    for (const rel of candidates) {
      const validation = CommandAllowlist.validateFilePath(rel);
      if (validation.valid && fs.existsSync(validation.resolved)) return rel;
    }
    return null;
  }

  _parseRequirements(input) {
    const lines = input.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const reqs = [];
    for (const line of lines) {
      const m = line.match(/^\d+[\).\s]+(.+)$/);
      if (m) reqs.push(m[1].replace(/\*+/g, "").trim());
    }
    return reqs;
  }

  _buildModuleScaffold(moduleName, requirements, originalInput) {
    const isDeviceModule = /\b(camera|cctv|nvr|iot|device|sensor|lock)\b/i.test(originalInput);
    const safeCommentInput = String(originalInput).slice(0, 200).replace(/\*\//g, "").replace(/\r?\n/g, " ");
    const className = moduleName.replace(/[^A-Za-z0-9]/g, "") || "CustomModule";

    const lines = [
      "// ============================================================",
      `// ${moduleName} — generated by ALEX goal-classifier`,
      `// Owner request: ${safeCommentInput}`,
      "// ============================================================",
      "",
      "// SAFETY CONTRACT (applies to device-related modules):",
      "//  - Only owner-registered/authorized devices may be managed.",
      "//  - NO network scanning, discovery, or access of unknown devices.",
      "//  - Proximity/IP/location alone never grants authorization.",
      "//  - All control actions are reversible, confirmed, and audited.",
      "//  - Fail-safe: on communication loss, devices return to default state.",
      "",
      `class ${className} {`,
      "  constructor(options = {}) {",
      "    this.options = options;",
      "    this.initialized = false;",
      "    this.auditLog = [];",
      "    this.authorized = new Map();",
      "  }",
      "",
      "  async init() {",
      "    // TODO: initialize per requirements below",
      "    this.initialized = true;",
      "    return this;",
      "  }",
      "",
      "  _audit(action, target, result) {",
      "    this.auditLog.push({ action, target, result, timestamp: new Date().toISOString() });",
      "  }",
      "",
    ];

    if (requirements.length) {
      lines.push("  // ---- Owner requirements (for implementation) ----");
      for (const r of requirements.slice(0, 20)) {
        lines.push("  // * " + r.replace(/\*\//g, "").replace(/\r?\n/g, " "));
      }
      lines.push("");
    }

    if (isDeviceModule) {
      lines.push(
        "  // Owner-registered device registry — devices must be pre-authorized",
        "  // via explicit registration (id + official API details supplied by owner).",
        "  registerAuthorizedDevice(device) {",
        "    if (!device || !device.id || !device.apiBaseUrl) {",
        "      throw new Error(\"Device registration requires id and official API base URL\");",
        "    }",
        "    this.authorized.set(device.id, { ...device, registeredAt: new Date().toISOString() });",
        "    this._audit(\"register-device\", device.id, \"ok\");",
        "    return true;",
        "  }",
        "",
        "  _requireAuthorized(deviceId) {",
        "    const d = this.authorized.get(deviceId);",
        "    if (!d) throw new Error(\"Device not registered as owner-authorized: \" + deviceId);",
        "    return d;",
        "  }",
        "",
        "  // Temporary pause via device's OFFICIAL management interface only",
        "  async pauseDevice(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    try {",
        "      const res = await fetch(device.apiBaseUrl + \"/pause\", { method: \"POST\", headers: device.authHeaders || {} });",
        "      this._audit(\"pause\", deviceId, res.ok ? \"ok\" : \"failed\");",
        "      return res.ok;",
        "    } catch (err) {",
        "      this._audit(\"pause\", deviceId, \"error: \" + err.message);",
        "      throw new Error(\"Communication lost — device left unchanged (fail-safe)\");",
        "    }",
        "  }",
        "",
        "  async restoreDevice(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    try {",
        "      const res = await fetch(device.apiBaseUrl + \"/resume\", { method: \"POST\", headers: device.authHeaders || {} });",
        "      this._audit(\"restore\", deviceId, res.ok ? \"ok\" : \"failed\");",
        "      return res.ok;",
        "    } catch (err) {",
        "      this._audit(\"restore\", deviceId, \"error: \" + err.message);",
        "      throw new Error(\"Communication lost — device left unchanged (fail-safe)\");",
        "    }",
        "  }",
        "",
        "  healthCheck(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    this._audit(\"health-check\", deviceId, \"reported\");",
        "    return { deviceId, status: \"unknown\", note: \"Report unsupported/unverifiable devices instead of controlling them\" };",
        "  }",
        "",
      );
    }

    lines.push("}", "");
    lines.push(`module.exports = { ${className} };`, "");

    return lines.join("\n");
  }

  // ============================================================
  // DEEP PROJECT ANALYSIS — READ-ONLY static analysis report
  // ============================================================
  async _analyzeProject(originalInput) {
    const findings = [];
    const stats = {
      filesScanned: 0,
      filesSkippedProtected: 0,
      totalLines: 0,
      scannedFiles: [],
      notInspected: [],
    };

    const CODE_EXT = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"]);
    const PROTECTED_DIRS = new Set([".git", "node_modules", ".alex-backups", "cache", "dist", "build"]);
    const MAX_FILE_BYTES = 200 * 1024;
    const MAX_FILES = 400;

    const addFinding = (severity, file, location, problem, why, fix, safelyFixable) => {
      findings.push({ severity, file, location: location || "unknown", problem, why, recommendedFix: fix, safelyFixable });
    };

    const walk = (dir, depth) => {
      if (depth > 5 || stats.filesScanned >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
        stats.notInspected.push({ file: dir, reason: e.message });
        return;
      }

      for (const entry of entries) {
        if (stats.filesScanned >= MAX_FILES) {
          stats.notInspected.push({ file: dir, reason: "scan limit reached (MAX_FILES)" });
          break;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (PROTECTED_DIRS.has(entry.name) || entry.name.startsWith(".")) { stats.filesSkippedProtected++; continue; }
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();

        // Protected file patterns never read
        if (/^\.env|^credentials|^secrets|\.pem$|\.cert$|\.key$/.test(entry.name)) { stats.filesSkippedProtected++; continue; }

        if (!CODE_EXT.has(ext) && entry.name !== "package.json") continue;

        let content;
        let stat;
        try {
          stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) { stats.notInspected.push({ file: full, reason: `too large (${stat.size} bytes)` }); continue; }
          content = fs.readFileSync(full, "utf8");
        } catch (e) {
          stats.notInspected.push({ file: full, reason: e.message });
          continue;
        }

        stats.filesScanned++;
        const rel = path.relative(PROJECT_ROOT, full);
        stats.scannedFiles.push({ file: rel, size: stat.size, lines: content.split("\n").length });
        stats.totalLines += content.split("\n").length;

        const lines = content.split("\n");

        // --- Static checks per file ---
        lines.forEach((line, i) => {
          const loc = `${rel}:${i + 1}`;
          if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
            addFinding("Low", rel, loc, `Unresolved marker: ${line.trim().slice(0, 100)}`, "Indicates incomplete work.", "Complete or remove the marker.", true);
          }
          if (/\beval\s*\(|new\s+Function\s*\(/.test(line) && !/^\s*\/[/*]/.test(line)) {
            addFinding("High", rel, loc, "Use of eval()/new Function()", "Code injection risk if any part of the input is user-controlled.", "Replace with safe parsing (JSON.parse, explicit logic).", false);
          }
          if (/\b(child_process|execSync|exec)\b/.test(line) && /\breq\.(body|query|params)\b|template literal.*\$\{/.test(line)) {
            addFinding("Critical", rel, loc, "Possible command injection (exec with dynamic input)", "Unsanitized input can reach shell.", "Use execFile with fixed args; never interpolate input into shell strings.", false);
          }
          if (/(api[_-]?key|secret|password|token|credential)\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(line) && !/process\.env|placeholder|example/i.test(line)) {
            // Value is NEVER included in the finding — location only
            addFinding("Critical", rel, loc, "Possible hardcoded secret", "Secrets in source leak via git.", "Move to environment variables. (Value withheld)", false);
          }
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
            addFinding("Medium", rel, loc, "Empty catch block — errors silently swallowed", "Failures become invisible and hard to debug.", "Log the error or handle it explicitly.", true);
          }
        });

        // File-level checks
        if (content.split("\n").length > 800) {
          addFinding("Low", rel, "whole file", `Very large file (${content.split("\n").length} lines)`, "Hard to maintain and review.", "Split into smaller modules.", false);
        }

        // package.json checks
        if (entry.name === "package.json") {
          try {
            const pkg = JSON.parse(content);
            if (!pkg.scripts || !pkg.scripts.test) {
              addFinding("Medium", rel, "scripts", "No test script defined", "npm test will fail; fix-loop and verification depend on it.", 'Add "test": "node --test" or a test runner.', true);
            }
            if (!pkg.scripts || (!pkg.scripts.start && !pkg.scripts.main)) {
              addFinding("Low", rel, "scripts", "No start script", "Deployment tooling may fail.", 'Add "start" script.', true);
            }
          } catch (e) {
            addFinding("Medium", rel, "JSON", "package.json is not valid JSON", "npm tooling may break.", "Fix JSON syntax.", false);
          }
        }
      }
    };

    walk(PROJECT_ROOT, 0);

    // Repo-level checks
    const gitignorePath = path.join(PROJECT_ROOT, ".gitignore");
    if (fs.existsSync(path.join(PROJECT_ROOT, ".env")) && fs.existsSync(gitignorePath)) {
      const gi = fs.readFileSync(gitignorePath, "utf8");
      if (!/^\.env/m.test(gi)) {
        addFinding("Critical", ".gitignore", "-", ".env exists but is NOT in .gitignore", "Secrets may be committed to git.", 'Add ".env" to .gitignore.', true);
      }
    }

    // Severity summary — HEURISTIC readiness (clearly labelled as such)
    const bySeverity = { Critical: [], High: [], Medium: [], Low: [] };
    for (const f of findings) (bySeverity[f.severity] || bySeverity.Low).push(f);

    const totalIssues = findings.length;
    const readinessHeuristic = Math.max(0, Math.min(100,
      100 - (bySeverity.Critical.length * 12) - (bySeverity.High.length * 7) - (bySeverity.Medium.length * 3) - (bySeverity.Low.length * 1)
    ));

    const fixOrder = ["Critical", "High", "Medium", "Low"]
      .flatMap(sev => bySeverity[sev].slice(0, 5).map(f => `${sev}: ${f.problem} (${f.file})`))
      .slice(0, 10);

    const reportText = this._formatReportText({
      findings, bySeverity, totalIssues, readiness: readinessHeuristic,
      fixOrder, stats, totalFiles: stats.filesScanned,
    });

    // Optional AI narrative summary (non-blocking)
    let aiSummary = null;
    if (config.ai?.available) {
      try {
        const condensed = findings.slice(0, 30).map(f => `[${f.severity}] ${f.file} ${f.location}: ${f.problem}`).join("\n");
        const prompt = `Summarize this project analysis in under 200 words. Highlight the top risks and overall production readiness.\n\nFindings:\n${condensed}`;
        const res = await callGemini(prompt, { temperature: 0.2, timeoutMs: 12000 });
        if (res) aiSummary = typeof res === "string" ? res.slice(0, 1200) : (res.text || res.summary || String(res).slice(0, 1200));
      } catch (e) {
        console.warn("[ALEX] AI summary unavailable:", e?.message || e);
        aiSummary = null;
      }
    }

    // Real verification status (honest, evidence-based)
    let gitVerification = null;
    try {
      gitVerification = this._detectChangedFiles();
    } catch (e) {
      gitVerification = { verified: false, reason: e.message };
    }

    const result = {
      success: true,
      message: `Deep analysis complete: ${totalIssues} findings across ${stats.filesScanned} files (read-only, nothing modified). Report ready — say "report dikhao" or "show report" to view it.`,
      mode: "read-only-analysis",
      scanLimits: {
        maxFiles: MAX_FILES,
        maxFileBytes: MAX_FILE_BYTES,
        maxDepth: 5,
        skippedProtected: stats.filesSkippedProtected,
        notInspectedCount: stats.notInspected.length,
        note: stats.filesScanned >= MAX_FILES
          ? "Scan limit reached — report is PARTIAL, not a complete project analysis."
          : undefined,
      },
      summary: {
        totalIssues,
        critical: bySeverity.Critical.length,
        high: bySeverity.High.length,
        medium: bySeverity.Medium.length,
        low: bySeverity.Low.length,
        // HEURISTIC — not a real production-readiness measurement
        heuristicReadinessPercent: readinessHeuristic,
        readinessIsHeuristic: true,
      },
      verificationStatus: {
        git: gitVerification,
        note: "Real readiness requires passing tests + build + env verification — use 'run tests' and 'prepare-deploy'.",
      },
      topIssues: fixOrder,
      findings: findings.slice(0, 100),
      report: reportText,
      filesScanned: stats.scannedFiles,
      notInspected: stats.notInspected.length ? stats.notInspected : undefined,
      skippedProtected: stats.filesSkippedProtected,
      aiSummary,
      note: "Findings marked safelyFixable=true can be fixed via 'fix bugs' or explicit modify-file commands. Follow-ups: 'report dikhao', 'file ka path btao', 'findings verify karo', 'remediation plan banao'.",
      requestedAs: String(originalInput || "").slice(0, 200),
    };

    // CACHE the full report for follow-up queries
    this.lastAnalysis = {
      ...result,
      cachedAt: new Date().toISOString(),
      bySeverity,
    };

    return result;
  }

  // ============================================================
  // REMEDIATION PLAN (READ-ONLY)
  // ============================================================
  async _buildRemediationPlan(originalInput) {
    if (!this.lastAnalysis) {
      console.log("[ALEX] Remediation plan: no cached analysis — running fresh deep analysis (read-only)...");
      await this._analyzeProject(originalInput);
      if (!this.lastAnalysis) {
        return { success: false, error: "Analysis could not be completed; remediation plan unavailable." };
      }
    }

    const a = this.lastAnalysis;

    // --- READ-ONLY git history check: is .env tracked? (names only, never values) ---
    let gitStatus;
    try {
      const tracked = execFileSync("git", ["ls-files", "--", ".env", ".env.*"],
        { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
      const files = tracked.split("\n").map(s => s.trim()).filter(Boolean);
      gitStatus = {
        checked: true,
        envTrackedInGit: files.length > 0,
        trackedFiles: files,
        warning: files.length > 0
          ? "⚠️ .env file(s) are TRACKED in git history. Do NOT simply unblock/unignore and push. Safe cleanup plan: (1) rotate ALL secrets now, (2) add .env to .gitignore, (3) git rm --cached .env, (4) rewrite history with git filter-repo or BFG, (5) force-push only after owner review."
          : null,
      };
    } catch (e) {
      gitStatus = { checked: false, reason: `git check unavailable: ${e.message}` };
    }

    // --- Split findings into auto-fixable vs manual ---
    const autoFixable = a.findings.filter(f => f.safelyFixable);
    const manual = a.findings.filter(f => !f.safelyFixable);

    const priority = ["Critical", "High", "Medium", "Low"];
    const bySev = list => priority.flatMap(s => list.filter(f => f.severity === s));

    // --- Build markdown plan (NEVER prints secret values) ---
    const L = [];
    L.push(`# 🛠️ ALEX Remediation Plan (READ-ONLY — nothing modified yet)`);
    L.push(`**Based on analysis of:** ${new Date(a.cachedAt).toLocaleString()}`);
    L.push(`**Total findings:** ${a.summary.totalIssues} | 🔴 ${a.summary.critical} | 🟠 ${a.summary.high} | 🟡 ${a.summary.medium} | ⚪ ${a.summary.low}`);
    L.push(`**Heuristic readiness estimate:** ${a.summary.heuristicReadinessPercent}% _(heuristic, not a real measurement)_`);
    L.push("");
    L.push(`## ✅ AUTO-FIXABLE (${autoFixable.length}) — safe, will ask confirmation + backup each`);
    for (const f of bySev(autoFixable).slice(0, 40)) {
      L.push(`- **[${f.severity}]** \`${f.file}\` \`${f.location}\` — ${f.problem}`);
      L.push(`  - Fix: ${f.recommendedFix}`);
    }
    if (!autoFixable.length) L.push("_None_");
    L.push("");
    L.push(`## ⚠️ REQUIRES MANUAL REVIEW (${manual.length}) — ALEX will NOT auto-touch these`);
    for (const f of bySev(manual).slice(0, 40)) {
      L.push(`- **[${f.severity}]** \`${f.file}\` \`${f.location}\` — ${f.problem}`);
      L.push(`  - Why manual: ${f.why}`);
      L.push(`  - Recommended: ${f.recommendedFix}`);
    }
    if (!manual.length) L.push("_None_");
    L.push("");

    L.push(`## 🔐 Git / .env status`);
    if (gitStatus.checked) {
      L.push(`- .env tracked in git history: **${gitStatus.envTrackedInGit ? "YES — CRITICAL: rotate secrets + history cleanup required (see warning)" : "No (good)"}**`);
      if (gitStatus.warning) L.push(`- ${gitStatus.warning}`);
    } else {
      L.push(`- Git check unavailable: ${gitStatus.reason}`);
    }
    L.push(`- .gitignore contains .env: check via "findings verify karo"`);
    L.push("");

    L.push(`## 🚀 Deployment: required env-var NAMES (values OWNER-ONLY, never shown)`);
    L.push(`- \`ADMIN_KEY\` — owner command auth (currently weak/known value — MUST rotate before deploy)`);
    L.push(`- \`JWT_SECRET\` — auth token signing`);
    L.push(`- \`MONGO_URI\` — database connection`);
    L.push(`- Gemini API keys (via config/geminiKeys.js source as configured)`);
    L.push(`- Any other \`process.env.*\` referenced by the app (frontend needs \`VITE_API_URL\`)`);
    L.push("");

    L.push(`## ▶️ NEXT STEP`);
    L.push(`- Reply **"plan approve karo"** or **"ab fix karo"** → ALEX will execute the AUTO-FIXABLE items via its fix-loop, with explicit confirmation + backup before every modification. Manual items will be listed as "requires manual review" — ALEX will NOT guess those.`);
    L.push("");
    L.push(`_Generated: ${new Date().toISOString()} | mode: read-only planning_`);

    const estimatedReadiness = Math.max(0, Math.min(100,
      a.summary.heuristicReadinessPercent + (autoFixable.filter(f => f.severity === "Critical").length * 12)
      + (autoFixable.filter(f => f.severity === "High").length * 7)
      + (autoFixable.filter(f => f.severity === "Medium").length * 3)
    ));

    return {
      success: true,
      mode: "remediation-plan",
      message: `Remediation plan ready: ${autoFixable.length} auto-fixable, ${manual.length} manual-review findings. NOTHING modified yet. Say "plan approve karo" to begin safe fixes (each with confirmation + backup).`,
      summary: {
        ...a.summary,
        autoFixable: autoFixable.length,
        manualReview: manual.length,
        estimatedReadinessAfterAutoFix: estimatedReadiness,
        readinessIsHeuristic: true,
      },
      gitStatus,
      autoFixableFindings: autoFixable.slice(0, 100),
      manualFindings: manual.slice(0, 100),
      report: L.join("\n"),
      note: "Plan is read-only. Execution requires explicit approval and runs through confirmation + backup-before-modification. Secret values are never displayed.",
      requestedAs: String(originalInput || "").slice(0, 200),
    };
  }

  // ============================================================
  // REPORT FORMATTER — markdown text for frontend display
  // ============================================================
  _formatReportText({ findings, bySeverity, totalIssues, readiness, fixOrder, stats, totalFiles }) {
    const L = [];
    L.push(`# 🔍 ALEX Deep Analysis Report`);
    L.push(`**Files scanned:** ${totalFiles} | **Findings:** ${totalIssues} | **Heuristic readiness:** ${readiness}% _(heuristic estimate — not a real measurement)_`);
    L.push(`**Severity:** 🔴 Critical: ${bySeverity.Critical.length} | 🟠 High: ${bySeverity.High.length} | 🟡 Medium: ${bySeverity.Medium.length} | ⚪ Low: ${bySeverity.Low.length}`);
    L.push("");

    L.push(`## 🔴 Critical`);
    if (bySeverity.Critical.length === 0) L.push("_None_");
    for (const f of bySeverity.Critical.slice(0, 15)) L.push(`- **${f.file}** \`${f.location}\` — ${f.problem}\n  - Why: ${f.why}\n  - Fix: ${f.recommendedFix}\n  - Auto-fix: ${f.safelyFixable ? "✅ Yes" : "⚠️ Manual review required"}`);
    L.push("");

    L.push(`## 🟠 High`);
    if (bySeverity.High.length === 0) L.push("_None_");
    for (const f of bySeverity.High.slice(0, 15)) L.push(`- **${f.file}** \`${f.location}\` — ${f.problem}\n  - Why: ${f.why}\n  - Fix: ${f.recommendedFix}\n  - Auto-fix: ${f.safelyFixable ? "✅ Yes" : "⚠️ Manual review required"}`);
    L.push("");

    L.push(`## 🟡 Medium`);
    if (bySeverity.Medium.length === 0) L.push("_None_");
    for (const f of bySeverity.Medium.slice(0, 20)) L.push(`- **${f.file}** \`${f.location}\` — ${f.problem} → Fix: ${f.recommendedFix} (auto-fix: ${f.safelyFixable ? "yes" : "no"})`);
    L.push("");

    L.push(`## ⚪ Low`);
    if (bySeverity.Low.length === 0) L.push("_None_");
    for (const f of bySeverity.Low.slice(0, 20)) L.push(`- **${f.file}** \`${f.location}\` — ${f.problem}`);
    L.push("");

    L.push(`## 📋 TOP fixes (in order)`);
    fixOrder.forEach((item, i) => L.push(`${i + 1}. ${item}`));
    L.push("");

    if (stats.notInspected.length) {
      L.push(`## ⚠️ NOT INSPECTED (no guessing)`);
      for (const n of stats.notInspected.slice(0, 15)) L.push(`- ${n.file} — ${n.reason}`);
      L.push("");
    }

    L.push(`_Protected paths skipped: ${stats.filesSkippedProtected} | Generated: ${new Date().toISOString()}_`);
    return L.join("\n");
  }

  // ============================================================
  // FOLLOW-UP: affected files list from cached report
  // ============================================================
  _findingsByFile() {
    if (!this.lastAnalysis) return null;
    const byFile = new Map();
    for (const f of this.lastAnalysis.findings) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    const L = [];
    L.push(`# 📁 Files with issues (${byFile.size} files, ${this.lastAnalysis.findings.length} findings)`);
    L.push("");
    for (const [file, list] of byFile) {
      const counts = {};
      for (const f of list) counts[f.severity] = (counts[f.severity] || 0) + 1;
      L.push(`## ${file} — ${list.length} issue(s) [${Object.entries(counts).map(([s, c]) => `${s}:${c}`).join(", ")}]`);
      for (const f of list.slice(0, 10)) {
        L.push(`- \`${f.location}\` **[${f.severity}]** ${f.problem}`);
        L.push(`  - Why: ${f.why}`);
        L.push(`  - Fix: ${f.recommendedFix} (auto-fix: ${f.safelyFixable ? "✅" : "⚠️ manual"})`);
      }
      if (list.length > 10) L.push(`- _...and ${list.length - 10} more in this file_`);
      L.push("");
    }
    return {
      success: true,
      message: `Report for ${byFile.size} affected files (from cached analysis of ${new Date(this.lastAnalysis.cachedAt).toLocaleString()}).`,
      mode: "cached-report",
      report: L.join("\n"),
      files: Array.from(byFile.keys()),
      summary: this.lastAnalysis.summary,
    };
  }

  // ============================================================
  // FOLLOW-UP: verify top findings against actual code
  // ============================================================
  _verifyFindings(count = 5) {
    if (!this.lastAnalysis) {
      return { success: false, error: "No cached analysis report. Run a deep analysis first (e.g. 'deep analysis karo')." };
    }

    const priority = ["Critical", "High", "Medium", "Low"];
    const targets = priority.flatMap(sev => this.lastAnalysis.bySeverity[sev] || []).slice(0, count);

    const results = targets.map(f => {
      const verification = {
        finding: f,
        verdict: "UNVERIFIED",
        evidence: "",
      };

      // Repo-level finding (.gitignore check)
      if (f.location === "-" || f.file === ".gitignore") {
        try {
          const gi = fs.readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8");
          const envExists = fs.existsSync(path.join(PROJECT_ROOT, ".env"));
          const stillMissing = envExists && !/^\.env/m.test(gi);
          verification.verdict = stillMissing ? "GENUINE" : "FALSE_POSITIVE";
          verification.evidence = `.env exists: ${envExists}; .gitignore contains .env entry: ${/^\.env/m.test(gi)}`;
        } catch (e) {
          verification.verdict = "CANNOT_VERIFY";
          verification.evidence = e.message;
        }
        return verification;
      }

      // File:line finding — re-read actual file ONCE
      const [filePart, linePart] = String(f.location).split(":");
      const lineNo = parseInt(linePart, 10);
      const abs = path.join(PROJECT_ROOT, filePart || f.file);
      try {
        const content = fs.readFileSync(abs, "utf8");
        const lines = content.split("\n");
        const idx = Number.isInteger(lineNo) ? lineNo - 1 : -1;

        // package.json parsed ONCE
        let pkgHasTest = null;
        if (f.problem.includes("test script")) {
          try {
            const pkg = JSON.parse(content);
            pkgHasTest = !!(pkg.scripts && pkg.scripts.test);
          } catch (e) { pkgHasTest = false; }
        }

        const patternStillPresent = lines.some(l => {
          if (f.problem.includes("eval")) return /\beval\s*\(|new\s+Function\s*\(/.test(l) && !/^\s*\/[/*]/.test(l);
          if (f.problem.includes("command injection")) return /\b(child_process|execSync|exec)\b/.test(l) && /\$\{/.test(l);
          if (f.problem.includes("hardcoded secret")) return /(api[_-]?key|secret|password|token|credential)\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(l) && !/process\.env/i.test(l);
          if (f.problem.includes("Empty catch")) return /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l);
          if (f.problem.includes("marker")) return /\b(TODO|FIXME|HACK|XXX)\b/.test(l);
          // FIX (3.7.1): verdict was inverted — the finding is "No test
          // script defined", so the problem pattern is still present only
          // when the test script is STILL MISSING.
          if (f.problem.includes("test script")) return pkgHasTest !== true;
          return false;
        });

        if (idx >= 0 && idx < lines.length) {
          const actualLine = lines[idx].trim();
          // NEVER print secret values — mask anything that looks like one
          const safeLine = actualLine.replace(/(["'])(?:(?!\1)[^\\]|\\.)*\1/g, m => {
            return /secret|key|token|password|credential/i.test(actualLine) ? `"****"` : m;
          }).slice(0, 160);
          verification.verdict = patternStillPresent ? "GENUINE" : "FALSE_POSITIVE";
          verification.evidence = `Line ${lineNo} (masked, value NOT shown): ${safeLine}`;
        } else {
          verification.verdict = patternStillPresent ? "GENUINE" : "FALSE_POSITIVE";
          verification.evidence = `Line ${lineNo} not found in file, but pattern ${patternStillPresent ? "still present" : "absent"} elsewhere in file.`;
        }
      } catch (e) {
        verification.verdict = "CANNOT_VERIFY";
        verification.evidence = `NOT INSPECTED: ${e.message}`;
      }
      return verification;
    });

    const genuine = results.filter(r => r.verdict === "GENUINE").length;
    const falsePos = results.filter(r => r.verdict === "FALSE_POSITIVE").length;

    const L = [];
    L.push(`# 🔬 Finding Verification (top ${results.length}, read-only — nothing modified)`);
    L.push("");
    for (const r of results) {
      const icon = r.verdict === "GENUINE" ? "🔴 GENUINE" : r.verdict === "FALSE_POSITIVE" ? "🟢 FALSE POSITIVE" : "❓ CANNOT VERIFY";
      L.push(`## ${icon} — ${r.finding.file} \`${r.finding.location}\` [${r.finding.severity}]`);
      L.push(`- **Problem:** ${r.finding.problem}`);
      L.push(`- **Evidence:** ${r.evidence}`);
      L.push(`- **Safe fix:** ${r.finding.recommendedFix}`);
      L.push(`- **Files to change:** ${r.finding.file}${r.finding.safelyFixable ? " (+ possibly .gitignore)" : ""}`);
      L.push(`- **Auto-fix:** ${r.finding.safelyFixable ? "✅ Possible via 'fix bugs'" : "⚠️ Manual approval required"}`);
      L.push("");
    }
    L.push(`**Summary:** ${genuine} genuine, ${falsePos} false positive(s), ${results.length - genuine - falsePos} unverifiable.`);

    return {
      success: true,
      message: `Verified ${results.length} findings: ${genuine} genuine, ${falsePos} false positive(s), ${results.length - genuine - falsePos} cannot verify. (read-only)`,
      mode: "verification",
      report: L.join("\n"),
      verifications: results,
    };
  }

  // ============================================================
  // COMPREHENSIVE FALLBACK PARSER — 50+ natural variations
  // ============================================================
  _fallbackParse(input) {
    const lower = input.toLowerCase().trim();

    // --- REEL GENERATION ---
    if (
      /\b(reel|reels|video|videos|short|shorts)\b/i.test(lower) &&
      /\b(genrat\w*|generat\w*|creat\w*|mak\w*|build|bana\w*|bna\w*|kr\s*do|kar\s*do|chahiye|render)\b/i.test(lower)
    ) {
      return {
        success: true,
        action: "generate-reel",
        target: input.trim(),
        parameters: { prompt: input.trim(), originalInput: input },
        riskLevel: 1,
        confidence: 0.98,
      };
    }

    // --- CHANGED FILES ---
    if (/(change\s+kiya|kiye\s+the|kaunsa\s*code\s*change|kya\s*change\s*kiya|what\s+did\s+i\s+change|changed\s+files|git\s*status)/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { changedFiles: true, originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- HELP / ACTIONS ---
    if (/^(what|show|list|display|get|view|tell)\s.*(can|do|action|command|ability|capabilit|help|allow)/i.test(lower) ||
        /^(help|actions|commands|menu|options|capabilities|what can you do)$/i.test(lower) ||
        /^list\s+(all\s+)?(actions|commands)/i.test(lower) ||
        /^show\s+(me\s+)?(available|allowed)\s+(actions|commands)/i.test(lower)) {
      return { success: true, action: "list-actions", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- STATUS ---
    if (/^(status|state|report|summary|overview|how\s+(are|is)\s+(you|the\s+system))/i.test(lower) ||
        /^system\s+status/i.test(lower)) {
      return { success: true, action: "status", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- HEALTH ---
    if (/(check|test|verify|run)\s.*(health|alive|running|ok|up\s+and\s+running)/i.test(lower) ||
        /^health/i.test(lower) ||
        /is\s+(the\s+)?(system|server|app)\s+(healthy|running|ok|up)/i.test(lower) ||
        /how\s+(is|are)\s+(the\s+)?(system|server|app)/i.test(lower)) {
      return { success: true, action: "check-health", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DATABASE ---
    if (/(check|test|verify|show)\s.*(database|db|mongo|connection)/i.test(lower) ||
        /^database/i.test(lower) ||
        /is\s+the\s+database\s+(up|connected|running)/i.test(lower)) {
      return { success: true, action: "check-database", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- SHOW LAST REPORT (cached) ---
    if (/(show|dikha|dikhao|dikha do|display|view|dekhna|batao|btao|list)\b[\s\S]{0,40}\b(report|findings|analysis|result|issues?|kami|kamiyan|files?)\b/.test(lower) ||
        /^last\s+(analysis|report)/.test(lower) ||
        /(file\s*ka\s*path|file\s*paths?|kin\s*files|kis\s*file|konsi\s*file)/.test(lower) ||
        /path\s+batao|path\s+btao/.test(lower)) {
      if (!/(karo|perform|run)\s*$/.test(lower) && !/analysis\s+karo/.test(lower)) {
        return { success: true, action: "inspect", target: "project", parameters: { showLast: true, originalInput: input }, riskLevel: 1, confidence: 0.9 };
      }
    }

    // --- VERIFY FINDINGS ---
    if (/(verify|confirm|check|validate)\b[\s\S]{0,40}\b(finding|issue|problem|report|analysis|kami)/.test(lower) ||
        /(genuine|false\s+positive)/.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { verifyFindings: true, originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DEEP ANALYSIS ---
    if (/(deep|detailed|full|complete|actual)\s+(analysis|inspect|review|audit)/i.test(lower) ||
        /(analysis|inspect|review|audit)\s+karo/i.test(lower) ||
        /(detailed\s+findings|findings\s+do|report\s+do)/i.test(lower) ||
        /(har\s+(bug|problem|issue|vulnerabilit))/i.test(lower) ||
        /modify\s*\/?\s*delete\s+mat\s+karo/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { deep: true, originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    // --- REMEDIATION PLAN ---
    if (/(fix|repair|resolve|patch|auto[\s-]?fix)\b[\s\S]{0,60}\b(findings?|kami|kamiyan|vulnerabilit)/i.test(lower) ||
        /(safe\s+fixes|security\s+fixes|critical\s+security\s+fixes)/i.test(lower) ||
        /(production[\s-]*ready)/i.test(lower) ||
        /(systematically\s+(karo|fix))/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { remediationPlan: true, originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    // --- INSPECT ---
    if (/(inspect|explore|browse|show\s+structure|list\s+files|directory|tree)\b.*(project|code|app|structure|files|directory)/i.test(lower) ||
        /^inspect/i.test(lower) ||
        /show\s+me\s+the\s+(project|code)/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- FIND BUGS ---
    if (/(find|look\s*for|detect|search|analyze|check|scan)\b.*(bug|issue|problem|vulnerabilit|error|defect)/i.test(lower) ||
        /^find\s+(bugs|issues)/i.test(lower) ||
        /are\s+there\s+(any\s+)?(bugs|issues|problems)/i.test(lower)) {
      return { success: true, action: "find-bugs", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- FIX BUGS ---
    if (/(fix|resolve|repair|patch|correct|auto.fix)\b.*(bug|issue|problem|error)/i.test(lower) ||
        /^fix\s+(bugs|issues|problems)/i.test(lower)) {
      return { success: true, action: "fix-bugs", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- SECURITY INSPECT ---
    if (/(inspect|check|scan|audit|review|analyze)\b.*security/i.test(lower) ||
        /^security/i.test(lower) ||
        /is\s+(the\s+)?(app|project|code)\s+secure/i.test(lower) ||
        /are\s+there\s+(any\s+)?(security\s+)?(issues|vulnerabilit)/i.test(lower)) {
      return { success: true, action: "inspect-security", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- SECURITY SCAN ---
    if (/(full\s+)?security\s+scan/i.test(lower) ||
        /scan\s+(for\s+)?(vulnerabilit|threat|security)/i.test(lower)) {
      return { success: true, action: "security-scan", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- IMPROVE CODE ---
    if (/(improve|enhance|optimize|refactor|clean|modernize)\b.*(code|quality|structure|performance)/i.test(lower) ||
        /^improve\s+(code|quality)/i.test(lower) ||
        /make\s+(the\s+)?(code|app)\s+better/i.test(lower)) {
      return { success: true, action: "improve-code", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- IMPROVE SECURITY ---
    if (/(improve|harden|strengthen|secure|better)\b.*security/i.test(lower) || /^harden/i.test(lower)) {
      return { success: true, action: "improve-security", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- LOGS ---
    if (/(inspect|read|view|show|check|get|fetch|display)\b.*(log|audit)/i.test(lower) ||
        /^logs/i.test(lower) ||
        /show\s+me\s+the\s+(logs|audit)/i.test(lower)) {
      return { success: true, action: "inspect-logs", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- TESTS ---
    if (/(run|execute|start|trigger)\b.*(test|spec|suite|jest|mocha)/i.test(lower) ||
        /^run\s+tests/i.test(lower) ||
        /^test/i.test(lower) ||
        /test\s+the\s+(project|app|code|system)/i.test(lower) ||
        /^npm\s+test(\s|$)/i.test(lower)) {
      return { success: true, action: "run-tests", target: "project", parameters: { originalInput: input, command: "npm test" }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DEPLOY ---
    if (/(prepare|ready|stage|setup|check)\b.*(deploy|release|production|launch|publish)/i.test(lower) ||
        /^deploy/i.test(lower) ||
        /is\s+(it\s+)?(ready|safe)\s+(to\s+)?deploy/i.test(lower)) {
      return { success: true, action: "prepare-deploy", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    // --- INCIDENTS ---
    if (/(show|list|get|display|view|check)\b.*(incident|issue|problem|alert)/i.test(lower) ||
        /^incidents/i.test(lower)) {
      return { success: true, action: "list-incidents", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- HISTORY ---
    if (/(show|list|get|display|view)\b.*(history|past|previous|recent)/i.test(lower) ||
        /^history/i.test(lower) ||
        /what\s+(did|have)\s+(i|you)\s+(do|run|execute)/i.test(lower)) {
      return { success: true, action: "list-history", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- VERIFY ---
    if (/(verify|self.test|check\s+all|validate)\b.*(action|command|system)/i.test(lower) ||
        /^verify(\s+all)?$/i.test(lower) ||
        /check\s+(if\s+)?(everything|all)\s+(is\s+)?(working|ok)/i.test(lower)) {
      return { success: true, action: "verify", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    return {
      success: false,
      error: `Could not understand command: "${input.slice(0, 200)}"`,
      suggestion: "Try: inspect project, run tests, check health, show actions, fix bugs, check security, show incidents, show history, verify all — 'deep analysis karo', 'report dikhao', 'file ka path btao', 'findings verify karo', 'remediation plan banao', 'plan approve karo'"
    };
  }

  // ============================================================
  // FILE COMMAND PARSER
  // ============================================================
  _parseFileCommand(input) {
    const normalized = input.trim();

    // Delete file detection (Hinglish + English)
    const deleteMatch = normalized.match(/\b(?:delete|remove|hatao|hata\s*do|mita\s*do)\b[\s\S]*?(?:"([^"]+\.[A-Za-z0-9]+)"|'([^']+\.[A-Za-z0-9]+)'|`([^`]+\.[A-Za-z0-9]+)`|([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+))/i);
    if (deleteMatch) {
      const filePath = deleteMatch[1] || deleteMatch[2] || deleteMatch[3] || deleteMatch[4];
      if (filePath) {
        return { success: true, action: "delete-file", target: filePath, parameters: { path: filePath, originalInput: input }, riskLevel: 3, confidence: 0.95 };
      }
    }

    // Create file detection
    const createMatch = normalized.match(/\b(?:create|make|add|generate|write|save|build)\b[\s\S]*?\bfile\b[\s\S]*?(?:"([^"]+\.[A-Za-z0-9]+)"|'([^']+\.[A-Za-z0-9]+)'|`([^`]+\.[A-Za-z0-9]+)`|([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+))/i);

    if (createMatch || /\bcreate\s+file\b/i.test(normalized)) {
      const filePath = createMatch?.[1] || createMatch?.[2] || createMatch?.[3] || createMatch?.[4];
      if (!filePath) {
        return { success: false, error: 'Create-file command detected, but no filename was found. Example: Create file test.js with content console.log("OK");' };
      }
      const content = this._extractFileContent(normalized, filePath);
      if (content === null || content === undefined) {
        return { success: false, error: `Filename "${filePath}" was detected, but file content was not provided.` };
      }
      return { success: true, action: "create-file", target: filePath, parameters: { path: filePath, content, originalInput: input }, riskLevel: 1, confidence: 1 };
    }

    // Modify file detection
    const modifyMatch = normalized.match(/\b(?:modify|edit|update|rewrite|change|replace|badlo|badal\s*do)\b[\s\S]*?\b(?:file|code|file\s*ka\s*content)\b[\s\S]*?(?:"([^"]+\.[A-Za-z0-9]+)"|'([^']+\.[A-Za-z0-9]+)'|`([^`]+\.[A-Za-z0-9]+)`|([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+))/i);

    if (modifyMatch) {
      const filePath = modifyMatch[1] || modifyMatch[2] || modifyMatch[3] || modifyMatch[4];
      const content = this._extractFileContent(normalized, filePath);
      if (content === null || content === undefined) {
        return { success: false, error: `File "${filePath}" detected, but replacement content was not supplied.` };
      }
      return { success: true, action: "modify-file", target: filePath, parameters: { path: filePath, content, originalInput: input }, riskLevel: 2, confidence: 1 };
    }

    return null;
  }

  // ============================================================
  // CONTENT EXTRACTION — Handles multiline, code, JSON
  // ============================================================
  _extractFileContent(input, filePath) {
    const markerPatterns = [
      /with\s+exactly\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /exactly\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+this\s+exact\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+content\s*:\s*([\s\S]*)$/i,
      /containing\s*:\s*([\s\S]*)$/i,
      /contains\s*:\s*([\s\S]*)$/i,
      /content\s*:\s*([\s\S]*)$/i,
    ];

    for (const pattern of markerPatterns) {
      const match = input.match(pattern);
      if (match) return this._cleanExtractedContent(match[1]);
    }

    const withMatch = input.match(/\bwith\b\s+([\s\S]+)$/i);
    if (withMatch && !/^with\s+(exactly\s+this\s+)?content/i.test(withMatch[0])) {
      const candidate = withMatch[1].trim();
      if (candidate) return this._cleanExtractedContent(candidate);
    }

    const containingMatch = input.match(/\bcontaining\b\s+([\s\S]+)$/i);
    if (containingMatch) return this._cleanExtractedContent(containingMatch[1]);

    const contentMatch = input.match(/\bcontent\b\s+([\s\S]+)$/i);
    if (contentMatch) return this._cleanExtractedContent(contentMatch[1]);

    return null;
  }

  _cleanExtractedContent(content) {
    if (content === null || content === undefined) return "";
    let value = String(content).trim();

    value = value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
    value = value.replace(/\n?```\s*$/, "");

    if (value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    return value;
  }

  // ============================================================
  // AI RESULT NORMALIZATION — WITH SAFETY VALIDATION
  // Every AI action is validated against the allowlist; paths are
  // validated; unknown actions and invalid params are rejected.
  // ============================================================
  _normalizeAIParse(result, originalInput) {
    if (!result) return null;
    let parsed = result;
    if (typeof result === "string") {
      try { parsed = JSON.parse(this._extractJSON(result)); } catch (e) {
        console.log("[ALEX] AI parse rejected: malformed JSON. Raw:", String(result).slice(0, 200));
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.action || parsed.action === "unknown") {
      console.log("[ALEX] AI parse rejected: no/unknown action. Raw:", String(result).slice(0, 200));
      return null;
    }

    const action = String(parsed.action).trim();

    // SAFETY: action must be allowlisted — AI output can NEVER bypass security
    if (!CommandAllowlist.isActionAllowed(action)) {
      console.log("[ALEX] AI parse rejected: action not in allowlist:", action);
      return null;
    }

    const parameters = parsed.parameters && typeof parsed.parameters === "object" ? { ...parsed.parameters } : {};
    let target = parsed.target || parameters.path || "project";

    if (action === "generate-reel") {
      parameters.prompt = parameters.prompt || originalInput;
      target = parameters.prompt;
    }

    if (action === "create-file" || action === "modify-file" || action === "delete-file") {
      // Prefer the deterministic local parse for file actions
      const local = this._parseFileCommand(originalInput);
      if (local) return local;

      if (!parameters.path && (!target || target === "project")) {
        console.log("[ALEX] AI parse rejected: file action without extractable path.");
        return { success: false, error: "File action detected but filename/path was not extracted." };
      }

      // SAFETY: validate the AI-provided path BEFORE execution
      const validation = CommandAllowlist.validateFilePath(parameters.path || target);
      if (!validation.valid) {
        console.log("[ALEX] AI parse rejected: invalid file path.");
        return { success: false, error: `AI-provided path rejected by path validation: ${validation.error}` };
      }

      if ((action === "create-file" || action === "modify-file") &&
          (parameters.content === undefined || parameters.content === null)) {
        return { success: false, error: "File action detected but no content provided. ALEX will not guess file contents." };
      }
    }

    if (action === "run-command") {
      const cmd = parameters.command || target;
      if (!cmd || !CommandAllowlist.isCommandAllowed(cmd) || CommandAllowlist.containsBlockedPattern(cmd)) {
        console.log("[ALEX] AI parse rejected: command not allowed or blocked pattern detected:", String(cmd).slice(0, 100));
        return {
          success: false,
          error: "Command was rejected by the security allowlist. Only approved commands (e.g. npm test, git status, node --check) can be executed.",
          rejectedCommand: String(cmd).slice(0, 80),
        };
      }
      parameters.command = cmd;
      target = cmd;
    }

    // Risk level: clamp AI-provided value to 1..5
    const riskLevel = Math.max(1, Math.min(5, Number(parsed.riskLevel) || 2));

    return {
      success: true,
      action,
      target,
      parameters,
      riskLevel,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
    };
  }

  // ============================================================
  // AI RESPONSE — JSON EXTRACTOR
  // Handles: raw JSON, ```json fenced blocks, JSON embedded in prose
  // ============================================================
  _extractJSON(text) {
    if (typeof text !== "string") return text;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1];
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
    return text;
  }

  // ============================================================
  // BACKUPS — before any modification
  // ============================================================
  _ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  _backupFile(absPath) {
    this._ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.basename(absPath);
    const dest = path.join(BACKUP_DIR, `${stamp}__${base}`);
    fs.copyFileSync(absPath, dest);
    return dest;
  }

  // ============================================================
  // FILE HANDLERS — create / modify / delete (protected paths enforced)
  // ============================================================
  async _handleCreateFile(parameters) {
    const filePath = parameters.path;
    if (!filePath) return { success: false, error: "File path is required." };

    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: `Path rejected: ${validation.error}` };
    const abs = validation.resolved;

    if (fs.existsSync(abs)) {
      return { success: false, error: `File already exists: ${filePath}. Use modify-file instead.` };
    }

    const content = String(parameters.content ?? "");
    if (content.length > MAX_FILE_SIZE) return { success: false, error: `Content exceeds max size (${MAX_FILE_SIZE} bytes).` };

    // FIX (3.7.1): create parent directories so nested paths don't crash
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
    } catch (e) {
      return { success: false, error: `Could not create parent directory: ${e.message}` };
    }

    this._ensureBackupDir();
    fs.writeFileSync(abs, content, "utf8");
    this._audit("create-file", filePath, "created");

    return {
      success: true,
      message: `File created: ${filePath} (${content.length} bytes).`,
      filePath, bytes: content.length,
      backupNote: "New file — no backup needed.",
    };
  }

  async _handleModifyFile(parameters) {
    const filePath = parameters.path;
    if (!filePath) return { success: false, error: "File path is required." };

    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: `Path rejected: ${validation.error}` };
    const abs = validation.resolved;

    if (!fs.existsSync(abs)) return { success: false, error: `File not found: ${filePath}` };
    if (CommandAllowlist.isProtectedFile(filePath)) return { success: false, error: `File is protected and cannot be modified: ${filePath}` };

    const content = String(parameters.content ?? "");
    if (content.length > MAX_FILE_SIZE) return { success: false, error: `Content exceeds max size (${MAX_FILE_SIZE} bytes).` };

    let backupPath = null;
    try {
      backupPath = this._backupFile(abs);
    } catch (e) {
      return { success: false, error: `Backup failed — modification aborted: ${e.message}` };
    }

    fs.writeFileSync(abs, content, "utf8");
    this._audit("modify-file", filePath, "modified");

    return {
      success: true,
      message: `File modified: ${filePath} (${content.length} bytes). Backup: ${path.relative(PROJECT_ROOT, backupPath)}`,
      filePath, bytes: content.length,
      backupPath: path.relative(PROJECT_ROOT, backupPath),
    };
  }

  async _handleDeleteFile(parameters) {
    const filePath = parameters.path;
    if (!filePath) return { success: false, error: "File path is required." };

    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: `Path rejected: ${validation.error}` };
    const abs = validation.resolved;

    if (!fs.existsSync(abs)) return { success: false, error: `File not found: ${filePath}` };
    if (CommandAllowlist.isProtectedFile(filePath)) return { success: false, error: `File is protected and cannot be deleted: ${filePath}` };

    let backupPath;
    try {
      backupPath = this._backupFile(abs);
    } catch (e) {
      return { success: false, error: `Backup failed — deletion aborted: ${e.message}` };
    }

    fs.unlinkSync(abs);
    this._audit("delete-file", filePath, "deleted");

    return {
      success: true,
      message: `File deleted: ${filePath}. Backup saved: ${path.relative(PROJECT_ROOT, backupPath)}`,
      filePath,
      backupPath: path.relative(PROJECT_ROOT, backupPath),
    };
  }

  async _readFileSafe(filePath) {
    if (!filePath) return { success: false, error: "No file path supplied." };
    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: `Path rejected: ${validation.error}` };
    try {
      const content = fs.readFileSync(validation.resolved, "utf8");
      return { success: true, message: `File: ${filePath}`, filePath, content: content.slice(0, 8000) };
    } catch (e) {
      return { success: false, error: `Could not read file: ${e.message}` };
    }
  }

  _audit(action, target, result) {
    try {
      const audit = getAuditLogger?.();
      if (audit?.log) audit.log({ action, target, result, timestamp: new Date().toISOString() });
    } catch (e) {
      // Audit must never crash execution, but is never silently dropped
      console.warn("[ALEX] audit entry kept in-memory:", action, target, e.message);
    }
  }

  // ============================================================
  // AUDIT LOGGER
  // ============================================================
  async _auditLog(entry) {
    try {
      const audit = getAuditLogger?.();
      if (audit?.log) {
        await audit.log(this._sanitizeAuditFields(entry));
        return;
      }
    } catch (e) {
      console.warn("[ALEX] audit logger unavailable, using console:", e.message);
    }
    // Fallback: structured console audit (still sanitized)
    console.log("[ALEX:AUDIT]", JSON.stringify(this._sanitizeAuditFields(entry)));
  }

  // ============================================================
  // SELF-VERIFICATION
  // ============================================================
  async _verifyActions() {
    const checks = [];
    const check = (name, fn) => {
      try {
        const result = fn();
        checks.push({ name, ok: result === true, detail: result === true ? "ok" : String(result) });
      } catch (e) {
        checks.push({ name, ok: false, detail: e.message });
      }
    };

    check("backup-dir-writable", () => {
      this._ensureBackupDir();
      fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
      return true;
    });
    check("protected-paths-block-project-root", () =>
      CommandAllowlist.validateFilePath(".env").valid === false ? true : "FAIL: .env passed validation");
    check("command-allowlist-loaded", () => Array.isArray(CommandAllowlist.getAllowedActions()));
    check("memory-namespacing", () => typeof this._ownerKey === "function" ? true : "ownerKey helper missing");
    check("confirmation-store", () => this.pendingConfirmations instanceof Map);
    check("audit-sanitizer", () => this._sanitizeForAudit("password=hunter2").includes("[REDACTED]") || !this._sanitizeForAudit("password=hunter2").includes("hunter2"));

    const passed = checks.filter(c => c.ok).length;
    return {
      success: true,
      message: `Self-verification: ${passed}/${checks.length} checks passed.`,
      checks,
    };
  }

  // ============================================================
  // SIMPLE INFO HANDLERS
  // ============================================================
  async _handleStatus() {
    return {
      success: true,
      message: `ALEX Owner Command Handler v${ALEX_VERSION} — operational. History entries: ${this.commandHistory.length}. Pending confirmations: ${this.pendingConfirmations.size}.`,
      pendingConfirmations: this.pendingConfirmations.size,
      historyCount: this.commandHistory.length,
    };
  }

  async _handleListActions() {
    return {
      success: true,
      message: "Available owner actions listed below.",
      actions: CommandAllowlist.getAllowedActions(),
    };
  }

  async _handleListHistory(parameters, owner = null) {
    const limit = Number(parameters?.limit) || 20;
    const ownerId = this._ownerIdOf(owner);
    // FIX (3.7.1): history is owner-scoped (matches the v3.7 isolation claim)
    const scoped = owner
      ? this.commandHistory.filter(h => h.owner === ownerId)
      : this.commandHistory;
    const history = scoped.slice(-Math.min(Math.max(1, limit), 500));
    return {
      success: true,
      message: `Last ${history.length} command(s).`,
      history,
    };
  }

  // ============================================================
  // CHAT / GENERAL CHAT HANDLERS (never-fail with fallbacks)
  // ============================================================
  async _handleChat(
    parameters,
    originalInput,
    owner = null
  ) {
    const chatType =
      parameters?.chatType ||
      "general";

    const sessionId =
      parameters?.sessionId ||
      "default";

    const ownerId =
      parameters?.ownerId ||
      this._ownerIdOf(owner);

    // ==========================================================
    // SIMPLE CHAT = NO GEMINI
    // ==========================================================
    const FALLBACKS = {
      greeting:
        "Hello! Main ALEX hoon. Bolo, kya help chahiye?",

      howAreYou:
        "Main theek hoon. Bolo, kya karna hai?",

      thanks:
        "Aapka swagat hai! ??",

      bye:
        "Theek hai. Jab zarurat ho bula lena.",

      ack:
        "Samajh gaya. Agla kadam batao.",

      general:
        "Main yahin hoon. Kya poochhna chahte ho?",
    };

    const message =
      FALLBACKS[chatType] ||
      FALLBACKS.general;

    // ==========================================================
    // SAVE OWNER MESSAGE
    // ==========================================================
    try {
      if (
        typeof chatMemory.saveMessage ===
        "function"
      ) {
        await chatMemory.saveMessage(
          sessionId,
          "owner",
          String(
            originalInput || ""
          ).slice(0, 2000),
          { ownerId }
        );
      }
    } catch (error) {
      console.warn(
        "[ALEX] simple-chat owner memory save unavailable:",
        error?.message || error
      );
    }

    // ==========================================================
    // SAVE ASSISTANT MESSAGE
    // ==========================================================
    try {
      if (
        typeof chatMemory.saveMessage ===
        "function"
      ) {
        await chatMemory.saveMessage(
          sessionId,
          "assistant",
          message.slice(0, 2000),
          { ownerId }
        );
      }
    } catch (error) {
      console.warn(
        "[ALEX] simple-chat assistant memory save unavailable:",
        error?.message || error
      );
    }

    return {
      success: true,
      message,
      mode: "chat-fast",
      chatType,
    };
  }

  async _handleGeneralChat(
  parameters,
  originalInput,
  owner = null
) {
  const FALLBACK =
    "Gemini abhi temporarily unavailable hai. Aapka message receive ho gaya hai, lekin AI response generate nahi ho paya.";

  const sessionId =
    parameters?.sessionId || "default";

  const ownerId =
    parameters?.ownerId ||
    this._ownerIdOf(owner);

  const currentMessage =
    parameters?.currentMessage ||
    originalInput ||
    "";

  // ==========================================================
  // SAVE OWNER MESSAGE
  // ==========================================================
  try {
    if (typeof chatMemory.saveMessage === "function") {
      await chatMemory.saveMessage(
        sessionId,
        "owner",
        String(currentMessage).slice(0, 2000),
        { ownerId }
      );
    }
  } catch (error) {
    console.warn(
      "[ALEX] general-chat owner memory save unavailable:",
      error?.message || error
    );
  }

  // ==========================================================
  // BUILD OWNER-SCOPED CONTEXT
  // ==========================================================
  let contextBlock = "";

  try {
    if (typeof chatMemory.buildContextBlock === "function") {
      contextBlock =
        await chatMemory.buildContextBlock(
          sessionId,
          String(currentMessage).slice(0, 2000),
          { ownerId }
        );
    }
  } catch (error) {
    console.warn(
      "[ALEX] general-chat context unavailable:",
      error?.message || error
    );

    contextBlock = "";
  }

  // ==========================================================
  // GEMINI
  // ==========================================================
  const prompt =
    `${systemPrompt}\n\n` +
    `${contextBlock || ""}\n\n` +
    `CURRENT OWNER MESSAGE:\n` +
    `${JSON.stringify(
      String(currentMessage).slice(0, 2000)
    )}\n\n` +
    `Respond naturally like a helpful ChatGPT-style project assistant. ` +
    `Understand Hindi, English, Hinglish, typos, slang, short follow-ups, ` +
    `references to previous messages and incomplete sentences. ` +
    `Do not claim that an action was performed unless ALEX actually performed it. ` +
    `Reply naturally in the owner's language/style.`;

  try {
    const reply = await callGemini(
      prompt,
      {
        temperature: 0.6,
        timeoutMs: 20000,
        retries: 3,
        chatMode: true,
      }
    );

    const text =
      typeof reply === "string"
        ? reply
        : reply?.text ||
          reply?.message ||
          null;

    if (text && String(text).trim()) {
      const cleanText = String(text)
        .trim()
        .slice(0, 4000);

      try {
        if (typeof chatMemory.saveMessage === "function") {
          await chatMemory.saveMessage(
            sessionId,
            "alex",
            cleanText,
            { ownerId }
          );
        }
      } catch (error) {
        console.warn(
          "[ALEX] general-chat assistant memory save unavailable:",
          error?.message || error
        );
      }

      return {
        success: true,
        message: cleanText,
        mode: "general-chat-with-memory",
      };
    }

    return {
      success: false,
      message: FALLBACK,
      mode: "general-chat-fallback",
      aiError: "Gemini returned an empty response.",
    };

  } catch (error) {
    const reason = String(
      error?.message ||
      error ||
      "Unknown Gemini error"
    );

    console.warn(
      "[ALEX] general-chat Gemini failed:",
      reason
    );

    return {
      success: false,
      message: FALLBACK,
      mode: "general-chat-fallback",
      aiError: reason.slice(0, 300),
    };
  }
}

    // ============================================================
// 🎬 GENERATE REEL — BACKGROUND JOB
// ============================================================
async _handleGenerateReel(parameters, originalInput) {
  try {
    const mod = require("./ReelGenerator");

    const getReelGenerator =
      mod.getReelGenerator ||
      mod.default?.getReelGenerator;

    if (typeof getReelGenerator !== "function") {
      return {
        success: false,
        action: "generate-reel",
        status: "failed",
        error:
          "ReelGenerator module does not export getReelGenerator().",
      };
    }

    const generator = getReelGenerator();

    if (
      !generator ||
      typeof generator.startJob !== "function"
    ) {
      return {
        success: false,
        action: "generate-reel",
        status: "failed",
        error:
          "ReelGenerator background startJob() available nahi hai.",
      };
    }

    const prompt = String(
      parameters?.reelPrompt ||
      parameters?.prompt ||
      parameters?.story ||
      originalInput ||
      ""
    ).trim();

    if (!prompt) {
      return {
        success: false,
        action: "generate-reel",
        status: "failed",
        error: "Reel prompt required hai.",
      };
    }

    const jobId =
      parameters?.jobId ||
      `alex_reel_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const job = generator.startJob({
      prompt,
      jobId,
    });

    if (!job || job.success !== true || !job.jobId) {
      return {
        success: false,
        action: "generate-reel",
        status: "failed",
        error:
          job?.error ||
          job?.message ||
          "Reel background job start nahi ho paya.",
        data: job || null,
      };
    }

    console.log(
      `[ALEX][REEL] Background job started: ${job.jobId}`
    );

    // IMPORTANT:
    // startJob() ka success sirf generation START hone ka
    // confirmation hai. MP4 abhi complete nahi hui.
    return {
      success: true,
      action: "generate-reel",
      mode: "reel-generation",
      status: "processing",
      processing: true,

      jobId: job.jobId,

      progress: Number(job.progress || 0),

      stage:
        job.stage ||
        "queued",

      message:
        `🎬 Reel generation start ho gayi hai. ` +
        `Job ID: ${job.jobId}. ` +
        `ALEX background mein reel bana raha hai. ` +
        `Abhi MP4 complete nahi hui hai.`,

      reel: {
        jobId: job.jobId,
        status: "processing",
        processing: true,
        progress: Number(job.progress || 0),
        stage:
          job.stage ||
          "queued",
      },
    };
  } catch (error) {
    console.error(
      "[ALEX][REEL] Background job error:",
      error?.message || error
    );

    return {
      success: false,
      action: "generate-reel",
      status: "failed",
      error:
        `Reel generation start nahi ho payi. Real reason: ${
          error?.message || "Unknown error"
        }`,
    };
  }
}

  // ============================================================
  // TEST EXECUTION (cross-platform, no shell interpolation)
  // ============================================================
  async _runTests() {
    const hasPackageJson = fs.existsSync(path.join(PROJECT_ROOT, "package.json"));

    if (!hasPackageJson) {
      return {
        success: false,
        error: "No package.json found in project root — test suite cannot run.",
        verdict: "no-suite",
      };
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
    } catch (e) {
      return { success: false, error: `package.json is unreadable: ${e.message}`, verdict: "no-suite" };
    }

    if (!pkg.scripts?.test) {
      return {
        success: false,
        error: "No test script defined in package.json — there is no test suite to run.",
        verdict: "no-suite",
        suggestion: 'Add "test": "node --test" to package.json scripts.',
      };
    }

    const isWin = process.platform === "win32";
    const npmCmd = isWin ? "npm.cmd" : "npm";

    let stdout = "";
    let stderr = "";
    let code = null;
    try {
      const result = execFileSync(npmCmd, ["test"], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 120000,
        stdio: ["pipe", "pipe", "pipe"],
        ...(isWin ? { shell: true } : {}),
      });
      stdout = result;
      // FIX (3.7.1): exit code was never set on success, so passing tests
      // were reported as "fail". Explicitly mark success.
      code = 0;
    } catch (e) {
      code = e.status ?? null;
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
    }

    const output = `${stdout}\n${stderr}`.trim().slice(0, 6000);

    // Honest verdict — never claim "pass" without evidence
    if (code === 0) {
      return {
        success: true,
        verdict: "pass",
        message: "Tests passed (exit code 0).",
        output,
      };
    }
    if (code === null && !output) {
      return { success: false, verdict: "unavailable", error: "Test runner could not be launched on this platform.", output };
    }
    return {
      success: false,
      verdict: "fail",
      error: `Tests failed with exit code ${code}.`,
      output,
    };
  }

  // ============================================================
// AUTO REPAIR ENGINE v4
// Scan -> Verify -> Safe Fix -> Syntax/Test -> Re-scan
// -> Verify -> Next Fix -> Final Report
// ============================================================
async _runFixLoop(parameters = {}, owner, commandId) {
  const results = [];
  let iterations = 0;
  let aborted = false;
  let abortReason = null;

  const maxIterations = Math.min(
    Number(parameters.maxIterations) || MAX_FIX_LOOP_ITERATIONS || 5,
    10
  );

  const startedAt = Date.now();

  // ----------------------------------------------------------
  // STEP 1: ALWAYS CREATE FRESH ANALYSIS IF CACHE IS MISSING
  // ----------------------------------------------------------
  try {
    if (
      !this.lastAnalysis ||
      !Array.isArray(this.lastAnalysis.findings)
    ) {
      const analysis = await this._analyzeProject(
        parameters.originalInput || "automatic project repair scan"
      );

      if (!analysis || analysis.success === false) {
        return {
          success: false,
          message:
            "Automatic repair stopped: fresh project analysis could not be completed.",
          results,
          commandId,
        };
      }

      this.lastAnalysis = analysis;
    }
  } catch (scanError) {
    return {
      success: false,
      message:
        `Automatic repair stopped during initial scan: ${scanError.message}`,
      results,
      commandId,
    };
  }

  // ----------------------------------------------------------
  // STEP 2: BASELINE TEST
  // ----------------------------------------------------------
  let baseline;

  try {
    baseline = await this._runTests();
  } catch (testError) {
    baseline = {
      verdict: "unavailable",
      output: "",
      error: testError.message,
    };
  }

  // ----------------------------------------------------------
  // HELPER: GET SAFE CANDIDATES
  // ----------------------------------------------------------
  const getSafeCandidates = () => {
    const findings = Array.isArray(this.lastAnalysis?.findings)
      ? this.lastAnalysis.findings
      : [];

    return findings.filter((finding) => {
      if (!finding || finding._fixed) return false;

      const severity = String(finding.severity || "").toLowerCase();

      // Only real verified findings are eligible.
      if (
        finding.verification &&
        !["genuine", "verified", "confirmed"].includes(
          String(finding.verification).toLowerCase()
        )
      ) {
        return false;
      }

      // Never automatically modify protected/sensitive files.
      const file = String(finding.file || "");

      if (
        /(^|[\\/])\.env($|\.)/i.test(file) ||
        /(^|[\\/])\.git([\\/]|$)/i.test(file) ||
        /(^|[\\/])node_modules([\\/]|$)/i.test(file) ||
        /(^|[\\/])\.alex-backups([\\/]|$)/i.test(file) ||
        /\.(pem|key|cert)$/i.test(file) ||
        /(^|[\\/])(credentials|secrets?)([\\/]|\.|$)/i.test(file)
      ) {
        return false;
      }

      // Never blindly rewrite these patterns.
      const problem = String(
        finding.problem ||
          finding.title ||
          finding.message ||
          ""
      ).toLowerCase();

      if (
        problem.includes("hardcoded secret") ||
        problem.includes("hardcoded api key") ||
        problem.includes("password") ||
        problem.includes("credential")
      ) {
        return false;
      }

      if (
        problem.includes("eval()") ||
        problem.includes("new function") ||
        problem.includes("command injection") ||
        problem.includes("shell injection")
      ) {
        return false;
      }

      // Only explicitly safe findings.
      return Boolean(finding.safelyFixable);
    });
  };

  // ----------------------------------------------------------
  // STEP 3: FIX LOOP
  // ----------------------------------------------------------
  while (iterations < maxIterations && !aborted) {
    iterations++;

    const candidates = getSafeCandidates();

    if (!candidates.length) {
      break;
    }

    const next = candidates[0];

    const relativeFile = String(next.file || "");

    const abs = path.resolve(
      PROJECT_ROOT,
      relativeFile
    );

    // --------------------------------------------------------
    // PATH SAFETY
    // --------------------------------------------------------
    try {
      const validation =
        CommandAllowlist.validateFilePath(relativeFile);

      if (!validation || validation.success === false) {
        next._fixed = true;

        results.push({
          finding: next.problem || next.message,
          file: relativeFile,
          outcome: "skipped",
          reason: "File path failed safety validation.",
        });

        continue;
      }
    } catch (pathError) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: `Path validation failed: ${pathError.message}`,
      });

      continue;
    }

    // --------------------------------------------------------
    // FILE EXISTENCE
    // --------------------------------------------------------
    if (!fs.existsSync(abs)) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: "File no longer exists.",
      });

      continue;
    }

    // --------------------------------------------------------
    // BACKUP BEFORE EVERY MODIFICATION
    // --------------------------------------------------------
    let backupPath;

    try {
      backupPath = this._backupFile(abs);
    } catch (backupError) {
      aborted = true;
      abortReason =
        `Backup failed for ${relativeFile}: ${backupError.message}`;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: abortReason,
      });

      break;
    }

    let original;

    try {
      original = fs.readFileSync(abs, "utf8");
    } catch (readError) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: `Could not read file: ${readError.message}`,
      });

      continue;
    }

    // --------------------------------------------------------
    // APPLY ONLY SAFE AUTO-FIX
    // --------------------------------------------------------
    let fixed;

    try {
      fixed = await this._applyAutoFix(
        original,
        next,
        {
          file: relativeFile,
          absolutePath: abs,
        }
      );
    } catch (fixError) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: `Safe auto-fix failed: ${fixError.message}`,
      });

      continue;
    }

    if (
      fixed === null ||
      fixed === undefined ||
      fixed === original
    ) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason:
          "No deterministic safe fix is available for this finding.",
      });

      continue;
    }

    // --------------------------------------------------------
    // WRITE
    // --------------------------------------------------------
    try {
      fs.writeFileSync(abs, fixed, "utf8");
    } catch (writeError) {
      next._fixed = true;

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "skipped",
        reason: `Write failed: ${writeError.message}`,
      });

      continue;
    }

    // --------------------------------------------------------
    // SYNTAX VALIDATION
    // --------------------------------------------------------
    let syntaxValid = true;

    if (/\.(js|mjs|cjs)$/.test(relativeFile)) {
      try {
        execFileSync(
          process.execPath,
          ["--check", abs],
          {
            timeout: 15000,
            stdio: ["pipe", "pipe", "pipe"],
          }
        );
      } catch (syntaxError) {
        syntaxValid = false;

        try {
          fs.copyFileSync(backupPath, abs);
        } catch (rollbackError) {
          aborted = true;
          abortReason =
            `Syntax error + rollback failed for ${relativeFile}: ${rollbackError.message}`;
        }

        results.push({
          finding: next.problem || next.message,
          file: relativeFile,
          outcome: "rolled-back",
          reason:
            `Auto-fix produced invalid syntax: ${syntaxError.message.slice(
              0,
              300
            )}`,
        });

        next._fixed = true;

        if (aborted) break;

        continue;
      }
    }

    if (!syntaxValid) {
      continue;
    }

    // --------------------------------------------------------
    // TARGETED VERIFICATION
    // --------------------------------------------------------
    let verified = false;
    let verificationReason = "";

    try {
      const verification = await this._verifySingleFinding(next);

      verified = Boolean(
        verification &&
          (
            verification.fixed === true ||
            verification.resolved === true ||
            verification.status === "resolved"
          )
      );

      verificationReason =
        verification?.reason ||
        verification?.message ||
        "";
    } catch (verifyError) {
      verificationReason =
        `Targeted verification unavailable: ${verifyError.message}`;
    }

    // --------------------------------------------------------
    // IF TARGETED VERIFICATION SAYS NOT FIXED -> ROLLBACK
    // --------------------------------------------------------
    if (!verified) {
      try {
        fs.copyFileSync(backupPath, abs);
      } catch (rollbackError) {
        aborted = true;
        abortReason =
          `Rollback failed for ${relativeFile}: ${rollbackError.message}`;
      }

      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "rolled-back",
        reason:
          verificationReason ||
          "Finding could not be verified as resolved.",
      });

      next._fixed = true;

      if (aborted) break;

      continue;
    }

    // --------------------------------------------------------
    // MARK SUCCESS
    // --------------------------------------------------------
    next._fixed = true;

    results.push({
      finding: next.problem || next.message,
      file: relativeFile,
      outcome: "fixed",
      verified: true,
      backupPath: path.relative(PROJECT_ROOT, backupPath),
    });

    // --------------------------------------------------------
    // STEP 4: FRESH RE-SCAN AFTER EVERY SUCCESSFUL FIX
    // --------------------------------------------------------
    try {
      const freshAnalysis = await this._analyzeProject(
        `verification rescan after fixing ${relativeFile}`
      );

      if (
        freshAnalysis &&
        freshAnalysis.success !== false
      ) {
        this.lastAnalysis = freshAnalysis;
      } else {
        results.push({
          finding: next.problem || next.message,
          file: relativeFile,
          outcome: "fixed-but-rescan-failed",
          reason: "Fix was verified, but fresh project rescan failed.",
        });

        break;
      }
    } catch (rescanError) {
      results.push({
        finding: next.problem || next.message,
        file: relativeFile,
        outcome: "fixed-but-rescan-failed",
        reason: rescanError.message,
      });

      break;
    }
  }

  // ----------------------------------------------------------
  // STEP 5: FINAL TEST
  // ----------------------------------------------------------
  let post;

  try {
    post = await this._runTests();
  } catch (testError) {
    post = {
      verdict: "unavailable",
      output: "",
      error: testError.message,
    };
  }

  // ----------------------------------------------------------
  // FINAL COUNTS
  // ----------------------------------------------------------
  const fixedCount = results.filter(
    (r) => r.outcome === "fixed"
  ).length;

  const rolledBackCount = results.filter(
    (r) => r.outcome === "rolled-back"
  ).length;

  const skippedCount = results.filter(
    (r) =>
      r.outcome === "skipped" ||
      r.outcome === "fixed-but-rescan-failed"
  ).length;

  // ----------------------------------------------------------
  // UNSAFE FINDINGS
  // ----------------------------------------------------------
  const remainingFindings = Array.isArray(
    this.lastAnalysis?.findings
  )
    ? this.lastAnalysis.findings.filter(
        (f) => !f._fixed
      )
    : [];

  const unsafeFindings = remainingFindings.filter((f) => {
    const problem = String(
      f.problem ||
        f.title ||
        f.message ||
        ""
    ).toLowerCase();

    return (
      problem.includes("secret") ||
      problem.includes("credential") ||
      problem.includes("password") ||
      problem.includes("eval()") ||
      problem.includes("new function") ||
      problem.includes("command injection")
    );
  });

  // ----------------------------------------------------------
  // FINAL MESSAGE
  // ----------------------------------------------------------
  const durationMs = Date.now() - startedAt;

  return {
    success: true,

    message:
      `Automatic repair complete: ${fixedCount} fixed, ` +
      `${rolledBackCount} rolled back, ` +
      `${skippedCount} skipped/manual. ` +
      `Fresh scan was performed after successful fixes.`,

    fixedCount,
    rolledBackCount,
    skippedCount,

    iterations,

    remainingFindings: remainingFindings.length,

    unsafeFindings: unsafeFindings.map((f) => ({
      file: f.file,
      severity: f.severity,
      problem: f.problem || f.message || f.title,
      reason:
        "Requires manual review; automatic modification is unsafe.",
    })),

    results,

    testVerdictBefore: baseline?.verdict || "unavailable",
    testVerdictAfter: post?.verdict || "unavailable",

    testOutputAfter:
      post?.output ||
      post?.error ||
      undefined,

    aborted,
    abortReason,

    durationMs,

    note:
      "Only verified safe fixes were automatically applied. " +
      "Protected files, secrets, credentials, eval/new Function, " +
      "and other unsafe patterns were skipped. " +
      "Every modification received a backup, syntax validation, " +
      "targeted verification, and a fresh project rescan.",

    commandId,
  };
}

  // ============================================================
// SAFE AUTO-FIX STRATEGIES
// ============================================================
async _applyAutoFix(content, finding, context = {}) {
  const problem = String(
    finding?.problem ||
      finding?.title ||
      finding?.message ||
      ""
  );

  const lower = problem.toLowerCase();

  // ----------------------------------------------------------
  // NEVER AUTO-FIX SENSITIVE SECURITY ITEMS
  // ----------------------------------------------------------
  if (
    /hardcoded\s+(secret|api\s*key|password|credential)/i.test(problem) ||
    /credential/i.test(problem) ||
    /password/i.test(problem)
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // NEVER AUTO-FIX DYNAMIC CODE EXECUTION
  // ----------------------------------------------------------
  if (
    /eval\s*\(\s*\)/i.test(problem) ||
    /\beval\s*\(/i.test(problem) ||
    /new\s+function/i.test(problem) ||
    /command\s*injection/i.test(problem) ||
    /shell\s*injection/i.test(problem)
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // EMPTY CATCH BLOCK
  // ----------------------------------------------------------
  if (
    lower.includes("empty catch") ||
    lower.includes("empty catch block")
  ) {
    return content.replace(
      /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*\}/g,
      (match, errorName) => {
        return `catch (${errorName}) {
    console.warn("[ALEX] Caught error:", ${errorName}?.message || ${errorName});
  }`;
      }
    );
  }

  // ----------------------------------------------------------
  // EMPTY CATCH WITHOUT PARAMETER
  // ----------------------------------------------------------
  if (
    lower.includes("empty catch") &&
    /catch\s*\{\s*\}/.test(content)
  ) {
    return content.replace(
      /catch\s*\{\s*\}/g,
      `catch {
    console.warn("[ALEX] Caught an error.");
  }`
    );
  }

  // ----------------------------------------------------------
  // MISSING TEST SCRIPT
  // ----------------------------------------------------------
  if (
    lower.includes("test script") &&
    context.absolutePath &&
    path.basename(context.absolutePath) === "package.json"
  ) {
    try {
      const pkg = JSON.parse(content);

      if (!pkg.scripts) {
        pkg.scripts = {};
      }

      if (!pkg.scripts.test) {
        pkg.scripts.test = "node --test";

        return JSON.stringify(pkg, null, 2) + "\n";
      }
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------
  // TODO MARKERS ARE NOT AUTO-FIXED
  // ----------------------------------------------------------
  if (
    lower.includes("todo") ||
    lower.includes("fixme") ||
    lower.includes("xxx")
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // LARGE FILE FINDING IS NOT A BUG BY ITSELF
  // ----------------------------------------------------------
  if (
    lower.includes("large file") ||
    lower.includes("whole file")
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // UNKNOWN PATTERN = SAFE SKIP
  // ----------------------------------------------------------
  return null;
}

// ============================================================
// VERIFY ONE FINDING AFTER AUTO-FIX
// ============================================================
async _verifySingleFinding(finding) {
  const file = String(finding?.file || "");

  if (!file) {
    return {
      fixed: false,
      reason: "Finding has no file path.",
    };
  }

  const abs = path.resolve(PROJECT_ROOT, file);

  if (!fs.existsSync(abs)) {
    return {
      fixed: false,
      reason: "File no longer exists.",
    };
  }

  const content = fs.readFileSync(abs, "utf8");

  const problem = String(
    finding?.problem ||
      finding?.title ||
      finding?.message ||
      ""
  );

  const lower = problem.toLowerCase();

  // Empty catch verification
  if (
    lower.includes("empty catch") ||
    lower.includes("empty catch block")
  ) {
    const stillEmpty =
      /catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*\}/.test(content) ||
      /catch\s*\{\s*\}/.test(content);

    return {
      fixed: !stillEmpty,
      resolved: !stillEmpty,
      reason: stillEmpty
        ? "Empty catch block still exists."
        : "Empty catch block resolved.",
    };
  }

  // Test script verification
  if (
    lower.includes("test script") &&
    path.basename(abs) === "package.json"
  ) {
    try {
      const pkg = JSON.parse(content);

      return {
        fixed: Boolean(pkg.scripts && pkg.scripts.test),
        resolved: Boolean(pkg.scripts && pkg.scripts.test),
        reason:
          pkg.scripts && pkg.scripts.test
            ? "Test script exists."
            : "Test script is still missing.",
      };
    } catch (error) {
      return {
        fixed: false,
        reason: `package.json is invalid: ${error.message}`,
      };
    }
  }

  // Unknown finding: do not claim success.
  return {
    fixed: false,
    resolved: false,
    reason:
      "No deterministic verifier exists for this finding.",
  };
}

  // ============================================================
  // SANITIZATION
  // ============================================================
  _sanitizeForAudit(text) {
    if (typeof text !== "string") return String(text ?? "").slice(0, 4000);
    return text
      .replace(/\b(sk-|api[_-]?key|apikey|secret|password|token|bearer|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
      .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[PRIVATE KEY REDACTED]")
      .replace(/\b(AIza|ghp_|gho_|github_pat_|xox[bp]-|AKIA)[A-Za-z0-9_-]{10,}/g, "[CREDENTIAL REDACTED]")
      .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)\b/gi, "[INJECTION-ATTEMPT REDACTED]")
      .slice(0, 4000);
  }

  _sanitizeAuditFields(value, depth = 0) {
    if (depth > 6) return "[depth-limit]";
    if (typeof value === "string") return this._sanitizeForAudit(value);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => this._sanitizeAuditFields(item, depth + 1));
    if (value && typeof value === "object") {
      const safe = {};
      for (const [key, val] of Object.entries(value)) {
        if (/^(password|secret|token|apikey|api_key|authorization|cookie|credential)$/i.test(key)) {
          safe[key] = "[REDACTED]";
        } else {
          safe[key] = this._sanitizeAuditFields(val, depth + 1);
        }
      }
      return safe;
    }
    return value;
  }

  _sanitizeOwnerForLog(owner) {
    const oid = this._ownerIdOf(owner);
    if (!oid || oid === "anonymous") return "anonymous";
    return `owner_${oid.slice(-8)}`;
  }

  _sanitizeParams(params) {
    if (!params || typeof params !== "object") return {};
    const safe = { ...params };
    delete safe.password; delete safe.secret; delete safe.key; delete safe.token;
    delete safe.apiKey; delete safe.credential;
    if (typeof safe.content === "string") safe.content = `[content omitted: ${safe.content.length} chars]`;
    return safe;
  }

  _generateCommandId() {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  _buildResult(commandId, status, data = {}) {
    return {
      success: status === "completed",
      commandId,
      status,
      timestamp: new Date().toISOString(),
      alex: {
        system: "ALEX Owner Command Handler",
        version: ALEX_VERSION,
        capabilities: [
          "natural-language-commands", "goal-classifier", "deep-analysis", "cached-report",
          "remediation-plan", "plan-execute",
          "chat-with-memory", "general-chat-chatgpt-style",
          "create-file", "modify-file", "delete-file",
          "project-inspection", "test-execution", "approved-command-execution",
          "audit-logging", "backup-before-modification", "path-traversal-protection",
          "protected-file-boundary", "self-verification", "fix-loop", "security-scan",
        ],
      },
      ...data,
    };
  }

  getHistory(limit = 50) {
    const actualLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
    return this.commandHistory.slice(-actualLimit);
  }
}

// ============================================================
// SINGLETON
// ============================================================
let instance = null;
function getOwnerCommandHandler() {
  if (!instance) instance = new OwnerCommandHandler();
  return instance;
}

module.exports = OwnerCommandHandler;
module.exports.OwnerCommandHandler = OwnerCommandHandler;
module.exports.getOwnerCommandHandler = getOwnerCommandHandler;