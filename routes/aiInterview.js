
const express = require("express");
const {
  generateBank,
  generateInterviewQuestions,
} = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");
const SeenQuestions = require("../models/SeenQuestions");
const { sanitizeBank } = require("../utils/questionSanitizer");

const router = express.Router();

const PRACTICE_DIFFICULTIES = ["Medium", "Hard"];
const BANK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUESTIONS = 50;
const warming = new Map();

function shuffle(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function qKey(question) {
  return String(question?.question || "")
    .split(" / ")[0]
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueQuestions(questions) {
  const clean = sanitizeBank(Array.isArray(questions) ? questions : []);
  const seen = new Set();
  const result = [];

  for (const question of clean) {
    const key = qKey(question);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(question);
  }

  return result;
}

function normalizeDifficulty(value) {
  const text = String(value || "Medium").trim();
  if (!text) return "Medium";

  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function isBankFresh(bank) {
  if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
    return false;
  }

  const updatedAt = new Date(bank.updatedAt).getTime();

  return Number.isFinite(updatedAt) &&
    Date.now() - updatedAt < BANK_TTL_MS;
}

function isTechnicalCategory(category) {
  return /\b(react|javascript|typescript|node|python|java|programming|coding|software|web development|frontend|backend|full.?stack|database|sql|cyber.?security|networking|cloud|aws|azure|devops|data science|machine learning|technical|computer science|computer programming|artificial intelligence|ai.?ml)\b/i.test(
    String(category || "")
  );
}

function buildExtraHint(category, techStack, experience) {
  const selectedCategory = String(category || "").trim();
  const stack = String(techStack || "").trim();
  const exp = String(experience || "").trim();
  const technical = isTechnicalCategory(selectedCategory);

  let hint = [
    `The user's requested category is exactly "${selectedCategory}".`,
    `Generate every question strictly about "${selectedCategory}".`,
    "The category may be any subject, topic, profession, exam, skill, hobby, or niche, including a category that does not exist in any stored question bank.",
    "Never substitute a different category just because the requested category is unfamiliar.",
    "Do not ask the user to choose from a predefined category list.",
    "Generate original, accurate, non-duplicate multiple-choice questions.",
    "Every question must have exactly four options and one unambiguous correct answer matching an option.",
    "Return the same question format and bilingual English/Hindi style expected by the application.",
  ].join(" ");

  if (technical && stack) {
    hint += ` Relevant technical stack: ${stack}.`;
  }

  if (exp) {
    hint += ` Candidate experience level: ${exp}.`;
  }

  if (!technical) {
    hint +=
      " Ignore unrelated technology-stack values. Do not turn a non-technical subject into a programming interview.";
  }

  return hint;
}

async function saveBank(category, difficulty, questions) {
  const incoming = uniqueQuestions(questions);
  if (!incoming.length) return [];

  const existingBank = await QuestionBank.findOne({
    category,
    difficulty,
  });

  const existing = uniqueQuestions(existingBank?.questions || []);
  const seen = new Set(existing.map(qKey));
  const additions = incoming.filter((question) => {
    const key = qKey(question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const merged = [...existing, ...additions];

  if (merged.length) {
    await QuestionBank.findOneAndUpdate(
      { category, difficulty },
      {
        $set: {
          questions: merged,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  }

  return merged;
}

async function generateAndSave(category, difficulty, count, extraHint = "") {
  const amount = Math.min(Math.max(Number(count) || 1, 1), MAX_QUESTIONS);

  console.log(
    `[AI-INTERVIEW] AI generation started: category="${category}" difficulty="${difficulty}" count=${amount}`
  );

  const generated = await withGenLock(() =>
    generateInterviewQuestions(category, difficulty, amount, extraHint)
  );

  const valid = uniqueQuestions(generated);

  console.log(
    `[AI-INTERVIEW] AI generation finished: category="${category}" difficulty="${difficulty}" requested=${amount} valid=${valid.length}`
  );

  if (!valid.length) {
    throw new Error(
      `AI returned zero valid questions for category "${category}" and difficulty "${difficulty}".`
    );
  }

  return saveBank(category, difficulty, valid);
}

async function warmCategory(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const lockKey = `warm-${category}-${diff}`;

  if (warming.has(lockKey)) return warming.get(lockKey);

  const job = (async () => {
    try {
      const existing = await QuestionBank.findOne({
        category,
        difficulty: diff,
      });

      if (uniqueQuestions(existing?.questions || []).length >= 50) {
        return existing.questions.length;
      }

      console.log(`[AI-INTERVIEW] Background warm: ${category}/${diff}`);

      const merged = await generateAndSave(
        category,
        diff,
        50,
        buildExtraHint(category, "", "")
      );

      return merged.length;
    } catch (error) {
      console.error(
        `[AI-INTERVIEW] Background warm failed ${category}/${diff}:`,
        error.message
      );
      return 0;
    } finally {
      warming.delete(lockKey);
    }
  })();

  warming.set(lockKey, job);
  return job;
}

function warmMixCategory(category) {
  for (const difficulty of PRACTICE_DIFFICULTIES) {
    warmCategory(category, difficulty).catch(() => {});
  }
}

async function refreshBankInBackground(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const lockKey = `refresh-${category}-${diff}`;

  if (warming.has(lockKey)) return;

  const job = (async () => {
    try {
      console.log(`[AI-INTERVIEW] Background refresh: ${category}/${diff}`);

      await generateAndSave(
        category,
        diff,
        30,
        buildExtraHint(category, "", "")
      );
    } catch (error) {
      console.error(
        `[AI-INTERVIEW] Background refresh failed ${category}/${diff}:`,
        error.message
      );
    } finally {
      warming.delete(lockKey);
    }
  })();

  warming.set(lockKey, job);
  return job;
}

async function getMixBank(category) {
  const banks = await QuestionBank.find({
    category,
    difficulty: { $in: PRACTICE_DIFFICULTIES },
  });

  return uniqueQuestions(
    banks.flatMap((bank) =>
      Array.isArray(bank.questions) ? bank.questions : []
    )
  );
}

async function expandBank(category, difficulty = "Medium", targetSize = 150) {
  const diff = normalizeDifficulty(difficulty);
  const lockKey = `expand-${category}-${diff}`;

  if (warming.has(lockKey)) return;

  const job = (async () => {
    try {
      const bank = await QuestionBank.findOne({
        category,
        difficulty: diff,
      });

      const existing = uniqueQuestions(bank?.questions || []);
      const needed = Math.min(targetSize - existing.length, 30);

      if (needed <= 0) return;

      console.log(
        `[AI-INTERVIEW] Background expansion: category="${category}" difficulty="${diff}" need=${needed}`
      );

      await generateAndSave(
        category,
        diff,
        needed,
        buildExtraHint(category, "", "")
      );
    } catch (error) {
      console.error(
        `[AI-INTERVIEW] Background expansion failed ${category}/${diff}:`,
        error.message
      );
    } finally {
      warming.delete(lockKey);
    }
  })();

  warming.set(lockKey, job);
  return job;
}

async function getSeenRecord(userId, category) {
  let record = await SeenQuestions.findOne({
    user: userId,
    category,
  });

  if (!record) {
    try {
      record = await SeenQuestions.create({
        user: userId,
        category,
        seen: [],
      });
    } catch (error) {
      record = await SeenQuestions.findOne({
        user: userId,
        category,
      });

      if (!record) throw error;
    }
  }

  return record;
}

function chooseQuestions(pool, count, seenSet) {
  const uniquePool = uniqueQuestions(pool);
  const unseen = uniquePool.filter((question) => !seenSet.has(qKey(question)));
  const previouslySeen = uniquePool.filter((question) => seenSet.has(qKey(question)));

  const picked = shuffle(unseen).slice(0, count);
  const repeats = [];

  if (picked.length < count) {
    const needed = count - picked.length;
    repeats.push(...shuffle(previouslySeen).slice(0, needed));
    picked.push(...repeats);
  }

  return {
    picked,
    repeats,
    bankSize: uniquePool.length,
  };
}

router.get("/generate", async (req, res) => {
  const startedAt = Date.now();

  try {
    const category = String(req.query.category || "").trim();
    const rawDifficulty = String(req.query.difficulty || "").trim();
    const techStack = String(req.query.techStack || "").trim();
    const experience = String(req.query.experience || "").trim();

    if (!category) {
      return res.status(400).json({
        success: false,
        code: "CATEGORY_REQUIRED",
        message: "Please provide a question category.",
      });
    }

    const requested = Math.min(
      Math.max(parseInt(req.query.count, 10) || 50, 1),
      MAX_QUESTIONS
    );

    const mixMode =
      !rawDifficulty || ["mix", "all"].includes(rawDifficulty.toLowerCase());

    const difficulty = mixMode ? null : normalizeDifficulty(rawDifficulty);

    if (
      !mixMode &&
      !["Easy", "Medium", "Hard"].includes(difficulty)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_DIFFICULTY",
        message: "Difficulty must be Easy, Medium, Hard, or Mix.",
      });
    }

    const extraHint = buildExtraHint(category, techStack, experience);
    let pool = [];
    let servedDifficulty = difficulty || "Mix";
    let fromBank = false;

    if (mixMode) {
      pool = await getMixBank(category);

      if (pool.length < requested) {
        warmMixCategory(category);

        if (pool.length === 0) {
          return res.status(503).json({
            success: false,
            code: "PRACTICE_BANK_NOT_READY",
            message:
              "This category's practice bank is being prepared. Choose Easy, Medium, or Hard to generate questions directly with AI, or retry shortly.",
            category,
            difficulty: "Mix",
            requested,
            generated: 0,
          });
        }
      }

      const banks = await QuestionBank.find({
        category,
        difficulty: { $in: PRACTICE_DIFFICULTIES },
      });

      for (const bank of banks) {
        if (!isBankFresh(bank)) {
          refreshBankInBackground(category, bank.difficulty).catch(() => {});
        }
      }

      fromBank = true;
    } else {
      const bank = await QuestionBank.findOne({
        category,
        difficulty,
      });

      const bankQuestions = uniqueQuestions(bank?.questions || []);

      if (bankQuestions.length >= requested) {
        pool = bankQuestions;
        fromBank = true;

        console.log(
          `[AI-INTERVIEW] Bank hit: category="${category}" difficulty="${difficulty}" bankSize=${pool.length}`
        );

        if (!isBankFresh(bank)) {
          refreshBankInBackground(category, difficulty).catch(() => {});
        }
      } else {
        /*
         * IMPORTANT:
         * Never return a small bank immediately just because it contains
         * five or more questions. First ask the AI to generate the requested
         * category and difficulty. This also works for categories that have
         * never existed in the database.
         */
        console.log(
          `[AI-INTERVIEW] Bank insufficient: category="${category}" difficulty="${difficulty}" existing=${bankQuestions.length} requested=${requested}; generating with AI`
        );

        try {
          const merged = await generateAndSave(
            category,
            difficulty,
            requested,
            extraHint
          );

          pool = uniqueQuestions(merged);
          fromBank = false;

          console.log(
            `[AI-INTERVIEW] Generated/merged pool: category="${category}" difficulty="${difficulty}" total=${pool.length}`
          );
        } catch (generationError) {
          console.error(
            `[AI-INTERVIEW] Generation failed: category="${category}" difficulty="${difficulty}"`,
            generationError?.stack || generationError?.message || generationError
          );

          // If AI is temporarily unavailable, preserve and serve valid bank data.
          pool = bankQuestions;
          fromBank = pool.length > 0;

          if (pool.length > 0) {
            console.warn(
              `[AI-INTERVIEW] Using bank fallback: category="${category}" difficulty="${difficulty}" questions=${pool.length}`
            );
          }
        }

        // Continue building the bank after returning a usable partial result.
        if (pool.length < requested) {
          expandBank(category, difficulty, 150).catch(() => {});
        }
      }
    }

    pool = uniqueQuestions(pool);

    if (!pool.length) {
      return res.status(503).json({
        success: false,
        code: "QUESTION_GENERATION_UNAVAILABLE",
        message:
          "AI could not generate valid questions for this category right now. Please retry shortly.",
        category,
        difficulty: servedDifficulty,
        requested,
        generated: 0,
      });
    }

    const userId =
      req.user?._id?.toString() ||
      req.user?.id?.toString() ||
      `anon:${req.ip || "unknown"}`;

    const seenRecord = await getSeenRecord(userId, category);
    const seenSet = new Set(seenRecord?.seen || []);

    const {
      picked,
      repeats,
      bankSize,
    } = chooseQuestions(pool, requested, seenSet);

    if (!picked.length) {
      return res.status(503).json({
        success: false,
        code: "NO_SELECTABLE_QUESTIONS",
        message: "No valid questions could be selected. Please retry.",
        category,
        difficulty: servedDifficulty,
        requested,
        generated: 0,
      });
    }

    const questionKeys = picked.map(qKey).filter(Boolean);
    const mergedSeen = [
      ...new Set([...(seenRecord?.seen || []), ...questionKeys]),
    ].slice(-500);

    await SeenQuestions.updateOne(
      { _id: seenRecord._id },
      {
        $set: {
          seen: mergedSeen,
          updatedAt: new Date(),
        },
      }
    );

    if (picked.length < requested) {
      console.warn(
        `[AI-INTERVIEW] Partial response: requested=${requested} returned=${picked.length} category="${category}" difficulty="${servedDifficulty}" pool=${pool.length}`
      );
    }

    console.log(
      `[AI-INTERVIEW] Questions served: category="${category}" difficulty="${servedDifficulty}" returned=${picked.length}/${requested} repeats=${repeats.length} bankSize=${bankSize} fromBank=${fromBank} elapsedMs=${Date.now() - startedAt}`
    );

    return res.json({
      success: true,
      category,
      difficulty: servedDifficulty,
      total: picked.length,
      requested,
      questions: picked,
      fromBank,
      repeats: repeats.length,
      bankSize,
      partial: picked.length < requested,
    });
  } catch (error) {
    console.error(
      "[AI GENERATE ERROR]",
      error?.stack || error?.message || error
    );

    if (res.headersSent) return;

    return res.status(500).json({
      success: false,
      code: "AI_GENERATE_ERROR",
      message: "Question generation request failed.",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(error?.message || error),
    });
  }
});

router.get("/bank-status", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}).lean();

    return res.json(
      banks.map((bank) => ({
        category: bank.category,
        difficulty: bank.difficulty,
        questions: Array.isArray(bank.questions) ? bank.questions.length : 0,
        ageHours: Math.round(
          (Date.now() - new Date(bank.updatedAt).getTime()) / 3600000
        ),
      }))
    );
  } catch (error) {
    console.error("[BANK STATUS ERROR]", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load bank status.",
    });
  }
});

module.exports = router;
