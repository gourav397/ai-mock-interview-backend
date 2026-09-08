const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const extractText = require("../utils/extractText");

const Resume = require("../models/Resume");
const { generateResumeQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// uploads/ folder ensure (Render par disk ephemeral hai — folder missing ho sakta hai)
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({ storage });

router.post("/resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const extractedText = await extractText(req.file.path);
    console.log("RESUME TEXT:", extractedText.substring(0, 200));

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(400).json({
        message: "Resume se text extract nahi hua — PDF text-based honi chahiye (scanned image PDF support nahi)",
      });
    }

    // ---------- AI GENERATION with RETRY (max 2 attempts) ----------
    let questions = [];
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        questions = await generateResumeQuestions(extractedText, 50);
        if (questions.length) break;
      } catch (err) {
        lastError = err;
        console.log(`❌ [UPLOAD] Attempt ${attempt} fail: ${err.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // Clean up uploaded file (Render disk chhota hai — temp files mat jodo)
    try { fs.unlinkSync(req.file.path); } catch {}

    // ---------- GUARD: saaf array of objects ----------
    const safeQuestions = (Array.isArray(questions) ? questions : [])
      .filter((q) => q && q.question)
      .map((q) => ({
        question: String(q.question),
        type: q.type || "technical",
        topic: q.topic || "",
        page: q.page || 1,
        difficulty: q.difficulty || "Medium",
        options: Array.isArray(q.options)
          ? q.options.map((op) => ({
              text: op.text || "",
              explanation: op.explanation || "",
            }))
          : [],
        correctAnswer: q.correctAnswer || "",
      }))
      .filter((q) => q.options.length >= 2 && q.correctAnswer);

    console.log(`✅ [UPLOAD] TOTAL QUESTIONS: ${safeQuestions.length}`);
    console.log(`✅ [UPLOAD] FIRST Q OPTIONS: ${safeQuestions[0]?.options?.length || 0}`);

    // ---------- EMPTY = ERROR (chup-chaap success nahi) ----------
    if (!safeQuestions.length) {
      const msg =
        lastError?.message ||
        "AI service abhi questions generate nahi kar payi — thodi der baad dobara try karo";
      return res.status(503).json({
        success: false,
        message: msg,
        questions: [],
      });
    }

    const resume = await Resume.create({
      filename: req.file.filename,
      text: extractedText,
      questions: safeQuestions,
    });

    res.json({
      success: true,
      message: "Resume analyzed",
      resumeId: resume._id,
      questions: safeQuestions,
      extractedText,
    });
  } catch (err) {
    console.log("[UPLOAD ERROR]", err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;