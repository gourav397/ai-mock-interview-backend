const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// GENERATE AI INTERVIEW QUESTIONS
// GET /api/ai-interview/generate?category=Cyber Security&difficulty=Medium
router.get("/generate", async (req, res) => {
  try {
    const { category, difficulty } = req.query;

    if (!category) {
      return res.status(400).json({ message: "Category required" });
    }

    const questions = await generateQuestions(
      category,
      difficulty || "Medium",
      10
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