// routes/uploadRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const extractText = require("../utils/extractText");
const Resume = require("../models/Resume");
const { generateResumeQuestionsFast } = require("../utils/aiGenerator");

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.post("/resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const extractedText = await extractText(req.file.path);
    console.log("RESUME TEXT:", extractedText.substring(0, 150));

    if (!extractedText || extractedText.trim().length < 50) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        message: "रिज़्यूमे से टेक्स्ट एक्सट्रैक्ट नहीं हुआ — टेक्स्ट-आधारित PDF अपलोड करो (स्कैन्ड इमेज PDF सपोर्टेड नहीं)",
      });
    }

    // ---------- FAST GENERATION (एक प्रयास, ~60-90 सेकंड) ----------
    let questions = [];
    let genError = null;
    try {
      questions = await generateResumeQuestionsFast(extractedText, 30);
    } catch (err) {
      genError = err;
      console.log("❌ [UPLOAD] Generation fail:", err.message);
    }

    try { fs.unlinkSync(req.file.path); } catch {}

    const safeQuestions = (Array.isArray(questions) ? questions : [])
      .filter((q) => q && q.question)
      .map((q) => ({
        question: String(q.question),
        type: q.type || "technical",
        topic: q.topic || "",
        page: q.page || 1,
        difficulty: q.difficulty || "Medium",
        options: Array.isArray(q.options)
          ? q.options.map((op) => ({ text: op.text || "", explanation: op.explanation || "" }))
          : [],
        correctAnswer: q.correctAnswer || "",
      }))
      .filter((q) => q.options.length >= 2 && q.correctAnswer);

    console.log(`✅ [UPLOAD] QUESTIONS: ${safeQuestions.length}`);

    if (!safeQuestions.length) {
      return res.status(503).json({
        success: false,
        message: genError?.message || "AI अभी क्यू जनरेट नहीं कर पाया — 2 मिनट बाद दोबारा ट्राई करो",
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