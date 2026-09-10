// ============================================================
// routes/ppt.js — AI PPT Generator API
//
// POST /api/ppt/generate        → PPT banao (auth required)
// GET  /api/ppt/my              → user ki history ("My PPTs")
// GET  /api/ppt/download/:name  → safe download (ownership check)
//
// ⚠️ VERIFY FLAG: `protect` import existing middleware export
// style se match karna chahiye (routes/resume.js dekho):
//   export object hai   → const { protect } = require("../middleware/auth");
//   default export hai  → const protect   = require("../middleware/auth");
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");

// ⚠️ Ye line apne existing middleware export style ke hisab se verify karo
const protect = require("../middleware/auth");

const PPTGeneration = require("../models/PPTGeneration");
const {
  generatePPT,
  isSafeFileName,
  PPT_DIR,
} = require("../services/pptGenerator");

const router = express.Router();

// Abuse protection — max 10 PPT per 10 min per user
const pptLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { success: false, message: "Too many PPT requests — 10 min baad try karo." },
});

// ----------------------------------------------------------
// POST /api/ppt/generate
// ----------------------------------------------------------
router.post("/generate", pptLimiter, protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await generatePPT(req.body || {}, String(userId));

    // History save — fail hoga to bhi PPT user ko mil jayega (isolated)
    try {
      await PPTGeneration.create({
        userId,
        topic: String(req.body?.topic || "").slice(0, 300),
        slideCount: result.slideCount,
        language: String(req.body?.language || "English"),
        type: String(req.body?.type || "General"),
        theme: String(req.body?.theme || "Modern"),
        addImages: !!req.body?.addImages,
        fileName: result.fileName,
      });
    } catch (histErr) {
      console.log("📊 [PPT] history save fail:", histErr.message);
    }

    return res.json({
      success: true,
      message: "PPT generated successfully",
      file: result.fileName,
      downloadUrl: `/api/ppt/download/${result.fileName}`,
      slideCount: result.slideCount,
    });
  } catch (error) {
    console.error("📊 [PPT] generate error:", error.message);
    const status = error.statusCode || 500;
    // Internal paths/keys/stack expose NAHI karte
    const friendly =
      status === 400
        ? error.message
        : error.message?.includes("quota")
        ? error.message
        : "PPT generate nahi ho paya — thodi der baad try karo.";
    return res.status(status).json({ success: false, message: friendly });
  }
});

// ----------------------------------------------------------
// GET /api/ppt/my — user ki apni history
// ----------------------------------------------------------
router.get("/my", protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const items = await PPTGeneration.find({ userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    return res.json({
      success: true,
      items: items.map((it) => ({
        topic: it.topic,
        slideCount: it.slideCount,
        language: it.language,
        type: it.type,
        theme: it.theme,
        file: it.fileName,
        downloadUrl: `/api/ppt/download/${it.fileName}`,
        createdAt: it.createdAt,
      })),
    });
  } catch (error) {
    console.error("📊 [PPT] history error:", error.message);
    return res.status(500).json({ success: false, message: "History load nahi hui" });
  }
});

// ----------------------------------------------------------
// GET /api/ppt/download/:fileName — ownership + traversal safe
// ----------------------------------------------------------
router.get("/download/:fileName", protect, async (req, res) => {
  try {
    const { fileName } = req.params;

    // 1) Filename pattern + path-traversal reject
    if (!isSafeFileName(fileName)) {
      return res.status(400).json({ success: false, message: "Invalid file name" });
    }

    // 2) Ownership — sirf apni files download kar sakte ho
    const userId = req.user?._id || req.user?.id;
    const record = await PPTGeneration.findOne({ fileName, userId });
    if (!record) {
      return res.status(403).json({ success: false, message: "Ye file tumhari nahi hai" });
    }

    // 3) File exists? (TTL cleanup ho chuka ho to clear message)
    const filePath = path.join(PPT_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(410).json({
        success: false,
        message: "File expire ho gayi — PPT dobara generate karo",
      });
    }

    // Browser directly .pptx download kare (raw path open nahi hota)
    return res.download(filePath, fileName, (err) => {
      if (err && !res.headersSent) {
        return res.status(500).json({ success: false, message: "Download fail hua" });
      }
    });
  } catch (error) {
    console.error("📊 [PPT] download error:", error.message);
    return res.status(500).json({ success: false, message: "Download fail hua" });
  }
});

module.exports = router;