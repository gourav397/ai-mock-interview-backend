// ============================================================
// ALEX AUTONOMOUS TASK ROUTES
// VERSION 1.0.0
//
// PURPOSE:
//   API routes for controlling and monitoring autonomous tasks.
//
// FEATURES:
//   - Get task status
//   - List owner's tasks
//   - Get running task progress
//   - Pause task
//   - Resume task
//   - Cancel task
//   - Get completed/failed task result
//
// IMPORTANT:
//   - Tasks are ALWAYS owner-scoped.
//   - A user cannot access another owner's task.
//   - Routes do not execute arbitrary commands.
//   - Actual execution is handled by AutonomousTaskService.
// ============================================================

"use strict";

const express = require("express");

const {
  getAutonomousTaskService,
} = require("./AutonomousTaskService");

// ------------------------------------------------------------
// ROUTER
// ------------------------------------------------------------

const router = express.Router();

// ------------------------------------------------------------
// SERVICE
// ------------------------------------------------------------

const taskService =
  getAutonomousTaskService();

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

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

function getOwnerId(req) {
  // ----------------------------------------------------------
  // Primary authenticated user
  // ----------------------------------------------------------

  const user =
    req?.user ||
    req?.owner ||
    null;

  if (user) {
    const id =
      user._id ||
      user.id ||
      user.userId ||
      user.ownerId;

    if (id) {
      return String(id);
    }
  }

  // ----------------------------------------------------------
  // Some existing ALEX routes may attach owner information
  // differently.
  // ----------------------------------------------------------

  if (
    req?.auth &&
    typeof req.auth === "object"
  ) {
    const id =
      req.auth.userId ||
      req.auth.ownerId ||
      req.auth.id;

    if (id) {
      return String(id);
    }
  }

  return "";
}

function requireOwner(req, res, next) {
  const ownerId =
    getOwnerId(req);

  if (!ownerId) {
    return res.status(401).json({
      success: false,
      error:
        "Authenticated owner context is required.",
    });
  }

  req.autonomousOwnerId =
    ownerId;

  next();
}

function getTaskId(req) {
  return safeString(
    req.params?.taskId
  );
}

function sendServiceError(
  res,
  error,
  fallbackStatus = 500
) {
  const message =
    safeString(
      error?.message ||
        error?.error ||
        error,
      "Autonomous task operation failed."
    );

  const lower =
    message.toLowerCase();

  let status =
    fallbackStatus;

  if (
    lower.includes(
      "not found"
    )
  ) {
    status = 404;
  } else if (
    lower.includes(
      "not authorized"
    ) ||
    lower.includes(
      "unauthorized"
    ) ||
    lower.includes(
      "forbidden"
    )
  ) {
    status = 403;
  } else if (
    lower.includes(
      "required"
    ) ||
    lower.includes(
      "invalid"
    )
  ) {
    status = 400;
  }

  return res.status(status).json({
    success: false,
    error: message,
  });
}

// ============================================================
// GET MY TASKS
// ============================================================
//
// GET /tasks
//
// Optional query:
//
//   ?status=running
//   ?limit=20
//
// ============================================================

router.get(
  "/",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const status =
        safeString(
          req.query?.status
        ).toLowerCase();

      let limit =
        Number(
          req.query?.limit || 50
        );

      if (
        !Number.isFinite(limit) ||
        limit < 1
      ) {
        limit = 50;
      }

      limit =
        Math.min(
          Math.floor(limit),
          100
        );

      const result =
        await taskService.listTasks({
          ownerId,
          status:
            status || null,
          limit,
        });

      return res.json({
        success: true,
        ownerId,
        tasks:
          Array.isArray(
            result?.tasks
          )
            ? result.tasks
            : Array.isArray(result)
              ? result
              : [],
        count:
          Array.isArray(
            result?.tasks
          )
            ? result.tasks.length
            : Array.isArray(result)
              ? result.length
              : 0,
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// GET TASK STATUS
// ============================================================
//
// GET /tasks/:taskId
//
// Returns:
//   - current status
//   - progress
//   - current step
//   - total steps
//   - attempt
//   - errors
//   - result
//   - execution history
//
// ============================================================

router.get(
  "/:taskId",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const task =
        await taskService.getTask({
          taskId,
          ownerId,
        });

      if (!task) {
        return res.status(404).json({
          success: false,
          error:
            "Autonomous task not found.",
        });
      }

      return res.json({
        success: true,
        task,
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// GET TASK PROGRESS
// ============================================================
//
// GET /tasks/:taskId/progress
//
// ============================================================

router.get(
  "/:taskId/progress",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const task =
        await taskService.getTask({
          taskId,
          ownerId,
        });

      if (!task) {
        return res.status(404).json({
          success: false,
          error:
            "Autonomous task not found.",
        });
      }

      return res.json({
        success: true,

        taskId:
          task.id ||
          task.taskId ||
          taskId,

        status:
          task.status ||
          "unknown",

        progress:
          task.progress ??
          0,

        currentStep:
          task.currentStep ??
          0,

        totalSteps:
          task.totalSteps ??
          0,

        attempt:
          task.attempt ??
          0,

        maxRetries:
          task.maxRetries ??
          null,

        startedAt:
          task.startedAt ||
          null,

        updatedAt:
          task.updatedAt ||
          null,

        completedAt:
          task.completedAt ||
          null,

        error:
          task.error ||
          null,

        result:
          task.result ||
          null,
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// GET TASK RESULT
// ============================================================
//
// GET /tasks/:taskId/result
//
// Intended for:
//   completed
//   failed
//   cancelled
//
// ============================================================

router.get(
  "/:taskId/result",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const task =
        await taskService.getTask({
          taskId,
          ownerId,
        });

      if (!task) {
        return res.status(404).json({
          success: false,
          error:
            "Autonomous task not found.",
        });
      }

      return res.json({
        success: true,

        taskId:
          task.id ||
          task.taskId ||
          taskId,

        status:
          task.status ||
          "unknown",

        result:
          task.result ||
          null,

        error:
          task.error ||
          null,

        completedAt:
          task.completedAt ||
          null,

        failedAt:
          task.failedAt ||
          null,

        cancelledAt:
          task.cancelledAt ||
          null,
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// PAUSE TASK
// ============================================================
//
// POST /tasks/:taskId/pause
//
// ============================================================

router.post(
  "/:taskId/pause",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const result =
        await taskService.pauseTask({
          taskId,
          ownerId,
        });

      return res.json({
        success:
          result?.success !== false,

        message:
          result?.message ||
          "Autonomous task pause requested.",

        task:
          result?.task ||
          null,

        status:
          result?.status ||
          result?.task?.status ||
          "paused",
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// RESUME TASK
// ============================================================
//
// POST /tasks/:taskId/resume
//
// ============================================================

router.post(
  "/:taskId/resume",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const result =
        await taskService.resumeTask({
          taskId,
          ownerId,
        });

      return res.json({
        success:
          result?.success !== false,

        message:
          result?.message ||
          "Autonomous task resume requested.",

        task:
          result?.task ||
          null,

        status:
          result?.status ||
          result?.task?.status ||
          "queued",
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// CANCEL TASK
// ============================================================
//
// POST /tasks/:taskId/cancel
//
// ============================================================

router.post(
  "/:taskId/cancel",
  requireOwner,
  async (req, res) => {
    try {
      const ownerId =
        req.autonomousOwnerId;

      const taskId =
        getTaskId(req);

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error:
            "Task ID is required.",
        });
      }

      const result =
        await taskService.cancelTask({
          taskId,
          ownerId,
        });

      return res.json({
        success:
          result?.success !== false,

        message:
          result?.message ||
          "Autonomous task cancellation requested.",

        task:
          result?.task ||
          null,

        status:
          result?.status ||
          result?.task?.status ||
          "cancelled",
      });
    } catch (error) {
      return sendServiceError(
        res,
        error
      );
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports =
  router;