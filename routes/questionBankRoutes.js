// routes/questionBankRoutes.js
// QuestionBank API — banks + system status. कोई लाइव AI जनरेशन नहीं।

const express = require("express");
const router = express.Router();
const QuestionBank = require("../models/QuestionBank");
const { keyManager } = require("../config/geminiKeys");

// ------------------------------------------------------------
// GET /api/question-banks/status  (या /api/bank-status नीचे माउंट है)
// → banks की स्थिति + Gemini कीज़ की स्थिति एक जगह
// ------------------------------------------------------------
router.get("/status", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}, "category difficulty questions updatedAt").lean();

    const perDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
    const categoryList = [];
    let totalQuestions = 0;

    const seenCat = new Set();
    for (const b of banks) {
      const count = Array.isArray(b.questions) ? b.questions.length : 0;
      totalQuestions += count;
      if (perDifficulty[b.difficulty] !== undefined) perDifficulty[b.difficulty] += 1;
      if (!seenCat.has(b.category)) {
        seenCat.add(b.category);
        categoryList.push({
          category: b.category,
          counts: { Easy: 0, Medium: 0, Hard: 0 },
          total: 0,
        });
      }
      const c = categoryList.find((x) => x.category === b.category);
      c.counts[b.difficulty] = count;
      c.total += count;
    }

    res.json({
      gemini: keyManager.stats(),   // कीज़ की वैल्यूज़ कभी नहीं जातीं — केवल काउंट्स
      totalBanks: banks.length,
      totalQuestions,
      banksWithQuestions: perDifficulty,
      categories: categoryList,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/question-banks/overview → [{ category, difficulty, count }]
router.get("/overview", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}, "category difficulty questions").lean();
    res.json(banks.map((b) => ({
      category: b.category,
      difficulty: b.difficulty,
      count: Array.isArray(b.questions) ? b.questions.length : 0,
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/question-banks/get?category=SSC&difficulty=Easy&count=50
router.get("/get", async (req, res) => {
  try {
    const { category, difficulty = "Medium", count = 50 } = req.query;
    if (!category) return res.status(400).json({ message: "category required", questions: [] });

    const bank = await QuestionBank.findOne({ category, difficulty }).lean();

    if (!bank || !bank.questions?.length) {
      return res.status(404).json({
        message: `${category} (${difficulty}) में अभी क्यू (Q) नहीं हैं — रात 3 बजे क्रोन जोड़ता है, या मैन्युअल रिफ्रेश चलाओ`,
        questions: [],
      });
    }

    const qs = [...bank.questions];
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }

    res.json({ questions: qs.slice(0, Number(count) || 50), total: bank.questions.length });
  } catch (err) {
    res.status(500).json({ message: err.message, questions: [] });
  }
});

module.exports = router;