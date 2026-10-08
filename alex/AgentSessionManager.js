// ============================================================
// ALEX — Agent Session Manager
// Version: 1.0.0
// Purpose:
//   Manage long-running ALEX agent sessions, contexts,
//   activity history, lifecycle state and cancellation.
//
// This file does NOT execute tools.
// Execution remains handled by:
//   AgentOrchestrator
//   AgentPlanExecutor
//   AgentWorkflowEngine
// ============================================================

"use strict";

const crypto = require("crypto");

const SESSION_MANAGER_VERSION = "1.0.0";

const SESSION_STATUS = Object.freeze({
  CREATED: "created",
  ACTIVE: "active",
  PAUSED: "paused",
  WAITING_CONFIRMATION: "waiting_confirmation",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const MAX_SESSIONS = 500;
const MAX_HISTORY_ITEMS = 200;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

function createId(prefix) {
  if (crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function now() {
  return Date.now();
}

function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

class AgentSessionManager {
  constructor(options = {}) {
    this.version = SESSION_MANAGER_VERSION;

    this.maxSessions =
      Number.isFinite(options.maxSessions) &&
      options.maxSessions > 0
        ? Math.floor(options.maxSessions)
        : MAX_SESSIONS;

    this.maxHistoryItems =
      Number.isFinite(options.maxHistoryItems) &&
      options.maxHistoryItems > 0
        ? Math.floor(options.maxHistoryItems)
        : MAX_HISTORY_ITEMS;

    this.sessionTtlMs =
      Number.isFinite(options.sessionTtlMs) &&
      options.sessionTtlMs > 0
        ? Math.floor(options.sessionTtlMs)
        : DEFAULT_SESSION_TTL_MS;

    this.sessions = new Map();
  }

  // ==========================================================
  // CREATE SESSION
  // ==========================================================

  create(options = {}) {
    this._cleanupExpired();

    const sessionId =
      safeString(options.sessionId).trim() ||
      createId("alex_session");

    if (this.sessions.has(sessionId)) {
      throw new Error(
        `Session already exists: ${sessionId}`
      );
    }

    const timestamp = now();

    const session = {
      sessionId,

      ownerId:
        options.ownerId !== undefined
          ? safeString(options.ownerId)
          : null,

      userId:
        options.userId !== undefined
          ? safeString(options.userId)
          : null,

      taskId:
        options.taskId !== undefined
          ? safeString(options.taskId)
          : null,

      parentSessionId:
        options.parentSessionId !== undefined
          ? safeString(options.parentSessionId)
          : null,

      goal:
        options.goal !== undefined
          ? safeString(options.goal)
          : "",

      originalInput:
        options.originalInput !== undefined
          ? safeString(options.originalInput)
          : "",

      status: SESSION_STATUS.CREATED,

      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,

      expiresAt:
        options.expiresAt !== undefined
          ? Number(options.expiresAt)
          : timestamp + this.sessionTtlMs,

      stepIndex: 0,

      metadata:
        options.metadata &&
        typeof options.metadata === "object"
          ? clone(options.metadata)
          : {},

      capabilities:
        Array.isArray(options.capabilities)
          ? [...new Set(options.capabilities.map(String))]
          : [],

      history: [],
    };

    this.sessions.set(sessionId, session);

    this._enforceSessionLimit();

    this._record(session, "session_created", {
      goal: session.goal,
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // GET SESSION
  // ==========================================================

  get(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return null;
    }

    const session = this.sessions.get(id);

    if (!session) {
      return null;
    }

    if (this._isExpired(session)) {
      this._expire(session);
      return this._publicSession(session);
    }

    return this._publicSession(session);
  }

  // ==========================================================
  // INTERNAL GET
  // ==========================================================

  _getInternal(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return null;
    }

    return this.sessions.get(id) || null;
  }

  // ==========================================================
  // EXISTS
  // ==========================================================

  has(sessionId) {
    return Boolean(this._getInternal(sessionId));
  }

  // ==========================================================
  // START
  // ==========================================================

  start(sessionId) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.ACTIVE;

    this._touch(session);

    this._record(session, "session_started");

    return this._publicSession(session);
  }

  // ==========================================================
  // PAUSE
  // ==========================================================

  pause(sessionId, reason = "") {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.PAUSED;

    this._touch(session);

    this._record(session, "session_paused", {
      reason: safeString(reason),
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // WAITING FOR CONFIRMATION
  // ==========================================================

  waitForConfirmation(sessionId, details = {}) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status =
      SESSION_STATUS.WAITING_CONFIRMATION;

    this._touch(session);

    this._record(
      session,
      "waiting_confirmation",
      details
    );

    return this._publicSession(session);
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  resume(sessionId) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.ACTIVE;

    this._touch(session);

    this._record(session, "session_resumed");

    return this._publicSession(session);
  }

  // ==========================================================
  // COMPLETE
  // ==========================================================

  complete(sessionId, result = null) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.COMPLETED;

    session.result =
      result === undefined
        ? null
        : clone(result);

    this._touch(session);

    this._record(session, "session_completed", {
      hasResult: result !== null &&
        result !== undefined,
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // FAIL
  // ==========================================================

  fail(sessionId, error = null) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.FAILED;

    session.error = this._normalizeError(error);

    this._touch(session);

    this._record(session, "session_failed", {
      error: session.error,
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // CANCEL
  // ==========================================================

  cancel(sessionId, reason = "") {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.status = SESSION_STATUS.CANCELLED;

    session.cancelReason = safeString(reason);

    this._touch(session);

    this._record(session, "session_cancelled", {
      reason: session.cancelReason,
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // STEP
  // ==========================================================

  nextStep(sessionId, details = {}) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.stepIndex += 1;

    this._touch(session);

    this._record(session, "step_started", {
      stepIndex: session.stepIndex,
      ...details,
    });

    return session.stepIndex;
  }

  // ==========================================================
  // RECORD ACTIVITY
  // ==========================================================

  record(sessionId, type, data = {}) {
    const session = this._require(sessionId);

    this._touch(session);

    return this._record(
      session,
      type,
      data
    );
  }

  // ==========================================================
  // GET HISTORY
  // ==========================================================

  getHistory(sessionId, limit = this.maxHistoryItems) {
    const session = this._require(sessionId);

    const safeLimit =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : this.maxHistoryItems;

    return clone(
      session.history.slice(-safeLimit)
    );
  }

  // ==========================================================
  // UPDATE GOAL
  // ==========================================================

  setGoal(sessionId, goal) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.goal = safeString(goal);

    this._touch(session);

    this._record(session, "goal_updated", {
      goal: session.goal,
    });

    return this._publicSession(session);
  }

  // ==========================================================
  // UPDATE INPUT
  // ==========================================================

  setOriginalInput(sessionId, input) {
    const session = this._require(sessionId);

    this._assertNotTerminal(session);

    session.originalInput = safeString(input);

    this._touch(session);

    return this._publicSession(session);
  }

  // ==========================================================
  // METADATA
  // ==========================================================

  setMetadata(sessionId, key, value) {
    const session = this._require(sessionId);

    if (!key) {
      throw new Error("Metadata key is required");
    }

    session.metadata[String(key)] = clone(value);

    this._touch(session);

    return this._publicSession(session);
  }

  getMetadata(sessionId, key, fallback = null) {
    const session = this._require(sessionId);

    const normalizedKey = String(key);

    if (
      !Object.prototype.hasOwnProperty.call(
        session.metadata,
        normalizedKey
      )
    ) {
      return fallback;
    }

    return clone(
      session.metadata[normalizedKey]
    );
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  setCapabilities(sessionId, capabilities) {
    const session = this._require(sessionId);

    session.capabilities =
      Array.isArray(capabilities)
        ? [
            ...new Set(
              capabilities.map(String)
            ),
          ]
        : [];

    this._touch(session);

    this._record(
      session,
      "capabilities_updated",
      {
        capabilities: session.capabilities,
      }
    );

    return this._publicSession(session);
  }

  addCapability(sessionId, capability) {
    const session = this._require(sessionId);

    const value = safeString(capability).trim();

    if (!value) {
      throw new Error("Capability is required");
    }

    if (!session.capabilities.includes(value)) {
      session.capabilities.push(value);
    }

    this._touch(session);

    return this._publicSession(session);
  }

  removeCapability(sessionId, capability) {
    const session = this._require(sessionId);

    const value = safeString(capability).trim();

    session.capabilities =
      session.capabilities.filter(
        (item) => item !== value
      );

    this._touch(session);

    return this._publicSession(session);
  }

  hasCapability(sessionId, capability) {
    const session = this._require(sessionId);

    return session.capabilities.includes(
      safeString(capability).trim()
    );
  }

  // ==========================================================
  // ACTIVITY
  // ==========================================================

  touch(sessionId) {
    const session = this._require(sessionId);

    this._touch(session);

    return this._publicSession(session);
  }

  _touch(session) {
    const timestamp = now();

    session.updatedAt = timestamp;
    session.lastActivityAt = timestamp;

    if (
      session.status !== SESSION_STATUS.COMPLETED &&
      session.status !== SESSION_STATUS.FAILED &&
      session.status !== SESSION_STATUS.CANCELLED
    ) {
      session.expiresAt =
        timestamp + this.sessionTtlMs;
    }
  }

  // ==========================================================
  // SESSION LIST
  // ==========================================================

  list(options = {}) {
    this._cleanupExpired();

    let sessions = Array.from(
      this.sessions.values()
    );

    if (options.status) {
      sessions = sessions.filter(
        (session) =>
          session.status === options.status
      );
    }

    if (options.ownerId !== undefined) {
      const ownerId = safeString(options.ownerId);

      sessions = sessions.filter(
        (session) =>
          session.ownerId === ownerId
      );
    }

    if (options.userId !== undefined) {
      const userId = safeString(options.userId);

      sessions = sessions.filter(
        (session) =>
          session.userId === userId
      );
    }

    sessions.sort(
      (a, b) =>
        b.updatedAt - a.updatedAt
    );

    if (
      Number.isFinite(options.limit) &&
      options.limit > 0
    ) {
      sessions = sessions.slice(
        0,
        Math.floor(options.limit)
      );
    }

    return sessions.map(
      (session) =>
        this._publicSession(session)
    );
  }

  // ==========================================================
  // ACTIVE SESSIONS
  // ==========================================================

  listActive() {
    return this.list({
      status: SESSION_STATUS.ACTIVE,
    });
  }

  // ==========================================================
  // TERMINAL CHECK
  // ==========================================================

  isTerminal(sessionId) {
    const session = this._require(sessionId);

    return [
      SESSION_STATUS.COMPLETED,
      SESSION_STATUS.FAILED,
      SESSION_STATUS.CANCELLED,
      SESSION_STATUS.EXPIRED,
    ].includes(session.status);
  }

  // ==========================================================
  // DELETE
  // ==========================================================

  remove(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return false;
    }

    return this.sessions.delete(id);
  }

  // ==========================================================
  // CLEAR
  // ==========================================================

  clear(options = {}) {
    if (options.keepActive === true) {
      for (const [
        sessionId,
        session,
      ] of this.sessions.entries()) {
        if (
          session.status !==
          SESSION_STATUS.ACTIVE
        ) {
          this.sessions.delete(sessionId);
        }
      }

      return this.sessions.size;
    }

    this.sessions.clear();

    return 0;
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    this._cleanupExpired();

    const stats = {
      version: this.version,
      total: this.sessions.size,
      created: 0,
      active: 0,
      paused: 0,
      waiting_confirmation: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,
    };

    for (const session of this.sessions.values()) {
      if (
        Object.prototype.hasOwnProperty.call(
          stats,
          session.status
        )
      ) {
        stats[session.status] += 1;
      }
    }

    return stats;
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  snapshot(sessionId) {
    const session = this._require(sessionId);

    return this._publicSession(session);
  }

  // ==========================================================
  // EXPORT
  // ==========================================================

  exportState() {
    this._cleanupExpired();

    return {
      version: this.version,
      exportedAt: now(),
      sessions: Array.from(
        this.sessions.values()
      ).map((session) =>
        this._publicSession(session)
      ),
    };
  }

  // ==========================================================
  // IMPORT
  // ==========================================================

  importState(state = {}) {
    if (!state || !Array.isArray(state.sessions)) {
      throw new Error(
        "Invalid AgentSessionManager state"
      );
    }

    this.sessions.clear();

    for (const raw of state.sessions) {
      if (!raw || !raw.sessionId) {
        continue;
      }

      const session = {
        ...clone(raw),
        history: Array.isArray(raw.history)
          ? clone(raw.history).slice(
              -this.maxHistoryItems
            )
          : [],
        metadata:
          raw.metadata &&
          typeof raw.metadata === "object"
            ? clone(raw.metadata)
            : {},
        capabilities:
          Array.isArray(raw.capabilities)
            ? [
                ...new Set(
                  raw.capabilities.map(String)
                ),
              ]
            : [],
      };

      this.sessions.set(
        String(raw.sessionId),
        session
      );
    }

    this._enforceSessionLimit();

    return this.exportState();
  }

  // ==========================================================
  // INTERNAL RECORD
  // ==========================================================

  _record(session, type, data = {}) {
    const event = {
      id: createId("session_event"),
      type: safeString(type, "event"),
      timestamp: now(),
      sessionId: session.sessionId,
      stepIndex: session.stepIndex,
      data:
        data &&
        typeof data === "object"
          ? clone(data)
          : {},
    };

    session.history.push(event);

    if (
      session.history.length >
      this.maxHistoryItems
    ) {
      session.history =
        session.history.slice(
          -this.maxHistoryItems
        );
    }

    return clone(event);
  }

  // ==========================================================
  // REQUIRE
  // ==========================================================

  _require(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      throw new Error("Session id is required");
    }

    const session = this.sessions.get(id);

    if (!session) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    if (this._isExpired(session)) {
      this._expire(session);
    }

    return session;
  }

  // ==========================================================
  // TERMINAL PROTECTION
  // ==========================================================

  _assertNotTerminal(session) {
    if (
      [
        SESSION_STATUS.COMPLETED,
        SESSION_STATUS.FAILED,
        SESSION_STATUS.CANCELLED,
        SESSION_STATUS.EXPIRED,
      ].includes(session.status)
    ) {
      throw new Error(
        `Session is already terminal: ${session.status}`
      );
    }
  }

  // ==========================================================
  // EXPIRATION
  // ==========================================================

  _isExpired(session) {
    if (
      [
        SESSION_STATUS.COMPLETED,
        SESSION_STATUS.FAILED,
        SESSION_STATUS.CANCELLED,
        SESSION_STATUS.EXPIRED,
      ].includes(session.status)
    ) {
      return false;
    }

    return (
      Number.isFinite(session.expiresAt) &&
      session.expiresAt <= now()
    );
  }

  _expire(session) {
    session.status = SESSION_STATUS.EXPIRED;

    this._touch(session);

    this._record(session, "session_expired");
  }

  _cleanupExpired() {
    for (const session of this.sessions.values()) {
      if (this._isExpired(session)) {
        this._expire(session);
      }
    }
  }

  // ==========================================================
  // SESSION LIMIT
  // ==========================================================

  _enforceSessionLimit() {
    if (
      this.sessions.size <=
      this.maxSessions
    ) {
      return;
    }

    const sessions = Array.from(
      this.sessions.values()
    );

    sessions.sort(
      (a, b) =>
        a.updatedAt - b.updatedAt
    );

    while (
      this.sessions.size >
      this.maxSessions
    ) {
      const removable =
        sessions.find(
          (session) =>
            [
              SESSION_STATUS.COMPLETED,
              SESSION_STATUS.FAILED,
              SESSION_STATUS.CANCELLED,
              SESSION_STATUS.EXPIRED,
            ].includes(session.status)
        ) || sessions[0];

      if (!removable) {
        break;
      }

      this.sessions.delete(
        removable.sessionId
      );

      const index =
        sessions.indexOf(removable);

      if (index !== -1) {
        sessions.splice(index, 1);
      }
    }
  }

  // ==========================================================
  // ERROR NORMALIZER
  // ==========================================================

  _normalizeError(error) {
    if (!error) {
      return null;
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
      };
    }

    if (typeof error === "string") {
      return {
        name: "Error",
        message: error,
      };
    }

    if (typeof error === "object") {
      return {
        name:
          safeString(
            error.name,
            "Error"
          ),
        message:
          safeString(
            error.message,
            "Unknown error"
          ),
        code:
          error.code !== undefined
            ? safeString(error.code)
            : undefined,
      };
    }

    return {
      name: "Error",
      message: String(error),
    };
  }

  // ==========================================================
  // PUBLIC SESSION
  // ==========================================================

  _publicSession(session) {
    const output = clone(session);

    delete output.agentToken;
    delete output.token;
    delete output.accessToken;
    delete output.secret;

    return output;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let sessionManagerInstance = null;

function getAgentSessionManager(options = {}) {
  if (!sessionManagerInstance) {
    sessionManagerInstance =
      new AgentSessionManager(options);
  }

  return sessionManagerInstance;
}

function resetAgentSessionManager(options = {}) {
  sessionManagerInstance =
    new AgentSessionManager(options);

  return sessionManagerInstance;
}

function createAgentSessionManager(options = {}) {
  return new AgentSessionManager(options);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentSessionManager,
  getAgentSessionManager,
  resetAgentSessionManager,
  createAgentSessionManager,

  SESSION_MANAGER_VERSION,
  SESSION_STATUS,

  MAX_SESSIONS,
  MAX_HISTORY_ITEMS,
  DEFAULT_SESSION_TTL_MS,
};