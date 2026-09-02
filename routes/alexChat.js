// ============================================================
// ALEX CHAT — Premium Owner Chat Interface
// ✅ FIXED: Routes at /chat (mounted at /api/alex → /api/alex/chat)
// ============================================================

const express = require("express");
const router = express.Router();
const { ownerAuth } = require("../middleware/ownerAuth");
const { getOwnerCommandHandler } = require("../alex/OwnerCommandHandler");
const config = require("../alex/config");

// ============================================================
// In-memory session store
// ============================================================
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

function generateSessionId() {
  return `alex_chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSession(sessionId, owner) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    return session;
  }

  const newSession = {
    id: generateSessionId(),
    owner: { userId: owner?.userId, method: owner?.method, role: owner?.role },
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
    messages: [],
    context: {
      state: "idle",
      lastAction: null,
      lastResult: null,
      activeGoal: null,
      projectContext: {
        framework: "Express.js + MongoDB",
        alexVersion: config.version || "1.0.0",
        aiAvailable: config.ai?.available || false,
      },
      ongoingTasks: [],
      resolvedIncidents: 0,
    },
    metrics: {
      totalMessages: 0,
      commandsExecuted: 0,
      commandsFailed: 0,
    },
  };

  newSession.messages.push({
    role: "alex",
    type: "system",
    content: `👋 Hello ${owner?.role || "Owner"}! I'm ALEX, your autonomous agent system. I'm ready to execute any goal you give me.

**What I can do:**
• 🛡️ Security scanning & auto-fix vulnerabilities
• 🔍 Project inspection & code analysis
• 🐛 Find and fix bugs automatically
• 📝 Create and modify files
• 🧪 Run tests and verify results
• 🚀 Prepare deployments
• 📊 System health monitoring
• 🔄 Fix-loop — auto-retry with rollback

Just tell me what you want to accomplish.`,
    timestamp: new Date().toISOString(),
  });

  sessions.set(newSession.id, newSession);
  return newSession;
}

function formatAlexResponse(result) {
  if (!result) return "I encountered an issue processing that request.";

  if (result.status === "completed") {
    let response = `✅ **Done!** ${result.message || "Task completed successfully."}`;
    if (result.systemStatus) {
      const s = result.systemStatus;
      response += `\n\n**System Status:**\n• Status: ${s.system?.status || "unknown"}\n• Uptime: ${s.system?.uptime || 0}s\n• AI: ${s.system?.aiAvailable ? "✅ Enabled" : "⚠️ Limited"}\n• Incidents handled: ${s.state?.incidentsHandled || 0}`;
    }
    if (result.health) response += `\n\n**Health:** ${result.health.status || "unknown"}`;
    if (result.scanResult) {
      response += `\n\n**Scan Results:**\n• Total: ${result.scanResult.totalVulnerabilities || 0}\n• Critical: ${result.scanResult.criticalCount || 0}\n• High: ${result.scanResult.highCount || 0}\n• Medium: ${result.scanResult.mediumCount || 0}\n• Low: ${result.scanResult.lowCount || 0}`;
    }
    if (result.fixResult) {
      response += `\n\n**Fix Results:**\n• Attempted: ${result.fixResult.attempted || 0}\n• Succeeded: ${result.fixResult.succeeded || 0}\n• Failed: ${result.fixResult.failed || 0}`;
    }
    if (result.structure) {
      const files = result.structure.files || [];
      const dirs = Object.keys(result.structure.directories || {});
      response += `\n\n**Project Structure:**\n• Files: ${files.length}\n• Directories: ${dirs.length}`;
      if (files.length > 0) response += `\n• Sample files: ${files.slice(0, 10).map(f => f.name).join(", ")}`;
    }
    if (result.incidents) {
      response += `\n\n**Recent Incidents:**\n${result.incidents.map(i => `• [${i.severity}] ${i.description?.slice(0, 80)}`).join("\n")}`;
    }
    if (result.filePath) response += `\n\n📄 **File:** \`${result.filePath}\``;
    return response;
  }

  if (result.status === "failed") {
    let response = `❌ **Failed.** ${result.error || result.message || "An error occurred."}`;
    if (result.stdout) response += `\n\n**Output:**\n\`\`\`\n${String(result.stdout).slice(-500)}\n\`\`\``;
    if (result.stderr) response += `\n\n**Errors:**\n\`\`\`\n${String(result.stderr).slice(-500)}\n\`\`\``;
    return response;
  }

  if (result.status === "confirmation_required") {
    return `⚠️ **Confirmation Required**\n\nAction: **${result.action}**\nTarget: ${result.target}\n\n${result.message || "This action requires your approval."}\n\nReply with **"confirm"** to proceed, or **"cancel"** to abort.`;
  }

  if (result.status === "denied") return `🚫 **Access Denied**\n\n${result.error || result.message || "This action is not permitted."}`;
  if (result.status === "error") return `❌ **Error:** ${result.error || result.message || "Something went wrong."}`;

  return JSON.stringify(result, null, 2).slice(0, 2000);
}

// ============================================================
// ALL ROUTES REQUIRE OWNER AUTH
// ============================================================
router.use(ownerAuth);

// ============================================================
// POST /chat — Send message to ALEX  →  /api/alex/chat
// ============================================================
router.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: "Message is required." });
    }

    const session = getOrCreateSession(sessionId, req.owner);
    const trimmedMessage = message.trim();

    session.messages.push({ role: "user", type: "message", content: trimmedMessage, timestamp: new Date().toISOString() });
    session.metrics.totalMessages++;

    // Confirmation handling
    if (/^(confirm|yes|proceed|go ahead|do it|approve)$/i.test(trimmedMessage)) {
      const pendingAction = session.context.pendingAction;
      if (pendingAction) {
        session.context.pendingAction = null;
        const handler = getOwnerCommandHandler();
        const result = await handler.processCommand(pendingAction.originalInput, req.owner, pendingAction.confirmationId);
        const alexResponse = formatAlexResponse(result);
        session.messages.push({ role: "alex", type: "result", content: alexResponse, result, timestamp: new Date().toISOString() });
        session.context.lastAction = pendingAction.action;
        session.context.lastResult = result;
        if (result.success) session.metrics.commandsExecuted++;
        else session.metrics.commandsFailed++;
        return res.json({ success: true, sessionId: session.id, response: alexResponse, result, metrics: session.metrics });
      }
    }

    if (/^(cancel|no|stop|abort|forget it|never mind)$/i.test(trimmedMessage)) {
      session.context.pendingAction = null;
      session.messages.push({ role: "alex", type: "system", content: "Cancelled. What would you like to do next?", timestamp: new Date().toISOString() });
      return res.json({ success: true, sessionId: session.id, response: "Cancelled. What would you like to do next?" });
    }

    // Execute command
    const handler = getOwnerCommandHandler();
    const result = await handler.processCommand(trimmedMessage, req.owner, null);

    if (result.status === "confirmation_required") {
      session.context.pendingAction = { originalInput: trimmedMessage, action: result.action, target: result.target, confirmationId: result.confirmationId };
    }

    const alexResponse = formatAlexResponse(result);
    session.messages.push({
      role: "alex",
      type: result.status === "confirmation_required" ? "confirmation" : "result",
      content: alexResponse, result, timestamp: new Date().toISOString()
    });

    session.context.lastAction = result.action || "unknown";
    session.context.lastResult = result;
    if (result.success) session.metrics.commandsExecuted++;
    else if (result.status === "failed" || result.status === "error") session.metrics.commandsFailed++;

    return res.json({
      success: true, sessionId: session.id, response: alexResponse, result, metrics: session.metrics,
      requiresConfirmation: result.status === "confirmation_required"
    });
  } catch (err) {
    console.error("❌ ALEX Chat error:", err);
    return res.status(500).json({ success: false, error: "Chat processing failed.", response: "Sorry, I encountered an error." });
  }
});

// ============================================================
// GET /chat/sessions — List active sessions
// ============================================================
router.get("/chat/sessions", (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => ({
    id: s.id, createdAt: s.createdAt, lastActivity: s.lastActivity,
    messageCount: s.messages.length, metrics: s.metrics, owner: s.owner,
  }));
  return res.json({ success: true, data: sessionList, count: sessionList.length });
});

// ============================================================
// GET /chat/sessions/:id — Get session history
// ============================================================
router.get("/chat/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: "Session not found." });
  return res.json({
    success: true,
    data: { id: session.id, createdAt: session.createdAt, lastActivity: session.lastActivity, context: session.context, metrics: session.metrics, messages: session.messages.slice(-100) }
  });
});

// ============================================================
// DELETE /chat/sessions/:id — Clear a session
// ============================================================
router.delete("/chat/sessions/:id", (req, res) => {
  const deleted = sessions.delete(req.params.id);
  return res.json({ success: deleted, message: deleted ? "Session deleted." : "Session not found." });
});

module.exports = router;