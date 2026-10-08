// ============================================================
// ALEX AGENT VERIFICATION ENGINE
// Version: 1.0.0
//
// Purpose:
//   Verify whether an agent action actually achieved its
//   expected result.
//
// Flow:
//
//   AgentPlanExecutor
//          ↓
//   AgentVerificationEngine
//          ↓
//   Verification rules
//          ↓
//   verified / failed / unknown
//
// IMPORTANT:
//   This file NEVER executes tools.
//   It only verifies returned results and supplied expectations.
// ============================================================

"use strict";

// ============================================================
// CONSTANTS
// ============================================================

const VERIFICATION_ENGINE_VERSION =
  "1.0.0";

const VERIFICATION_STATUS =
  Object.freeze({
    VERIFIED:
      "verified",

    FAILED:
      "failed",

    UNKNOWN:
      "unknown",

    NOT_REQUIRED:
      "not_required",
  });

const MAX_STRING_COMPARE_LENGTH =
  100000;

const MAX_EXPECTED_ITEMS =
  100;

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

function normalizeText(
  value
) {
  return safeString(
    value
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .trim();
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

function getNestedValue(
  object,
  path
) {
  if (
    !path ||
    typeof path !== "string"
  ) {
    return undefined;
  }

  const parts =
    path.split(
      "."
    );

  let current =
    object;

  for (
    const part of parts
  ) {
    if (
      current ===
        null ||
      current ===
        undefined
    ) {
      return undefined;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        Object(current),
        part
      )
    ) {
      return undefined;
    }

    current =
      current[part];
  }

  return current;
}

function deepEqual(
  left,
  right
) {
  if (
    left ===
    right
  ) {
    return true;
  }

  if (
    typeof left !==
      "object" ||
    typeof right !==
      "object" ||
    left ===
      null ||
    right ===
      null
  ) {
    return false;
  }

  if (
    Array.isArray(left) !==
    Array.isArray(right)
  ) {
    return false;
  }

  const leftKeys =
    Object.keys(left);

  const rightKeys =
    Object.keys(right);

  if (
    leftKeys.length !==
    rightKeys.length
  ) {
    return false;
  }

  for (
    const key of leftKeys
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        right,
        key
      )
    ) {
      return false;
    }

    if (
      !deepEqual(
        left[key],
        right[key]
      )
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================
// VERIFICATION ENGINE
// ============================================================

class AgentVerificationEngine {
  constructor(options = {}) {
    this.version =
      VERIFICATION_ENGINE_VERSION;

    this.strict =
      options.strict !==
      undefined
        ? Boolean(
            options.strict
          )
        : true;
  }

  // ==========================================================
  // MAIN VERIFY
  // ==========================================================

  verify({
    result,
    expectation = null,
    action = null,
    context = null,
  } = {}) {
    // --------------------------------------------------------
    // No expectation
    // --------------------------------------------------------

    if (
      !expectation
    ) {
      return {
        verified:
          result?.success ===
          true,

        status:
          result?.success ===
          true
            ? VERIFICATION_STATUS.VERIFIED
            : VERIFICATION_STATUS.UNKNOWN,

        reason:
          result?.success ===
          true
            ? "Action reported success and no explicit verification was required."
            : "Action did not report success.",
      };
    }

    // --------------------------------------------------------
    // Normalize expectation
    // --------------------------------------------------------

    const expected =
      this.normalizeExpectation(
        expectation
      );

    // --------------------------------------------------------
    // Custom verifier
    // --------------------------------------------------------

    if (
      typeof expected.verify ===
      "function"
    ) {
      return this._runCustomVerifier(
        expected.verify,
        {
          result,
          action,
          context,
          expectation:
            expected,
        }
      );
    }

    // --------------------------------------------------------
    // Result success requirement
    // --------------------------------------------------------

    if (
      expected.requireSuccess &&
      result?.success !==
        true
    ) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          "Action result did not report success.",

        checks: [
          {
            type:
              "requireSuccess",

            passed:
              false,
          },
        ],
      };
    }

    // --------------------------------------------------------
    // Expected status
    // --------------------------------------------------------

    if (
      expected.status !==
      undefined
    ) {
      const actualStatus =
        this._extractStatus(
          result
        );

      const statusMatch =
        actualStatus ===
        expected.status;

      if (
        !statusMatch
      ) {
        return {
          verified:
            false,

          status:
            VERIFICATION_STATUS.FAILED,

          reason:
            `Expected status '${expected.status}' but received '${actualStatus}'.`,

          checks: [
            {
              type:
                "status",

              expected:
                expected.status,

              actual:
                actualStatus,

              passed:
                false,
            },
          ],
        };
      }
    }

    // --------------------------------------------------------
    // Expected fields
    // --------------------------------------------------------

    if (
      Object.keys(
        expected.fields
      ).length >
      0
    ) {
      const fieldResult =
        this.verifyFields(
          result,
          expected.fields
        );

      if (
        !fieldResult.verified
      ) {
        return fieldResult;
      }
    }

    // --------------------------------------------------------
    // Expected text
    // --------------------------------------------------------

    if (
      expected.text !==
      undefined
    ) {
      const textResult =
        this.verifyText(
          result,
          expected.text,
          {
            exact:
              expected.exactText,

            caseSensitive:
              expected.caseSensitive,
          }
        );

      if (
        !textResult.verified
      ) {
        return textResult;
      }
    }

    // --------------------------------------------------------
    // Expected contains
    // --------------------------------------------------------

    if (
      expected.contains !==
      undefined
    ) {
      const containsResult =
        this.verifyContains(
          result,
          expected.contains,
          {
            caseSensitive:
              expected.caseSensitive,
          }
        );

      if (
        !containsResult.verified
      ) {
        return containsResult;
      }
    }

    // --------------------------------------------------------
    // Expected not contains
    // --------------------------------------------------------

    if (
      expected.notContains !==
      undefined
    ) {
      const notContainsResult =
        this.verifyNotContains(
          result,
          expected.notContains,
          {
            caseSensitive:
              expected.caseSensitive,
          }
        );

      if (
        !notContainsResult.verified
      ) {
        return notContainsResult;
      }
    }

    // --------------------------------------------------------
    // Expected value
    // --------------------------------------------------------

    if (
      expected.value !==
      undefined
    ) {
      const valueResult =
        this.verifyValue(
          result,
          expected.value,
          expected.path
        );

      if (
        !valueResult.verified
      ) {
        return valueResult;
      }
    }

    // --------------------------------------------------------
    // Expected items
    // --------------------------------------------------------

    if (
      expected.items !==
      undefined
    ) {
      const itemsResult =
        this.verifyItems(
          result,
          expected.items,
          expected.path
        );

      if (
        !itemsResult.verified
      ) {
        return itemsResult;
      }
    }

    // --------------------------------------------------------
    // All checks passed
    // --------------------------------------------------------

    return {
      verified:
        true,

      status:
        VERIFICATION_STATUS.VERIFIED,

      reason:
        "All verification checks passed.",

      checks:
        this._buildPassedChecks(
          expected
        ),
    };
  }

  // ==========================================================
  // NORMALIZE EXPECTATION
  // ==========================================================

  normalizeExpectation(
    expectation
  ) {
    if (
      typeof expectation ===
      "string"
    ) {
      return {
        requireSuccess:
          true,

        contains:
          expectation,

        fields: {},
      };
    }

    const source =
      safeObject(
        expectation
      );

    const normalized = {
      requireSuccess:
        source.requireSuccess !==
        undefined
          ? Boolean(
              source.requireSuccess
            )
          : true,

      status:
        source.status !==
        undefined
          ? safeString(
              source.status
            )
          : undefined,

      text:
        source.text !==
        undefined
          ? safeString(
              source.text
            )
          : undefined,

      exactText:
        source.exactText ===
        true,

      caseSensitive:
        source.caseSensitive ===
        true,

      contains:
        source.contains,

      notContains:
        source.notContains,

      value:
        source.value,

      path:
        source.path !==
        undefined
          ? safeString(
              source.path
            )
          : undefined,

      fields:
        safeObject(
          source.fields
        ),

      items:
        source.items,

      verify:
        typeof source.verify ===
        "function"
          ? source.verify
          : null,
    };

    return normalized;
  }

  // ==========================================================
  // VERIFY FIELDS
  // ==========================================================

  verifyFields(
    result,
    fields
  ) {
    const checks = [];

    for (
      const [
        path,
        expected,
      ] of Object.entries(
        fields
      )
    ) {
      const actual =
        getNestedValue(
          result,
          path
        );

      const passed =
        deepEqual(
          actual,
          expected
        );

      checks.push({
        type:
          "field",

        path,

        expected,

        actual,

        passed,
      });

      if (
        !passed
      ) {
        return {
          verified:
            false,

          status:
            VERIFICATION_STATUS.FAILED,

          reason:
            `Field '${path}' did not match expected value.`,

          checks,
        };
      }
    }

    return {
      verified:
        true,

      status:
        VERIFICATION_STATUS.VERIFIED,

      reason:
        "All expected fields matched.",

      checks,
    };
  }

  // ==========================================================
  // VERIFY TEXT
  // ==========================================================

  verifyText(
    result,
    expectedText,
    options = {}
  ) {
    const actualText =
      this._extractText(
        result
      );

    const expected =
      normalizeText(
        expectedText
      );

    const actual =
      normalizeText(
        actualText
      );

    let passed;

    if (
      options.exact
    ) {
      passed =
        options.caseSensitive
          ? actual ===
            expected
          : actual.toLowerCase() ===
            expected.toLowerCase();
    } else {
      passed =
        options.caseSensitive
          ? actual.includes(
              expected
            )
          : actual
              .toLowerCase()
              .includes(
                expected.toLowerCase()
              );
    }

    return {
      verified:
        passed,

      status:
        passed
          ? VERIFICATION_STATUS.VERIFIED
          : VERIFICATION_STATUS.FAILED,

      reason:
        passed
          ? "Expected text matched."
          : "Expected text did not match.",

      checks: [
        {
          type:
            options.exact
              ? "exactText"
              : "text",

          expected:
            expected,

          actual:
            actual.slice(
              0,
              MAX_STRING_COMPARE_LENGTH
            ),

          passed,
        },
      ],
    };
  }

  // ==========================================================
  // VERIFY CONTAINS
  // ==========================================================

  verifyContains(
    result,
    expected,
    options = {}
  ) {
    const values =
      Array.isArray(
        expected
      )
        ? expected
        : [expected];

    const actualText =
      this._extractText(
        result
      );

    const actual =
      options.caseSensitive
        ? actualText
        : actualText.toLowerCase();

    const checks = [];

    for (
      const value of values.slice(
        0,
        MAX_EXPECTED_ITEMS
      )
    ) {
      const target =
        options.caseSensitive
          ? safeString(
              value
            )
          : safeString(
              value
            ).toLowerCase();

      const passed =
        actual.includes(
          target
        );

      checks.push({
        type:
          "contains",

        expected:
          value,

        passed,
      });

      if (
        !passed
      ) {
        return {
          verified:
            false,

          status:
            VERIFICATION_STATUS.FAILED,

          reason:
            `Expected content '${safeString(
              value
            )}' was not found.`,

          checks,
        };
      }
    }

    return {
      verified:
        true,

      status:
        VERIFICATION_STATUS.VERIFIED,

      reason:
        "All expected content was found.",

      checks,
    };
  }

  // ==========================================================
  // VERIFY NOT CONTAINS
  // ==========================================================

  verifyNotContains(
    result,
    expected,
    options = {}
  ) {
    const values =
      Array.isArray(
        expected
      )
        ? expected
        : [expected];

    const actualText =
      this._extractText(
        result
      );

    const actual =
      options.caseSensitive
        ? actualText
        : actualText.toLowerCase();

    const checks = [];

    for (
      const value of values.slice(
        0,
        MAX_EXPECTED_ITEMS
      )
    ) {
      const target =
        options.caseSensitive
          ? safeString(
              value
            )
          : safeString(
              value
            ).toLowerCase();

      const passed =
        !actual.includes(
          target
        );

      checks.push({
        type:
          "notContains",

        expected:
          value,

        passed,
      });

      if (
        !passed
      ) {
        return {
          verified:
            false,

          status:
            VERIFICATION_STATUS.FAILED,

          reason:
            `Forbidden content '${safeString(
              value
            )}' was found.`,

          checks,
        };
      }
    }

    return {
      verified:
        true,

      status:
        VERIFICATION_STATUS.VERIFIED,

      reason:
        "Forbidden content was not found.",

      checks,
    };
  }

  // ==========================================================
  // VERIFY VALUE
  // ==========================================================

  verifyValue(
    result,
    expected,
    path
  ) {
    const actual =
      path
        ? getNestedValue(
            result,
            path
          )
        : result;

    const passed =
      deepEqual(
        actual,
        expected
      );

    return {
      verified:
        passed,

      status:
        passed
          ? VERIFICATION_STATUS.VERIFIED
          : VERIFICATION_STATUS.FAILED,

      reason:
        passed
          ? "Expected value matched."
          : "Expected value did not match.",

      checks: [
        {
          type:
            "value",

          path:
            path || null,

          expected,

          actual,

          passed,
        },
      ],
    };
  }

  // ==========================================================
  // VERIFY ITEMS
  // ==========================================================

  verifyItems(
    result,
    expectedItems,
    path
  ) {
    const actual =
      path
        ? getNestedValue(
            result,
            path
          )
        : result;

    if (
      !Array.isArray(
        actual
      )
    ) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          "Expected result to contain an array.",

        checks: [
          {
            type:
              "items",

            path:
              path || null,

            passed:
              false,
          },
        ],
      };
    }

    const expected =
      Array.isArray(
        expectedItems
      )
        ? expectedItems
        : [expectedItems];

    if (
      expected.length >
      MAX_EXPECTED_ITEMS
    ) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          `Too many expected items. Maximum is ${MAX_EXPECTED_ITEMS}.`,
      };
    }

    for (
      const item of expected
    ) {
      const found =
        actual.some(
          (actualItem) =>
            deepEqual(
              actualItem,
              item
            )
        );

      if (
        !found
      ) {
        return {
          verified:
            false,

          status:
            VERIFICATION_STATUS.FAILED,

          reason:
            "One or more expected items were not found.",

          checks: [
            {
              type:
                "items",

              expected:
                item,

              passed:
                false,
            },
          ],
        };
      }
    }

    return {
      verified:
        true,

      status:
        VERIFICATION_STATUS.VERIFIED,

      reason:
        "All expected items were found.",

      checks: [
        {
          type:
            "items",

          expectedCount:
            expected.length,

          actualCount:
            actual.length,

          passed:
            true,
        },
      ],
    };
  }

  // ==========================================================
  // CUSTOM VERIFIER
  // ==========================================================

  _runCustomVerifier(
    verifier,
    payload
  ) {
    try {
      const result =
        verifier(
          payload
        );

      if (
        typeof result ===
        "boolean"
      ) {
        return {
          verified:
            result,

          status:
            result
              ? VERIFICATION_STATUS.VERIFIED
              : VERIFICATION_STATUS.FAILED,

          reason:
            result
              ? "Custom verification passed."
              : "Custom verification failed.",
        };
      }

      if (
        result &&
        typeof result ===
          "object"
      ) {
        return {
          verified:
            result.verified ===
            true,

          status:
            result.verified ===
            true
              ? VERIFICATION_STATUS.VERIFIED
              : VERIFICATION_STATUS.FAILED,

          ...result,
        };
      }

      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.UNKNOWN,

        reason:
          "Custom verifier returned an unsupported value.",
      };
    } catch (error) {
      return {
        verified:
          false,

        status:
          VERIFICATION_STATUS.FAILED,

        reason:
          `Custom verification failed: ${
            error?.message ||
            String(error)
          }`,
      };
    }
  }

  // ==========================================================
  // EXTRACT STATUS
  // ==========================================================

  _extractStatus(
    result
  ) {
    return (
      result?.status ||
      result?.result?.status ||
      null
    );
  }

  // ==========================================================
  // EXTRACT TEXT
  // ==========================================================

  _extractText(
    result
  ) {
    if (
      typeof result ===
      "string"
    ) {
      return result.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    if (
      typeof result?.text ===
      "string"
    ) {
      return result.text.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    if (
      typeof result?.message ===
      "string"
    ) {
      return result.message.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    if (
      typeof result?.result ===
      "string"
    ) {
      return result.result.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    if (
      typeof result?.result?.text ===
      "string"
    ) {
      return result.result.text.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    if (
      typeof result?.result?.message ===
      "string"
    ) {
      return result.result.message.slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    }

    try {
      return JSON.stringify(
        result
      ).slice(
        0,
        MAX_STRING_COMPARE_LENGTH
      );
    } catch {
      return "";
    }
  }

  // ==========================================================
  // PASSED CHECK SUMMARY
  // ==========================================================

  _buildPassedChecks(
    expectation
  ) {
    const checks = [];

    if (
      expectation.requireSuccess
    ) {
      checks.push(
        {
          type:
            "requireSuccess",

          passed:
            true,
        }
      );
    }

    if (
      expectation.status !==
      undefined
    ) {
      checks.push(
        {
          type:
            "status",

          expected:
            expectation.status,

          passed:
            true,
        }
      );
    }

    if (
      expectation.text !==
      undefined
    ) {
      checks.push(
        {
          type:
            "text",

          passed:
            true,
        }
      );
    }

    if (
      expectation.contains !==
      undefined
    ) {
      checks.push(
        {
          type:
            "contains",

          passed:
            true,
        }
      );
    }

    if (
      expectation.notContains !==
      undefined
    ) {
      checks.push(
        {
          type:
            "notContains",

          passed:
            true,
        }
      );
    }

    if (
      expectation.value !==
      undefined
    ) {
      checks.push(
        {
          type:
            "value",

          passed:
            true,
        }
      );
    }

    if (
      expectation.items !==
      undefined
    ) {
      checks.push(
        {
          type:
            "items",

          passed:
            true,
        }
      );
    }

    return checks;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentVerificationEngine(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentVerificationEngine(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentVerificationEngine() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERIFICATION_ENGINE_VERSION,

  VERIFICATION_STATUS,

  AgentVerificationEngine,

  getAgentVerificationEngine,

  resetAgentVerificationEngine,
};