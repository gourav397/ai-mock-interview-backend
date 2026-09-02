require("dotenv").config();

const cron = require("node-cron");
const mongoose = require("mongoose");
const { generateBank, isQuotaExhausted } = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");
const SeenQuestions = require("../models/SeenQuestions");

// =====================================================
// NORMAL CATEGORIES
// =====================================================

const CATEGORIES = [
 "Haryana GK",
"General Knowledge",
"Current Affairs",
"Indian History",
"Indian Polity",
"Geography",
"Science",
"Computer",
"Python",
"Cyber Security",
"AI & Machine Learning",
"SSC",
"UPSC",
"Railway",
"Banking",
"Defence",
"Mathematics",
"Hindi",
"English",
"Haryana History",
"Haryana Geography",
"Haryana Polity",
"Haryana Economy",
"Haryana Culture & Heritage",
"Haryana Environment",
"Haryana Literature"

];

// =====================================================
// CLASS 11 + CLASS 12
// =====================================================

const CLASS_CATEGORIES = [
  // Class 11 Science
  "Class 11 Science - Physics",
  "Class 11 Science - Chemistry",
  "Class 11 Science - Biology",
  "Class 11 Science - Mathematics",
  "Class 11 Science - Computer Science",
  "Class 11 Science - English Core",

  // Class 11 Commerce
  "Class 11 Commerce - Accountancy",
  "Class 11 Commerce - Business Studies",
  "Class 11 Commerce - Economics",
  "Class 11 Commerce - Mathematics",
  "Class 11 Commerce - English Core",

  // Class 11 Humanities
  "Class 11 Humanities - History",
  "Class 11 Humanities - Geography",
  "Class 11 Humanities - Political Science",
  "Class 11 Humanities - Economics",
  "Class 11 Humanities - Psychology",
  "Class 11 Humanities - Sociology",
  "Class 11 Humanities - English Core",

  // Class 12 Science
  "Class 12 Science - Physics",
  "Class 12 Science - Chemistry",
  "Class 12 Science - Biology",
  "Class 12 Science - Mathematics",
  "Class 12 Science - Computer Science",
  "Class 12 Science - English Core",

  // Class 12 Commerce
  "Class 12 Commerce - Accountancy",
  "Class 12 Commerce - Business Studies",
  "Class 12 Commerce - Economics",
  "Class 12 Commerce - Mathematics",
  "Class 12 Commerce - English Core",

  // Class 12 Humanities
  "Class 12 Humanities - History",
  "Class 12 Humanities - Geography",
  "Class 12 Humanities - Political Science",
  "Class 12 Humanities - Economics",
  "Class 12 Humanities - Psychology",
  "Class 12 Humanities - Sociology",
  "Class 12 Humanities - English Core"
];

// =====================================================
// ALL CATEGORIES
// =====================================================

const ALL_CATEGORIES = [
  ...new Set([...CATEGORIES, ...CLASS_CATEGORIES])
];

// =====================================================
// DIFFICULTIES
// =====================================================

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

// Har category/difficulty par har 3 AM run me
// itne NEW questions add karne ki koshish hogi.
const ADD_PER_RUN = parseInt(
  process.env.ADD_PER_RUN || "50",
  10
);

// Gemini requests ke beech gap
const GAP_MS = parseInt(
  process.env.GAP_MS || "30000",
  10
);

// Cron: roz raat 3:00 AM India time
const CRON_SCHEDULE =
  process.env.CRON_SCHEDULE || "0 3 * * *";

const CRON_TZ =
  process.env.CRON_TZ || "Asia/Kolkata";

let running = false;

// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function qKey(q) {
  return (q?.question || "")
    .split(" / ")[0]
    .trim()
    .toLowerCase();
}

// =====================================================
// ADD QUESTIONS
// =====================================================

async function addQuestions(category, difficulty) {
  console.log("");
  console.log("======================================");
  console.log(`📚 ${category} | ${difficulty}`);
  console.log("======================================");

  const bank = await QuestionBank.findOne({
    category,
    difficulty
  });

  const oldQuestions = bank?.questions || [];

  console.log(
    `📦 Existing questions: ${oldQuestions.length}`
  );

  console.log(
    `🌱 Generating up to ${ADD_PER_RUN} new questions...`
  );

  let fresh = [];

  try {
    fresh = await withGenLock(() =>
      generateBank(
        category,
        difficulty,
        ADD_PER_RUN
      )
    );
  } catch (error) {
    console.log(
      `❌ Generation failed: ${category} | ${difficulty}`
    );
    console.log(error.message);
    return false;
  }

  if (!Array.isArray(fresh) || fresh.length === 0) {
    console.log(
      `⚠️ No questions generated: ${category} | ${difficulty}`
    );
    return true;
  }

  // Existing questions ke duplicate keys
  const existingKeys = new Set(
    oldQuestions.map(qKey)
  );

  // Sirf unique questions rakho
  const uniqueFresh = fresh.filter(q => {
    const key = qKey(q);

    if (!key) return false;

    if (existingKeys.has(key)) {
      return false;
    }

    existingKeys.add(key);
    return true;
  });

  console.log(
    `🆕 Unique new questions: ${uniqueFresh.length}`
  );

  if (uniqueFresh.length === 0) {
    console.log(
      `⚠️ Generated questions duplicate nikle`
    );
    return true;
  }

  // IMPORTANT:
  // Purane questions delete nahi honge.
  const mergedQuestions = [
    ...oldQuestions,
    ...uniqueFresh
  ];

  await QuestionBank.findOneAndUpdate(
    {
      category,
      difficulty
    },
    {
      $set: {
        questions: mergedQuestions,
        updatedAt: new Date()
      }
    },
    {
      upsert: true,
      new: true
    }
  );

  console.log(
    `✅ SAVED: ${category} | ${difficulty} → ${mergedQuestions.length} total`
  );

  return true;
}

// =====================================================
// REFRESH ALL BANKS
// =====================================================

async function refreshAllBanks() {
  if (running) {
    console.log(
      "⏭️ Cron skip — previous refresh abhi chal raha hai"
    );
    return;
  }

  running = true;

  console.log("");
  console.log("==============================================");
  console.log("🌙 3 AM BANK REFRESH STARTED");
  console.log("==============================================");
  console.log(
    `📚 Categories: ${ALL_CATEGORIES.length}`
  );
  console.log(
    `🎯 Difficulties: ${DIFFICULTIES.join(", ")}`
  );
  console.log(
    `🌱 Questions per bank/run: ${ADD_PER_RUN}`
  );
  console.log("==============================================");

  let completed = 0;
  let failed = 0;

  try {
    for (const category of ALL_CATEGORIES) {

      for (const difficulty of DIFFICULTIES) {

        // Quota khatam ho gaya to unnecessary requests mat bhejo
        if (isQuotaExhausted()) {
          console.log("");
          console.log(
            "🚫 Gemini quota exhausted."
          );
          console.log(
            "⏭️ Current run yahin stop kar diya."
          );
          console.log(
            "➡️ Next scheduled run me dobara continue hoga."
          );
          return;
        }

        const ok = await addQuestions(
          category,
          difficulty
        );

        if (ok) {
          completed++;
        } else {
          failed++;
        }

        // Next Gemini request se pehle gap
        console.log(
          `⏳ Waiting ${GAP_MS / 1000}s...`
        );

        await sleep(GAP_MS);
      }
    }

    // Purane seen records cleanup
    const cleared = await SeenQuestions.deleteMany({
      updatedAt: {
        $lt: new Date(
          Date.now() - 24 * 60 * 60 * 1000
        )
      }
    });

    console.log("");
    console.log("==============================================");
    console.log("🎉 3 AM BANK REFRESH COMPLETE");
    console.log("==============================================");
    console.log(
      `✅ Completed: ${completed}`
    );
    console.log(
      `❌ Failed: ${failed}`
    );
    console.log(
      `🧹 Old seen records removed: ${cleared.deletedCount}`
    );
    console.log("==============================================");

  } catch (error) {
    console.log(
      "❌ CRON REFRESH ERROR:",
      error.message
    );
  } finally {
    running = false;
  }
}

// =====================================================
// START CRON
// =====================================================

function startBankRefreshCron() {

  if (!cron.validate(CRON_SCHEDULE)) {
    console.log(
      "❌ Invalid CRON_SCHEDULE:",
      CRON_SCHEDULE
    );
    return;
  }

  cron.schedule(
    CRON_SCHEDULE,
    refreshAllBanks,
    {
      timezone: CRON_TZ
    }
  );

  console.log("");
  console.log(
    `⏰ Bank refresh cron ready`
  );
  console.log(
    `   Schedule: ${CRON_SCHEDULE}`
  );
  console.log(
    `   Timezone: ${CRON_TZ}`
  );
  console.log(
    `   Categories: ${ALL_CATEGORIES.length}`
  );
  console.log(
    `   Difficulties: Easy + Medium + Hard`
  );
}

// =====================================================
// MANUAL TEST
// =====================================================

if (require.main === module) {

  require("dotenv").config();

  (async () => {

    try {

      await mongoose.connect(
        process.env.MONGO_URI
      );

      console.log(
        "✅ MongoDB connected — manual refresh"
      );

      await refreshAllBanks();

    } catch (error) {

      console.log(
        "❌ Manual refresh error:",
        error.message
      );

    } finally {

      await mongoose.disconnect();

      console.log(
        "🔌 MongoDB disconnected"
      );

      process.exit(0);
    }

  })();
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  startBankRefreshCron,
  refreshAllBanks
};