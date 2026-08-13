const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// GET /api/ai-interview/generate?category=UPSC&difficulty=Medium&count=5&fresh=1
router.get("/generate", async (req, res) => {
  try {
    const { category, difficulty, count, fresh } = req.query;

    if (!category) {
      return res.status(400).json({ message: "Category required" });
    }

    const finalCount = Math.min(parseInt(count, 10) || 5, 10);

    // ✅ fresh=1 → naye questions (cache skip + clear)
    // ✅ normal load → cache use karo (fast)
    const useCache = fresh !== "1";

    const questions = await generateQuestions(
      category,
      difficulty || "Medium",
      finalCount,
      useCache
    );

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(502).json({
        message: "AI questions generate nahi kar paya, dobara try karein"
      });
    }

    res.json({
      category,
      difficulty: difficulty || "Medium",
      total: questions.length,
      questions
    });
  } catch (error) {
    console.log("AI GENERATE ERROR:", error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;