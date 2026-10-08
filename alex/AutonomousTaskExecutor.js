// ============================================================
// ALEX AUTONOMOUS TASK EXECUTOR
// Version: 2.1.0
//
// Purpose:
//   - Connect ALEX reasoning/planning with PersistentTaskManager
//   - Use TaskExecutionBridge with its actual API
//   - Execute long-running tasks step-by-step
//   - Continue until the goal is actually verified
//   - Retry recoverable failures
//   - Re-plan when verification says the goal is incomplete
//   - Track progress
//   - Support pause/cancel
//   - Recover safely after restart
//   - Never claim completion without verification
// ============================================================

"use strict";

const {
  getPersistentTaskManager,
} = require("./PersistentTaskManager");

const {
  createTaskExecutionBridge,
} = require("./TaskExecutionBridge");

const { getLearningStore } = require("./LearningStore");

// ============================================================
// LIMITS
// ============================================================

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_MAX_REPLANS = 20;
const DEFAULT_STEP_DELAY_MS = 250;

// ============================================================
// AUTONOMOUS TASK EXECUTOR
// ============================================================

class AutonomousTaskExecutor {
  constructor(options = {}) {
    this.taskManager =
      options.taskManager ||
      getPersistentTaskManager();

    this.bridge =
      options.bridge ||
      createTaskExecutionBridge();

    this.maxSteps =
      Number.isFinite(
        Number(options.maxSteps)
      )
        ? Math.max(
            1,
            Number(options.maxSteps)
          )
        : DEFAULT_MAX_STEPS;

    this.maxReplans =
      Number.isFinite(
        Number(options.maxReplans)
      )
        ? Math.max(
            0,
            Number(options.maxReplans)
          )
        : DEFAULT_MAX_REPLANS;

    this.defaultStepDelayMs =
      Number.isFinite(
        Number(options.defaultStepDelayMs)
      )
        ? Math.max(
            0,
            Number(options.defaultStepDelayMs)
          )
        : DEFAULT_STEP_DELAY_MS;

    this._registered = false;

    this._register();
  }

  // ==========================================================
  // REGISTER WITH PERSISTENT TASK MANAGER
  // ==========================================================

  _register() {
    if (this._registered) {
      return;
    }

    if (
      !this.taskManager ||
      typeof this.taskManager.registerExecutor !==
        "function"
    ) {
      throw new Error(
        "PersistentTaskManager.registerExecutor() is unavailable."
      );
    }

    this.taskManager.registerExecutor(
      "alex-autonomous",
      async (context) => {
        return this._executeStep(context);
      }
    );

    this._registered = true;
  }

  // ==========================================================
  // CREATE + START AUTONOMOUS TASK
  // ==========================================================

  async start(options = {}) {
    const input =
      typeof options.input === "string"
        ? options.input.trim()
        : "";

    if (!input) {
      throw new Error(
        "Autonomous task input is required."
      );
    }

    const ownerId =
      options.ownerId ||
      "anonymous";

    const sessionId =
      options.sessionId ||
      "default";

    const metadata = {
      ...(options.metadata || {}),

      executorType:
        "alex-autonomous",

      ownerId,

      sessionId,

      windowsAgentToken:
        options.windowsAgentToken ||
        "",

      plan: null,

      executionHistory: [],

      replanCount: 0,

      autonomousVersion:
        "2.1.0",

      startedAt:
        new Date().toISOString(),
    };

    const task =
      await this.taskManager.createTask({
        ownerId,

        sessionId,

        input,

        action:
          options.action ||
          "autonomous-task",

        target:
          options.target ||
          "project",

        totalSteps:
          Number(options.totalSteps) || 0,

        maxRetries:
          Number.isFinite(
            Number(options.maxRetries)
          )
            ? Number(options.maxRetries)
            : undefined,

        resumeOnRestart:
          options.resumeOnRestart !== false,

        metadata,
      });

    await this.taskManager.startTask(
      task.id,
      {
        executorType:
          "alex-autonomous",
      }
    );

    return this.taskManager.getTask(
      task.id
    );
  }

  // ==========================================================
  // EXECUTE ONE AUTONOMOUS CYCLE
  // ==========================================================

  async _executeStep(context) {
    if (!context) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "Autonomous execution context is missing.",
      };
    }

    // --------------------------------------------------------
    // CANCEL
    // --------------------------------------------------------

    if (
      typeof context.isCancelled ===
        "function" &&
      context.isCancelled()
    ) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "Task cancelled by owner.",
      };
    }

    // --------------------------------------------------------
    // PAUSE
    // --------------------------------------------------------

    if (
      typeof context.isPaused ===
        "function" &&
      context.isPaused()
    ) {
      return {
        done: false,
        failed: false,
        retry: false,
        waitMs: 0,
        message:
          "Task paused by owner.",
      };
    }

    // --------------------------------------------------------
    // METADATA
    // --------------------------------------------------------

    if (
      !context.metadata ||
      typeof context.metadata !==
        "object"
    ) {
      context.metadata = {};
    }

    const metadata =
      context.metadata;

    if (
      !Array.isArray(
        metadata.executionHistory
      )
    ) {
      metadata.executionHistory = [];
    }

    if (
      !Number.isFinite(
        Number(metadata.replanCount)
      )
    ) {
      metadata.replanCount = 0;
    }

    // --------------------------------------------------------
    // STEP LIMIT
    // --------------------------------------------------------

    if (
      Number(context.currentStep || 0) >
      this.maxSteps
    ) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          `Maximum autonomous step limit (${this.maxSteps}) reached.`,
      };
    }

    // ========================================================
    // FIRST CYCLE → CREATE PLAN
    // ========================================================

    if (
      Number(context.currentStep || 0) === 0
    ) {
      return this._createInitialPlan(
        context
      );
    }

    // ========================================================
    // LOAD PLAN
    // ========================================================

    const plan =
      metadata.plan;

    if (
      !plan ||
      !Array.isArray(plan.steps) ||
      plan.steps.length === 0
    ) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "Autonomous execution plan is missing.",
      };
    }

    if (
      plan.steps.length >
      this.maxSteps
    ) {
      plan.steps =
        plan.steps.slice(
          0,
          this.maxSteps
        );
    }

    // ========================================================
    // FIND NEXT STEP
    // ========================================================

    const history =
      metadata.executionHistory;

    const successfulStepIds =
      new Set(
        history
          .filter(
            (item) =>
              item &&
              item.success === true
          )
          .map(
            (item) =>
              item.stepId
          )
      );

    const nextStep =
      plan.steps.find(
        (step) =>
          step &&
          !successfulStepIds.has(
            step.id
          )
      );

    // ========================================================
    // ALL PLAN STEPS COMPLETE → VERIFY
    // ========================================================

    if (!nextStep) {
      return this._verifyTask(
        context,
        plan
      );
    }

    // ========================================================
    // EXECUTE NEXT STEP
    // ========================================================

    return this._executeNextStep(
      context,
      plan,
      nextStep
    );
  }

  // ==========================================================
  // CREATE INITIAL PLAN
  // ==========================================================

  async _createInitialPlan(context) {
    const brainPlan =
      context.metadata?.brainPlan;

    // --------------------------------------------------------
    // USE PLAN ALREADY CREATED BY ALEX BRAIN
    // --------------------------------------------------------

    if (
      brainPlan &&
      Array.isArray(brainPlan.steps) &&
      brainPlan.steps.length > 0
    ) {
      const steps =
        brainPlan.steps
          .slice(0, this.maxSteps)
          .filter(Boolean);

      context.metadata.plan = {
        canExecute: true,

        goal:
          brainPlan.goal ||
          String(
            context.input || ""
          ).trim(),

        reason:
          brainPlan.reason ||
          "Plan supplied by ALEX Brain.",

        steps,

        verification:
          brainPlan.verification ||
          "",

        createdAt:
          new Date().toISOString(),

        version:
          "2.2.0",

        source:
          "AlexBrain",
      };

      context.metadata.executionHistory =
        [];

      context.metadata.replanCount =
        Number(
          context.metadata.replanCount || 0
        );

      await this._updateProgress(
        context,
        0,
        steps.length,
        "ALEX Brain plan loaded. Starting autonomous execution."
      );

      return {
        done: false,
        failed: false,
        retry: false,

        progress: 0,

        currentStep: 1,

        totalSteps:
          steps.length,

        result: {
          type:
            "autonomous-brain-plan-loaded",

          goal:
            brainPlan.goal ||
            null,

          totalSteps:
            steps.length,

          source:
            "AlexBrain",
        },

        waitMs:
          this.defaultStepDelayMs,
      };
    }

    // --------------------------------------------------------
    // FALLBACK → CREATE PLAN THROUGH BRIDGE
    // --------------------------------------------------------

    let planResult;

    try {
      planResult =
        await this.bridge.planner({
          input:
            String(
              context.input || ""
            ).trim(),

          taskInput:
            String(
              context.input || ""
            ).trim(),

          metadata:
            context.metadata || {},

          task:
            context.task || null,

          ownerId:
            context.ownerId || null,

          sessionId:
            context.sessionId || null,
        });
    } catch (error) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          `Planner error: ${
            error?.message ||
            String(error)
          }`,
      };
    }

    const steps =
      Array.isArray(
        planResult?.steps
      )
        ? planResult.steps
            .slice(
              0,
              this.maxSteps
            )
            .filter(Boolean)
        : [];

    if (!steps.length) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "ALEX planner returned no executable steps.",
      };
    }

    context.metadata.plan = {
      canExecute: true,

      goal:
        planResult.goal ||
        String(
          context.input || ""
        ).trim(),

      reason:
        planResult.reason ||
        "",

      steps,

      createdAt:
        new Date().toISOString(),

      version:
        "2.1.0",
    };

    context.metadata.executionHistory =
      [];

    context.metadata.replanCount =
      Number(
        context.metadata.replanCount ||
          0
      );

    await this._updateProgress(
      context,
      0,
      steps.length,
      "ALEX created the autonomous execution plan."
    );

    return {
      done: false,
      failed: false,
      retry: false,

      progress: 0,

      currentStep: 1,

      totalSteps:
        steps.length,

      result: {
        type:
          "autonomous-plan-created",

        goal:
          planResult.goal ||
          null,

        totalSteps:
          steps.length,
      },

      waitMs:
        this.defaultStepDelayMs,
    };
  }

  // ==========================================================
  // EXECUTE NEXT STEP
  // ==========================================================

  async _executeNextStep(
    context,
    plan,
    step
  ) {
    const stepIndex =
      plan.steps.findIndex(
        (item) =>
          item &&
          item.id === step.id
      );

    if (stepIndex < 0) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "Autonomous step could not be located.",
      };
    }

    if (
      context.isCancelled?.()
    ) {
      return {
        done: false,
        failed: true,
        retry: false,
        error:
          "Task cancelled before step execution.",
      };
    }

    if (
      context.isPaused?.()
    ) {
      return {
        done: false,
        failed: false,
        retry: false,
        waitMs: 0,
      };
    }

    const executionContext = {
      taskId:
        context.taskId,

      ownerId:
        context.ownerId,

      sessionId:
        context.sessionId,

      input:
        context.input,

      action:
        context.action,

      target:
        context.target,

      owner:
        context.owner || {},

      windowsAgentToken:
        context.metadata
          ?.windowsAgentToken ||
        "",

      agentToken:
        context.metadata
          ?.windowsAgentToken ||
        "",

      stepIndex,

      totalSteps:
        plan.steps.length,

      metadata:
        context.metadata,

      task:
        context.task,

      isCancelled:
        context.isCancelled,

      isPaused:
        context.isPaused,

      updateProgress:
        context.updateProgress,
    };

    let stepResult;

    try {
      // TaskExecutionBridge expects:
      // actionExecutor(stepObject, context)
      stepResult =
        await this.bridge.actionExecutor(
          step,
          executionContext
        );
    } catch (error) {
      stepResult = {
        success: false,

        retry: true,

        error:
          error?.message ||
          String(error),
      };
    }

    const historyEntry = {
      stepId:
        step.id,

      action:
        step.action ||
        null,

      title:
        step.title ||
        step.description ||
        `Step ${stepIndex + 1}`,

      success:
  stepResult?.success === true ||
  stepResult?.complete === true ||
  stepResult?.verified === true,

      retry:
        stepResult?.retry === true,

      source:
        stepResult?.source ||
        null,

      tool:
        stepResult?.tool ||
        null,

      result:
        stepResult?.result ??
        stepResult ??
        null,

      error:
        stepResult?.error ||
        null,

      timestamp:
        new Date().toISOString(),
    };

    context.metadata.executionHistory.push(
      historyEntry
    );

    // --------------------------------------------------------
    // STEP FAILED
    // --------------------------------------------------------

        const stepSucceeded =
      stepResult?.success === true ||
      stepResult?.complete === true ||
      stepResult?.verified === true;

        if (!stepSucceeded) {
      // ------------------------------------------------------
      // EXPLICIT RETRY REQUEST
      // ------------------------------------------------------

      if (
        stepResult?.retry === true
      ) {
        return {
          done: false,
          failed: false,
          retry: true,

          currentStep:
            stepIndex + 1,

          totalSteps:
            plan.steps.length,

          error:
            stepResult?.error ||
            `Step "${step.description || step.id}" failed and is retryable.`,

          result:
            stepResult,

          waitMs:
            Number(
              stepResult?.waitMs
            ) ||
            this.defaultStepDelayMs,
        };
      }

      // ------------------------------------------------------
      // RECOVERABLE FAILURE → REPLAN
      //
      // Example:
      // create-file → "File already exists"
      //
      // ALEX should NOT immediately fail.
      // Ask the planner for a recovery plan.
      // ------------------------------------------------------

      const currentReplanCount =
        Number(
          context.metadata?.replanCount || 0
        );

      if (
        currentReplanCount >=
        this.maxReplans
      ) {
        return {
          done: false,
          failed: true,
          retry: false,

          error:
            `Maximum autonomous replanning limit (${this.maxReplans}) reached after step failure.`,

          result:
            stepResult,
        };
      }

      context.metadata.replanCount =
        currentReplanCount + 1;

      let recoveryPlan;

      try {
        recoveryPlan =
          await this.bridge.planner({
            input:
              String(
                context.input || ""
              ).trim(),

            taskInput:
              String(
                context.input || ""
              ).trim(),

            metadata: {
              ...(context.metadata || {}),

              previousPlan:
                plan,

              failedStep:
                step,

              stepResult,

              failure:
                stepResult?.error ||
                `Step "${step.description || step.id}" failed.`,

              replanReason:
                "A step failed during autonomous execution. Create a safe recovery plan that works around the failure and continues toward the original goal.",

              replanCount:
                context.metadata
                  .replanCount,
            },

            task:
              context.task || null,

            ownerId:
              context.ownerId || null,

            sessionId:
              context.sessionId || null,
          });
      } catch (error) {
        return {
          done: false,
          failed: false,
          retry: true,

          error:
            `Recovery planner error: ${
              error?.message ||
              String(error)
            }`,

          result:
            stepResult,

          waitMs:
            this.defaultStepDelayMs,
        };
      }

      const recoverySteps =
        Array.isArray(
          recoveryPlan?.steps
        )
          ? recoveryPlan.steps
              .slice(
                0,
                this.maxSteps
              )
              .filter(Boolean)
          : [];

      if (!recoverySteps.length) {
        return {
          done: false,
          failed: false,
          retry: true,

          error:
            "ALEX could not create a recovery plan after the step failure.",

          result:
            stepResult,

          waitMs:
            this.defaultStepDelayMs,
        };
      }

      // ------------------------------------------------------
      // INSTALL RECOVERY PLAN
      // ------------------------------------------------------

      context.metadata.plan = {
        canExecute: true,

        goal:
          recoveryPlan.goal ||
          plan.goal ||
          String(
            context.input || ""
          ).trim(),

        reason:
          recoveryPlan.reason ||
          "Recovery plan created after an autonomous step failure.",

        steps:
          recoverySteps,

        createdAt:
          new Date().toISOString(),

        version:
          "2.2.0",

        replan:
          context.metadata
            .replanCount,

        source:
          "AutonomousFailureRecovery",
      };

      // Old failed execution history must not
      // make the new recovery plan look completed.
      context.metadata.executionHistory =
        [];

      const newTotalSteps =
        recoverySteps.length;

      await this._updateProgress(
        context,
        0,
        newTotalSteps,
        "ALEX detected a recoverable failure and created a new recovery plan."
      );

      return {
        done: false,
        failed: false,

        // Tell PersistentTaskManager to continue
        // with the newly installed recovery plan.
        retry: true,

        progress: 0,

        currentStep: 1,

        totalSteps:
          newTotalSteps,

        error:
          stepResult?.error ||
          "Autonomous step failed; recovery plan created.",

        result: {
          type:
            "autonomous-failure-replanned",

          failedStep:
            step.id,

          failedAction:
            step.action || null,

          failure:
            stepResult?.error ||
            null,

          replan:
            context.metadata
              .replanCount,

          plan: {
            totalSteps:
              newTotalSteps,
          },
        },

        waitMs:
          this.defaultStepDelayMs,
      };
    }

    // --------------------------------------------------------
    // STEP SUCCESS
    // --------------------------------------------------------

    const completedCount =
      context.metadata.executionHistory.filter(
        (item) =>
          item &&
          item.success === true
      ).length;

    const totalSteps =
      plan.steps.length;

    const progress =
      Math.min(
        99,
        Math.round(
          (completedCount /
            totalSteps) *
            100
        )
      );

    await this._updateProgress(
      context,
      completedCount,
      totalSteps,
      `Completed: ${
        step.description ||
        step.title ||
        `Step ${stepIndex + 1}`
      }`
    );

    return {
      done: false,
      failed: false,
      retry: false,

      progress,

      currentStep:
        stepIndex + 2,

      totalSteps,

      result: {
        type:
          "autonomous-step-completed",

        stepId:
          step.id,

        action:
          step.action,

        title:
          step.description ||
          step.title ||
          `Step ${stepIndex + 1}`,

        output:
          stepResult?.result ??
          stepResult ??
          null,
      },

      waitMs:
        Number(
          stepResult?.waitMs
        ) ||
        this.defaultStepDelayMs,
    };
  }

  // ==========================================================
  // VERIFY COMPLETE GOAL
  // ==========================================================

  async _verifyTask(
    context,
    plan
  ) {
    let verification;

    try {
      // TaskExecutionBridge expects ONE context object.
      verification =
        await this.bridge.verifier({
          task:
            context.task || {
              id:
                context.taskId,

              input:
                context.input,

              metadata:
                context.metadata,
            },

          result:
            context.metadata
              ?.executionHistory?.[
              context.metadata
                .executionHistory
                .length - 1
            ] || null,

          executionHistory:
            context.metadata
              ?.executionHistory || [],

          verification:
            null,

          owner:
            context.owner ||
            {},

          ownerId:
            context.ownerId,

          sessionId:
            context.sessionId,

          windowsAgentToken:
            context.metadata
              ?.windowsAgentToken ||
            "",

          plan,

          metadata:
            context.metadata,
        });
    } catch (error) {
      return {
        done: false,
        failed: false,
        retry: true,

        error:
          `Verification error: ${
            error?.message ||
            String(error)
          }`,

        waitMs:
          this.defaultStepDelayMs,
      };
    }

    // ========================================================
    // VERIFIED COMPLETE
    // ========================================================

    if (
      verification?.complete === true ||
      verification?.verified === true
    ) {
      await this._updateProgress(
        context,
        plan.steps.length,
        plan.steps.length,
        "ALEX verified that the task is complete."
      );

            try {
        const task =
          context.task || {
            id: context.taskId,
            ownerId: context.ownerId,
            input: context.input,
            createdAt:
              context.task?.createdAt ||
              context.metadata?.startedAt ||
              new Date().toISOString(),
          };

        const attempts =
          Number(context.metadata?.replanCount || 0) + 1;

        getLearningStore().storeExperience({
          ownerKey:
            context.ownerId ||
            "anonymous",

          goal:
            plan.goal ||
            String(context.input || "").trim(),

          taskType:
            "autonomous",

          outcome:
            "success",

          approach:
            `Plan with ${plan.steps.length} steps, ${attempts} attempt(s)`,

          whatWorked:
            "Plan completed and verification passed",

          whatFailed:
            "",

          whyFailed:
            "",

          solution:
            "",

          attempts,

          durationMs:
            task.createdAt
              ? Date.now() -
                new Date(task.createdAt).getTime()
              : 0,

          sourceTaskId:
            task.id || context.taskId,
        });
      } catch (learningError) {
        console.warn(
          "[ALEX][LEARNING] Could not store success experience:",
          learningError?.message || learningError
        );
      }

      return {
        done: true,
        failed: false,
        retry: false,

        progress: 100,

        currentStep:
          plan.steps.length,

        totalSteps:
          plan.steps.length,

        result:
          verification,
      };
    }

    // ========================================================
    // NEEDS REPLANNING
    // ========================================================

    if (
      verification?.retry === true
    ) {
      const replanCount =
        Number(
          context.metadata
            ?.replanCount ||
          0
        );

      if (
        replanCount >=
        this.maxReplans
      ) {
        return {
          done: false,
          failed: true,
          retry: false,

          error:
            "Maximum autonomous replanning limit reached.",

          result:
            verification,
        };
      }

      context.metadata.replanCount =
        replanCount + 1;

      let recoveryPlan;

      try {
        recoveryPlan =
          await this.bridge.planner({
            input:
              String(
                context.input || ""
              ).trim(),

            taskInput:
              String(
                context.input || ""
              ).trim(),

            metadata: {
              ...(context.metadata ||
                {}),

              previousPlan:
                plan,

              verification,

              replanCount:
                context.metadata
                  .replanCount,
            },

            task:
              context.task || null,

            ownerId:
              context.ownerId || null,

            sessionId:
              context.sessionId || null,
          });
      } catch (error) {
        return {
          done: false,
          failed: false,
          retry: true,

          error:
            `Recovery planner error: ${
              error?.message ||
              String(error)
            }`,

          waitMs:
            this.defaultStepDelayMs,
        };
      }

      if (
        !recoveryPlan ||
        !Array.isArray(
          recoveryPlan.steps
        ) ||
        recoveryPlan.steps.length === 0
      ) {
        return {
          done: false,
          failed: false,
          retry: true,

          error:
            "ALEX could not create a recovery plan.",

          waitMs:
            this.defaultStepDelayMs,
        };
      }

      context.metadata.plan = {
        canExecute: true,

        goal:
          recoveryPlan.goal ||
          String(
            context.input || ""
          ).trim(),

        reason:
          recoveryPlan.reason ||
          "Recovery plan created because verification found incomplete work.",

        steps:
          recoveryPlan.steps
            .slice(
              0,
              this.maxSteps
            ),

        createdAt:
          new Date().toISOString(),

        replan:
          context.metadata
            .replanCount,
      };

      context.metadata.executionHistory =
        [];

      const newTotal =
        context.metadata.plan.steps.length;

      await this._updateProgress(
        context,
        0,
        newTotal,
        "ALEX found incomplete work and created a recovery plan."
      );

      return {
        done: false,
        failed: false,
        retry: false,

        progress: 0,

        currentStep: 1,

        totalSteps:
          newTotal,

        result: {
          type:
            "autonomous-replanned",

          replan:
            context.metadata
              .replanCount,

          reason:
            verification.reason ||
            "Goal is not complete.",

          plan: {
            totalSteps:
              newTotal,
          },
        },

        waitMs:
          this.defaultStepDelayMs,
      };
    }

    // ========================================================
    // VERIFICATION NOT COMPLETE
    // ========================================================

    return {
      done: false,
      failed: false,
      retry: true,

      error:
        verification?.reason ||
        "Task is not verified as complete.",

      result:
        verification,

      waitMs:
        this.defaultStepDelayMs,
    };
  }

  // ==========================================================
  // SAFE PROGRESS UPDATE
  // ==========================================================

  async _updateProgress(
    context,
    currentStep,
    totalSteps,
    message
  ) {
    if (
      typeof context.updateProgress !==
      "function"
    ) {
      return;
    }

    const safeCurrent =
      Math.max(
        0,
        Number(currentStep) || 0
      );

    const safeTotal =
      Math.max(
        0,
        Number(totalSteps) || 0
      );

    const progress =
      safeTotal > 0
        ? Math.min(
            99,
            Math.round(
              (safeCurrent /
                safeTotal) *
                100
            )
          )
        : 0;

    await context.updateProgress(
      progress,
      safeCurrent,
      safeTotal
    );
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskExecutor(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskExecutor(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskExecutor;

module.exports.AutonomousTaskExecutor =
  AutonomousTaskExecutor;

module.exports.getAutonomousTaskExecutor =
  getAutonomousTaskExecutor;