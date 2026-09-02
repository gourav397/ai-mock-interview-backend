const express = require("express");
const MockTestSession = require("../models/MockTestSession");
const QuestionBank = require("../models/QuestionBank");
const WeakQuestion = require("../models/WeakQuestion");
const { getUser } = require("../utils/reqUser");

const router = express.Router();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function qKey(q) {
  return (q.question || "").split(" / ")[0].trim().toLowerCase();
}

function requireUser(req, res) {
  const user = getUser(req);
  if (!user) { res.status(401).json({ message: "Login required" }); return null; }
  return user;
}

// ---------- START MOCK ----------
router.post("/start", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { categories = [], count = 30, duration = 20 } = req.body || {};
    const qCount = Math.min(Math.max(parseInt(count, 10) || 30, 10), 50);
    const dur = Math.min(Math.max(parseInt(duration, 10) || 20, 5), 60);

    let banks;
    if (Array.isArray(categories) && categories.length) {
      banks = await QuestionBank.find({ category: { $in: categories } });
    } else {
      banks = await QuestionBank.find({});
    }

    let all = [];
    banks.forEach((b) => all.push(...(b.questions || [])));

    const seen = new Set();
    const unique = all.filter((q) => {
      const k = qKey(q);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (unique.length < 10) {
      return res.status(409).json({ message: "Question banks abhi ready nahi hain — thodi der baad try karo" });
    }

    const picked = shuffle(unique).slice(0, qCount);

    await MockTestSession.updateMany(
      { user: user._id, status: "ongoing" },
      { $set: { status: "expired", submittedAt: new Date() } }
    );

    const session = await MockTestSession.create({
      user: user._id,
      categories: categories.length ? categories : [...new Set(banks.map((b) => b.category))].slice(0, 10),
      questions: picked,
      durationMinutes: dur
    });

    res.json({
      sessionId: session._id,
      durationMinutes: dur,
      totalQuestions: picked.length,
      categories: session.categories,
      startedAt: session.startedAt,
      questions: picked.map((q, i) => ({
        index: i + 1,
        question: q.question,
        options: q.options || [],
        correctOption: q.correctOption || q.answer || ""
      }))
    });
  } catch (e) {
    console.log("MOCK START ERROR:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ---------- SUBMIT ----------
router.post("/submit", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { sessionId, answers = [] } = req.body || {};
    if (!sessionId) return res.status(400).json({ message: "sessionId required" });

    const session = await MockTestSession.findOne({ _id: sessionId, user: user._id });
    if (!session) return res.status(404).json({ message: "Session nahi mila" });
    if (session.status !== "ongoing") {
      return res.status(400).json({ message: "Session pehle hi submit/expired ho chuka hai" });
    }

    const deadline = new Date(session.startedAt.getTime() + session.durationMinutes * 60000);
    const expired = Date.now() > deadline.getTime();

    const ansMap = {};
    (answers || []).forEach((a) => { if (a && a.index != null) ansMap[a.index] = a.selectedOption; });

    let correct = 0, wrong = 0, skipped = 0;
    const detail = [];

    session.questions.forEach((q, i) => {
      const idx = i + 1;
      const correctOption = q.correctOption || q.answer || "";
      const selected = ansMap[idx] || "";
      const isCorrect = !!selected && selected === correctOption;

      if (!selected) skipped++;
      else if (isCorrect) correct++;
      else wrong++;

      detail.push({ question: q.question, selectedOption: selected, correctOption, isCorrect });

      if (selected && !isCorrect) {
        WeakQuestion.findOneAndUpdate(
          { user: user._id, category: q.category || "General", "question.question": q.question },
          { $set: { question: q, lastWrongAt: new Date() }, $inc: { timesWrong: 1 } },
          { upsert: true, returnDocument: "after" }
        ).catch(() => {});
      }
    });

    const total = session.questions.length;
    const score = Math.round((correct / total) * 100);

    session.answers = detail;
    session.correctCount = correct;
    session.wrongCount = wrong;
    session.skippedCount = skipped;
    session.score = score;
    session.status = expired ? "expired" : "submitted";
    session.submittedAt = new Date();
    await session.save();

    res.json({ sessionId: session._id, score, correct, wrong, skipped, total, status: session.status, detail });
  } catch (e) {
    console.log("MOCK SUBMIT ERROR:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ---------- HISTORY ----------
router.get("/history", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const sessions = await MockTestSession.find({ user: user._id, status: { $in: ["submitted", "expired"] } })
      .sort({ submittedAt: -1 }).limit(20).lean();
    res.json(sessions.map((s) => ({
      id: s._id, title: s.title, categories: s.categories, score: s.score,
      correct: s.correctCount, wrong: s.wrongCount, skipped: s.skippedCount,
      total: s.questions.length, duration: s.durationMinutes, submittedAt: s.submittedAt
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;