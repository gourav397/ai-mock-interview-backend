const express = require("express");
const multer = require("multer");
const path = require("path");
const extractText = require("../utils/extractText");

const Resume = require("../models/Resume");

const {
  generateResumeQuestions
} = require("../utils/aiGenerator");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage
});

router.post("/resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const extractedText = await extractText(req.file.path);
    console.log("RESUME TEXT:", extractedText.substring(0, 200));

    let questions = [];

    try {
      questions = await generateResumeQuestions(extractedText, 50);
    } catch (err) {
      console.log("AI QUESTION ERROR:", err.message);
      questions = [
        {
          question: "AI service temporarily unavailable",
          type: "system"
        }
      ];
    }

    // ✅ GUARD: Gemini se jo bhi aaye — hamesha saaf array of objects
    // (galat/malformed data ho to bhi crash nahi hoga, save ho jayega)
    const safeQuestions = Array.isArray(questions)
  ? questions
      .filter((q) => q && q.question)
      .map((q) => ({
  question: String(q.question),
  type: q.type || "technical",

  topic: q.topic || "",

  page: q.page || 1,

  difficulty: q.difficulty || "Medium",

  options: Array.isArray(q.options)
    ? q.options.map((op)=>({
        text: op.text || "",
        explanation: op.explanation || ""
      }))
    : [],

  correctAnswer: q.correctAnswer || ""
}))
    
    
  : [];

  // 🔍 DEBUG — dekhna ki API kya return kar rahi hai
    console.log("✅ TOTAL QUESTIONS:", safeQuestions.length);
    console.log("✅ FIRST Q OPTIONS COUNT:", safeQuestions[0]?.options?.length || 0);
    console.log("✅ FIRST OPTION SAMPLE:", JSON.stringify(safeQuestions[0]?.options?.[0] || null));

    const resume = await Resume.create({
      filename: req.file.filename,
      text: extractedText,
      questions: safeQuestions
    });

    res.json({
      success: true,
      message: "Resume analyzed",
      resumeId: resume._id,
      questions: safeQuestions,
      extractedText
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;