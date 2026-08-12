const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// Fresh regenerate ko rate-limit karo — taaki user baar-baar click karke 429 na utha le
const lastFresh = new Map();

// GET /api/ai-interview/generate?category=UPSC&difficulty=Medium&count=5&fresh=1
router.get("/generate", async (req, res) => {
  try {
    const category = req.query.category || "General";
    const difficulty = req.query.difficulty || "Medium";
    // 🔥 total frontend se lo — max 56 (batch system ki limit)
    const total = Math.min(parseInt(req.query.total) || 50, 56);

    console.log(`🎯 Generating ${total} questions for ${category} (${difficulty})`);

    // 🔥 IMPORTANT: DB/cache se questions check mat karo —
    // hamesha Gemini se FRESH generate karo taaki har baar naye aayein
    const questions = await generateQuestions(category, difficulty, total);

    res.json({
      category,
      difficulty,
      total: questions.length,
      questions,
    });
  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(500).json({ message: err.message || "Questions generate nahi ho paye" });
  }
});

module.exports = router;