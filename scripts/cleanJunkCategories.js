// scripts/cleanJunkCategories.js
require("dotenv").config();
const mongoose = require("mongoose");
const QuestionBank = require("../models/QuestionBank");

const JUNK = [
  "normal", "haryana gk", "haryana gk ", "haryanna gk ",
  "mbbs", "ssc", "maths", "current affear", "Reasing",
  "Shi jgd", "Data analysis ", "Haryana Environment", "Haryana History",
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const res = await QuestionBank.deleteMany({ category: { $in: JUNK } });
  console.log(`🧹 Deleted ${res.deletedCount} junk banks`);
  await mongoose.disconnect();
  process.exit(0);
})();