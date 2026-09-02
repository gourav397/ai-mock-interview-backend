require("dotenv").config();

const mongoose = require("mongoose");
const { generateBank, isQuotaExhausted } = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");

const CATEGORIES = [
  "Haryana GK", "General Knowledge", "Reasoning", "Current Affairs",
  "Indian History", "Indian Polity", "Geography", "Science",
  "Computer", "Python", "Cyber Security", "AI & Machine Learning",
  "SSC", "UPSC", "Railway", "Banking", "Defence",
  "General Hindi", "General Science", "Mathematics", "Haryana History", "Haryana Geography",
"Haryana Polity", "Haryana Economy", "Haryana Culture & Heritage",
"Haryana Environment", "Haryana Literature", "English"
];

const CLASS_CATEGORIES = [
  // ---- Class 11 ----
  "Class 11 Science - Physics",
  "Class 11 Science - Chemistry",
  "Class 11 Science - Biology",
  "Class 11 Science - Mathematics",
  "Class 11 Science - Computer Science",
  "Class 11 Science - English Core",
  "Class 11 Commerce - Accountancy",
  "Class 11 Commerce - Business Studies",
  "Class 11 Commerce - Economics",
  "Class 11 Commerce - Mathematics",
  "Class 11 Commerce - English Core",
  "Class 11 Humanities - History",
  "Class 11 Humanities - Geography",
  "Class 11 Humanities - Political Science",
  "Class 11 Humanities - Economics",
  "Class 11 Humanities - Psychology",
  "Class 11 Humanities - Sociology",
  "Class 11 Humanities - English Core",
  // ---- Class 12 ----
  "Class 12 Science - Physics",
  "Class 12 Science - Chemistry",
  "Class 12 Science - Biology",
  "Class 12 Science - Mathematics",
  "Class 12 Science - Computer Science",
  "Class 12 Science - English Core",
  "Class 12 Commerce - Accountancy",
  "Class 12 Commerce - Business Studies",
  "Class 12 Commerce - Economics",
  "Class 12 Commerce - Mathematics",
  "Class 12 Commerce - English Core",
  "Class 12 Humanities - History",
  "Class 12 Humanities - Geography",
  "Class 12 Humanities - Political Science",
  "Class 12 Humanities - Economics",
  "Class 12 Humanities - Psychology",
  "Class 12 Humanities - Sociology",
  "Class 12 Humanities - English Core"
];

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

// Har run me itne naye questions (5+ keys = 90 calls/day → 16/run × 30 runs = 60 calls OK)
const ADD_PER_RUN = parseInt(process.env.ADD_PER_RUN || "16", 10);

// Gemini calls ke beech gap
const GAP_MS = parseInt(process.env.GAP_MS || "30000", 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function qKey(q) {
  return (q.question || "")
    .split(" / ")[0]
    .trim()
    .toLowerCase();
}

async function addQuestions(category, difficulty) {
  console.log(`\n==============================`);
  console.log(`📚 ${category} - ${difficulty}`);
  console.log(`==============================`);

  const bank = await QuestionBank.findOne({ category, difficulty });
  const oldQuestions = bank?.questions || [];

  console.log(`📦 Existing: ${oldQuestions.length}`);
  console.log(`🌱 Generating ${ADD_PER_RUN} new questions...`);

  let fresh = [];
  try {
    fresh = await withGenLock(() =>
      generateBank(category, difficulty, ADD_PER_RUN)
    );
  } catch (e) {
    console.log(`❌ Generation failed: ${e.message}`);
    return;
  }

  if (!Array.isArray(fresh) || fresh.length === 0) {
    console.log(`⚠️ ${category} - ${difficulty}: koi new question nahi mila`);
    return;
  }

  // Existing + newly generated ke beech duplicate hatao
  const existingKeys = new Set(oldQuestions.map(qKey));

  const uniqueFresh = fresh.filter(q => {
    const key = qKey(q);
    if (!key) return false;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });

  console.log(`🆕 Unique new: ${uniqueFresh.length}`);

  if (uniqueFresh.length === 0) {
    console.log(`⚠️ Sab generated questions duplicate the`);
    return;
  }

  // Purane questions delete/replace NAHI honge — sirf append
  const mergedQuestions = [...oldQuestions, ...uniqueFresh];

  await QuestionBank.findOneAndUpdate(
    { category, difficulty },
    { $set: { questions: mergedQuestions, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  console.log(`✅ SAVED: ${category} - ${difficulty} → ${mergedQuestions.length} total`);
}

async function main() {
  console.log("🚀 START: Easy + Medium + Hard banks");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected");

  try {
    for (const category of CATEGORIES) {
      for (const difficulty of DIFFICULTIES) {
        await addQuestions(category, difficulty);

        // 🚫 Quota khatam → turant stop, baaki runs waste mat karo
        if (isQuotaExhausted()) {
          console.log("🚫 Daily quota khatam — run roka. Reset ke baad dobara chalao.");
          break;
        }

        console.log(`⏳ ${GAP_MS / 1000}s wait...`);
        await sleep(GAP_MS);
      }
      if (isQuotaExhausted()) break;
    }

    console.log("\n=================================");
    console.log("🎉 ALL DONE");
    console.log("=================================");
  } catch (e) {
    console.log("❌ MAIN ERROR:", e.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected");
  }
}

main();