// ============================================================
// ALEX CHAT — Premium Owner/User Chat Interface
// ============================================================
//
// Mounted at:
// POST /api/alex/chat
//
// Authentication:
// - Normal logged-in users -> userAuth
// - Owner/Admin -> userAuth + preserved owner context
//
// IMPORTANT:
// - Normal users must NEVER be converted into owners.
// - Owner/Admin privileges remain controlled by their JWT role.
// - This route does not weaken ownerAuth.
// - Stale/old session IDs are automatically replaced with a
//   fresh authenticated session instead of causing chat failure.
// ============================================================

const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");

const { userAuth } = require("../middleware/userAuth");

const {
  getOwnerCommandHandler,
} = require("../alex/OwnerCommandHandler");

const AgentAssistantAPI = require("../alex/AgentAssistantAPI");

const getAgentAssistantAPI =
  typeof AgentAssistantAPI.getAgentAssistantAPI === "function"
    ? AgentAssistantAPI.getAgentAssistantAPI
    : () => AgentAssistantAPI;

const config = require("../alex/config");

// ============================================================
// REEL GENERATOR
// ============================================================

const { getReelGenerator } = require("../alex/ReelGenerator");

const REELS_DIR = path.join(
  __dirname,
  "..",
  "reels"
);

if (!fs.existsSync(REELS_DIR)) {
  fs.mkdirSync(REELS_DIR, {
    recursive: true,
  });
}

// ============================================================
// REEL REQUEST DETECTOR
// ============================================================

function isReelRequest(msg) {
  const text = String(msg || "");

  return (
    /reel|video\s*bana|video\s*generate|reels?\s*bana/i.test(
      text
    ) &&
    /bana|banao|banau|bnao|generate|create|chahiye|karo|kar\s*do/i.test(
      text
    )
  );
}

// ============================================================
// SESSION STORE
// ============================================================

const sessions = new Map();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_MS = 60 * 60 * 1000;

function generateSessionId() {
  return `alex_chat_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function createAlexSession(actor) {
  const sessionId = generateSessionId();

  const now = Date.now();

  const session = {
    id: sessionId,

    userId: actor.userId
      ? String(actor.userId)
      : null,

    role: actor.role || "student",

    isOwner: Boolean(actor.isOwner),
    isAdmin: Boolean(actor.isAdmin),

    createdAt: now,
    lastActivity: now,

    messages: [],

    metrics: {
      messagesSent: 0,
      commandsExecuted: 0,
      startedAt: new Date(now).toISOString(),
    },

    context: {
      user: {
        userId: actor.userId,
        id: actor.userId,
        email: actor.email,
        role: actor.role,
        isOwner: actor.isOwner,
        isAdmin: actor.isAdmin,
      },

      alexAccess: actor.isOwner
        ? "full"
        : "user",

      alexMode: actor.isOwner
        ? "full"
        : "user",

      authenticated: true,
    },
  };

  sessions.set(sessionId, session);

  return session;
}

function getSessionForActor(sessionId, actor) {
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(String(sessionId));

  if (!session) {
    return null;
  }

  // Session sirf usi authenticated user ki honi chahiye.
  if (
    !actor.userId ||
    !session.userId ||
    String(session.userId) !== String(actor.userId)
  ) {
    return null;
  }

  session.lastActivity = Date.now();

  return session;
}

setInterval(() => {
  const now = Date.now();

  for (const [id, session] of sessions.entries()) {
    if (
      !session ||
      now - Number(session.lastActivity || 0) >
        SESSION_TTL_MS
    ) {
      sessions.delete(id);
    }
  }
}, SESSION_CLEANUP_MS);
// ============================================================
// SESSION ID
// ============================================================

function generateSessionId() {
  return `alex_chat_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

// ============================================================
// AUTH ACTOR
// ============================================================

function getAlexActor(req) {
  const user = req.user || {};

  const role = String(
    user.role || "student"
  ).toLowerCase();

  const isAdmin =
    role === "admin";

  const isOwner =
    role === "owner" ||
    isAdmin;

  const userId =
    user.userId ||
    user.id ||
    null;

  return {
    userId: userId
      ? String(userId)
      : null,

    id: userId
      ? String(userId)
      : null,

    email:
      user.email || null,

    role,

    isOwner,

    isAdmin,

    method:
      req.owner?.method || "jwt",

    authenticated:
      user.authenticated === true,
  };
}

// ============================================================
// CREATE SESSION
// ============================================================

function createSession(actor) {
  const safeActor = actor || {};

  const newSession = {
    id: generateSessionId(),

    owner: {
      userId:
        safeActor.userId || null,

      method:
        safeActor.method || "jwt",

      role:
        safeActor.role || "student",

      isOwner:
        safeActor.isOwner === true,

      isAdmin:
        safeActor.isAdmin === true,
    },

    createdAt:
      new Date().toISOString(),

    lastActivity:
      Date.now(),

    messages: [],

    context: {
      state: "idle",

      lastAction: null,

      lastResult: null,

      activeGoal: null,

      pendingAction: null,

      projectContext: {
        framework:
          "Express.js + MongoDB",

        alexVersion:
          config.version ||
          "1.0.0",

        aiAvailable:
          config.ai?.available ||
          false,
      },

      ongoingTasks: [],

      resolvedIncidents: 0,

      user: {
        userId:
          safeActor.userId || null,

        role:
          safeActor.role || "student",

        isOwner:
          safeActor.isOwner === true,

        isAdmin:
          safeActor.isAdmin === true,
      },
    },

    metrics: {
      totalMessages: 0,

      commandsExecuted: 0,

      commandsFailed: 0,
    },
  };

  const greeting =
    safeActor.isOwner
      ? `👋 Hello ${safeActor.role || "Owner"}! I'm ALEX, your autonomous agent system. I'm ready to help you execute authorized project goals.

**What I can do:**

• 🛡️ Security scanning & authorized fixes
• 🔍 Project inspection & code analysis
• 🐛 Find and fix authorized project bugs
• 📝 Create and modify authorized project files
• 🧪 Run tests and verify results
• 🚀 Prepare deployments
• 📊 System health monitoring
• 🎬 Cinematic AI reel generation
• 🔄 Fix-loop with verification

Just tell me what you want to accomplish.`
      : `👋 Hello! I'm ALEX.

I can help you with questions, explanations, problem solving and other features available to your account.

Tell me what you want to do.`;

  newSession.messages.push({
    role: "alex",

    type: "system",

    content: greeting,

    timestamp:
      new Date().toISOString(),
  });

  sessions.set(
    newSession.id,
    newSession
  );

  return newSession;
}

// ============================================================
// SESSION CREATE / GET
// ============================================================
//
// IMPORTANT FIX:
//
// Old frontend/session IDs can be:
// - UUID
// - old ALEX IDs
// - expired IDs
// - deleted IDs
// - sessions belonging to another user
//
// None of these should break normal chat.
//
// A fresh authenticated session is created automatically.
// Owner/admin privileges are NEVER copied from old sessions.
// ============================================================

function getOrCreateSession(
  requestedSessionId,
  actor
) {
  const sessionId =
    typeof requestedSessionId === "string"
      ? requestedSessionId.trim()
      : "";

  if (
    sessionId &&
    sessions.has(sessionId)
  ) {
    const existing =
      sessions.get(sessionId);

    const existingOwnerId =
      existing?.owner?.userId
        ? String(existing.owner.userId)
        : null;

    const currentUserId =
      actor?.userId
        ? String(actor.userId)
        : null;

    // Same authenticated user -> reuse session.
    if (
      existingOwnerId &&
      currentUserId &&
      existingOwnerId === currentUserId
    ) {
      existing.lastActivity =
        Date.now();

      return existing;
    }

    // --------------------------------------------------------
    // SECURITY:
    // Never attach another user's session to current user.
    // Create a completely fresh session instead.
    // --------------------------------------------------------

    console.warn(
      `[ALEX SESSION] Ownership mismatch. Creating fresh session. requested=${sessionId}`
    );

    return createSession(actor);
  }

  // ----------------------------------------------------------
  // Missing / stale / old / deleted session.
  // ----------------------------------------------------------

  if (sessionId) {
    console.log(
      `[ALEX SESSION] Requested session not found. Creating fresh session. requested=${sessionId}`
    );
  }

  return createSession(actor);
}

// ============================================================
// RESPONSE FORMATTER
// ============================================================

function formatAlexResponse(result) {
  if (!result) {
    return "I encountered an issue processing that request.";
  }

  // ==========================================================
  // NORMAL CHAT
  // ==========================================================

  if (
    result.route === "chat" ||
    result.intent?.intent ===
      "GENERAL_CHAT" ||
    result.result?.route === "chat"
  ) {
    const chatReply =
      result.reply ||
      result.result?.reply ||
      result.result?.result?.reply;

    if (chatReply) {
      return String(chatReply);
    }
  }

  // ==========================================================
  // COMPLETED
  // ==========================================================

  if (
    result.status ===
    "completed"
  ) {
    let response =
      `✅ **Done!** ${
        result.message ||
        "Task completed successfully."
      }`;

    if (result.systemStatus) {
      const s =
        result.systemStatus;

      response +=
        `\n\n**System Status:**` +
        `\n• Status: ${
          s.system?.status ||
          "unknown"
        }` +
        `\n• Uptime: ${
          s.system?.uptime || 0
        }s` +
        `\n• AI: ${
          s.system?.aiAvailable
            ? "✅ Enabled"
            : "⚠️ Limited"
        }` +
        `\n• Incidents handled: ${
          s.state?.incidentsHandled ||
          0
        }`;
    }

    if (result.health) {
      response +=
        `\n\n**Health:** ${
          result.health.status ||
          "unknown"
        }`;
    }

    if (result.scanResult) {
      response +=
        `\n\n**Scan Results:**` +
        `\n• Total: ${
          result.scanResult
            .totalVulnerabilities ||
          0
        }` +
        `\n• Critical: ${
          result.scanResult
            .criticalCount ||
          0
        }` +
        `\n• High: ${
          result.scanResult
            .highCount ||
          0
        }` +
        `\n• Medium: ${
          result.scanResult
            .mediumCount ||
          0
        }` +
        `\n• Low: ${
          result.scanResult
            .lowCount ||
          0
        }`;
    }

    if (result.fixResult) {
      response +=
        `\n\n**Fix Results:**` +
        `\n• Attempted: ${
          result.fixResult.attempted ||
          0
        }` +
        `\n• Succeeded: ${
          result.fixResult.succeeded ||
          0
        }` +
        `\n• Failed: ${
          result.fixResult.failed ||
          0
        }`;
    }

    if (result.structure) {
      const files =
        Array.isArray(
          result.structure.files
        )
          ? result.structure.files
          : [];

      const dirs = Object.keys(
        result.structure
          .directories || {}
      );

      response +=
        `\n\n**Project Structure:**` +
        `\n• Files: ${files.length}` +
        `\n• Directories: ${dirs.length}`;

      if (files.length > 0) {
        response +=
          `\n• Sample files: ${files
            .slice(0, 10)
            .map((f) =>
              typeof f === "string"
                ? f
                : f?.name || ""
            )
            .filter(Boolean)
            .join(", ")}`;
      }
    }

    if (
      Array.isArray(result.incidents)
    ) {
      response +=
        `\n\n**Recent Incidents:**\n` +
        result.incidents
          .map(
            (i) =>
              `• [${
                i.severity ||
                "unknown"
              }] ${
                i.description
                  ? String(
                      i.description
                    ).slice(0, 80)
                  : "No description"
              }`
          )
          .join("\n");
    }

    if (result.filePath) {
      response +=
        `\n\n📄 **File:** \`${result.filePath}\``;
    }

    return response;
  }

  // ==========================================================
  // FAILED
  // ==========================================================

  if (
    result.status ===
    "failed"
  ) {
    let response =
      `❌ **Failed.** ${
        result.error ||
        result.message ||
        "An error occurred."
      }`;

    if (result.stdout) {
      response +=
        `\n\n**Output:**\n\`\`\`\n${String(
          result.stdout
        ).slice(-500)}\n\`\`\``;
    }

    if (result.stderr) {
      response +=
        `\n\n**Errors:**\n\`\`\`\n${String(
          result.stderr
        ).slice(-500)}\n\`\`\``;
    }

    return response;
  }

  // ==========================================================
  // CONFIRMATION
  // ==========================================================

  if (
    result.status ===
    "confirmation_required"
  ) {
    return (
      `⚠️ **Confirmation Required**\n\n` +
      `Action: **${
        result.action ||
        "Unknown"
      }**\n` +
      `Target: ${
        result.target ||
        "Not specified"
      }\n\n` +
      `${
        result.message ||
        "This action requires your approval."
      }\n\n` +
      `Reply with **"confirm"** to proceed, or **"cancel"** to abort.`
    );
  }

  // ==========================================================
  // DENIED
  // ==========================================================

  if (
    result.status ===
    "denied"
  ) {
    return (
      `🚫 **Access Denied**\n\n${
        result.error ||
        result.message ||
        "This action is not permitted."
      }`
    );
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (
    result.status ===
    "error"
  ) {
    return (
      `❌ **Error:** ${
        result.error ||
        result.message ||
        "Something went wrong."
      }`
    );
  }

  // ==========================================================
  // NEEDS CLARIFICATION
  // ==========================================================

  if (
    result.status ===
    "needs_clarification"
  ) {
    return (
      result.reply ||
      result.message ||
      "I need a little more information to answer that correctly."
    );
  }

  // ==========================================================
  // FALLBACK
  // ==========================================================

  try {
    return JSON.stringify(
      result,
      null,
      2
    ).slice(0, 4000);
  } catch {
    return String(result);
  }
}

// ============================================================
// REEL STATUS HELPER
// ============================================================

function getReelStatus(jobId) {
  const dir =
    path.join(
      REELS_DIR,
      jobId
    );

  const metaPath =
    path.join(
      dir,
      "metadata.json"
    );

  const errPath =
    path.join(
      dir,
      "error.json"
    );

  if (
    fs.existsSync(metaPath)
  ) {
    try {
      return {
        status: "done",

        metadata:
          JSON.parse(
            fs.readFileSync(
              metaPath,
              "utf8"
            )
          ),
      };
    } catch (error) {
      return {
        status: "failed",
        error:
          "Invalid reel metadata.",
      };
    }
  }

  if (
    fs.existsSync(errPath)
  ) {
    try {
      return {
        status: "failed",

        error:
          JSON.parse(
            fs.readFileSync(
              errPath,
              "utf8"
            )
          ).error,
      };
    } catch {
      return {
        status: "failed",
        error:
          "Reel generation failed.",
      };
    }
  }

  return {
    status: "processing",
  };
}

// ============================================================
// ALEX ROUTE DEBUG
// ============================================================

router.use((req, res, next) => {
  console.log(
    `[ALEX ROUTE HIT] ${req.method} ${req.originalUrl}`
  );

  next();
});

// ============================================================
// ALL ALEX CHAT ROUTES REQUIRE LOGIN
// ============================================================

router.use(userAuth);

// ============================================================
// AUTH DEBUG
// ============================================================

router.use((req, res, next) => {
  console.log(
    `[ALEX AUTH PASSED] ${req.method} ${req.originalUrl}`,
    {
      authenticated:
        req.user?.authenticated,

      userId:
        req.user?.userId,

      role:
        req.user?.role,

      isOwner:
        req.user?.isOwner,

      isAdmin:
        req.user?.isAdmin,
    }
  );

  next();
});

// ============================================================
// GET /reel/:jobId
// ============================================================

router.get(
  "/reel/:jobId",
  (req, res) => {
    try {
      const jobId =
        String(
          req.params.jobId || ""
        ).trim();

      if (!jobId) {
        return res.status(400).json({
          success: false,
          message:
            "Job ID required",
        });
      }

      const job =
        getReelGenerator().getJob(
          jobId
        );

      if (!job) {
        return res.status(404).json({
          success: false,
          message:
            "Reel job not found",
          jobId,
        });
      }

      return res.json({
        success: true,
        job,
      });
    } catch (error) {
      console.error(
        "[ALEX REEL STATUS]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Unable to get reel status",
      });
    }
  }
);

// ============================================================
// POST /chat
// /api/alex/chat
// ============================================================

router.post(
  "/chat",
  async (req, res) => {
    try {
      console.log(
        "[ALEX POST CHAT HANDLER ENTERED]",
        {
          method: req.method,

          url:
            req.originalUrl,

          userId:
            req.user?.userId,

          role:
            req.user?.role,

          authenticated:
            req.user?.authenticated,
        }
      );

      const {
        message,
        sessionId,
        windowsAgentToken,
      } = req.body || {};

      // ------------------------------------------------------
      // VALIDATE MESSAGE
      // ------------------------------------------------------

      if (
        typeof message !== "string" ||
        message.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Message is required.",
        });
      }

      // ------------------------------------------------------
      // AUTH ACTOR
      // ------------------------------------------------------

      const actor =
        getAlexActor(req);

      if (
        !actor.authenticated ||
        !actor.userId
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Login required.",
        });
      }

      // ------------------------------------------------------
      // SESSION
      // ------------------------------------------------------

      const session =
        getOrCreateSession(
          sessionId,
          actor
        );

      const trimmedMessage =
        message.trim();

      session.lastActivity =
        Date.now();

      session.messages.push({
        role: "user",

        type: "message",

        content:
          trimmedMessage,

        timestamp:
          new Date().toISOString(),
      });

      session.metrics.totalMessages++;

      // ======================================================
      // CONFIRMATION
      // ======================================================

      if (
        /^(confirm|yes|proceed|go ahead|do it|approve)$/i.test(
          trimmedMessage
        )
      ) {
        const pendingAction =
          session.context
            .pendingAction;

        if (pendingAction) {
          if (!actor.isOwner) {
            session.context.pendingAction =
              null;

            return res.status(403).json({
              success: false,

              sessionId:
                session.id,

              response:
                "🚫 **Access Denied**\n\nThis action requires owner/admin permission.",

              result: {
                status: "denied",

                message:
                  "Owner/admin permission required.",
              },
            });
          }

          session.context.pendingAction =
            null;

          const handler =
            getOwnerCommandHandler();

          const result =
            await handler.processCommand(
              pendingAction.originalInput,

              req.owner,

              pendingAction.confirmationId,

              session.id,

              pendingAction.windowsAgentToken ||
                ""
            );

          const alexResponse =
            formatAlexResponse(
              result
            );

          session.messages.push({
            role: "alex",

            type: "result",

            content:
              alexResponse,

            result,

            timestamp:
              new Date().toISOString(),
          });

          session.context.lastAction =
            pendingAction.action;

          session.context.lastResult =
            result;

          if (
            result?.success
          ) {
            session.metrics.commandsExecuted++;
          } else {
            session.metrics.commandsFailed++;
          }

          return res.json({
            success: true,

            sessionId:
              session.id,

            response:
              alexResponse,

            result,

            metrics:
              session.metrics,
          });
        }
      }

      // ======================================================
      // CANCEL
      // ======================================================

      if (
        /^(cancel|no|stop|abort|forget it|never mind)$/i.test(
          trimmedMessage
        )
      ) {
        session.context.pendingAction =
          null;

        const response =
          "Cancelled. What would you like to do next?";

        session.messages.push({
          role: "alex",

          type: "system",

          content:
            response,

          timestamp:
            new Date().toISOString(),
        });

        return res.json({
          success: true,

          sessionId:
            session.id,

          response,

          metrics:
            session.metrics,
        });
      }

      // ======================================================
      // REEL STATUS CHECK
      // ======================================================

      const statusMatch =
        trimmedMessage.match(
          /reel\s*status\s*(reel_\d+_\w+)/i
        );

      if (statusMatch) {
        const jobId =
          statusMatch[1];

        const reelStatus =
          getReelStatus(jobId);

        let reply;

        if (
          reelStatus.status ===
          "done"
        ) {
          const meta =
            reelStatus.metadata ||
            {};

          reply =
            `✅ **Reel ready hai!**\n\n` +
            `🎬 Title: ${
              meta.title ||
              "Untitled"
            }\n` +
            `📐 ${
              meta.resolution ||
              "Unknown"
            } • ${
              Math.round(
                meta.durationSeconds ||
                  0
              )
            }s • ${
              (
                (meta.sizeBytes ||
                  0) /
                1024 /
                1024
              ).toFixed(1)
            } MB\n` +
            `🔊 Audio: ${
              meta.hasAudio
                ? "YES"
                : "NO"
            }\n` +
            `📥 Download: \`/api/alex/reels/${jobId}/final_reel.mp4\``;
        } else if (
          reelStatus.status ===
          "failed"
        ) {
          reply =
            `❌ Reel fail ho gayi (Job: ${jobId}).\n\n` +
            `**Reason:** ${
              reelStatus.error ||
              "Unknown error"
            }`;
        } else {
          reply =
            `⏳ Reel abhi bhi ban rahi hai (Job: ${jobId})...\n\n` +
            `Thodi der baad phir status poochho.`;
        }

        session.messages.push({
          role: "alex",

          type: "system",

          content:
            reply,

          timestamp:
            new Date().toISOString(),
        });

        session.context.lastAction =
          "reel-status-check";

        return res.json({
          success: true,

          sessionId:
            session.id,

          response:
            reply,

          metrics:
            session.metrics,
        });
      }

      // ======================================================
      // REEL INTERCEPTION
      // ======================================================

      if (
        isReelRequest(
          trimmedMessage
        )
      ) {
        const reelJobId =
          `reel_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        getReelGenerator()
          .generate({
            topic:
              trimmedMessage,

            jobId:
              reelJobId,
          })
          .then(() =>
            console.log(
              `[REEL] ✅ Job ${reelJobId} completed`
            )
          )
          .catch((err) =>
            console.error(
              `[REEL] ❌ Job ${reelJobId} failed:`,
              err?.friendlyMessage ||
                err?.message
            )
          );

        const alexResponse =
          `🎬 **Reel generation shuru ho gayi!**\n\n` +
          `**Job ID:** \`${reelJobId}\`\n` +
          `**Topic:** ${trimmedMessage.slice(
            0,
            150
          )}\n\n` +
          `Generation background mein chal rahi hai.\n` +
          `Status check karne ke liye poochho: **reel status ${reelJobId}**`;

        session.messages.push({
          role: "alex",

          type: "system",

          content:
            alexResponse,

          timestamp:
            new Date().toISOString(),
        });

        session.metrics.commandsExecuted++;

        session.context.lastAction =
          "generate-reel";

        session.context.lastResult = {
          jobId:
            reelJobId,
        };

        return res.json({
          success: true,

          sessionId:
            session.id,

          response:
            alexResponse,

          result: {
            status:
              "completed",

            jobId:
              reelJobId,
          },

          metrics:
            session.metrics,
        });
      }

      // ======================================================
      // UNIFIED ALEX AGENT
      // ======================================================

      const assistantAPI =
        getAgentAssistantAPI();

      // ------------------------------------------------------
      // Owner context only for actual owner/admin.
      // ------------------------------------------------------

      const ownerContext =
        actor.isOwner
          ? {
              userId:
                req.owner?.userId ||
                actor.userId,

              ownerId:
                req.owner?.userId ||
                actor.userId,

              ownerKey:
                req.owner?.ownerKey ||
                req.owner?.key ||
                null,

              email:
                req.owner?.email ||
                actor.email ||
                null,

              role:
                req.owner?.role ||
                actor.role,

              method:
                req.owner?.method ||
                actor.method,
            }
          : null;

      const agentResult =
        await assistantAPI.ask({
          message:
            trimmedMessage,

          ownerId:
            actor.userId,

          ownerKey:
            ownerContext?.ownerKey ||
            null,

          sessionId:
            session.id,

          execute: true,

          confirmed: false,

          confirmationReason:
            null,

          context: {
            ...session.context,

            user: {
              userId:
                actor.userId,

              id:
                actor.userId,

              email:
                actor.email,

              role:
                actor.role,

              isOwner:
                actor.isOwner,

              isAdmin:
                actor.isAdmin,
            },

            owner:
              ownerContext,

            windowsAgentToken:
              windowsAgentToken ||
              "",

            alexAccess:
              actor.isOwner
                ? "full"
                : "user",

            alexMode:
              actor.isOwner
                ? "full"
                : "user",

            authenticated:
              true,
          },
        });

      // ======================================================
      // NORMALIZE RESULT
      // ======================================================

      const result =
        agentResult?.result ||
        agentResult;

      // ======================================================
      // CONFIRMATION REQUIRED
      // ======================================================

      if (
        result?.status ===
        "confirmation_required"
      ) {
        // ----------------------------------------------------
        // Normal users cannot create privileged pending
        // actions.
        // ----------------------------------------------------

        if (!actor.isOwner) {
          const deniedResult = {
            success: false,

            status: "denied",

            message:
              "Owner/admin permission required for this action.",

            action:
              result.action ||
              null,

            target:
              result.target ||
              null,
          };

          const deniedResponse =
            formatAlexResponse(
              deniedResult
            );

          session.messages.push({
            role: "alex",

            type: "result",

            content:
              deniedResponse,

            result:
              deniedResult,

            timestamp:
              new Date().toISOString(),
          });

          session.metrics.commandsFailed++;

          return res.json({
            success: true,

            sessionId:
              session.id,

            response:
              deniedResponse,

            result:
              deniedResult,

            metrics:
              session.metrics,

            requiresConfirmation:
              false,
          });
        }

        session.context.pendingAction = {
          originalInput:
            trimmedMessage,

          action:
            result.action,

          target:
            result.target,

          confirmationId:
            result.confirmationId,

          windowsAgentToken:
            windowsAgentToken ||
            "",
        };
      }

      // ======================================================
      // FORMAT RESPONSE
      // ======================================================

      const alexResponse =
        formatAlexResponse(
          result
        );

      session.messages.push({
        role: "alex",

        type:
          result?.status ===
          "confirmation_required"
            ? "confirmation"
            : "result",

        content:
          alexResponse,

        result,

        timestamp:
          new Date().toISOString(),
      });

      // ======================================================
      // SESSION CONTEXT
      // ======================================================

      session.context.lastAction =
        result?.action ||
        "chat";

      session.context.lastResult =
        result;

      // ======================================================
      // METRICS
      // ======================================================

      if (
        result?.success
      ) {
        session.metrics.commandsExecuted++;
      } else if (
        result?.status === "failed" ||
        result?.status === "error"
      ) {
        session.metrics.commandsFailed++;
      }

      // ======================================================
      // RESPONSE
      // ======================================================

      return res.json({
        success: true,

        sessionId:
          session.id,

        response:
          alexResponse,

        result,

        metrics:
          session.metrics,

        requiresConfirmation:
          result?.status ===
          "confirmation_required",
      });

    } catch (err) {
      console.error(
        "❌ ALEX Chat error:",
        err
      );

      console.error(
        "❌ ALEX Chat stack:",
        err?.stack
      );

      return res.status(500).json({
        success: false,

        error:
          err?.message ||
          "Chat processing failed.",

        response:
          `❌ ALEX error: ${
            err?.message ||
            "Unknown error"
          }`,
      });
    }
  }
);

// ============================================================
// GET /chat/sessions
// ============================================================

router.get(
  "/chat/sessions",
  (req, res) => {
    const actor =
      getAlexActor(req);

    if (
      !actor.authenticated ||
      !actor.userId
    ) {
      return res.status(401).json({
        success: false,

        error:
          "Login required.",
      });
    }

    const sessionList =
      Array.from(
        sessions.values()
      )
        .filter((s) => {
          if (
            !s?.owner?.userId ||
            !actor?.userId
          ) {
            return false;
          }

          return (
            String(
              s.owner.userId
            ) ===
            String(
              actor.userId
            )
          );
        })
        .map((s) => ({
          id: s.id,

          createdAt:
            s.createdAt,

          lastActivity:
            s.lastActivity,

          messageCount:
            Array.isArray(
              s.messages
            )
              ? s.messages.length
              : 0,

          metrics:
            s.metrics,

          owner:
            s.owner,
        }));

    return res.json({
      success: true,

      data:
        sessionList,

      count:
        sessionList.length,
    });
  }
);

// ============================================================
// GET /chat/sessions/:id
// ============================================================

router.get(
  "/chat/sessions/:id",
  (req, res) => {
    const actor =
      getAlexActor(req);

    if (
      !actor.authenticated ||
      !actor.userId
    ) {
      return res.status(401).json({
        success: false,

        error:
          "Login required.",
      });
    }

    const requestedId =
      String(
        req.params.id || ""
      ).trim();

    if (!requestedId) {
      return res.status(400).json({
        success: false,

        error:
          "Session ID required.",
      });
    }

    const session =
      sessions.get(
        requestedId
      );

    if (!session) {
      return res.status(404).json({
        success: false,

        error:
          "Session not found.",
      });
    }

    // --------------------------------------------------------
    // Never expose another user's session.
    // --------------------------------------------------------

    if (
      String(
        session.owner?.userId
      ) !==
      String(
        actor.userId
      )
    ) {
      return res.status(403).json({
        success: false,

        error:
          "Access denied.",
      });
    }

    return res.json({
      success: true,

      data: {
        id:
          session.id,

        createdAt:
          session.createdAt,

        lastActivity:
          session.lastActivity,

        context:
          session.context,

        metrics:
          session.metrics,

        messages:
          Array.isArray(
            session.messages
          )
            ? session.messages.slice(-100)
            : [],
      },
    });
  }
);

// ============================================================
// DELETE /chat/sessions/:id
// ============================================================

router.delete(
  "/chat/sessions/:id",
  (req, res) => {
    const actor =
      getAlexActor(req);

    if (
      !actor.authenticated ||
      !actor.userId
    ) {
      return res.status(401).json({
        success: false,

        error:
          "Login required.",
      });
    }

    const requestedId =
      String(
        req.params.id || ""
      ).trim();

    if (!requestedId) {
      return res.status(400).json({
        success: false,

        message:
          "Session ID required.",
      });
    }

    const session =
      sessions.get(
        requestedId
      );

    if (!session) {
      return res.json({
        success: false,

        message:
          "Session not found.",
      });
    }

    if (
      String(
        session.owner?.userId
      ) !==
      String(
        actor.userId
      )
    ) {
      return res.status(403).json({
        success: false,

        message:
          "Access denied.",
      });
    }

    const deleted =
      sessions.delete(
        requestedId
      );

    return res.json({
      success:
        deleted,

      message:
        deleted
          ? "Session deleted."
          : "Session not found.",
    });
  }
);

// ============================================================
// GET /reel/status/:jobId
// Frontend polling
// ============================================================

router.get(
  "/reel/status/:jobId",
  (req, res) => {
    const jobId =
      String(
        req.params.jobId || ""
      ).trim();

    if (
      !/^reel_\d+_\w+$/.test(
        jobId
      )
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Invalid jobId.",
      });
    }

    const reelStatus =
      getReelStatus(jobId);

    if (
      reelStatus.status ===
      "done"
    ) {
      return res.json({
        success: true,

        status: "done",

        metadata:
          reelStatus.metadata,
      });
    }

    if (
      reelStatus.status ===
      "failed"
    ) {
      return res.json({
        success: false,

        status: "failed",

        error:
          reelStatus.error,
      });
    }

    return res.json({
      success: true,

      status:
        "processing",
    });
  }
);

// ============================================================
// GET /reels/:jobId/final_reel.mp4
// ============================================================

router.get(
  "/reels/:jobId/final_reel.mp4",
  (req, res) => {
    const jobId =
      String(
        req.params.jobId || ""
      ).trim();

    // --------------------------------------------------------
    // Path traversal protection
    // --------------------------------------------------------

    if (
      !/^reel_\d+_\w+$/.test(
        jobId
      )
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Invalid jobId.",
      });
    }

    const videoPath =
      path.join(
        REELS_DIR,
        jobId,
        "final_reel.mp4"
      );

    const resolvedReelsDir =
      path.resolve(
        REELS_DIR
      );

    const resolvedVideoPath =
      path.resolve(
        videoPath
      );

    if (
      !resolvedVideoPath.startsWith(
        resolvedReelsDir +
          path.sep
      )
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Invalid video path.",
      });
    }

    if (
      !fs.existsSync(
        resolvedVideoPath
      )
    ) {
      return res.status(404).json({
        success: false,

        error:
          "Video not found.",
      });
    }

    let stat;

    try {
      stat =
        fs.statSync(
          resolvedVideoPath
        );
    } catch {
      return res.status(404).json({
        success: false,

        error:
          "Video not found.",
      });
    }

    const range =
      req.headers.range;

    // ========================================================
    // RANGE REQUEST
    // ========================================================

    if (range) {
      const match =
        range.match(
          /^bytes=(\d*)-(\d*)$/
        );

      if (!match) {
        return res.status(416).end();
      }

      let start =
        match[1]
          ? parseInt(
              match[1],
              10
            )
          : 0;

      let end =
        match[2]
          ? parseInt(
              match[2],
              10
            )
          : stat.size - 1;

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end < start ||
        start >= stat.size
      ) {
        return res
          .status(416)
          .set({
            "Content-Range":
              `bytes */${stat.size}`,
          })
          .end();
      }

      end = Math.min(
        end,
        stat.size - 1
      );

      const chunkSize =
        end - start + 1;

      res.writeHead(
        206,
        {
          "Content-Range":
            `bytes ${start}-${end}/${stat.size}`,

          "Accept-Ranges":
            "bytes",

          "Content-Length":
            chunkSize,

          "Content-Type":
            "video/mp4",
        }
      );

      return fs
        .createReadStream(
          resolvedVideoPath,
          {
            start,
            end,
          }
        )
        .pipe(res);
    }

    // ========================================================
    // NORMAL REQUEST
    // ========================================================

    res.writeHead(
      200,
      {
        "Content-Length":
          stat.size,

        "Content-Type":
          "video/mp4",

        "Accept-Ranges":
          "bytes",
      }
    );

    return fs
      .createReadStream(
        resolvedVideoPath
      )
      .pipe(res);
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;