// ============================================================
// ALEX AGENT EXECUTION VERIFIER
// Version: 1.0.0
//
// Purpose:
//   Connect AgentPlanExecutor results with
//   AgentVerificationEngine.
//
// Flow:
//
//   AgentPlanExecutor
//          ↓
//   AgentExecutionVerifier
//          ↓
//   AgentVerificationEngine
//          ↓
//   VERIFIED / FAILED / UNKNOWN
//
// This file does NOT execute tools.
// ============================================================

"use strict";

const {
  getAgentVerificationEngine,
  VERIFICATION_STATUS,
} = require("./AgentVerificationEngine");

// ============================================================
// CONSTANTS
// ============================================================

const EXECUTION_VERIFIER_VERSION =
  "1.0.0";

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

function safeObject(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

// ============================================================
// EXECUTION VERIFIER
// ============================================================

class AgentExecutionVerifier {
  constructor(options = {}) {
    this.version =
      EXECUTION_VERIFIER_VERSION;

    this.engine =
      options.engine ||
      getAgentVerificationEngine();
  }

  // ==========================================================
  // VERIFY ONE ACTION
  // ==========================================================

  verifyAction({
    action = null,
    result = null,
    context = null,
  } = {}) {
    if (
      !action ||
      typeof action !== "object"
    ) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          "Invalid agent action.",
      };
    }

    const expectation =
      this._getExpectation(
        action
      );

    // --------------------------------------------------------
    // No explicit expectation
    // --------------------------------------------------------

    if (
      !expectation
    ) {
      const implicit =
        result?.success ===
        true;

      return {
        verified:
          implicit,

        status:
          implicit
            ? VERIFICATION_STATUS.VERIFIED
            : VERIFICATION_STATUS.UNKNOWN,

        reason:
          implicit
            ? "Action completed successfully without an explicit verification rule."
            : "Action has no explicit verification rule and did not report success.",

        actionId:
          action.actionId ||
          null,

        tool:
          action.tool ||
          null,
      };
    }

    // --------------------------------------------------------
    // Run verification engine
    // --------------------------------------------------------

    const verification =
      this.engine.verify({
        result,

        expectation,

        action,

        context,
      });

    return {
      ...verification,

      actionId:
        action.actionId ||
        null,

      tool:
        action.tool ||
        null,
    };
  }

  // ==========================================================
  // VERIFY PLAN
  // ==========================================================

  verifyPlan({
    plan = null,
    results = [],
    context = null,
  } = {}) {
    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          "Invalid agent action plan.",

        actionResults: [],
      };
    }

    const safeResults =
      Array.isArray(
        results
      )
        ? results
        : [];

    const actionResults = [];

    let allVerified =
      true;

    let hasUnknown =
      false;

    // --------------------------------------------------------
    // Verify every action
    // --------------------------------------------------------

    for (
      let index = 0;
      index < plan.actions.length;
      index++
    ) {
      const action =
        plan.actions[index];

      const executionResult =
        this._findExecutionResult(
          action,
          safeResults,
          index
        );

      const verification =
        this.verifyAction({
          action,

          result:
            executionResult,

          context,
        });

      actionResults.push(
        {
          index,

          actionId:
            action.actionId ||
            null,

          tool:
            action.tool ||
            null,

          execution:
            executionResult,

          verification,
        }
      );

      if (
        verification.status ===
        VERIFICATION_STATUS.FAILED
      ) {
        allVerified =
          false;
      }

      if (
        verification.status ===
        VERIFICATION_STATUS.UNKNOWN
      ) {
        allVerified =
          false;

        hasUnknown =
          true;
      }
    }

    // --------------------------------------------------------
    // Determine final status
    // --------------------------------------------------------

    let status;

    if (
      allVerified
    ) {
      status =
        VERIFICATION_STATUS.VERIFIED;
    } else if (
      hasUnknown
    ) {
      status =
        VERIFICATION_STATUS.UNKNOWN;
    } else {
      status =
        VERIFICATION_STATUS.FAILED;
    }

    return {
      verified:
        status ===
        VERIFICATION_STATUS.VERIFIED,

      status,

      reason:
        status ===
        VERIFICATION_STATUS.VERIFIED
          ? "Every action in the plan was verified."
          : status ===
            VERIFICATION_STATUS.UNKNOWN
            ? "At least one action could not be conclusively verified."
            : "One or more actions failed verification.",

      planId:
        plan.planId ||
        null,

      actionCount:
        plan.actions.length,

      verifiedCount:
        actionResults.filter(
          (item) =>
            item.verification
              ?.status ===
            VERIFICATION_STATUS.VERIFIED
        ).length,

      failedCount:
        actionResults.filter(
          (item) =>
            item.verification
              ?.status ===
            VERIFICATION_STATUS.FAILED
        ).length,

      unknownCount:
        actionResults.filter(
          (item) =>
            item.verification
              ?.status ===
            VERIFICATION_STATUS.UNKNOWN
        ).length,

      actionResults,
    };
  }

  // ==========================================================
  // VERIFY AND UPDATE PLAN
  // ==========================================================

  verifyAndUpdatePlan({
    plan = null,
    results = [],
    context = null,
  } = {}) {
    const verification =
      this.verifyPlan({
        plan,

        results,

        context,
      });

    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      return verification;
    }

    // --------------------------------------------------------
    // Update action metadata
    // --------------------------------------------------------

    for (
      const item of verification.actionResults
    ) {
      const action =
        plan.actions.find(
          (candidate) =>
            candidate.actionId ===
            item.actionId
        );

      if (!action) {
        continue;
      }

      action.verification =
        {
          status:
            item.verification
              ?.status ||
            VERIFICATION_STATUS.UNKNOWN,

          verified:
            item.verification
              ?.verified ===
            true,

          reason:
            item.verification
              ?.reason ||
            "",
        };
    }

    // --------------------------------------------------------
    // Update plan status
    // --------------------------------------------------------

    if (
      verification.verified
    ) {
      plan.status =
        "verified";
    } else if (
      verification.status ===
      VERIFICATION_STATUS.FAILED
    ) {
      plan.status =
        "verification_failed";
    } else {
      plan.status =
        "verification_unknown";
    }

    if (
      typeof plan.touch ===
      "function"
    ) {
      plan.touch();
    }

    return verification;
  }

  // ==========================================================
  // VERIFY SINGLE EXPECTED RESULT
  // ==========================================================

  verifyExpectedResult({
    result = null,
    expectation = null,
    action = null,
    context = null,
  } = {}) {
    return this.engine.verify({
      result,

      expectation,

      action,

      context,
    });
  }

  // ==========================================================
  // GET EXPECTATION
  // ==========================================================

  _getExpectation(
    action
  ) {
    if (
      action.expectation
    ) {
      return action.expectation;
    }

    if (
      action.verification
    ) {
      return action.verification;
    }

    if (
      action.verify
    ) {
      return action.verify;
    }

    if (
      action.expectedResult
    ) {
      return action.expectedResult;
    }

    return null;
  }

  // ==========================================================
  // FIND EXECUTION RESULT
  // ==========================================================

  _findExecutionResult(
    action,
    results,
    index
  ) {
    if (
      !Array.isArray(
        results
      )
    ) {
      return null;
    }

    // --------------------------------------------------------
    // Match by actionId
    // --------------------------------------------------------

    if (
      action?.actionId
    ) {
      const byId =
        results.find(
          (item) =>
            item &&
            item.actionId ===
            action.actionId
        );

      if (byId) {
        return byId;
      }
    }

    // --------------------------------------------------------
    // Match by index
    // --------------------------------------------------------

    const byIndex =
      results.find(
        (item) =>
          item &&
          Number(item.index) ===
            Number(index)
      );

    if (byIndex) {
      return byIndex;
    }

    // --------------------------------------------------------
    // Direct positional fallback
    // --------------------------------------------------------

    return (
      results[index] ||
      null
    );
  }

  // ==========================================================
  // BUILD SUMMARY
  // ==========================================================

  buildSummary(
    verification
  ) {
    const value =
      safeObject(
        verification
      );

    return {
      version:
        this.version,

      verified:
        value.verified ===
        true,

      status:
        value.status ||
        VERIFICATION_STATUS.UNKNOWN,

      planId:
        value.planId ||
        null,

      actionCount:
        Number(
          value.actionCount
        ) || 0,

      verifiedCount:
        Number(
          value.verifiedCount
        ) || 0,

      failedCount:
        Number(
          value.failedCount
        ) || 0,

      unknownCount:
        Number(
          value.unknownCount
        ) || 0,

      reason:
        safeString(
          value.reason
        ),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentExecutionVerifier(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentExecutionVerifier(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentExecutionVerifier() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  EXECUTION_VERIFIER_VERSION,

  AgentExecutionVerifier,

  getAgentExecutionVerifier,

  resetAgentExecutionVerifier,
};