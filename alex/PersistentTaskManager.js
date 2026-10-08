// ============================================================
// ALEX PERSISTENT TASK MANAGER
// Version: 1.0.0
//
// Purpose:
//   - Long-running ALEX tasks
//   - Persistent task state
//   - Automatic resume after server restart
//   - Retry support
//   - Pause / Resume / Cancel
//   - Progress tracking
//   - No fake "completed" status
//   - Safe sequential execution
//
// This file has NO external dependencies.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class PersistentTaskManager {
  constructor(options = {}) {
    this.projectRoot =
      options.projectRoot ||
      process.cwd();

    this.dataDir =
      options.dataDir ||
      path.join(
        this.projectRoot,
        ".alex-data",
        "tasks"
      );

    this.tasksFile =
      options.tasksFile ||
      path.join(
        this.dataDir,
        "tasks.json"
      );

    this.maxRetries =
      Number.isFinite(Number(options.maxRetries))
        ? Math.max(0, Number(options.maxRetries))
        : 5;

    this.retryDelayMs =
      Number.isFinite(Number(options.retryDelayMs))
        ? Math.max(250, Number(options.retryDelayMs))
        : 3000;

    this.maxTaskHistory =
      Number.isFinite(Number(options.maxTaskHistory))
        ? Math.max(10, Number(options.maxTaskHistory))
        : 1000;

    this.tasks = new Map();

    this.executors = new Map();

    this.running = new Set();

    this._writeQueue = Promise.resolve();

    this._ensureStorage();

    this._load();

    this._recoverInterruptedTasks();
  }

  // ==========================================================
  // STORAGE
  // ==========================================================

  _ensureStorage() {
    fs.mkdirSync(this.dataDir, {
      recursive: true,
    });

    if (!fs.existsSync(this.tasksFile)) {
      fs.writeFileSync(
        this.tasksFile,
        JSON.stringify(
          {
            version: 1,
            updatedAt: new Date().toISOString(),
            tasks: [],
          },
          null,
          2
        ),
        "utf8"
      );
    }
  }

  _load() {
    try {
      const raw = fs.readFileSync(
        this.tasksFile,
        "utf8"
      );

      const parsed = JSON.parse(raw);

      const list = Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : [];

      this.tasks.clear();

      for (const task of list) {
        if (!task || typeof task !== "object") {
          continue;
        }

        if (!task.id) {
          continue;
        }

        this.tasks.set(
          task.id,
          this._normalizeTask(task)
        );
      }
    } catch (error) {
      console.error(
        "[ALEX TASK MANAGER] Failed to load tasks:",
        error.message
      );

      this.tasks.clear();
    }
  }

  _persist() {
    const snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tasks: Array.from(this.tasks.values())
        .sort((a, b) => {
          return (
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime()
          );
        })
        .slice(-this.maxTaskHistory),
    };

    this._writeQueue =
      this._writeQueue
        .then(async () => {
          const tempFile =
            `${this.tasksFile}.tmp`;

          await fs.promises.writeFile(
            tempFile,
            JSON.stringify(
              snapshot,
              null,
              2
            ),
            "utf8"
          );

          await fs.promises.rename(
            tempFile,
            this.tasksFile
          );
        })
        .catch((error) => {
          console.error(
            "[ALEX TASK MANAGER] Persist failed:",
            error.message
          );
        });

    return this._writeQueue;
  }

  // ==========================================================
  // TASK NORMALIZATION
  // ==========================================================

  _normalizeTask(task) {
    const now =
      new Date().toISOString();

    return {
      id:
        String(task.id),

      ownerId:
        task.ownerId
          ? String(task.ownerId)
          : "anonymous",

      sessionId:
        task.sessionId
          ? String(task.sessionId)
          : "default",

      input:
        typeof task.input === "string"
          ? task.input
          : "",

      action:
        task.action || "autonomous-task",

      target:
        task.target || "project",

      status:
        this._normalizeStatus(
          task.status
        ),

      progress:
        this._normalizeProgress(
          task.progress
        ),

      currentStep:
        Number.isFinite(
          Number(task.currentStep)
        )
          ? Math.max(
              0,
              Number(task.currentStep)
            )
          : 0,

      totalSteps:
        Number.isFinite(
          Number(task.totalSteps)
        )
          ? Math.max(
              0,
              Number(task.totalSteps)
            )
          : 0,

      attempt:
        Number.isFinite(
          Number(task.attempt)
        )
          ? Math.max(
              0,
              Number(task.attempt)
            )
          : 0,

      maxRetries:
        Number.isFinite(
          Number(task.maxRetries)
        )
          ? Math.max(
              0,
              Number(task.maxRetries)
            )
          : this.maxRetries,

      createdAt:
        task.createdAt || now,

      startedAt:
        task.startedAt || null,

      updatedAt:
        task.updatedAt || now,

      completedAt:
        task.completedAt || null,

      pausedAt:
        task.pausedAt || null,

      cancelledAt:
        task.cancelledAt || null,

      lastError:
        task.lastError || null,

      lastResult:
        task.lastResult ?? null,

      result:
        task.result ?? null,

      metadata:
        task.metadata &&
        typeof task.metadata === "object"
          ? task.metadata
          : {},

      history:
        Array.isArray(task.history)
          ? task.history.slice(-100)
          : [],

      resumeOnRestart:
        task.resumeOnRestart !== false,

      cancelRequested:
        task.cancelRequested === true,

      pauseRequested:
        task.pauseRequested === true,
    };
  }

  _normalizeStatus(status) {
    const allowed = new Set([
      "queued",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ]);

    return allowed.has(status)
      ? status
      : "queued";
  }

  _normalizeProgress(progress) {
    const value =
      Number(progress);

    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(0, value)
    );
  }

  // ==========================================================
  // RECOVERY
  // ==========================================================

  _recoverInterruptedTasks() {
    let changed = false;

    for (const task of this.tasks.values()) {
      if (
        task.status === "running" &&
        task.resumeOnRestart
      ) {
        task.status = "queued";

        task.lastError =
          "ALEX process restarted. Task queued for automatic resume.";

        task.updatedAt =
          new Date().toISOString();

        task.history.push({
          timestamp:
            new Date().toISOString(),
          event:
            "recovered-after-restart",
        });

        changed = true;
      }
    }

    if (changed) {
      this._persist();
    }
  }

  // ==========================================================
  // ID
  // ==========================================================

  _generateTaskId() {
    return (
      `task_${Date.now()}_` +
      crypto.randomBytes(5).toString("hex")
    );
  }

  // ==========================================================
  // CREATE TASK
  // ==========================================================

  async createTask(options = {}) {
    const task = this._normalizeTask({
      id:
        options.id ||
        this._generateTaskId(),

      ownerId:
        options.ownerId ||
        "anonymous",

      sessionId:
        options.sessionId ||
        "default",

      input:
        options.input ||
        "",

      action:
        options.action ||
        "autonomous-task",

      target:
        options.target ||
        "project",

      status: "queued",

      progress: 0,

      currentStep: 0,

      totalSteps:
        Number(options.totalSteps) || 0,

      attempt: 0,

      maxRetries:
        Number.isFinite(
          Number(options.maxRetries)
        )
          ? Number(options.maxRetries)
          : this.maxRetries,

      metadata:
        options.metadata || {},

      resumeOnRestart:
        options.resumeOnRestart !== false,

      history: [
        {
          timestamp:
            new Date().toISOString(),
          event: "created",
        },
      ],
    });

    this.tasks.set(
      task.id,
      task
    );

    await this._persist();

    return this._publicTask(task);
  }

  // ==========================================================
  // REGISTER EXECUTOR
  // ==========================================================

  registerExecutor(
    taskType,
    executor
  ) {
    if (
      !taskType ||
      typeof taskType !== "string"
    ) {
      throw new Error(
        "Task executor type is required."
      );
    }

    if (
      typeof executor !== "function"
    ) {
      throw new Error(
        "Task executor must be a function."
      );
    }

    this.executors.set(
      taskType,
      executor
    );

    return true;
  }

  unregisterExecutor(taskType) {
    return this.executors.delete(
      taskType
    );
  }

  // ==========================================================
  // START
  // ==========================================================

  async startTask(
    taskId,
    options = {}
  ) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    if (
      this.running.has(taskId)
    ) {
      return this._publicTask(task);
    }

    if (
      ["completed", "cancelled"].includes(
        task.status
      )
    ) {
      return this._publicTask(task);
    }

    const executorType =
      options.executorType ||
      task.metadata?.executorType ||
      "default";

    task.metadata.executorType =
      executorType;

    task.status = "running";
    task.startedAt =
      task.startedAt ||
      new Date().toISOString();

    task.pausedAt = null;
    task.cancelRequested = false;
    task.pauseRequested = false;

    task.updatedAt =
      new Date().toISOString();

    task.history.push({
      timestamp:
        new Date().toISOString(),
      event: "started",
    });

    await this._persist();

    this._runTask(
      taskId,
      executorType
    ).catch((error) => {
      console.error(
        "[ALEX TASK MANAGER] Worker error:",
        error.message
      );
    });

    return this._publicTask(task);
  }

  // ==========================================================
  // WORKER
  // ==========================================================

  async _runTask(
    taskId,
    executorType
  ) {
    if (
      this.running.has(taskId)
    ) {
      return;
    }

    this.running.add(taskId);

    try {
      const task =
        this.tasks.get(taskId);

      if (!task) {
        return;
      }

      const executor =
        this.executors.get(
          executorType
        );

      if (!executor) {
        throw new Error(
          `No executor registered for task type: ${executorType}`
        );
      }

      while (true) {
        const current =
          this.tasks.get(taskId);

        if (!current) {
          return;
        }

        // ------------------------------------------------------
        // CANCEL
        // ------------------------------------------------------

        if (
          current.cancelRequested
        ) {
          current.status =
            "cancelled";

          current.cancelledAt =
            new Date().toISOString();

          current.updatedAt =
            new Date().toISOString();

          current.history.push({
            timestamp:
              new Date().toISOString(),
            event: "cancelled",
          });

          await this._persist();

          return;
        }

        // ------------------------------------------------------
        // PAUSE
        // ------------------------------------------------------

        if (
          current.pauseRequested
        ) {
          current.status =
            "paused";

          current.pausedAt =
            new Date().toISOString();

          current.updatedAt =
            new Date().toISOString();

          current.history.push({
            timestamp:
              new Date().toISOString(),
            event: "paused",
          });

          await this._persist();

          return;
        }

        current.status =
          "running";

        current.attempt += 1;

        current.updatedAt =
          new Date().toISOString();

        await this._persist();

        let output;

        try {
          output =
            await executor(
              this._executorContext(current)
            );
        } catch (error) {
          output = {
            done: false,
            retry: true,
            error:
              error?.message ||
              String(error),
          };
        }

        const normalized =
          this._normalizeExecutorResult(
            output
          );

        // ------------------------------------------------------
        // UPDATE PROGRESS
        // ------------------------------------------------------

        if (
          normalized.progress !== null
        ) {
          current.progress =
            normalized.progress;
        }

        if (
          normalized.currentStep !== null
        ) {
          current.currentStep =
            normalized.currentStep;
        }

        if (
          normalized.totalSteps !== null
        ) {
          current.totalSteps =
            normalized.totalSteps;
        }

        current.lastResult =
          normalized.result;

        current.lastError =
          normalized.error;

        current.updatedAt =
          new Date().toISOString();

        current.history.push({
          timestamp:
            new Date().toISOString(),
          event:
            normalized.done
              ? "step-completed"
              : "step-finished",

          progress:
            current.progress,

          currentStep:
            current.currentStep,

          error:
            normalized.error || null,
        });

        // ------------------------------------------------------
        // COMPLETED
        // ------------------------------------------------------

        if (normalized.done) {
          current.status =
            "completed";

          current.progress = 100;

          current.completedAt =
            new Date().toISOString();

          current.updatedAt =
            new Date().toISOString();

          current.result =
            normalized.result;

          current.history.push({
            timestamp:
              new Date().toISOString(),
            event: "completed",
          });

          await this._persist();

          return;
        }

        // ------------------------------------------------------
        // FAILURE WITHOUT RETRY
        // ------------------------------------------------------

        if (
          normalized.failed &&
          !normalized.retry
        ) {
          current.status =
            "failed";

          current.updatedAt =
            new Date().toISOString();

          current.history.push({
            timestamp:
              new Date().toISOString(),
            event: "failed",
            error:
              normalized.error ||
              "Task failed",
          });

          await this._persist();

          return;
        }

        // ------------------------------------------------------
        // RETRY LIMIT
        // ------------------------------------------------------

        if (
          current.attempt >
          current.maxRetries
        ) {
          current.status =
            "failed";

          current.lastError =
            normalized.error ||
            "Maximum retry limit reached.";

          current.updatedAt =
            new Date().toISOString();

          current.history.push({
            timestamp:
              new Date().toISOString(),
            event: "retry-limit-reached",
            attempts:
              current.attempt,
          });

          await this._persist();

          return;
        }

        // ------------------------------------------------------
        // CONTINUE
        // ------------------------------------------------------

        current.status =
          "running";

        current.updatedAt =
          new Date().toISOString();

        await this._persist();

        if (
          normalized.waitMs > 0
        ) {
          await this._sleep(
            normalized.waitMs
          );
        } else if (
          normalized.retry
        ) {
          await this._sleep(
            this.retryDelayMs
          );
        }

        // Loop continues automatically.
      }
    } finally {
      this.running.delete(
        taskId
      );
    }
  }

  // ==========================================================
  // EXECUTOR CONTEXT
  // ==========================================================

  _executorContext(task) {
    return {
      taskId: task.id,

      ownerId:
        task.ownerId,

      sessionId:
        task.sessionId,

      input:
        task.input,

      action:
        task.action,

      target:
        task.target,

      progress:
        task.progress,

      currentStep:
        task.currentStep,

      totalSteps:
        task.totalSteps,

      attempt:
        task.attempt,

      maxRetries:
        task.maxRetries,

      metadata:
        task.metadata,

      isCancelled: () => {
        const current =
          this.tasks.get(task.id);

        return (
          !current ||
          current.cancelRequested ||
          current.status === "cancelled"
        );
      },

      isPaused: () => {
        const current =
          this.tasks.get(task.id);

        return (
          current?.pauseRequested === true ||
          current?.status === "paused"
        );
      },

      updateProgress: async (
        progress,
        currentStep = null,
        totalSteps = null
      ) => {
        const current =
          this.tasks.get(task.id);

        if (!current) {
          return;
        }

        if (
          Number.isFinite(
            Number(progress)
          )
        ) {
          current.progress =
            Math.min(
              100,
              Math.max(
                0,
                Number(progress)
              )
            );
        }

        if (
          Number.isFinite(
            Number(currentStep)
          )
        ) {
          current.currentStep =
            Math.max(
              0,
              Number(currentStep)
            );
        }

        if (
          Number.isFinite(
            Number(totalSteps)
          )
        ) {
          current.totalSteps =
            Math.max(
              0,
              Number(totalSteps)
            );
        }

        current.updatedAt =
          new Date().toISOString();

        await this._persist();
      },
    };
  }

  // ==========================================================
  // NORMALIZE EXECUTOR RESULT
  // ==========================================================

  _normalizeExecutorResult(
    output
  ) {
    if (
      output === true
    ) {
      return {
        done: true,
        failed: false,
        retry: false,
        progress: 100,
        currentStep: null,
        totalSteps: null,
        result: true,
        error: null,
        waitMs: 0,
      };
    }

    if (
      output === false ||
      output == null
    ) {
      return {
        done: false,
        failed: true,
        retry: false,
        progress: null,
        currentStep: null,
        totalSteps: null,
        result: null,
        error: "Executor returned no result.",
        waitMs: 0,
      };
    }

    if (
      typeof output !== "object"
    ) {
      return {
        done: true,
        failed: false,
        retry: false,
        progress: 100,
        currentStep: null,
        totalSteps: null,
        result: output,
        error: null,
        waitMs: 0,
      };
    }

    return {
      done:
        output.done === true,

      failed:
        output.failed === true,

      retry:
        output.retry === true,

      progress:
        Number.isFinite(
          Number(output.progress)
        )
          ? Math.min(
              100,
              Math.max(
                0,
                Number(output.progress)
              )
            )
          : null,

      currentStep:
        Number.isFinite(
          Number(output.currentStep)
        )
          ? Math.max(
              0,
              Number(output.currentStep)
            )
          : null,

      totalSteps:
        Number.isFinite(
          Number(output.totalSteps)
        )
          ? Math.max(
              0,
              Number(output.totalSteps)
            )
          : null,

      result:
        output.result ?? output.data ?? null,

      error:
        output.error
          ? String(output.error)
          : null,

      waitMs:
        Number.isFinite(
          Number(output.waitMs)
        )
          ? Math.max(
              0,
              Number(output.waitMs)
            )
          : 0,
    };
  }

  // ==========================================================
  // PAUSE
  // ==========================================================

  async pauseTask(taskId) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    if (
      task.status !== "running"
    ) {
      return this._publicTask(task);
    }

    task.pauseRequested = true;

    task.updatedAt =
      new Date().toISOString();

    task.history.push({
      timestamp:
        new Date().toISOString(),
      event:
        "pause-requested",
    });

    await this._persist();

    return this._publicTask(task);
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  async resumeTask(
    taskId,
    options = {}
  ) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    if (
      task.status !== "paused" &&
      task.status !== "queued" &&
      task.status !== "failed"
    ) {
      return this._publicTask(task);
    }

    task.pauseRequested = false;
    task.cancelRequested = false;
    task.status = "queued";
    task.lastError = null;

    task.updatedAt =
      new Date().toISOString();

    task.history.push({
      timestamp:
        new Date().toISOString(),
      event: "resume-requested",
    });

    await this._persist();

    return this.startTask(
      taskId,
      {
        executorType:
          options.executorType ||
          task.metadata?.executorType ||
          "default",
      }
    );
  }

  // ==========================================================
  // CANCEL
  // ==========================================================

  async cancelTask(taskId) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    if (
      ["completed", "cancelled"].includes(
        task.status
      )
    ) {
      return this._publicTask(task);
    }

    task.cancelRequested = true;

    task.updatedAt =
      new Date().toISOString();

    task.history.push({
      timestamp:
        new Date().toISOString(),
      event:
        "cancel-requested",
    });

    await this._persist();

    return this._publicTask(task);
  }

  // ==========================================================
  // GET TASK
  // ==========================================================

  getTask(taskId) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      return null;
    }

    return this._publicTask(task);
  }

  // ==========================================================
  // LIST TASKS
  // ==========================================================

  listTasks(options = {}) {
    const ownerId =
      options.ownerId != null
        ? String(options.ownerId)
        : null;

    const status =
      options.status
        ? String(options.status)
        : null;

    const limit =
      Math.min(
        Math.max(
          1,
          Number(options.limit) || 50
        ),
        500
      );

    let tasks =
      Array.from(
        this.tasks.values()
      );

    if (ownerId) {
      tasks =
        tasks.filter(
          (task) =>
            String(task.ownerId) ===
            ownerId
        );
    }

    if (status) {
      tasks =
        tasks.filter(
          (task) =>
            task.status === status
        );
    }

    tasks.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() -
        new Date(a.updatedAt).getTime()
    );

    return tasks
      .slice(0, limit)
      .map((task) =>
        this._publicTask(task)
      );
  }

  // ==========================================================
  // DELETE COMPLETED HISTORY
  // ==========================================================

  async deleteTask(taskId) {
    const task =
      this.tasks.get(taskId);

    if (!task) {
      return false;
    }

    if (
      this.running.has(taskId)
    ) {
      throw new Error(
        "Running task cannot be deleted. Cancel it first."
      );
    }

    this.tasks.delete(
      taskId
    );

    await this._persist();

    return true;
  }

  // ==========================================================
  // STATUS SUMMARY
  // ==========================================================

  getStatusSummary(ownerId = null) {
    const tasks =
      this.listTasks({
        ownerId,
        limit: 500,
      });

    const summary = {
      total: tasks.length,
      queued: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of tasks) {
      if (
        Object.prototype.hasOwnProperty.call(
          summary,
          task.status
        )
      ) {
        summary[task.status]++;
      }
    }

    return summary;
  }

  // ==========================================================
  // PUBLIC SAFE TASK
  // ==========================================================

  _publicTask(task) {
    return JSON.parse(
      JSON.stringify({
        id: task.id,
        ownerId: task.ownerId,
        sessionId: task.sessionId,
        input: task.input,
        action: task.action,
        target: task.target,
        status: task.status,
        progress: task.progress,
        currentStep: task.currentStep,
        totalSteps: task.totalSteps,
        attempt: task.attempt,
        maxRetries: task.maxRetries,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        pausedAt: task.pausedAt,
        cancelledAt: task.cancelledAt,
        lastError: task.lastError,
        lastResult: task.lastResult,
        result: task.result,
        metadata: task.metadata,
        resumeOnRestart:
          task.resumeOnRestart,
      })
    );
  }

  // ==========================================================
  // SLEEP
  // ==========================================================

  _sleep(ms) {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          Math.max(
            0,
            Number(ms) || 0
          )
        )
    );
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getPersistentTaskManager(
  options = {}
) {
  if (!instance) {
    instance =
      new PersistentTaskManager(
        options
      );
  }

  return instance;
}

module.exports =
  PersistentTaskManager;

module.exports.PersistentTaskManager =
  PersistentTaskManager;

module.exports.getPersistentTaskManager =
  getPersistentTaskManager;