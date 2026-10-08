// ============================================================
// ALEX — Agent Session Store
// Version: 1.0.0
// Purpose:
//   Central storage layer for AgentSessionManager.
//
// This file:
//   - stores session snapshots
//   - stores session history
//   - supports export/import
//   - supports recovery snapshots
//   - keeps storage bounded
//
// This file does NOT execute tools.
// ============================================================

"use strict";

const crypto = require("crypto");

const SESSION_STORE_VERSION = "1.0.0";

const MAX_SESSIONS = 500;
const MAX_EVENTS_PER_SESSION = 200;
const MAX_SNAPSHOTS_PER_SESSION = 10;

const SESSION_RECORD_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

function createId(prefix) {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
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

function timestamp() {
  return Date.now();
}

class AgentSessionStore {
  constructor(options = {}) {
    this.version = SESSION_STORE_VERSION;

    this.maxSessions =
      Number.isFinite(options.maxSessions) &&
      options.maxSessions > 0
        ? Math.floor(options.maxSessions)
        : MAX_SESSIONS;

    this.maxEventsPerSession =
      Number.isFinite(options.maxEventsPerSession) &&
      options.maxEventsPerSession > 0
        ? Math.floor(options.maxEventsPerSession)
        : MAX_EVENTS_PER_SESSION;

    this.maxSnapshotsPerSession =
      Number.isFinite(options.maxSnapshotsPerSession) &&
      options.maxSnapshotsPerSession > 0
        ? Math.floor(options.maxSnapshotsPerSession)
        : MAX_SNAPSHOTS_PER_SESSION;

    this.sessions = new Map();
    this.snapshots = new Map();
    this.events = new Map();
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create(session = {}) {
    const sessionId =
      safeString(session.sessionId).trim() ||
      createId("alex_session");

    if (this.sessions.has(sessionId)) {
      throw new Error(
        `Session already exists: ${sessionId}`
      );
    }

    const record = this._normalizeSession({
      ...session,
      sessionId,
    });

    this.sessions.set(sessionId, record);
    this.events.set(sessionId, []);
    this.snapshots.set(sessionId, []);

    this._enforceLimit();

    this.recordEvent(
      sessionId,
      "session_created",
      {
        status: record.status,
      }
    );

    return this.get(sessionId);
  }

  // ==========================================================
  // UPSERT
  // ==========================================================

  upsert(session) {
    if (!session || !session.sessionId) {
      throw new Error(
        "session.sessionId is required"
      );
    }

    const sessionId = String(session.sessionId);

    const exists = this.sessions.has(sessionId);

    const record = this._normalizeSession(
      session
    );

    this.sessions.set(
      sessionId,
      record
    );

    if (!this.events.has(sessionId)) {
      this.events.set(sessionId, []);
    }

    if (!this.snapshots.has(sessionId)) {
      this.snapshots.set(sessionId, []);
    }

    this._enforceLimit();

    if (!exists) {
      this.recordEvent(
        sessionId,
        "session_created"
      );
    }

    return this.get(sessionId);
  }

  // ==========================================================
  // GET
  // ==========================================================

  get(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return null;
    }

    const session = this.sessions.get(id);

    return session
      ? clone(session)
      : null;
  }

  // ==========================================================
  // HAS
  // ==========================================================

  has(sessionId) {
    const id = safeString(sessionId).trim();

    return id
      ? this.sessions.has(id)
      : false;
  }

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(sessionId, patch = {}) {
    const id = safeString(sessionId).trim();

    if (!id) {
      throw new Error("Session id is required");
    }

    const existing = this.sessions.get(id);

    if (!existing) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    const updated = this._normalizeSession({
      ...existing,
      ...patch,
      sessionId: id,
      updatedAt: timestamp(),
    });

    this.sessions.set(id, updated);

    return this.get(id);
  }

  // ==========================================================
  // SET STATUS
  // ==========================================================

  setStatus(sessionId, status) {
    const id = safeString(sessionId).trim();

    if (!id) {
      throw new Error("Session id is required");
    }

    const normalizedStatus =
      safeString(status).trim();

    if (!normalizedStatus) {
      throw new Error(
        "Session status is required"
      );
    }

    const existing = this.sessions.get(id);

    if (!existing) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    existing.status = normalizedStatus;
    existing.updatedAt = timestamp();

    this.sessions.set(id, existing);

    this.recordEvent(
      id,
      "status_changed",
      {
        status: normalizedStatus,
      }
    );

    return this.get(id);
  }

  // ==========================================================
  // SET RESULT
  // ==========================================================

  setResult(sessionId, result) {
    const id = safeString(sessionId).trim();

    const existing = this.sessions.get(id);

    if (!existing) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    existing.result = clone(result);
    existing.updatedAt = timestamp();

    this.sessions.set(id, existing);

    this.recordEvent(
      id,
      "result_saved"
    );

    return this.get(id);
  }

  // ==========================================================
  // SET ERROR
  // ==========================================================

  setError(sessionId, error) {
    const id = safeString(sessionId).trim();

    const existing = this.sessions.get(id);

    if (!existing) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    existing.error =
      this._normalizeError(error);

    existing.updatedAt = timestamp();

    this.sessions.set(id, existing);

    this.recordEvent(
      id,
      "error_saved",
      {
        error: existing.error,
      }
    );

    return this.get(id);
  }

  // ==========================================================
  // RECORD EVENT
  // ==========================================================

  recordEvent(
    sessionId,
    type,
    data = {}
  ) {
    const id = safeString(sessionId).trim();

    if (!id) {
      throw new Error("Session id is required");
    }

    if (!this.sessions.has(id)) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    if (!this.events.has(id)) {
      this.events.set(id, []);
    }

    const event = {
      eventId: createId("session_event"),
      sessionId: id,
      type: safeString(type, "event"),
      timestamp: timestamp(),
      data:
        data &&
        typeof data === "object"
          ? clone(data)
          : {},
    };

    const history = this.events.get(id);

    history.push(event);

    if (
      history.length >
      this.maxEventsPerSession
    ) {
      history.splice(
        0,
        history.length -
          this.maxEventsPerSession
      );
    }

    return clone(event);
  }

  // ==========================================================
  // GET EVENTS
  // ==========================================================

  getEvents(
    sessionId,
    options = {}
  ) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return [];
    }

    const history =
      this.events.get(id) || [];

    let result = history;

    if (options.type) {
      const type = String(options.type);

      result = result.filter(
        (event) =>
          event.type === type
      );
    }

    if (
      Number.isFinite(options.limit) &&
      options.limit > 0
    ) {
      result = result.slice(
        -Math.floor(options.limit)
      );
    }

    return clone(result);
  }

  // ==========================================================
  // CREATE SNAPSHOT
  // ==========================================================

  createSnapshot(
    sessionId,
    metadata = {}
  ) {
    const id = safeString(sessionId).trim();

    const session = this.sessions.get(id);

    if (!session) {
      throw new Error(
        `Session not found: ${id}`
      );
    }

    if (!this.snapshots.has(id)) {
      this.snapshots.set(id, []);
    }

    const snapshot = {
      snapshotId: createId(
        "session_snapshot"
      ),
      sessionId: id,
      createdAt: timestamp(),

      session: clone(session),

      metadata:
        metadata &&
        typeof metadata === "object"
          ? clone(metadata)
          : {},
    };

    const snapshots =
      this.snapshots.get(id);

    snapshots.push(snapshot);

    if (
      snapshots.length >
      this.maxSnapshotsPerSession
    ) {
      snapshots.splice(
        0,
        snapshots.length -
          this.maxSnapshotsPerSession
      );
    }

    this.recordEvent(
      id,
      "snapshot_created",
      {
        snapshotId:
          snapshot.snapshotId,
      }
    );

    return clone(snapshot);
  }

  // ==========================================================
  // GET SNAPSHOTS
  // ==========================================================

  getSnapshots(sessionId) {
    const id = safeString(sessionId).trim();

    return clone(
      this.snapshots.get(id) || []
    );
  }

  // ==========================================================
  // GET LATEST SNAPSHOT
  // ==========================================================

  getLatestSnapshot(sessionId) {
    const id = safeString(sessionId).trim();

    const snapshots =
      this.snapshots.get(id) || [];

    if (!snapshots.length) {
      return null;
    }

    return clone(
      snapshots[snapshots.length - 1]
    );
  }

  // ==========================================================
  // RESTORE SNAPSHOT
  // ==========================================================

  restoreSnapshot(
    sessionId,
    snapshotId
  ) {
    const id = safeString(sessionId).trim();

    const snapshots =
      this.snapshots.get(id) || [];

    const snapshot =
      snapshots.find(
        (item) =>
          item.snapshotId ===
          snapshotId
      );

    if (!snapshot) {
      throw new Error(
        `Snapshot not found: ${snapshotId}`
      );
    }

    const restored =
      this._normalizeSession({
        ...clone(snapshot.session),
        sessionId: id,
        updatedAt: timestamp(),
      });

    this.sessions.set(id, restored);

    this.recordEvent(
      id,
      "snapshot_restored",
      {
        snapshotId,
      }
    );

    return this.get(id);
  }

  // ==========================================================
  // REMOVE
  // ==========================================================

  remove(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return false;
    }

    const existed =
      this.sessions.delete(id);

    this.events.delete(id);
    this.snapshots.delete(id);

    return existed;
  }

  // ==========================================================
  // LIST
  // ==========================================================

  list(options = {}) {
    let sessions =
      Array.from(
        this.sessions.values()
      );

    if (options.status) {
      const status =
        String(options.status);

      sessions = sessions.filter(
        (session) =>
          session.status === status
      );
    }

    if (options.ownerId !== undefined) {
      const ownerId =
        String(options.ownerId);

      sessions = sessions.filter(
        (session) =>
          String(session.ownerId || "") ===
          ownerId
      );
    }

    if (options.userId !== undefined) {
      const userId =
        String(options.userId);

      sessions = sessions.filter(
        (session) =>
          String(session.userId || "") ===
          userId
      );
    }

    sessions.sort(
      (a, b) =>
        Number(b.updatedAt || 0) -
        Number(a.updatedAt || 0)
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

    return clone(sessions);
  }

  // ==========================================================
  // ACTIVE
  // ==========================================================

  listActive() {
    return this.list({
      status:
        SESSION_RECORD_STATUS.ACTIVE,
    });
  }

  // ==========================================================
  // COMPLETED
  // ==========================================================

  listCompleted() {
    return this.list({
      status:
        SESSION_RECORD_STATUS.COMPLETED,
    });
  }

  // ==========================================================
  // FAILED
  // ==========================================================

  listFailed() {
    return this.list({
      status:
        SESSION_RECORD_STATUS.FAILED,
    });
  }

  // ==========================================================
  // EXPORT
  // ==========================================================

  exportState() {
    return {
      version: this.version,
      exportedAt: timestamp(),

      sessions: clone(
        Array.from(
          this.sessions.values()
        )
      ),

      events: clone(
        Array.from(
          this.events.entries()
        )
      ),

      snapshots: clone(
        Array.from(
          this.snapshots.entries()
        )
      ),
    };
  }

  // ==========================================================
  // IMPORT
  // ==========================================================

  importState(state = {}) {
    if (
      !state ||
      !Array.isArray(state.sessions)
    ) {
      throw new Error(
        "Invalid AgentSessionStore state"
      );
    }

    this.sessions.clear();
    this.events.clear();
    this.snapshots.clear();

    for (
      const rawSession
      of state.sessions
    ) {
      if (
        !rawSession ||
        !rawSession.sessionId
      ) {
        continue;
      }

      const session =
        this._normalizeSession(
          rawSession
        );

      this.sessions.set(
        session.sessionId,
        session
      );
    }

    if (Array.isArray(state.events)) {
      for (
        const entry
        of state.events
      ) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2
        ) {
          continue;
        }

        const [
          sessionId,
          events,
        ] = entry;

        if (
          !this.sessions.has(
            String(sessionId)
          )
        ) {
          continue;
        }

        this.events.set(
          String(sessionId),
          Array.isArray(events)
            ? clone(events).slice(
                -this.maxEventsPerSession
              )
            : []
        );
      }
    }

    if (
      Array.isArray(state.snapshots)
    ) {
      for (
        const entry
        of state.snapshots
      ) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2
        ) {
          continue;
        }

        const [
          sessionId,
          snapshots,
        ] = entry;

        if (
          !this.sessions.has(
            String(sessionId)
          )
        ) {
          continue;
        }

        this.snapshots.set(
          String(sessionId),
          Array.isArray(snapshots)
            ? clone(snapshots).slice(
                -this.maxSnapshotsPerSession
              )
            : []
        );
      }
    }

    this._ensureMaps();

    this._enforceLimit();

    return this.exportState();
  }

  // ==========================================================
  // CLEAR
  // ==========================================================

  clear(options = {}) {
    if (options.keepActive === true) {
      for (
        const [
          sessionId,
          session,
        ]
        of this.sessions.entries()
      ) {
        if (
          session.status !==
          SESSION_RECORD_STATUS.ACTIVE
        ) {
          this.events.delete(
            sessionId
          );

          this.snapshots.delete(
            sessionId
          );

          this.sessions.delete(
            sessionId
          );
        }
      }

      return this.sessions.size;
    }

    this.sessions.clear();
    this.events.clear();
    this.snapshots.clear();

    return 0;
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    const stats = {
      version: this.version,

      totalSessions:
        this.sessions.size,

      totalEvents: 0,

      totalSnapshots: 0,

      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,

      storage:
        "memory",
    };

    for (
      const session
      of this.sessions.values()
    ) {
      switch (session.status) {
        case SESSION_RECORD_STATUS.ACTIVE:
          stats.active += 1;
          break;

        case SESSION_RECORD_STATUS.COMPLETED:
          stats.completed += 1;
          break;

        case SESSION_RECORD_STATUS.FAILED:
          stats.failed += 1;
          break;

        case SESSION_RECORD_STATUS.CANCELLED:
          stats.cancelled += 1;
          break;

        case SESSION_RECORD_STATUS.EXPIRED:
          stats.expired += 1;
          break;

        default:
          break;
      }
    }

    for (
      const events
      of this.events.values()
    ) {
      stats.totalEvents +=
        Array.isArray(events)
          ? events.length
          : 0;
    }

    for (
      const snapshots
      of this.snapshots.values()
    ) {
      stats.totalSnapshots +=
        Array.isArray(snapshots)
          ? snapshots.length
          : 0;
    }

    return stats;
  }

  // ==========================================================
  // INTERNAL NORMALIZER
  // ==========================================================

  _normalizeSession(session) {
    const normalized = {
      ...clone(session),

      sessionId:
        safeString(session.sessionId),

      status:
        safeString(
          session.status,
          SESSION_RECORD_STATUS.ACTIVE
        ),

      createdAt:
        Number(session.createdAt) ||
        timestamp(),

      updatedAt:
        Number(session.updatedAt) ||
        timestamp(),

      lastActivityAt:
        Number(session.lastActivityAt) ||
        Number(session.updatedAt) ||
        timestamp(),

      stepIndex:
        Number.isFinite(session.stepIndex)
          ? Number(session.stepIndex)
          : 0,

      metadata:
        session.metadata &&
        typeof session.metadata === "object"
          ? clone(session.metadata)
          : {},

      capabilities:
        Array.isArray(
          session.capabilities
        )
          ? [
              ...new Set(
                session.capabilities.map(
                  String
                )
              ),
            ]
          : [],
    };

    return normalized;
  }

  // ==========================================================
  // INTERNAL MAP REPAIR
  // ==========================================================

  _ensureMaps() {
    for (
      const sessionId
      of this.sessions.keys()
    ) {
      if (!this.events.has(sessionId)) {
        this.events.set(
          sessionId,
          []
        );
      }

      if (
        !this.snapshots.has(sessionId)
      ) {
        this.snapshots.set(
          sessionId,
          []
        );
      }
    }
  }

  // ==========================================================
  // SESSION LIMIT
  // ==========================================================

  _enforceLimit() {
    if (
      this.sessions.size <=
      this.maxSessions
    ) {
      return;
    }

    const sessions =
      Array.from(
        this.sessions.values()
      );

    sessions.sort(
      (a, b) =>
        Number(a.updatedAt || 0) -
        Number(b.updatedAt || 0)
    );

    while (
      this.sessions.size >
      this.maxSessions
    ) {
      const removable =
        sessions.find(
          (session) =>
            [
              SESSION_RECORD_STATUS.COMPLETED,
              SESSION_RECORD_STATUS.FAILED,
              SESSION_RECORD_STATUS.CANCELLED,
              SESSION_RECORD_STATUS.EXPIRED,
            ].includes(
              session.status
            )
        ) || sessions[0];

      if (!removable) {
        break;
      }

      this.remove(
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

    if (
      typeof error === "object"
    ) {
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
}

// ============================================================
// SINGLETON
// ============================================================

let sessionStoreInstance = null;

function getAgentSessionStore(options = {}) {
  if (!sessionStoreInstance) {
    sessionStoreInstance =
      new AgentSessionStore(options);
  }

  return sessionStoreInstance;
}

function resetAgentSessionStore(options = {}) {
  sessionStoreInstance =
    new AgentSessionStore(options);

  return sessionStoreInstance;
}

function createAgentSessionStore(options = {}) {
  return new AgentSessionStore(options);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentSessionStore,

  getAgentSessionStore,
  resetAgentSessionStore,
  createAgentSessionStore,

  SESSION_STORE_VERSION,

  SESSION_RECORD_STATUS,

  MAX_SESSIONS,
  MAX_EVENTS_PER_SESSION,
  MAX_SNAPSHOTS_PER_SESSION,
};