// routes/questionBankRoutes.js
// QuestionBank API — frontend ko MongoDB banks se questions deta hai.
// Yahan koi live AI generation NAHI hoti — sirf pre-generated banks.

const express = require("express");
const router = express.Router();
const QuestionBank = require("../models/QuestionBank");

// ------------------------------------------------------------
// GET /api/question-banks/overview
// → [{ category, difficulty, count }, ...]
// Category page ke real question-counts ke liye
// ------------------------------------------------------------
router.get("/overview", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}, "category difficulty questions").lean();
    const overview = banks.map((b) => ({
      category: b.category,
      difficulty: b.difficulty,
      count: Array.isArray(b.questions) ? b.questions.length : 0,
    }));
    res.json(overview);
  } catch (err) {
    console.error("❌ [BANKS] overview error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/question-banks/get?category=SSC&difficulty=Easy&count=50
// → MongoDB bank se shuffled questions
// ------------------------------------------------------------
router.get("/get", async (req, res) => {
  try {
    const { category, difficulty = "Medium", count = 50 } = req.query;

    if (!category) {
      return res.status(400).json({ message: "category required hai", questions: [] });
    }

    const bank = await QuestionBank.findOne({ category, difficulty }).lean();

    if (!bank || !bank.questions?.length) {
      return res.status(404).json({
        message: `Is category (${category}) me ${difficulty} questions abhi available nahi hain. Roz raat 3 baje naye questions add hote hain.`,
        questions: [],
      });
    }

    // Fisher-Yates shuffle — har baar different order
    const qs = [...bank.questions];
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }

    const sliced = qs.slice(0, Number(count) || 50);
    res.json({ questions: sliced, total: bank.questions.length });
  } catch (err) {
    console.error("❌ [BANKS] get error:", err.message);
    res.status(500).json({ message: err.message, questions: [] });
  }
});

module.exports = router;