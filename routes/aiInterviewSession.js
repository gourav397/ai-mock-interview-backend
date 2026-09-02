const express = require("express");
const QuestionBank = require("../models/QuestionBank");
const InterviewSession = require("../models/InterviewSession");
const { callJSON } = require("../utils/aiChat");
const { getUser } = require("../utils/reqUser");

const router = express.Router();
// ⭐ PUBLIC categories route — frontend isi ko call karta hai
router.get("/categories", (req, res) => {
  res.json({
    categories: [
      "Haryana GK", "General Knowledge", "Reasoning", "Current Affairs",
  "Indian History", "Indian Polity", "Geography", "Science",
  "Computer", "Python", "Cyber Security", "AI & Machine Learning",
  "SSC", "UPSC", "Railway", "Banking", "Defence",
  "General Hindi", "General Science", "Mathematics", "Haryana History", "Haryana Geography",
"Haryana Polity", "Haryana Economy", "Haryana Culture & Heritage",
"Haryana Environment", "Haryana Literature", "English"
    ]
  });
});

const DEFAULT_TOTAL = 8;

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

function normalizeDifficulty(d) {
  const s = (d || "Medium").trim();
  if (!s) return "Medium";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function pickQuestion(questions, excludeKeys) {
  const pool = shuffle(questions.filter((q) => !excludeKeys.has(qKey(q))));
  return pool[0] || shuffle(questions)[0] || null;
}

function requireUser(req, res) {
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return null;
  }
  return user;
}

// ---------- START ----------
router.post("/start", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { category, difficulty = "Medium", count } = req.body;
    if (!category) return res.status(400).json({ message: "Category required" });

    const diff = normalizeDifficulty(difficulty);
    const total = Math.min(Math.max(parseInt(count, 10) || DEFAULT_TOTAL, 3), 15);

    const bank = await QuestionBank.findOne({ category, difficulty: diff });
    const questions = bank?.questions || [];

    if (!questions.length) {
      return res.status(409).json({ message: "Bank abhi ready nahi hai — thodi der baad try karo" });
    }

    // 1 user ka 1 hi ongoing session
    await InterviewSession.updateMany(
      { user: user._id, status: "ongoing" },
      { $set: { status: "abandoned" } }
    );

    const session = await InterviewSession.create({
      user: user._id,
      category,
      difficulty: diff,
      totalQuestions: total
    });

    const first = pickQuestion(questions, new Set());
    session.messages.push({ role: "ai", question: first.question });
    await session.save();

    res.json({
      sessionId: session._id,
      question: first.question,
      questionNumber: 1,
      totalQuestions: total,
      category,
      difficulty: diff
    });
  } catch (e) {
    console.log("INTERVIEW SESSION START ERROR:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ---------- RESPOND (answer do → evaluation + agla question) ----------
router.post("/respond", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { sessionId, answer } = req.body;
    if (!sessionId || !answer) return res.status(400).json({ message: "sessionId aur answer required" });

    const session = await InterviewSession.findOne({ _id: sessionId, user: user._id });
    if (!session) return res.status(404).json({ message: "Session nahi mila" });
    if (session.status !== "ongoing") return res.status(400).json({ message: "Session khatam ho chuka hai" });

    const lastMsg = session.messages[session.messages.length - 1];
    const currentQuestion = lastMsg?.question || "";

    session.messages.push({ role: "user", answer });

    const context = session.messages.slice(-4)
      .map((m) => (m.role === "ai" ? `Q: ${m.question}` : `A: ${m.answer}`))
      .join("\n");

    const isLast = session.answeredQuestions + 1 >= session.totalQuestions;

    const prompt = `
Ek AI mock interview ho raha hai.
Category: ${session.category}
Difficulty: ${session.difficulty}

Ab tak ka conversation:
${context}

Abhi ka question: ${currentQuestion}
User ka answer: ${answer}

${isLast ? "Ye LAST question tha — sirf evaluation do, nextQuestion empty rakho."
          : "Ab ek FOLLOW-UP question do jo user ke answer ke hisab se ho (uski galti ya strength ke aas-paas)."}

Return sirf JSON:
{
  "score": 0-10,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "suggestedAnswer": "best answer (English / Hindi)",
  "nextQuestion": "${isLast ? "" : "agla question (English / Hindi format)"}"
}`;

    let result;
    try {
      result = await callJSON(prompt, { temperature: 0.5, maxTokens: 1024 });
    } catch (e) {
      // Gemini down/quota → interview kabhi stuck nahi hoga, bank se next question
      console.log("⚠️ Gemini fail — bank se next question:", e.message);
      const bank = await QuestionBank.findOne({ category: session.category, difficulty: session.difficulty });
      const askedKeys = new Set(session.messages.filter((m) => m.question).map((m) => qKey(m)));
      const next = pickQuestion(bank?.questions || [], askedKeys);
      result = {
        score: 5,
        strengths: ["Question attempt kiya"],
        weaknesses: ["AI evaluation abhi unavailable"],
        suggestedAnswer: "",
        nextQuestion: next ? next.question : ""
      };
    }

    const score = Math.min(Math.max(parseInt(result.score, 10) || 5, 0), 10);

    session.messages.push({
      role: "ai",
      question: result.nextQuestion || "",
      feedback: {
        score,
        strengths: Array.isArray(result.strengths) ? result.strengths : [],
        weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
        suggestedAnswer: result.suggestedAnswer || ""
      }
    });

    session.answeredQuestions += 1;

    let finalScore = null;
    if (isLast) {
      const scores = session.messages
        .filter((m) => m.feedback && m.feedback.score != null)
        .map((m) => m.feedback.score);
      finalScore = scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : 0;
      session.finalScore = finalScore;
      session.status = "completed";
      session.completedAt = new Date();
    }

    await session.save();

    const fb = session.messages[session.messages.length - 1].feedback;
    res.json({
      feedback: fb,
      nextQuestion: result.nextQuestion || null,
      questionNumber: session.answeredQuestions + 1,
      totalQuestions: session.totalQuestions,
      isFinished: isLast,
      finalScore
    });
  } catch (e) {
    console.log("INTERVIEW SESSION RESPOND ERROR:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ---------- FINISH (beech mein khatam karna ho) ----------
router.post("/finish", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const { sessionId } = req.body;
    const session = await InterviewSession.findOne({ _id: sessionId, user: user._id });
    if (!session) return res.status(404).json({ message: "Session nahi mila" });
    if (session.status === "completed") return res.json({ session });

    const scores = session.messages
      .filter((m) => m.feedback && m.feedback.score != null)
      .map((m) => m.feedback.score);
    session.finalScore = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;
    session.status = "completed";
    session.completedAt = new Date();
    await session.save();
    res.json({ session });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- HISTORY ----------
router.get("/history", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const sessions = await InterviewSession.find({ user: user._id, status: "completed" })
      .sort({ completedAt: -1 })
      .limit(20)
      .lean();
    res.json(sessions.map((s) => ({
      id: s._id,
      category: s.category,
      difficulty: s.difficulty,
      score: s.finalScore,
      totalQuestions: s.totalQuestions,
      answered: s.answeredQuestions,
      completedAt: s.completedAt
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- SESSION DETAIL (review ke liye) ----------
router.get("/:sessionId", async (req, res) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;

    const session = await InterviewSession.findOne({ _id: req.params.sessionId, user: user._id });
    if (!session) return res.status(404).json({ message: "Session nahi mila" });
    res.json(session);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;