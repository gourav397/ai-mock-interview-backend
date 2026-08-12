const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// GET /api/ai-interview/generate?category=Cyber%20Security&difficulty=Medium&total=50
router.get("/generate", async (req, res) => {
  try {
    const category = req.query.category || "General";
    const difficulty = req.query.difficulty || "Medium";
    const total = Math.min(parseInt(req.query.total) || 50, 56);

    console.log(`🎯 Generating ${total} FRESH questions for ${category} (${difficulty})`);

    // 🔥 useCache = false → hamesha Gemini se naye questions
    // (batch system andar 8-8 karke generate karega)
    const questions = await generateQuestions(category, difficulty, total, false);

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