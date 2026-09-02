const express = require("express");
const WeakQuestion = require("../models/WeakQuestion");
const { callGemini } = require("../utils/aiChat");
const { getUser } = require("../utils/reqUser");

const router = express.Router();

// ---------- REPORT: practice result batao (galat → weak list mein) ----------
router.post("/report", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });

    const { category, question, correct } = req.body;
    if (!category || !question || typeof correct !== "boolean") {
      return res.status(400).json({ message: "category, question, correct required" });
    }

    if (!correct) {
      await WeakQuestion.findOneAndUpdate(
        { user: user._id, category, "question.question": question.question },
        {
          $set: { question, lastWrongAt: new Date() },
          $inc: { timesWrong: 1 }
        },
        { upsert: true, returnDocument: "after" }
      );
    }

    res.json({ ok: true, saved: !correct });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- REVISION: weak questions (dubara practice ke liye) ----------
router.get("/revision", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });

    const weak = await WeakQuestion.find({ user: user._id })
      .sort({ lastWrongAt: -1 })
      .limit(50)
      .lean();
    res.json(weak.map((w) => ({
      category: w.category,
      question: w.question,
      timesWrong: w.timesWrong,
      lastWrongAt: w.lastWrongAt
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- EXPLAIN: kisi bhi question ka answer + explanation (on demand) ----------
router.post("/explain", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ message: "question required" });

    const text = typeof question === "string" ? question : (question.question || "");
    const explanation = await callGemini(
      `Question: ${text}\nIska sahi answer aur chhota explanation do (Hindi + English mix, max 120 words).`,
      { temperature: 0.3 }
    );

    res.json({ explanation });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;