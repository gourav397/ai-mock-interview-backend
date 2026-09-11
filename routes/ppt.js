// ============================================================
// routes/ppt.js — PRO AI PPT Generator API (upgraded)
//
// CHANGES (upgrade):
//  - /generate: naye optional options accept karta hai (layoutStyle,
//    transitions, animations, charts, narration) — backward compatible,
//    response me PREVIEW data + narration scripts add (purane fields
//    preserved: success/message/file/downloadUrl/slideCount)
//  - /my, /download/:fileName — behavior unchanged
// ⚠️ VERIFY FLAG: `protect` import existing middleware export style
// se match karna (routes/resume.js dekho).
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

// Abuse protection — max 10 PPT per 10 min per user (unchanged)
const pptLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { success: false, message: "Too many PPT requests — 10 min baad try karo." },
});

// ----------------------------------------------------------
// POST /api/ppt/generate
// Purane fields + naye optional fields dono accept hote hain
// ----------------------------------------------------------
router.post("/generate", pptLimiter, protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = req.body || {};
    const result = await generatePPT(body, String(userId));

    // History save — fail hoga to bhi PPT user ko mil jayega
    try {
      await PPTGeneration.create({
        userId,
        topic: String(body.topic || "").slice(0, 300),
        slideCount: result.slideCount,
        language: String(body.language || "English"),
        type: String(body.type || "General"),
        theme: String(body.theme || "Modern"),
        addImages: !!body.addImages,
        fileName: result.fileName,
        // naye optional fields (schema me optional — purane docs safe)
        layoutStyle: result.cfg.layoutStyle,
        transitions: result.cfg.transitions,
        animations: result.cfg.animations,
        narration: result.cfg.narration,
      });
    } catch (histErr) {
      console.log("📊 [PPT] history save fail:", histErr.message);
    }

    return res.json({
      // ---- PURANA CONTRACT (unchanged) ----
      success: true,
      message: "PPT generated successfully",
      file: result.fileName,
      downloadUrl: `/api/ppt/download/${result.fileName}`,
      slideCount: result.slideCount,
      // ---- NAYA (upgrade) ----
      preview: result.preview,
      narrationScripts: result.cfg.narration
        ? result.content.slides.map((s) => ({
            slideNumber: s.slideNumber,
            narration: s.narrationScript || s.speakerNotes || s.content.join(". "),
          }))
        : [],
    });
  } catch (error) {
    console.error("📊 [PPT] generate error:", error.message);
    const status = error.statusCode || 500;
    const friendly =
      status === 400
        ? error.message
        : error.message?.includes("quota") || error.message?.includes("AI se")
        ? error.message
        : "PPT generate nahi ho paya — thodi der baad try karo.";
    return res.status(status).json({ success: false, message: friendly });
  }
});

// ----------------------------------------------------------
// GET /api/ppt/my — user ki history (UNCHANGED behavior)
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
// (UNCHANGED behavior)
// ----------------------------------------------------------
router.get("/download/:fileName", protect, async (req, res) => {
  try {
    const { fileName } = req.params;
    if (!isSafeFileName(fileName)) {
      return res.status(400).json({ success: false, message: "Invalid file name" });
    }
    const userId = req.user?._id || req.user?.id;
    const record = await PPTGeneration.findOne({ fileName, userId });
    if (!record) {
      return res.status(403).json({ success: false, message: "Ye file tumhari nahi hai" });
    }
    const filePath = path.join(PPT_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(410).json({
        success: false,
        message: "File expire ho gayi — PPT dobara generate karo",
      });
    }
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