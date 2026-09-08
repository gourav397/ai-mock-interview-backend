// ============================================================
// cron/refreshBanks.js
// Daily 3 AM IST bank refresh — per-bank isolation, atomic
// $push save (no lost updates), partial success, resume,
// detailed run summary.
// ============================================================

require("dotenv").config();

const cron = require("node-cron");
const mongoose = require("mongoose");
const { generateBank, isQuotaExhausted } = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");
const SeenQuestions = require("../models/SeenQuestions");

// =====================================================
// CONFIG
// =====================================================

const CATEGORIES = [
  "Haryana GK", "General Knowledge", "Current Affairs", "Indian History",
  "Indian Polity", "Geography", "Science", "Computer", "Python",
  "Cyber Security", "AI & Machine Learning", "SSC", "UPSC", "Railway",
  "Banking", "Defence", "Mathematics", "Reasoning", "Hindi", "English",
  "Haryana History", "Haryana Geography", "Haryana Polity", "Haryana Economy",
  "Haryana Culture", "Haryana Literature"
];

const CLASS_CATEGORIES = [
  "Class 11 Science - Physics", "Class 11 Science - Chemistry",
  "Class 11 Science - Biology", "Class 11 Science - Mathematics",
  "Class 11 Science - Computer Science", "Class 11 Science - English Core",
  "Class 11 Commerce - Accountancy", "Class 11 Commerce - Business Studies",
  "Class 11 Commerce - Economics", "Class 11 Commerce - Mathematics",
  "Class 11 Commerce - English Core",
  "Class 11 Humanities - History", "Class 11 Humanities - Geography",
  "Class 11 Humanities - Political Science", "Class 11 Humanities - Economics",
  "Class 11 Humanities - Psychology", "Class 11 Humanities - Sociology",
  "Class 11 Humanities - English Core",
  "Class 12 Science - Physics", "Class 12 Science - Chemistry",
  "Class 12 Science - Biology", "Class 12 Science - Mathematics",
  "Class 12 Science - Computer Science", "Class 12 Science - English Core",
  "Class 12 Commerce - Accountancy", "Class 12 Commerce - Business Studies",
  "Class 12 Commerce - Economics", "Class 12 Commerce - Mathematics",
  "Class 12 Commerce - English Core",
  "Class 12 Humanities - History", "Class 12 Humanities - Geography",
  "Class 12 Humanities - Political Science", "Class 12 Humanities - Economics",
  "Class 12 Humanities - Psychology", "Class 12 Humanities - Sociology",
  "Class 12 Humanities - English Core"
];

const ALL_CATEGORIES = [...new Set([...CATEGORIES, ...CLASS_CATEGORIES])];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];

const ADD_PER_RUN = parseInt(process.env.ADD_PER_RUN || "50", 10);
const GAP_MS = parseInt(process.env.GAP_MS || "30000", 10);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 3 * * *";
const CRON_TZ = process.env.CRON_TZ || "Asia/Kolkata";

// resume support: agar bank aaj already successfully refresh ho chuka
// hai to next run me skip karo (quota/restart ke baad useful)
const SKIP_TODAY_DONE = process.env.SKIP_TODAY_DONE !== "false";

let running = false;

// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function qKey(q) {
  return (q?.question || "").split(" / ")[0].trim().toLowerCase();
}

function isSameISTDay(date) {
  if (!date) return false;
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

// =====================================================
// ADD QUESTIONS (per-bank, fail-safe)
// =====================================================

async function addQuestions(category, difficulty) {
  const result = {
    category,
    difficulty,
    requested: ADD_PER_RUN,
    generated: 0,
    valid: 0,
    duplicates: 0,
    saved: 0,
    failed: false,
    error: null,
  };

  console.log("");
  console.log("======================================");
  console.log(`📚 ${category} | ${difficulty}`);
  console.log("======================================");

  try {
    const bank = await QuestionBank.findOne({ category, difficulty });
    const oldQuestions = bank?.questions || [];

    // Resume support: aaj already successful refresh ho gaya to skip
    if (SKIP_TODAY_DONE && bank?.lastRefreshAt && isSameISTDay(bank.lastRefreshAt)) {
      console.log(`⏭️ Aaj already refreshed (${oldQuestions.length} questions) — skip`);
      result.skipped = true;
      result.saved = 0;
      return result;
    }

    console.log(`📦 Existing questions: ${oldQuestions.length}`);
    console.log(`🌱 Generating up to ${ADD_PER_RUN} new questions...`);

    let fresh = [];
    try {
      fresh = await withGenLock(() => generateBank(category, difficulty, ADD_PER_RUN));
    } catch (error) {
      console.log(`❌ Generation failed: ${error.message}`);
      result.failed = true;
      result.error = error.message.slice(0, 200);
      return result;
    }

    if (!Array.isArray(fresh) || fresh.length === 0) {
      console.log(`⚠️ No questions generated`);
      result.failed = true;
      result.error = "no questions generated";
      return result;
    }

    // Existing DB questions ke against dedupe
    const existingKeys = new Set(oldQuestions.map(qKey));
    const uniqueFresh = fresh.filter((q) => {
      const key = qKey(q);
      if (!key) return false;
      if (existingKeys.has(key)) {
        result.duplicates++;
        return false;
      }
      existingKeys.add(key); // batch ke andar bhi dedupe
      return true;
    });

    result.generated = fresh.length;
    result.valid = uniqueFresh.length;

    console.log(`🆕 Unique new questions: ${uniqueFresh.length} (duplicates removed: ${result.duplicates})`);

    if (uniqueFresh.length === 0) {
      console.log(`⚠️ Generated questions duplicate nikle`);
      return result;
    }

    // ✅ ATOMIC SAVE — $push $each: purane questions kabhi overwrite/delete nahi honge
    // NOTE: agar doc 16MB limit ke paas ho to $push fail karega — catch niche handle karta hai
    const updated = await QuestionBank.findOneAndUpdate(
      { category, difficulty },
      {
        $push: { questions: { $each: uniqueFresh } },
        $set: { updatedAt: new Date(), lastRefreshAt: new Date() },
      },
      { upsert: true, new: true }
    );

    result.saved = uniqueFresh.length;

    console.log(`✅ SAVED: ${category} | ${difficulty} → ${updated.questions.length} total`);
    return result;
  } catch (error) {
    console.log(`❌ Bank error (${category} | ${difficulty}):`, error.message);
    result.failed = true;
    result.error = error.message.slice(0, 200);
    return result;
  }
}

// =====================================================
// REFRESH ALL BANKS
// =====================================================

async function refreshAllBanks() {
  if (running) {
    console.log("⏭️ Cron skip — previous refresh abhi chal raha hai");
    return;
  }

  running = true;

  const results = [];
  let quotaStopped = false;

  console.log("");
  console.log("==============================================");
  console.log("🌙 BANK REFRESH STARTED");
  console.log("==============================================");
  console.log(`📚 Categories: ${ALL_CATEGORIES.length}`);
  console.log(`🎯 Difficulties: ${DIFFICULTIES.join(", ")}`);
  console.log(`🎯 Total banks: ${ALL_CATEGORIES.length * DIFFICULTIES.length}`);
  console.log(`🌱 Questions per bank/run: ${ADD_PER_RUN}`);
  console.log("==============================================");

  try {
    outer: for (const category of ALL_CATEGORIES) {
      for (const difficulty of DIFFICULTIES) {
        // Quota khatam → run safely stop, jo bana use save karte raho
        if (isQuotaExhausted()) {
          console.log("🚫 Gemini quota exhausted — run safely stop kar rahe hain");
          console.log("➡️ Next scheduled run me resume hoga (already-done banks skip honge)");
          quotaStopped = true;
          break outer;
        }

        // Har bank independent — fail hone par loop kabhi terminate nahi hota
        const res = await addQuestions(category, difficulty);
        results.push(res);

        console.log(`⏳ Waiting ${GAP_MS / 1000}s...`);
        await sleep(GAP_MS);
      }
    }

    // Purane seen records cleanup
    try {
      const cleared = await SeenQuestions.deleteMany({
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
      console.log(`🧹 Old seen records removed: ${cleared.deletedCount}`);
    } catch (e) {
      console.log("Seen cleanup fail:", e.message);
    }
  } catch (error) {
    console.log("❌ CRON REFRESH ERROR:", error.message);
  } finally {
    running = false;
    printSummary(results, quotaStopped);
  }

  return { results, quotaStopped };
}

// =====================================================
// RUN SUMMARY
// =====================================================

function printSummary(results, quotaStopped) {
  const ok = results.filter((r) => !r.failed && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const partial = results.filter((r) => !r.failed && !r.skipped && r.saved > 0 && r.saved < r.requested);
  const failed = results.filter((r) => r.failed);

  const totalRequested = results.length * ADD_PER_RUN;
  const totalValid = results.reduce((a, r) => a + (r.valid || 0), 0);
  const totalSaved = results.reduce((a, r) => a + (r.saved || 0), 0);
  const totalDupes = results.reduce((a, r) => a + (r.duplicates || 0), 0);

  const byDiff = (d) => results.filter((r) => r.difficulty === d && !r.failed && !r.skipped).length;

  console.log("");
  console.log("========== BANK REFRESH SUMMARY ==========");
  console.log("");
  console.log(`Total Banks Processed: ${results.length}`);
  console.log(`Successful Banks: ${ok.length - partial.length}`);
  console.log(`Partial Banks: ${partial.length}`);
  console.log(`Skipped (already done today): ${skipped.length}`);
  console.log(`Failed Banks: ${failed.length}`);
  console.log("");
  console.log(`Questions Requested: ${totalRequested}`);
  console.log(`Questions Accepted (unique/valid): ${totalValid}`);
  console.log(`Duplicates Removed: ${totalDupes}`);
  console.log(`Questions Saved: ${totalSaved}`);
  console.log("");
  console.log(`Easy Completed: ${byDiff("Easy")}/${ALL_CATEGORIES.length}`);
  console.log(`Medium Completed: ${byDiff("Medium")}/${ALL_CATEGORIES.length}`);
  console.log(`Hard Completed: ${byDiff("Hard")}/${ALL_CATEGORIES.length}`);
  console.log("");

  if (failed.length) {
    console.log("Failed Banks:");
    failed.forEach((r) => console.log(`- ${r.category} | ${r.difficulty} | ${r.error || "unknown"}`));
    console.log("");
  }

  if (quotaStopped) {
    console.log("STOPPED DUE TO GEMINI QUOTA");
    console.log(`Completed: ${results.length}/${ALL_CATEGORIES.length * DIFFICULTIES.length}`);
    console.log(`Remaining: ${ALL_CATEGORIES.length * DIFFICULTIES.length - results.length}`);
    console.log("");
  }

  console.log("==========================================");
}

// =====================================================
// START CRON
// =====================================================

function startBankRefreshCron() {
  if (!cron.validate(CRON_SCHEDULE)) {
    console.log(`❌ Invalid CRON_SCHEDULE: ${CRON_SCHEDULE}`);
    return;
  }
  cron.schedule(CRON_SCHEDULE, refreshAllBanks, { timezone: CRON_TZ });
  console.log("");
  console.log("🚀 Bank refresh cron started");
  console.log(`   Schedule: ${CRON_SCHEDULE}`);
  console.log(`   Timezone: ${CRON_TZ}`);
  console.log(`   Categories: ${ALL_CATEGORIES.length}`);
  console.log(`   Total banks/run: ${ALL_CATEGORIES.length * DIFFICULTIES.length}`);
}

// =====================================================
// MANUAL TEST MODE
// node cron/refreshBanks.js              → full refresh
// node cron/refreshBanks.js --test       → 1 category, 1 difficulty, 8 questions
// node cron/refreshBanks.js --test "SSC" "Hard" 10
// =====================================================

if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("✅ MongoDB connected — manual run");

      const args = process.argv.slice(2);
      if (args[0] === "--test") {
        const category = args[1] || ALL_CATEGORIES[0];
        const difficulty = args[2] || "Easy";
        const count = parseInt(args[3] || "8", 10);

        console.log(`🧪 TEST MODE: ${category} | ${difficulty} | ${count} questions`);

        const origAdd = process.env.ADD_PER_RUN;
        process.env.ADD_PER_RUN = String(count);
        const res = await addQuestions(category, difficulty);
        if (origAdd === undefined) delete process.env.ADD_PER_RUN;

        console.log("RESULT:", JSON.stringify(res, null, 2));
      } else {
        await refreshAllBanks();
      }
    } catch (error) {
      console.log("❌ Manual run error:", error.message);
    } finally {
      await mongoose.disconnect();
      console.log("🔌 MongoDB disconnected");
      process.exit(0);
    }
  })();
}

module.exports = { startBankRefreshCron, refreshAllBanks, addQuestions };