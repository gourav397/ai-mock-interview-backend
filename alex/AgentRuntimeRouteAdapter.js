// ============================================================
// ALEX — Agent Runtime Route Adapter
// Version: 1.0.0
//
// Purpose:
//   Thin adapter between existing Express routes and the
//   AgentRuntimeController.
//
//   This file does NOT register routes itself.
//   It only provides safe controller handlers that existing
//   ALEX route files can use later.
// ============================================================

"use strict";

const {
  getAgentRuntimeController,
} = require("./AgentRuntimeController");

const AGENT_RUNTIME_ROUTE_ADAPTER_VERSION =
  "1.0.0";

class AgentRuntimeRouteAdapter {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_ROUTE_ADAPTER_VERSION;

    this.controller =
      options.controller ||
      getAgentRuntimeController();
  }

  // ==========================================================
  // COMMON HELPERS
  // ==========================================================

  _body(req) {
    if (
      req &&
      req.body &&
      typeof req.body === "object"
    ) {
      return req.body;
    }

    return {};
  }

  _params(req) {
    if (
      req &&
      req.params &&
      typeof req.params === "object"
    ) {
      return req.params;
    }

    return {};
  }

  _query(req) {
    if (
      req &&
      req.query &&
      typeof req.query === "object"
    ) {
      return req.query;
    }

    return {};
  }

  _send(res, result) {
    if (
      res &&
      typeof res.status === "function" &&
      typeof res.json === "function"
    ) {
      return res
        .status(
          result?.success === false
            ? 400
            : 200
        )
        .json(result);
    }

    return result;
  }

  _handler(fn) {
    return async (req, res, next) => {
      try {
        const result =
          await fn.call(
            this,
            req,
            res,
            next
          );

        if (
          res &&
          res.headersSent
        ) {
          return result;
        }

        return this._send(
          res,
          result
        );
      } catch (error) {
        if (
          typeof next === "function"
        ) {
          return next(error);
        }

        return this._send(
          res,
          {
            success: false,

            adapterVersion:
              this.version,

            error: {
              name:
                error?.name ||
                "Error",

              message:
                error?.message ||
                String(error),

              code:
                error?.code ||
                null,
            },
          }
        );
      }
    };
  }

  // ==========================================================
  // RUNTIME
  // ==========================================================

  start() {
    return this._handler(
      async () =>
        this.controller.start()
    );
  }

  stop() {
    return this._handler(
      async () =>
        this.controller.stop()
    );
  }

  restart() {
    return this._handler(
      async () =>
        this.controller.restart()
    );
  }

  status() {
    return this._handler(
      async () =>
        this.controller.status()
    );
  }

  health() {
    return this._handler(
      async () =>
        this.controller.health()
    );
  }

  snapshot() {
    return this._handler(
      async () =>
        this.controller.snapshot()
    );
  }

  info() {
    return this._handler(
      async () =>
        this.controller.info()
    );
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  capabilities() {
    return this._handler(
      async (req) =>
        this.controller.capabilities(
          this._body(req)
        )
    );
  }

  capabilitySummary() {
    return this._handler(
      async () =>
        this.controller.capabilitySummary()
    );
  }

  hasCapability() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        const capability =
          body.capability ||
          this._params(req).capability;

        return this.controller.hasCapability(
          capability,
          body.options || {}
        );
      }
    );
  }

  // ==========================================================
  // SESSION
  // ==========================================================

  createSession() {
    return this._handler(
      async (req) =>
        this.controller.createSession(
          this._body(req)
        )
    );
  }

  getSession() {
    return this._handler(
      async (req) =>
        this.controller.getSession(
          this._params(req).sessionId
        )
    );
  }

  getSessionStatus() {
    return this._handler(
      async (req) =>
        this.controller.getSessionStatus(
          this._params(req).sessionId
        )
    );
  }

  addAction() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.addAction(
          this._params(req).sessionId ||
            body.sessionId,

          body.action
        );
      }
    );
  }

  addActions() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.addActions(
          this._params(req).sessionId ||
            body.sessionId,

          Array.isArray(body.actions)
            ? body.actions
            : []
        );
      }
    );
  }

  runSession() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.runSession(
          this._params(req).sessionId ||
            body.sessionId,

          body.options || {}
        );
      }
    );
  }

  runSessionWithRecovery() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.runSessionWithRecovery(
          this._params(req).sessionId ||
            body.sessionId,

          body.options || {}
        );
      }
    );
  }

  resumeSession() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.resumeSession(
          this._params(req).sessionId ||
            body.sessionId,

          body.options || {}
        );
      }
    );
  }

  cancelSession() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.cancelSession(
          this._params(req).sessionId ||
            body.sessionId,

          body.reason || ""
        );
      }
    );
  }

  createSessionSnapshot() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.createSessionSnapshot(
          this._params(req).sessionId ||
            body.sessionId,

          body.metadata || {}
        );
      }
    );
  }

  // ==========================================================
  // TASK
  // ==========================================================

  getTask() {
    return this._handler(
      async (req) =>
        this.controller.getTask(
          this._params(req).sessionId
        )
    );
  }

  getTaskStatus() {
    return this._handler(
      async (req) =>
        this.controller.getTaskStatus(
          this._params(req).sessionId
        )
    );
  }

  // ==========================================================
  // WORKFLOW
  // ==========================================================

  createWorkflow() {
    return this._handler(
      async (req) =>
        this.controller.createWorkflow(
          this._body(req)
        )
    );
  }

  getWorkflow() {
    return this._handler(
      async (req) =>
        this.controller.getWorkflow(
          this._params(req).workflowId
        )
    );
  }

  getWorkflowStatus() {
    return this._handler(
      async (req) =>
        this.controller.getWorkflowStatus(
          this._params(req).workflowId
        )
    );
  }

  // ==========================================================
  // TOOLS
  // ==========================================================

  inspectTool() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.inspectTool(
          body.tool ||
            this._params(req).tool,

          body.args || {},

          body.context || null
        );
      }
    );
  }

  executeTool() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.executeTool(
          body.context || null,

          body.tool ||
            this._params(req).tool,

          body.args || {},

          body.options || {}
        );
      }
    );
  }

  // ==========================================================
  // VERIFICATION
  // ==========================================================

  verifyResult() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.verifyResult(
          body.result,

          body.expectation,

          body.options || {}
        );
      }
    );
  }

  verifyAction() {
    return this._handler(
      async (req) => {
        const body =
          this._body(req);

        return this.controller.verifyAction(
          body.action,

          body.result,

          body.context || null
        );
      }
    );
  }

  // ==========================================================
  // EVENTS
  // ==========================================================

  events() {
    return this._handler(
      async (req) =>
        this.controller.events(
          this._query(req)
        )
    );
  }

  clearEvents() {
    return this._handler(
      async () =>
        this.controller.clearEvents()
    );
  }

  // ==========================================================
  // ROUTE HANDLER MAP
  //
  // Existing Express code can consume this map without this
  // file creating or mounting an Express router.
  // ==========================================================

  handlers() {
    return {
      start:
        this.start(),

      stop:
        this.stop(),

      restart:
        this.restart(),

      status:
        this.status(),

      health:
        this.health(),

      snapshot:
        this.snapshot(),

      info:
        this.info(),

      capabilities:
        this.capabilities(),

      capabilitySummary:
        this.capabilitySummary(),

      hasCapability:
        this.hasCapability(),

      createSession:
        this.createSession(),

      getSession:
        this.getSession(),

      getSessionStatus:
        this.getSessionStatus(),

      addAction:
        this.addAction(),

      addActions:
        this.addActions(),

      runSession:
        this.runSession(),

      runSessionWithRecovery:
        this.runSessionWithRecovery(),

      resumeSession:
        this.resumeSession(),

      cancelSession:
        this.cancelSession(),

      createSessionSnapshot:
        this.createSessionSnapshot(),

      getTask:
        this.getTask(),

      getTaskStatus:
        this.getTaskStatus(),

      createWorkflow:
        this.createWorkflow(),

      getWorkflow:
        this.getWorkflow(),

      getWorkflowStatus:
        this.getWorkflowStatus(),

      inspectTool:
        this.inspectTool(),

      executeTool:
        this.executeTool(),

      verifyResult:
        this.verifyResult(),

      verifyAction:
        this.verifyAction(),

      events:
        this.events(),

      clearEvents:
        this.clearEvents(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let adapterInstance =
  null;

function getAgentRuntimeRouteAdapter(
  options = {}
) {
  if (
    !adapterInstance
  ) {
    adapterInstance =
      new AgentRuntimeRouteAdapter(
        options
      );
  }

  return adapterInstance;
}

function resetAgentRuntimeRouteAdapter(
  options = {}
) {
  adapterInstance =
    new AgentRuntimeRouteAdapter(
      options
    );

  return adapterInstance;
}

function createAgentRuntimeRouteAdapter(
  options = {}
) {
  return new AgentRuntimeRouteAdapter(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeRouteAdapter,

  getAgentRuntimeRouteAdapter,
  resetAgentRuntimeRouteAdapter,
  createAgentRuntimeRouteAdapter,

  AGENT_RUNTIME_ROUTE_ADAPTER_VERSION,
};