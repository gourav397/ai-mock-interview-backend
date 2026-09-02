const express = require("express");
const UserProgress = require("../models/UserProgress");
const { getUser } = require("../utils/reqUser");

const router = express.Router();

// IST date (India) — streak midnight IST se reset hota hai
function istDateStr(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function levelFromXp(xp) {
  return Math.floor(xp / 100) + 1;
}

async function getOrCreate(userId) {
  let p = await UserProgress.findOne({ user: userId });
  if (!p) p = await UserProgress.create({ user: userId });
  return p;
}

// ---------- RECORD: practice/interview ke baad bhejo ----------
router.post("/record", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });

    const { correct = 0, attempted = 0, interview = false, score = 0 } = req.body || {};

    let p = await getOrCreate(user._id);
    const today = istDateStr();

    // STREAK: aaj pehli activity hai to update karo
    if (p.lastActiveDate !== today) {
      const yesterday = istDateStr(new Date(Date.now() - 86400000));
      p.streak = p.lastActiveDate === yesterday ? p.streak + 1 : 1;
      p.lastActiveDate = today;
    }

    // XP: +5/correct, +2/attempted, interview +25 + score bonus
    let gained = correct * 5 + attempted * 2;
    if (interview) gained += 25 + Math.round(score);
    p.xp += gained;

    if (interview) {
      p.totalInterviews += 1;
      if (score > p.bestScore) p.bestScore = score;
    }
    p.totalCorrect += correct;
    p.totalAttempted += attempted;

    // aaj ka history entry
    const day = p.history.find((h) => h.date === today);
    if (day) {
      day.questionsAttempted += attempted;
      day.questionsCorrect += correct;
      if (interview) day.interviewsTaken += 1;
    } else {
      p.history.push({
        date: today,
        questionsAttempted: attempted,
        questionsCorrect: correct,
        interviewsTaken: interview ? 1 : 0
      });
    }
    if (p.history.length > 90) p.history = p.history.slice(-90);

    p.level = levelFromXp(p.xp);
    await p.save();

    res.json({ xp: p.xp, level: p.level, streak: p.streak, gained });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- MY STATS (dashboard ke liye) ----------
router.get("/me", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });

    const p = await getOrCreate(user._id);
    res.json({
      xp: p.xp,
      level: p.level,
      streak: p.streak,
      bestScore: p.bestScore,
      totalInterviews: p.totalInterviews,
      accuracy: p.totalAttempted
        ? Math.round((p.totalCorrect / p.totalAttempted) * 100)
        : 0,
      history: p.history.slice(-30)
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- LEADERBOARD (top 50) ----------
router.get("/leaderboard", async (req, res) => {
  try {
    const top = await UserProgress.find()
      .sort({ xp: -1 })
      .limit(50)
      .populate("user", "name email")
      .lean();

    res.json(top.map((p, i) => ({
      rank: i + 1,
      name: p.user?.name || p.user?.email || "Anonymous",
      xp: p.xp,
      level: p.level,
      streak: p.streak
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- DAILY CHECK-IN (Snapchat-style streak) ----------
router.post("/checkin", async (req, res) => {
  try {
    const user = getUser(req);
    if (!user) return res.status(401).json({ message: "Login required" });

    let p = await UserProgress.findOne({ user: user._id });
    if (!p) p = await UserProgress.create({ user: user._id });

    const today = istDateStr();
    if (p.lastCheckIn === today) {
      return res.json({ already: true, streak: p.streak, xp: p.xp, message: "Aaj ka check-in ho chuka hai — kal phir aana! 🔥" });
    }

    const yesterday = istDateStr(new Date(Date.now() - 86400000));
    p.streak = p.lastActiveDate === yesterday ? p.streak + 1 : 1;
    p.lastActiveDate = today;
    p.lastCheckIn = today;
    p.xp += 10;
    p.level = levelFromXp(p.xp);
    await p.save();

    res.json({ already: false, streak: p.streak, xp: p.xp, gained: 10, message: `🔥 ${p.streak} din ki streak! +10 XP` });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
module.exports = router;