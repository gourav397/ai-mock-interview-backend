require("dotenv").config();
const mongoose = require("mongoose");
const { generateBank } = require("../utils/aiGenerator");
const { withGenLock } = require("../utils/genLock");
const QuestionBank = require("../models/QuestionBank");

// ⚠️ IMPORTANT: frontend me jo bhi categories hain SAB yahan daalo
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

async function warm() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected — banks ban rahe hain...");

  for (const category of CATEGORIES) {
    const difficulty = "Medium";
    const existing = await QuestionBank.findOne({ category, difficulty });
    if (existing && existing.questions.length >= 50) {
      console.log(`⏭️ Skip ${category} — already ${existing.questions.length} questions`);
      continue;
    }
    console.log(`🔄 Generating bank for ${category}...`);
    const questions = await withGenLock(() => generateBank(category, difficulty, 150));
    await QuestionBank.findOneAndUpdate(
      { category, difficulty },
      { questions, updatedAt: new Date() },
      { upsert: true }
    );
    console.log(`✅ ${category}: ${questions.length} questions saved to MongoDB`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  await mongoose.disconnect();
  console.log("\n🎉 Done! Ab app har user ko INSTANT 50 random questions dega.");
}

warm().catch((e) => { console.error(e); process.exit(1); });