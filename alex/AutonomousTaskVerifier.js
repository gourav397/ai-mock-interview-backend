// ============================================================
// ALEX AUTONOMOUS TASK VERIFIER
// Version: 1.0.0
//
// Purpose:
//   - Independently verify autonomous task results
//   - Verify files / project / tests when requested
//   - Prevent false "completed" states
//   - Provide a consistent verification result
//
// Architecture:
//
//   AutonomousTaskWorker
//          ↓
//   AutonomousTaskVerifier
//          ↓
//   TaskExecutionBridge
//          ↓
//   Verification
//          ↓
//   verified === true
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

const {
  CommandAllowlist,
} = require("./CommandAllowlist");

const {
  createTaskExecutionBridge,
} = require("./TaskExecutionBridge");

// ============================================================
// CONSTANTS
// ============================================================

const PROJECT_ROOT =
  CommandAllowlist.getProjectRoot();

const MAX_RESULT_SIZE =
  5 * 1024 * 1024;

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

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizePath(
  filePath
) {
  if (
    typeof filePath !==
    "string" ||
    !filePath.trim()
  ) {
    return null;
  }

  const absolute =
    path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(
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

  return absolute;
}

// ============================================================
// VERIFIER
// ============================================================

class AutonomousTaskVerifier {
  constructor(options = {}) {
    this.projectRoot =
      options.projectRoot ||
      PROJECT_ROOT;

    this.bridge =
      options.bridge ||
      createTaskExecutionBridge();
  }

  // ==========================================================
  // MAIN VERIFY
  // ==========================================================

  async verify({
    task = null,
    result = null,
    executionHistory = [],
    verification = null,
  } = {}) {
    const startedAt =
      Date.now();

    const checks = [];

    // --------------------------------------------------------
    // Explicit verification request
    // --------------------------------------------------------

    if (
      verification &&
      typeof verification ===
        "object"
    ) {
      const requested =
        this._normalizeVerificationRequest(
          verification
        );

      for (
        const check of requested
      ) {
        const checkResult =
          await this._runCheck(
            check,
            task
          );

        checks.push(
          checkResult
        );
      }
    }

    // --------------------------------------------------------
    // Infer verification from result
    // --------------------------------------------------------

    if (
      checks.length === 0
    ) {
      const inferred =
        this._inferChecks(
          task,
          result
        );

      for (
        const check of inferred
      ) {
        const checkResult =
          await this._runCheck(
            check,
            task
          );

        checks.push(
          checkResult
        );
      }
    }

    // --------------------------------------------------------
    // Check execution history
    // --------------------------------------------------------

    const historyCheck =
      this._verifyExecutionHistory(
        executionHistory
      );

    if (historyCheck) {
      checks.push(
        historyCheck
      );
    }

    // --------------------------------------------------------
    // Explicit result confirmation
    // --------------------------------------------------------

    const resultCheck =
      this._verifyResultFlags(
        result
      );

    if (resultCheck) {
      checks.push(
        resultCheck
      );
    }

    // --------------------------------------------------------
    // FINAL DECISION
    // --------------------------------------------------------

    const failedChecks =
      checks.filter(
        (check) =>
          check &&
          check.verified === false
      );

    const successfulChecks =
      checks.filter(
        (check) =>
          check &&
          check.verified === true
      );

    const verified =
      checks.length > 0 &&
      failedChecks.length === 0 &&
      successfulChecks.length > 0;

    return {
      verified,

      complete:
        verified,

      durationMs:
        Date.now() -
        startedAt,

      checks,

      checked:
        checks.length,

      passed:
        successfulChecks.length,

      failed:
        failedChecks.length,

      reason:
        verified
          ? "Task independently verified."
          : failedChecks.length > 0
          ? "One or more verification checks failed."
          : "Task could not be independently verified.",

      verifiedAt:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // NORMALIZE VERIFICATION REQUEST
  // ==========================================================

  _normalizeVerificationRequest(
    verification
  ) {
    const checks =
      Array.isArray(
        verification
      )
        ? verification
        : Array.isArray(
            verification.checks
          )
        ? verification.checks
        : [verification];

    return checks
      .filter(
        (check) =>
          check &&
          typeof check ===
            "object"
      )
      .map(
        (check) => ({
          type:
            safeString(
              check.type
            )
              .trim()
              .toLowerCase(),

          path:
            check.path ||
            check.filePath ||
            null,

          command:
            check.command ||
            null,
        })
      );
  }

  // ==========================================================
  // INFER CHECKS
  // ==========================================================

  _inferChecks(
    task,
    result
  ) {
    const checks = [];

    const taskInput =
      safeString(
        task &&
          task.input
      ).toLowerCase();

    const resultObject =
      result &&
      typeof result ===
        "object"
        ? result
        : {};

    // File information from result.
    const filePath =
      resultObject.filePath ||
      resultObject.path ||
      resultObject.file;

    if (filePath) {
      checks.push({
        type:
          "verify-file",

        path:
          filePath,
      });
    }

    // Explicit verification type.
    if (
      resultObject.verificationType
    ) {
      checks.push({
        type:
          resultObject.verificationType,

        path:
          filePath ||
          null,

        command:
          resultObject.command ||
          null,
      });
    }

    // Project-level task.
    if (
      taskInput.includes(
        "project"
      ) ||
      taskInput.includes(
        "build"
      ) ||
      taskInput.includes(
        "application"
      )
    ) {
      checks.push({
        type:
          "verify-project",
      });
    }

    // Test-related task.
    if (
      taskInput.includes(
        "test"
      ) ||
      taskInput.includes(
        "tests"
      )
    ) {
      checks.push({
        type:
          "verify-tests",
      });
    }

    return checks;
  }

  // ==========================================================
  // RUN CHECK
  // ==========================================================

  async _runCheck(
    check,
    task
  ) {
    const type =
      safeString(
        check &&
          check.type
      )
        .trim()
        .toLowerCase();

    try {
      switch (type) {
        case "verify-file":
        case "file":
          return await this._verifyFile(
            check.path
          );

        case "verify-project":
        case "project":
          return await this._verifyProject();

        case "verify-tests":
        case "tests":
          return await this._verifyTests(
            check.command
          );

        case "read-file":
          return await this._verifyReadableFile(
            check.path
          );

        default:
          return {
            type,
            verified: false,
            reason:
              "Unknown verification type.",
          };
      }
    } catch (error) {
      return {
        type,

        verified: false,

        reason:
          safeString(
            error &&
              error.message,
            "Verification failed."
          ),
      };
    }
  }

  // ==========================================================
  // VERIFY FILE
  // ==========================================================

  async _verifyFile(
    filePath
  ) {
    const absolute =
      normalizePath(
        filePath
      );

    if (!absolute) {
      return {
        type:
          "verify-file",

        verified: false,

        path:
          filePath || null,

        reason:
          "File path is outside the project root or invalid.",
      };
    }

    if (
      !fs.existsSync(
        absolute
      )
    ) {
      return {
        type:
          "verify-file",

        verified: false,

        path:
          filePath,

        reason:
          "Expected file does not exist.",
      };
    }

    const stats =
      fs.statSync(
        absolute
      );

    if (!stats.isFile()) {
      return {
        type:
          "verify-file",

        verified: false,

        path:
          filePath,

        reason:
          "Expected path is not a file.",
      };
    }

    if (
      stats.size >
      MAX_RESULT_SIZE
    ) {
      return {
        type:
          "verify-file",

        verified: false,

        path:
          filePath,

        reason:
          "File exceeds the verification size limit.",
      };
    }

    return {
      type:
        "verify-file",

      verified: true,

      path:
        filePath,

      size:
        stats.size,

      reason:
        "File exists and is readable.",
    };
  }

  // ==========================================================
  // VERIFY READABLE FILE
  // ==========================================================

  async _verifyReadableFile(
    filePath
  ) {
    const fileResult =
      await this._verifyFile(
        filePath
      );

    if (
      !fileResult.verified
    ) {
      return fileResult;
    }

    const absolute =
      normalizePath(
        filePath
      );

    try {
      fs.accessSync(
        absolute,
        fs.constants.R_OK
      );

      return {
        type:
          "read-file",

        verified: true,

        path:
          filePath,

        reason:
          "File exists and is readable.",
      };
    } catch (error) {
      return {
        type:
          "read-file",

        verified: false,

        path:
          filePath,

        reason:
          "File exists but cannot be read.",
      };
    }
  }

  // ==========================================================
  // VERIFY PROJECT
  // ==========================================================

  async _verifyProject() {
    const packageJson =
      path.join(
        this.projectRoot,
        "package.json"
      );

    if (
      !fs.existsSync(
        packageJson
      )
    ) {
      return {
        type:
          "verify-project",

        verified: false,

        reason:
          "package.json was not found.",
      };
    }

    try {
      const raw =
        fs.readFileSync(
          packageJson,
          "utf8"
        );

      const parsed =
        JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !==
          "object"
      ) {
        return {
          type:
            "verify-project",

          verified: false,

          reason:
            "package.json is invalid.",
        };
      }

      return {
        type:
          "verify-project",

        verified: true,

        packageName:
          parsed.name ||
          null,

        reason:
          "Project package configuration is valid.",
      };
    } catch (error) {
      return {
        type:
          "verify-project",

        verified: false,

        reason:
          "Project package configuration could not be parsed.",
      };
    }
  }

  // ==========================================================
  // VERIFY TESTS
  // ==========================================================

  async _verifyTests(
    command = null
  ) {
    const testCommand =
      command ||
      "npm test";

    if (
      !this.bridge ||
      typeof this.bridge.actionExecutor !==
        "function"
    ) {
      return {
        type:
          "verify-tests",

        verified: false,

        reason:
          "TaskExecutionBridge test executor is unavailable.",
      };
    }

    try {
      const result =
        await this.bridge.actionExecutor(
          {
            action:
              "verify-tests",

            command:
              testCommand,
          }
        );

      const success =
        Boolean(
          result &&
            (
              result.verified ===
                true ||
              result.success ===
                true
            )
        );

      return {
        type:
          "verify-tests",

        verified:
          success,

        command:
          testCommand,

        result:
          result || null,

        reason:
          success
            ? "Test verification succeeded."
            : "Test verification did not succeed.",
      };
    } catch (error) {
      return {
        type:
          "verify-tests",

        verified: false,

        command:
          testCommand,

        reason:
          safeString(
            error &&
              error.message,
            "Test verification failed."
          ),
      };
    }
  }

  // ==========================================================
  // EXECUTION HISTORY
  // ==========================================================

  _verifyExecutionHistory(
    executionHistory
  ) {
    if (
      !Array.isArray(
        executionHistory
      ) ||
      executionHistory.length ===
        0
    ) {
      return null;
    }

    const failed =
      executionHistory.find(
        (item) =>
          item &&
          item.result &&
          item.result.success ===
            false
      );

    if (failed) {
      return {
        type:
          "execution-history",

        verified: false,

        reason:
          "Execution history contains a failed action.",
      };
    }

    const successful =
      executionHistory.some(
        (item) =>
          item &&
          item.result &&
          (
            item.result.verified ===
              true ||
            item.result.complete ===
              true
          )
      );

    if (successful) {
      return {
        type:
          "execution-history",

        verified: true,

        reason:
          "Execution history contains explicit verification.",
      };
    }

    return {
      type:
        "execution-history",

      verified: false,

      reason:
        "Execution history does not contain independent verification.",
    };
  }

  // ==========================================================
  // RESULT FLAGS
  // ==========================================================

  _verifyResultFlags(
    result
  ) {
    if (
      !result ||
      typeof result !==
        "object"
    ) {
      return null;
    }

    if (
      result.verified ===
      true
    ) {
      return {
        type:
          "result-flag",

        verified: true,

        reason:
          "Executor explicitly reported verified=true.",
      };
    }

    if (
      result.complete ===
      true
    ) {
      return {
        type:
          "result-flag",

        verified: true,

        reason:
          "Executor explicitly reported complete=true.",
      };
    }

    return null;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskVerifier(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskVerifier(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskVerifier;

module.exports.AutonomousTaskVerifier =
  AutonomousTaskVerifier;

module.exports.getAutonomousTaskVerifier =
  getAutonomousTaskVerifier;