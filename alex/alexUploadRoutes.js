// ============================================================
// ALEX FILE UPLOAD + LAPTOP CONTROL ROUTES v1.0
// Mount: app.use("/api/alex", alexUploadRouter)  (auth middleware same as alexDashboard)
// ENDPOINTS:
//   POST /api/alex/upload/analyze   — single file -> analysis + fixed code
//   POST /api/alex/upload/batch     — up to 5 files
//   POST /api/alex/system/command   — laptop control (safe commands)
//   GET  /api/alex/system/info      — laptop info
// ============================================================

const express = require("express");
const multer = require("multer");
const { processUploadedFile, processUploadedFiles, MAX_FILE_SIZE, MAX_TOTAL_FILES } = require("./FileUploadIntelligence");
const { SystemControl } = require("./SystemControl");
const { CommandAllowlist } = require("./CommandAllowlist");

const ALLOWED_UPLOAD_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java",
  ".cpp", ".c", ".html", ".css", ".json", ".sql", ".sh", ".md", ".go", ".rb", ".php",
]);

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_TOTAL_FILES },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || "").toLowerCase().split(".").pop();
    const dotExt = "." + ext;
    if (ALLOWED_UPLOAD_EXTS.has(dotExt)) return cb(null, true);
    cb(new Error(`File type not supported: ${dotExt}. Allowed: ${[...ALLOWED_UPLOAD_EXTS].join(" ")}`));
  },
});

function createAlexUploadRouter({ authMiddleware } = {}) {
  const router = express.Router();

  // Auth — reuse the same auth as alexDashboard
  if (typeof authMiddleware === "function") {
    router.use(authMiddleware);
  }

  // ------------------------------------------------------------
  // POST /upload/analyze — single file
  // Body: multipart form-data, field name: "file"
  //       optional field: "hint" (e.g. "fix the login bug")
  // ------------------------------------------------------------
  router.post("/upload/analyze", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded. Use form field 'file'." });
      }
      const result = await processUploadedFile(req.file, { hint: req.body?.hint || "" });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: "Upload processing failed: " + err.message });
    }
  });

  // ------------------------------------------------------------
  // POST /upload/batch — multiple files (field name: "files")
  // ------------------------------------------------------------
  router.post("/upload/batch", upload.array("files", MAX_TOTAL_FILES), async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({ success: false, message: "No files uploaded. Use form field 'files'." });
      }
      const result = await processUploadedFiles(req.files, { hint: req.body?.hint || "" });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: "Batch processing failed: " + err.message });
    }
  });

  // ------------------------------------------------------------
  // POST /system/command — laptop control
  // Body: { "action": "...", ...params }
  //   { action: "open-path", path: "C:\..." | "file.pdf" }
  //   { action: "open-url", url: "https://..." }
  //   { action: "run", command: "dir" | "ls" | "npm test" ... }
  //   { action: "clipboard-read" } / { action: "clipboard-write", text: "..." }
  //   { action: "notify", title, message }
  //   { action: "list-dir", path: "..." }
  // ------------------------------------------------------------
  router.post("/system/command", async (req, res) => {
    try {
      const body = req.body || {};
      const result = await SystemControl.execute(body.action, body, req.user || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: "System command failed: " + err.message });
    }
  });

  // ------------------------------------------------------------
  // GET /system/info — laptop ka complete info
  // ------------------------------------------------------------
  router.get("/system/info", async (req, res) => {
    try {
      const info = await SystemControl.getSystemInfo();
      res.json({ success: true, data: info });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
}

module.exports = { createAlexUploadRouter, ALLOWED_UPLOAD_EXTS };