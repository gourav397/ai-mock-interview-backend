// ============================================================
// AI INTERVIEW BACKEND — PRODUCTION SERVER
// WITH ALEX MULTI-AGENT SYSTEM + OWNER CHAT
// FIXED: shared Gemini key pool + startup diagnostics + build id ✅
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

// ============================================================
// STARTUP DIAGNOSTIC — stale deploy detection + key status
// SECURITY: keys kabhi print nahi hoti, sirf count + masked preview
// ============================================================
const { envStatus, keyManager } = require("./config/geminiKeys");

// Render auto-inject karta hai: RENDER_GIT_COMMIT, RENDER_SERVICE_NAME
const APP_BUILD =
  (process.env.RENDER_GIT_COMMIT || process.env.APP_BUILD || "local-dev").slice(0, 12);

console.log("=================================");
console.log(`APP BUILD      : ${APP_BUILD}`);
console.log(`GEMINI DEBUG   : ${envStatus.summary}`);
if (envStatus.count > 0) {
  console.log(`GEMINI PREVIEW : ${envStatus.maskedKeys.join(", ")}`);
}
console.log(`GEMINI MODEL   : ${process.env.GEMINI_MODEL || "gemini-3.5-flash (default)"}`);
console.log("=================================");

console.log(
  "GEMINI DEBUG:",
  envStatus.count > 0
    ? `FOUND (${envStatus.count} keys via ${envStatus.source})`
    : "MISSING"
);

const imageEditorRoutes = require("./routes/imageEditor");
const { startBankRefreshCron } = require("./cron/refreshBanks");
const uploadRoutes = require("./routes/upload");
const connectDB = require("./config/db");
const bulkUploader = require("./utils/bulkUploader");
const classExamRoutes = require("./routes/classExam");

// Existing routes
const authRoutes = require("./routes/auth");
const questionRoutes = require("./routes/questions");
const interviewRoutes = require("./routes/interview");
const adminQuestionRoutes = require("./routes/adminQuestions");
const aiInterviewRoutes = require("./routes/aiInterview");
const aiInterviewVoiceRoutes = require("./routes/aiInterviewVoice");
const resultRoutes = require("./routes/results");
const gamificationRoutes = require("./routes/gamification");
const interviewSessionRoutes = require("./routes/aiInterviewSession");
const practiceRoutes = require("./routes/practice");
const resumeRoutes = require("./routes/resume");
const adminRoutes = require("./routes/admin");

const app = express();
app.set("trust proxy", 1);

// =======================
// MIDDLEWARE
// =======================

app.use(cors({
  origin: [
    'https://ai-mock-interview-frontend-alpha.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    /\.railway\.app$/,
    /\.vercel\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-admin-key'],
}));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use("/api/class-exam", classExamRoutes);

// =======================
// RATE LIMIT
// =======================

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  message: { success: false, message: 'Too many requests, please try again later.' }
}));

const genLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use("/api/ai-interview/generate", genLimiter);
app.use("/api/interview-session", genLimiter);

// =======================
// ENV CHECK
// =======================

console.log("=================================");
console.log("EMAIL USER :", process.env.EMAIL_USER);
console.log(process.env.EMAIL_PASS ? "EMAIL PASS FOUND" : "EMAIL PASS MISSING");
console.log(`GEMINI KEYS: ${envStatus.count > 0 ? `FOUND (${envStatus.count} keys)` : "MISSING"}`);
console.log(process.env.MONGO_URI ? "MONGO URI FOUND" : "MONGO URI MISSING");
console.log(process.env.ADMIN_KEY ? "ADMIN KEY FOUND" : "ADMIN KEY MISSING");
console.log(process.env.JWT_SECRET ? "JWT SECRET FOUND" : "JWT SECRET MISSING (required for owner auth)");
console.log("=================================");

// =======================
// ROUTES — Order matters!
// =======================

app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/admin/questions", adminQuestionRoutes);
app.use("/api/ai-interview", aiInterviewRoutes);
app.use("/api/ai-interview", aiInterviewVoiceRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/gamification", gamificationRoutes);
app.use("/api/interview-session", interviewSessionRoutes);
app.use("/api/practice", practiceRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/image-editor", imageEditorRoutes);

// ============================================================
// 🤖 ALEX CHAT ROUTES — MOUNTED FIRST (BEFORE dashboard)
// ============================================================
const alexChatRoutes = require("./routes/alexChat");
app.use("/api/alex", alexChatRoutes);
console.log("💬 ALEX Chat routes ready at POST /api/alex/chat");

// =======================
// 🚀 ALEX DASHBOARD ROUTES — Mounted AFTER chat routes
// =======================
let alexRouter = null;
(async () => {
  try {
    const { getDashboardRouter } = require("./alex/index");
    alexRouter = await getDashboardRouter();
    console.log("📊 ALEX Dashboard routes ready");
  } catch (err) {
    console.error("⚠️ ALEX route setup failed:", err.message);
  }
})();

app.use("/api/alex", (req, res, next) => {
  // Skip if already handled by chat routes
  if (req.path.startsWith("/chat")) return next();

  if (alexRouter) {
    alexRouter(req, res, next);
  } else {
    res.status(503).json({ success: false, message: "ALEX routes not yet initialized" });
  }
});

// =======================
// 👑 OWNER COMMAND ROUTES
// =======================
let ownerRouter = null;
(async () => {
  try {
    const { createOwnerRouter } = require("./routes/ownerCommands");
    ownerRouter = await createOwnerRouter();
    console.log("👑 Owner command routes ready at /api/owner");
  } catch (err) {
    console.error("⚠️ Owner route setup failed:", err.message);
  }
})();

app.use("/api/owner", (req, res, next) => {
  if (ownerRouter) {
    ownerRouter(req, res, next);
  } else {
    res.status(503).json({ success: false, message: "Owner routes not yet initialized" });
  }
});

// =======================
// HOME
// =======================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI Interview Backend Running",
    version: "2.0",
    build: APP_BUILD,
    voiceRoutes: true,
    alexSystem: true,
    ownerControl: true,
    alexChat: true,
    gemini: {
      status: envStatus.count > 0 ? "OK" : "MISSING",
      keyCount: envStatus.count, // safe — sirf number, kabhi key value nahi
      ...keyManager.stats(),     // usableNow, exhausted, invalid, totalCalls
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    },
    endpoints: [
      "GET /api/ai-interview/voice/test",
      "POST /api/ai-interview/voice/start",
      "POST /api/ai-interview/voice/chat",
      "GET /api/ai-interview/voice/session/:id",
      "POST /api/ai-interview/voice/end",
      "GET /api/alex/status",
      "GET /api/alex/incidents",
      "GET /api/alex/health",
      "POST /api/owner/command",
      "GET /api/owner/status",
      "GET /api/owner/history",
      "GET /api/owner/actions",
      "GET /api/owner/incidents",
      "GET /api/owner/audit",
      // 💬 ALEX Chat
      "POST /api/alex/chat              — Send message to ALEX",
      "GET /api/alex/chat/sessions      — List sessions",
      "GET /api/alex/chat/sessions/:id  — Session history",
      "DELETE /api/alex/chat/sessions/:id — Clear session",
    ]
  });
});

// =======================
// 404
// =======================

app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: "Route Not Found",
    path: req.originalUrl,
    method: req.method,
  });
});

// =======================
// ERROR HANDLER
// =======================

app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// =======================
// START SERVER
// =======================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server Running On Port ${PORT}`);
  console.log(`🌍 Health check: http://localhost:${PORT}/`);
  console.log(`👑 Owner API:    http://localhost:${PORT}/api/owner/actions`);
  console.log(`💬 ALEX Chat:    http://localhost:${PORT}/api/alex/chat`);
});

// =======================
// BACKGROUND INIT
// =======================

(async () => {
  try {
    await connectDB();
    startBankRefreshCron();
    try {
      const { initAlex } = require("./alex/index");
      await initAlex();
      console.log("🤖 ALEX is now running — monitoring all systems");
    } catch (alexErr) {
      console.error("⚠️ ALEX init warning (server continues):", alexErr.message);
    }
    const filePath = path.join(__dirname, "uploads", "questions.json");
    await bulkUploader(filePath);
    console.log("Upload Completed");
  } catch (error) {
    console.error("⚠️ Background setup issue:", error.message);
  }
})();