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
const warming = new Map();

function shuffle(arr) {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function qKey(q) {
  return String(q?.question || "")
    .split(" / ")[0]
    .trim()
    .toLowerCase();
}

function normalizeDifficulty(d) {
  const s = String(d || "Medium").trim();

  if (!s) return "Medium";

  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isBankFresh(bank) {
  if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
    return false;
  }

  const updatedAt = new Date(bank.updatedAt).getTime();

  return (
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt < BANK_TTL_MS
  );
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
    `The user's selected category is "${selectedCategory}".`,
    `Generate questions strictly relevant to "${selectedCategory}".`,
    "Do not change the selected category.",
    "Do not invent facts or make ambiguous questions.",
    "Return valid multiple-choice questions with exactly four options.",
    "Every question must have one correct answer matching an option exactly.",
  ].join(" ");

  if (technical && stack) {
    hint += ` Technical stack: ${stack}.`;
  }

  if (exp) {
    hint += ` Candidate experience level: ${exp}.`;
  }

  if (!technical) {
    hint +=
      " This is not a technical programming interview unless the selected category explicitly requires it. Ignore unrelated technology stack values.";
  }

  return hint;
}

async function warmCategory(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const key = `warm-${category}-${diff}`;

  if (warming.has(key)) {
    return warming.get(key);
  }

  const job = (async () => {
    try {
      const existing = await QuestionBank.findOne({
        category,
        difficulty: diff,
      });

      if (
        existing &&
        Array.isArray(existing.questions) &&
        existing.questions.length >= 50
      ) {
        console.log(
          `✅ ${category}/${diff} bank ready (${existing.questions.length})`
        );

        return existing.questions.length;
      }

      console.log(`🌡️ Warm: ${category}/${diff} ...`);

      const questions = await withGenLock(() =>
        generateBank(category, diff, 150)
      );

      if (!Array.isArray(questions) || questions.length === 0) {
        console.warn(`⚠️ Warm produced no questions: ${category}/${diff}`);
        return 0;
      }

      await QuestionBank.findOneAndUpdate(
        { category, difficulty: diff },
        {
          $set: {
            questions,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      console.log(
        `✅ Warm done: ${category}/${diff} (${questions.length})`
      );

      return questions.length;
    } catch (e) {
      console.error(`❌ Warm fail ${category}/${diff}:`, e.message);
      return 0;
    } finally {
      warming.delete(key);
    }
  })();

  warming.set(key, job);

  return job;
}

function warmMixCategory(category) {
  for (const difficulty of PRACTICE_DIFFICULTIES) {
    warmCategory(category, difficulty).catch(() => {});
  }
}

async function refreshBankInBackground(category, difficulty = "Medium") {
  const diff = normalizeDifficulty(difficulty);
  const key = `refresh-${category}-${diff}`;

  if (warming.has(key)) return;

  const job = (async () => {
    try {
      console.log(`♻️ Refreshing bank: ${category}/${diff}`);

      const questions = await withGenLock(() =>
        generateBank(category, diff, 150)
      );

      if (!Array.isArray(questions) || questions.length === 0) {
        console.warn(`⚠️ Refresh returned no questions: ${category}/${diff}`);
        return;
      }

      const existing = await QuestionBank.findOne({
        category,
        difficulty: diff,
      });

      const oldQuestions = Array.isArray(existing?.questions)
        ? existing.questions
        : [];

      const seen = new Set(oldQuestions.map(qKey));

      const uniqueNew = questions.filter((q) => {
        const key = qKey(q);

        if (!key || seen.has(key)) return false;

        seen.add(key);
        return true;
      });

      const merged = [...oldQuestions, ...uniqueNew];

      await QuestionBank.findOneAndUpdate(
        { category, difficulty: diff },
        {
          $set: {
            questions: merged,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      console.log(
        `✅ Refresh done: ${category}/${diff}; total=${merged.length}`
      );
    } catch (e) {
      console.error(`❌ Refresh fail ${category}/${diff}:`, e.message);
    } finally {
      warming.delete(key);
    }
  })();

  warming.set(key, job);

  return job;
}

async function getMixBank(category) {
  const banks = await QuestionBank.find({
    category,
    difficulty: { $in: PRACTICE_DIFFICULTIES },
  });

  const all = [];

  banks.forEach((bank) => {
    if (Array.isArray(bank.questions)) {
      all.push(...bank.questions);
    }
  });

  const seen = new Set();

  const unique = all.filter((q) => {
    const key = qKey(q);

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  return sanitizeBank(unique);
}

async function expandBank(category, difficulty = "Medium", targetSize = 150) {
  const diff = normalizeDifficulty(difficulty);

  if (warming.has(`refresh-${category}-${diff}`)) {
    return;
  }

  const bank = await QuestionBank.findOne({
    category,
    difficulty: diff,
  });

  const existing = sanitizeBank(
    Array.isArray(bank?.questions) ? bank.questions : []
  );

  const existingKeys = new Set(existing.map(qKey));
  const need = targetSize - existing.length;

  if (need <= 0) return existing.length;

  console.log(
    `🌱 Expand ${category}/${diff}: generating up to ${need} questions`
  );

  try {
    const fresh = await withGenLock(() =>
      generateBank(category, diff, Math.min(need, 50))
    );

    const unique = (Array.isArray(fresh) ? fresh : []).filter((q) => {
      const key = qKey(q);

      if (!key || existingKeys.has(key)) return false;

      existingKeys.add(key);
      return true;
    });

    const merged = [...existing, ...unique];

    if (merged.length > 0) {
      await QuestionBank.findOneAndUpdate(
        { category, difficulty: diff },
        { $set: { questions: merged } },
        { upsert: true, new: true }
      );
    }

    console.log(
      `✅ Bank ${category}/${diff} now contains ${merged.length} questions`
    );

    return merged.length;
  } catch (e) {
    console.error(`❌ Expand fail ${category}/${diff}:`, e.message);
    return existing.length;
  }
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
    } catch (e) {
      // Another simultaneous request may have created the record.
      record = await SeenQuestions.findOne({
        user: userId,
        category,
      });

      if (!record) throw e;
    }
  }

  return record;
}

function chooseQuestions(pool, finalCount, seenSet) {
  const validPool = sanitizeBank(Array.isArray(pool) ? pool : []);
  const uniquePool = [];
  const uniqueKeys = new Set();

  for (const q of validPool) {
    const key = qKey(q);

    if (!key || uniqueKeys.has(key)) continue;

    uniqueKeys.add(key);
    uniquePool.push(q);
  }

  const available = uniquePool.filter((q) => !seenSet.has(qKey(q)));
  let picked = shuffle(available).slice(0, finalCount);
  let repeats = [];

  if (picked.length < finalCount) {
    const remainingNeeded = finalCount - picked.length;

    repeats = shuffle(
      uniquePool.filter((q) => seenSet.has(qKey(q)))
    ).slice(0, remainingNeeded);

    picked = [...picked, ...repeats];
  }

  return {
    picked,
    repeats,
    bankSize: uniquePool.length,
  };
}

// GET /api/ai-interview/generate
router.get("/generate", async (req, res) => {
  const startedAt = Date.now();

  try {
    const {
      category,
      difficulty,
      count,
      techStack,
      experience,
    } = req.query;

    const requestedCategory = String(category || "").trim();

    if (!requestedCategory) {
      return res.status(400).json({
        success: false,
        code: "CATEGORY_REQUIRED",
        message: "Category required",
      });
    }

    const finalCount = Math.min(
      Math.max(parseInt(count, 10) || 50, 1),
      50
    );

    const rawDiff = String(difficulty || "").trim();

    const isMixMode =
      !rawDiff || ["mix", "all"].includes(rawDiff.toLowerCase());

    const diff = isMixMode ? null : normalizeDifficulty(rawDiff);

    if (
      !isMixMode &&
      !["Easy", "Medium", "Hard"].includes(diff)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_DIFFICULTY",
        message: "Difficulty must be Easy, Medium, Hard, or Mix.",
      });
    }

    let pool = [];
    let servedDifficulty = diff || "Mix";
    let fromBank = false;

    if (isMixMode) {
      const mixQuestions = await getMixBank(requestedCategory);

      if (mixQuestions.length < 1) {
        // Start warming in the background, but don't block this request
        // for several minutes while trying to create a complete bank.
        warmMixCategory(requestedCategory);

        console.warn(
          `[AI-INTERVIEW] No practice bank for "${requestedCategory}"`
        );

        return res.status(503).json({
          success: false,
          code: "PRACTICE_BANK_NOT_READY",
          message:
            "Question bank is being prepared. Please retry shortly, or start an interview using a specific difficulty.",
          category: requestedCategory,
          difficulty: "Mix",
          requested: finalCount,
          generated: 0,
        });
      }

      const banks = await QuestionBank.find({
        category: requestedCategory,
        difficulty: { $in: PRACTICE_DIFFICULTIES },
      });

      banks.forEach((bank) => {
        if (!isBankFresh(bank)) {
          refreshBankInBackground(
            requestedCategory,
            bank.difficulty
          ).catch(() => {});
        }
      });

      pool = mixQuestions;
      servedDifficulty = "Mix";
      fromBank = true;
    } else {
      const bank = await QuestionBank.findOne({
        category: requestedCategory,
        difficulty: diff,
      });

      const bankQuestions = sanitizeBank(
        Array.isArray(bank?.questions) ? bank.questions : []
      );

      if (bankQuestions.length >= finalCount) {
        pool = bankQuestions;
        servedDifficulty = diff;
        fromBank = true;

        if (!isBankFresh(bank)) {
          refreshBankInBackground(requestedCategory, diff).catch(
            () => {}
          );
        }

        console.log(
          `⚡ Interview cache HIT: ${requestedCategory}/${diff} (${pool.length})`
        );
      } else if (bankQuestions.length >= 5) {
        // Preserve an existing usable bank rather than risking losing it
        // because a fresh Gemini request is temporarily unavailable.
        pool = bankQuestions;
        servedDifficulty = diff;
        fromBank = true;

        console.log(
          `⚡ Partial bank: ${pool.length} questions for ${requestedCategory}/${diff}`
        );

        expandBank(requestedCategory, diff, 150).catch(() => {});
      } else {
        console.log(
          `⚡ Generating ${finalCount} questions for "${requestedCategory}" / ${diff}`
        );

        const extraHint = buildExtraHint(
          requestedCategory,
          techStack,
          experience
        );

        let freshQuestions = [];

        try {
          freshQuestions = await generateInterviewQuestions(
            requestedCategory,
            diff,
            finalCount,
            extraHint
          );

          freshQuestions = sanitizeBank(
            Array.isArray(freshQuestions) ? freshQuestions : []
          );

          // One valid question is better than discarding partial success.
          if (freshQuestions.length > 0) {
            const existingKeys = new Set(bankQuestions.map(qKey));
            const merged = [...bankQuestions];

            for (const q of freshQuestions) {
              const key = qKey(q);

              if (key && !existingKeys.has(key)) {
                existingKeys.add(key);
                merged.push(q);
              }
            }

            // Keep old valid questions and add newly generated ones.
            QuestionBank.findOneAndUpdate(
              { category: requestedCategory, difficulty: diff },
              {
                $set: {
                  questions: merged,
                  updatedAt: new Date(),
                },
              },
              { upsert: true, new: true }
            ).catch((e) => {
              console.error(
                "[AI-INTERVIEW] Bank save failed:",
                e.message
              );
            });

            pool = merged;
            servedDifficulty = diff;
            fromBank = bankQuestions.length > 0;

            console.log(
              `✅ Generation returned ${freshQuestions.length} valid questions; pool=${pool.length}`
            );
          } else {
            throw new Error(
              "Generator returned zero valid questions after validation"
            );
          }
        } catch (genError) {
          console.error(
            `[AI-INTERVIEW GENERATION FAILED] category="${requestedCategory}" difficulty="${diff}" requested=${finalCount}`,
            genError?.stack || genError?.message || genError
          );

          // If Gemini failed, use every valid question already in the bank.
          if (bankQuestions.length > 0) {
            pool = bankQuestions;
            servedDifficulty = diff;
            fromBank = true;

            console.warn(
              `⚠️ Fallback: serving ${pool.length} existing questions`
            );
          } else {
            return res.status(503).json({
              success: false,
              code: "QUESTION_GENERATION_UNAVAILABLE",
              message:
                "AI could not generate valid questions for this category right now. Please retry shortly.",
              category: requestedCategory,
              difficulty: diff,
              requested: finalCount,
              generated: 0,
            });
          }
        }
      }
    }

    pool = sanitizeBank(Array.isArray(pool) ? pool : []);

    if (pool.length === 0) {
      return res.status(503).json({
        success: false,
        code: "NO_VALID_QUESTIONS",
        message:
          "No valid questions are currently available for this category. Please retry shortly.",
        category: requestedCategory,
        difficulty: servedDifficulty,
        requested: finalCount,
        generated: 0,
      });
    }

    const userId =
      req.user?._id?.toString() ||
      req.user?.id?.toString() ||
      `anon:${req.ip || "unknown"}`;

    const seenRec = await getSeenRecord(userId, requestedCategory);
    const seenSet = new Set(seenRec?.seen || []);

    const {
      picked,
      repeats,
      bankSize,
    } = chooseQuestions(pool, finalCount, seenSet);

    if (picked.length === 0) {
      return res.status(503).json({
        success: false,
        code: "NO_SELECTABLE_QUESTIONS",
        message:
          "Questions are temporarily unavailable. Please retry shortly.",
        category: requestedCategory,
        difficulty: servedDifficulty,
        requested: finalCount,
        generated: 0,
      });
    }

    const keys = picked.map(qKey).filter(Boolean);

    const mergedSeen = [
      ...new Set([...(seenRec?.seen || []), ...keys]),
    ].slice(-500);

    await SeenQuestions.updateOne(
      { _id: seenRec._id },
      {
        $set: {
          seen: mergedSeen,
          updatedAt: new Date(),
        },
      }
    );

    if (picked.length < finalCount) {
      console.warn(
        `[AI-INTERVIEW] Partial response: requested=${finalCount} returned=${picked.length} category="${requestedCategory}" difficulty="${servedDifficulty}"`
      );

      if (!isMixMode) {
        expandBank(requestedCategory, diff, 150).catch(() => {});
      }
    }

    console.log(
      `✅ Questions served: category="${requestedCategory}" difficulty="${servedDifficulty}" returned=${picked.length}/${finalCount} repeats=${repeats.length} bankSize=${bankSize} elapsedMs=${Date.now() - startedAt}`
    );

    return res.json({
      success: true,
      category: requestedCategory,
      difficulty: servedDifficulty,
      total: picked.length,
      requested: finalCount,
      questions: picked,
      fromBank,
      repeats: repeats.length,
      bankSize,
      partial: picked.length < finalCount,
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

// GET /api/ai-interview/bank-status
router.get("/bank-status", async (req, res) => {
  try {
    const banks = await QuestionBank.find({}).lean();

    return res.json(
      banks.map((bank) => ({
        category: bank.category,
        difficulty: bank.difficulty,
        questions: bank.questions?.length || 0,
        ageHours: Math.round(
          (Date.now() - new Date(bank.updatedAt).getTime()) /
            3600000
        ),
      }))
    );
  } catch (e) {
    console.error("[BANK STATUS ERROR]", e.message);

    return res.status(500).json({
      success: false,
      message: "Could not load bank status.",
    });
  }
});

module.exports = router;