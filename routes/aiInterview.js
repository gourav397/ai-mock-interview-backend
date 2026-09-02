const express = require("express");
const { generateBank, generateInterviewQuestions } = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");
const SeenQuestions = require("../models/SeenQuestions");
const { sanitizeBank } = require("../utils/questionSanitizer");

const router = express.Router();

// ---------- CONFIG ----------
const PRACTICE_DIFFICULTIES = ["Medium", "Hard"];

// ---------- HELPERS ----------
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

// ---------- 24H BANK ROTATION ----------
const BANK_TTL_MS = 24 * 60 * 60 * 1000;

function isBankFresh(bank) {
  if (!bank || !bank.questions || !bank.questions.length) return false;
  return Date.now() - new Date(bank.updatedAt).getTime() < BANK_TTL_MS;
}

// ---------- WARM-UP (LAZY) ----------
const warming = new Map();

async function warmCategory(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const key = `warm-${category}-${diff}`;
  if (warming.has(key)) return warming.get(key);

  const job = (async () => {
    try {
      const existing = await QuestionBank.findOne({ category, difficulty: diff });
      if (existing && existing.questions.length >= 50) {
        console.log(`✅ ${category}/${diff} bank ready (${existing.questions.length})`);
        return existing.questions.length;
      }
      console.log(`🌡️ Warm: ${category}/${diff} ...`);
      const questions = await withGenLock(() => generateBank(category, diff, 150));
      await QuestionBank.findOneAndUpdate(
        { category, difficulty: diff },
        { questions, updatedAt: new Date() },
        { upsert: true }
      );
      console.log(`✅ Warm done: ${category}/${diff} (${questions.length})`);
      return questions.length;
    } catch (e) {
      console.log(`❌ Warm fail ${category}/${diff}:`, e.message);
      return 0;
    } finally {
      warming.delete(key);
    }
  })();

  warming.set(key, job);
  return job;
}

function warmMixCategory(category) {
  for (const d of PRACTICE_DIFFICULTIES) {
    warmCategory(category, d).catch(() => {});
  }
}

async function refreshBankInBackground(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const key = `refresh-${category}-${diff}`;
  if (warming.has(key)) return;

  const job = (async () => {
    console.log(`♻️ ${category}/${diff}: 24h ho gaya — naya bank ban raha hai...`);
    const questions = await withGenLock(() => generateBank(category, diff, 150));
    await QuestionBank.findOneAndUpdate(
      { category, difficulty: diff },
      { questions, updatedAt: new Date() },
      { upsert: true }
    );
    console.log(`✅ ${category}/${diff}: naya bank ready (${questions.length} q)`);
  })().catch((e) => console.log("Refresh fail:", e.message));

  warming.set(key, job);
  job.finally(() => warming.delete(key));
}

// ---------- MIX BANK (PRACTICE) ----------
async function getMixBank(category) {
  const banks = await QuestionBank.find({
    category,
    difficulty: { $in: PRACTICE_DIFFICULTIES }
  });
  const all = [];
  banks.forEach((b) => all.push(...(b.questions || [])));

  const seen = new Set();
  const unique = all.filter((q) => {
    const k = qKey(q);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return sanitizeBank(unique);
}

// ---------- BANK EXPAND ----------
async function expandBank(category, difficulty = "Medium", targetSize = 200) {
  const diff = normalizeDifficulty(difficulty);
  if (warming.has(`refresh-${category}-${diff}`)) return;

  const bank = await QuestionBank.findOne({ category, difficulty: diff });
  if (bank && bank.questions) bank.questions = sanitizeBank(bank.questions);
  const existing = bank?.questions || [];
  const existingKeys = new Set(existing.map(qKey));
  const need = targetSize - existing.length;
  if (need <= 0) return existing.length;

  console.log(`🌱 Expand ${category}/${diff}: +${need} aur generate ho rahe hain (background)...`);
  try {
    const fresh = await withGenLock(() => generateBank(category, diff, Math.min(need, 50)));
    const unique = fresh.filter((q) => !existingKeys.has(qKey(q)));
    const merged = [...existing, ...unique];
    await QuestionBank.findOneAndUpdate(
      { category, difficulty: diff },
      { questions: merged },
      { upsert: true }
    );
    console.log(`✅ Bank ${category}/${diff} ab ${merged.length} questions ka hai`);
    return merged.length;
  } catch (e) {
    console.log("Expand fail:", e.message);
    return existing.length;
  }
}

// ---------- GET /api/ai-interview/generate ----------
router.get("/generate", async (req, res) => {
  try {
    const { category, difficulty, count, techStack, experience } = req.query;
    if (!category) return res.status(400).json({ message: "Category required" });

    const finalCount = Math.min(Math.max(parseInt(count, 10) || 50, 1), 50);

    const rawDiff = (difficulty || "").trim();
    const isMixMode = !rawDiff || ["mix", "all"].includes(rawDiff.toLowerCase());
    const diff = isMixMode ? null : normalizeDifficulty(rawDiff);

    let pool;
    let servedDifficulty;

    if (isMixMode) {
      // ========== PRACTICE TEST: Medium + Hard ka MIX ==========
      const mixQuestions = await getMixBank(category);

      if (mixQuestions.length < 10) {
        warmMixCategory(category);
        return res.status(409).json({
          message: "Question bank bana raha hai (~2-3 min). 1 min baad Retry dabao — sirf pehli baar."
        });
      }

      const banks = await QuestionBank.find({
        category,
        difficulty: { $in: PRACTICE_DIFFICULTIES }
      });
      banks.forEach((b) => {
        if (!isBankFresh(b)) refreshBankInBackground(category, b.difficulty);
      });

      pool = mixQuestions;
      servedDifficulty = "Mix";
    } else {
      // ========== START INTERVIEW: selected difficulty ==========
      const bank = await QuestionBank.findOne({ category, difficulty: diff });

      if (bank && bank.questions.length >= finalCount) {
        // ✅ Bank has enough questions — serve immediately (1-3 seconds)
        pool = bank.questions;
        servedDifficulty = difficulty;

        if (!isBankFresh(bank)) refreshBankInBackground(category, diff);

        console.log(`⚡ Interview cache HIT: ${category}/${diff} (${bank.questions.length} questions)`);

      } else if (bank && bank.questions.length >= 5) {
        // ⚡ Partial bank — return what we have + background expansion
        pool = bank.questions;
        servedDifficulty = difficulty;
        console.log(`⚡ Partial bank: ${bank.questions.length} available, expanding in background`);

        expandBank(category, diff, 150).catch(() => {});

      } else {
        // 🔥 NO BANK / TOO SMALL — generate on-the-fly (fast mode, <10 seconds)
        console.log(`⚡ Fast-generating ${finalCount} questions for ${category}/${diff}...`);

        try {
          // Build extra hint from techStack + experience
          const ts = (techStack || "").trim();
          const exp = (experience || "").trim();
          let extraHint = "";
          if (ts) extraHint += `Tech Stack: ${ts}. `;
          if (exp) extraHint += `Experience Level: ${exp}. `;
          extraHint += "Generate interview questions relevant to this specific role, tech stack, and experience level.";

          // Fast generation — 15s internal timeout, parallel calls
          const freshQuestions = await generateInterviewQuestions(
            category, diff, finalCount, extraHint
          );

          if (freshQuestions.length >= Math.min(finalCount, 5)) {
            // Save to bank for future use (fire & forget)
            QuestionBank.findOneAndUpdate(
              { category, difficulty: diff },
              { questions: freshQuestions, updatedAt: new Date() },
              { upsert: true }
            ).catch(() => {});

            pool = freshQuestions;
            servedDifficulty = difficulty;
            console.log(`✅ Fast-gen served ${freshQuestions.length} questions for ${category}/${diff}`);

          } else {
            throw new Error(`Only ${freshQuestions.length} questions generated`);
          }
        } catch (genError) {
          console.log(`❌ Fast-gen failed: ${genError.message}`);

          // Final fallback — whatever bank has
          if (bank && bank.questions.length > 0) {
            pool = bank.questions;
            servedDifficulty = difficulty;
            console.log(`⚠️ Fallback: serving ${bank.questions.length} existing questions`);
          } else {
            return res.status(503).json({
              message: "Questions temporarily unavailable. Please try again in a moment."
            });
          }
        }
      }
    }

    // ---------- SEEN TRACKING ----------
    const userId = req.user?._id?.toString() || req.user?.id?.toString() || `anon:${req.ip || "unknown"}`;

    let seenRec = await SeenQuestions.findOne({ user: userId, category });
    if (!seenRec) {
      seenRec = await SeenQuestions.create({ user: userId, category, seen: [] });
    }
    const seenSet = new Set(seenRec.seen);

    const available = pool.filter((q) => !seenSet.has(qKey(q)));

    let picked, repeats = [];

    if (available.length >= finalCount) {
      picked = shuffle(available).slice(0, finalCount);
    } else {
      picked = [...shuffle(available)];
      const remainingNeeded = finalCount - picked.length;
      repeats = shuffle(pool.filter((q) => seenSet.has(qKey(q)))).slice(0, remainingNeeded);
      picked = [...picked, ...repeats];
      if (isMixMode) {
        PRACTICE_DIFFICULTIES.forEach((d) => expandBank(category, d, 150));
      } else {
        expandBank(category, diff, 150);
      }
    }

    const keys = picked.map(qKey);
    const mergedSeen = [...new Set([...seenRec.seen, ...keys])].slice(-500);
    await SeenQuestions.updateOne(
      { _id: seenRec._id },
      { $set: { seen: mergedSeen, updatedAt: new Date() } }
    );

    console.log(`⚡ ${picked.length} questions served (${repeats.length} repeats, mode: ${servedDifficulty}, user seen: ${mergedSeen.length})`);
    res.json({
      category,
      difficulty: servedDifficulty,
      total: picked.length,
      questions: picked,
      fromBank: true,
      repeats: repeats.length,
      bankSize: pool.length
    });
  } catch (error) {
    console.log("AI GENERATE ERROR:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// ---------- DEBUG: bank status ----------
router.get("/bank-status", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}).lean();
    res.json(banks.map((b) => ({
      category: b.category,
      difficulty: b.difficulty,
      questions: b.questions?.length || 0,
      ageHours: Math.round((Date.now() - new Date(b.updatedAt).getTime()) / 3600000)
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;