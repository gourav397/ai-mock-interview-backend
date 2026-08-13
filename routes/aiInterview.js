const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// GET /api/ai-interview/generate?category=UPSC&difficulty=Medium&count=50&fresh=1
router.get("/generate", async (req, res) => {
  try {
    const { category, difficulty, count, fresh } = req.query;

    if (!category) {
      return res.status(400).json({ message: "Category required" });
    }

    // ✅ count = 50 tak allow (pehle max 10 tha — isliye 4-5 hi aate the)
    const finalCount = Math.min(Math.max(parseInt(count, 10) || 50, 1), 50);

    // ✅ fresh=1 → cache skip + clear → HAR BAAR naye alag questions
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