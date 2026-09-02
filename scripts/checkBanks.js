require("dotenv").config();
const mongoose = require("mongoose");
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

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const banks = await QuestionBank.find({}).lean();
  const map = {};
  banks.forEach((b) => { map[`${b.category}::${b.difficulty}`] = b.questions?.length || 0; });

  let missing = 0, small = 0, total = 0;
  console.log("\n📊 BANK HEALTH REPORT\n======================");
  for (const c of CATEGORIES) {
    const row = [];
    for (const d of DIFFICULTIES) {
      const n = map[`${c}::${d}`] ?? 0;
      if (n === 0) missing++;
      else if (n < 50) small++;
      total += n;
      row.push(`${d}:${n}`);
    }
    console.log(`${c.padEnd(22)} ${row.join("  ")}`);
  }
  console.log(`\nTotal questions: ${total}`);
  console.log(`Missing banks (0): ${missing}`);
  console.log(`Small banks (<50): ${small}`);
  if (missing || small) console.log("⚠️ Pehle 'node cron/addQuestions.js' 5-6 baar chalao");
  else console.log("✅ Sab banks healthy hain!");
  await mongoose.disconnect();
  process.exit(0);
})();