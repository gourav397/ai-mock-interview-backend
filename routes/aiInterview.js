const express = require("express");
const { generateQuestions } = require("../utils/aiGenerator");

const router = express.Router();

// Fresh regenerate ko rate-limit karo — taaki user baar-baar click karke 429 na utha le
const lastFresh = new Map();

// GET /api/ai-interview/generate?category=UPSC&difficulty=Medium&count=5&fresh=1
router.get("/generate", async (req, res) => {
  try {
    const { category, difficulty, count, fresh } = req.query;

    if (!category) {
      return res.status(400).json({ message: "Category required" });
    }

    const finalCount = Math.min(parseInt(count, 10) || 5, 10);

    // "Naye Questions" per category sirf 60 sec me ek baar
    if (fresh === "1") {
      const now = Date.now();
      const last = lastFresh.get(category) || 0;
      if (now - last < 60000) {
        return res.status(429).json({
          message: "Naye questions 1 minute me ek baar hi generate hote hain. Thoda ruk kar try karo."
        });
      }
      lastFresh.set(category, now);
    }

    const questions = await generateQuestions(
      category,
      difficulty || "Medium",
      finalCount,
      fresh === "1"
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