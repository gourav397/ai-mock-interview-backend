// ============================================================
// ALEX — Autonomous Task Bootstrap
// FILE: backend/alex/AutonomousTaskBootstrap.js
// ============================================================

"use strict";

const {
  getAutonomousTaskService,
} = require("./AutonomousTaskService");

const {
  getAutonomousTaskRegistry,
} = require("./AutonomousTaskRegistry");

const {
  getAutonomousTaskEvents,
} = require("./AutonomousTaskEvents");

const {
  getAutonomousTaskAPI,
} = require("./AutonomousTaskAPI");

const {
  getAutonomousTaskRecovery,
} = require("./AutonomousTaskRecovery");

class AutonomousTaskBootstrap {
  constructor(options = {}) {
    this.options = options;

    this.service = null;
    this.registry = null;
    this.events = null;
    this.api = null;
    this.recovery = null;

    this.started = false;
    this.starting = false;
    this.recoveryResult = null;
    this.startedAt = null;
  }

  // ------------------------------------------------------------
  // START
  // ------------------------------------------------------------

  async start() {
    if (this.started) {
      return this.getStatus();
    }

    if (this.starting) {
      return this.getStatus();
    }

    this.starting = true;

    try {
      // --------------------------------------------------------
      // CORE SINGLETONS
      // --------------------------------------------------------

      this.service =
        this.options.service ||
        getAutonomousTaskService(
          this.options.serviceOptions || {}
        );

      this.registry =
        this.options.registry ||
        getAutonomousTaskRegistry(
          this.options.registryOptions || {}
        );

      this.events =
        this.options.events ||
        getAutonomousTaskEvents(
          this.options.eventsOptions || {}
        );

      this.api =
        this.options.api ||
        getAutonomousTaskAPI({
          service: this.service,
          ...(this.options.apiOptions || {}),
        });

      // --------------------------------------------------------
      // EVENT WIRING
      // --------------------------------------------------------

      this._wireRegistryEvents();

      // --------------------------------------------------------
      // RECOVERY
      // --------------------------------------------------------

      this.recovery =
        this.options.recovery ||
        this._createRecovery();

      if (
        this.recovery &&
        typeof this.recovery.recover === "function"
      ) {
        this.recoveryResult =
          await this.recovery.recover();
      }

      this.started = true;
      this.startedAt = new Date().toISOString();

      return this.getStatus();
    } finally {
      this.starting = false;
    }
  }

  // ------------------------------------------------------------
  // RECOVERY CREATION
  // ------------------------------------------------------------

  _createRecovery() {
    try {
      return getAutonomousTaskRecovery({
        registry: this.registry,
        events: this.events,
        ...(
          this.options.recoveryOptions || {}
        ),
      });
    } catch (error) {
      // Recovery must never prevent ALEX from booting.
      // The recovery error is exposed through status.
      this.recoveryResult = {
        success: false,
        error: this._normalizeError(error),
      };

      return null;
    }
  }

  // ------------------------------------------------------------
  // EVENT WIRING
  // ------------------------------------------------------------

  _wireRegistryEvents() {
    if (!this.registry || !this.events) {
      return;
    }

    if (
      typeof this.registry.on !== "function" ||
      typeof this.events.emitTask !== "function"
    ) {
      return;
    }

    this.registry.on(
      "registered",
      (event) => {
        this.events.registered(
          event?.task || event
        );
      }
    );

    this.registry.on(
      "started",
      (event) => {
        this.events.started(
          event?.task || event
        );
      }
    );

    this.registry.on(
      "completed",
      (event) => {
        this.events.completed(
          event?.task || event,
          event?.result || null
        );
      }
    );

    this.registry.on(
      "failed",
      (event) => {
        this.events.failed(
          event?.task || event,
          event?.error || null
        );
      }
    );

    this.registry.on(
      "cancelled",
      (event) => {
        this.events.cancelled(
          event?.task || event
        );
      }
    );

    this.registry.on(
      "updated",
      (event) => {
        this.events.progress(
          event?.task || event,
          event?.task?.progress ??
            event?.progress ??
            0
        );
      }
    );
  }

  // ------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------

  getStatus() {
    return {
      started: this.started,
      starting: this.starting,

      startedAt: this.startedAt,

      components: {
        service: Boolean(this.service),
        registry: Boolean(this.registry),
        events: Boolean(this.events),
        api: Boolean(this.api),
        recovery: Boolean(this.recovery),
      },

      recovery: this.recoveryResult,
    };
  }

  // ------------------------------------------------------------
  // COMPONENT ACCESS
  // ------------------------------------------------------------

  getService() {
    return this.service;
  }

  getRegistry() {
    return this.registry;
  }

  getEvents() {
    return this.events;
  }

  getAPI() {
    return this.api;
  }

  getRecovery() {
    return this.recovery;
  }

  // ------------------------------------------------------------
  // STOP
  // ------------------------------------------------------------

  async stop() {
    if (!this.started && !this.starting) {
      return this.getStatus();
    }

    this.started = false;
    this.starting = false;

    return this.getStatus();
  }

  // ------------------------------------------------------------
  // ERROR NORMALIZATION
  // ------------------------------------------------------------

  _normalizeError(error) {
    if (!error) {
      return {
        message: "Unknown error",
      };
    }

    if (typeof error === "string") {
      return {
        message: error,
      };
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        code: error.code || null,
      };
    }

    if (typeof error === "object") {
      return {
        name: error.name || "Error",
        message:
          error.message ||
          error.error ||
          "Unknown error",
        code: error.code || null,
      };
    }

    return {
      message: String(error),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let bootstrapInstance = null;

function getAutonomousTaskBootstrap(options = {}) {
  if (!bootstrapInstance) {
    bootstrapInstance =
      new AutonomousTaskBootstrap(options);
  }

  return bootstrapInstance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AutonomousTaskBootstrap,
  getAutonomousTaskBootstrap,
};