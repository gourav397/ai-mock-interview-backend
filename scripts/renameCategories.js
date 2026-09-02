require("dotenv").config();
const mongoose = require("mongoose");
const QuestionBank = require("../models/QuestionBank");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const renames = [
    ["History", "Indian History"],
    ["Math", "Mathematics"]
  ];
  for (const [from, to] of renames) {
    const r = await QuestionBank.updateMany({ category: from }, { $set: { category: to } });
    console.log(`${from} → ${to}: ${r.modifiedCount} docs renamed`);
  }
  await mongoose.disconnect();
  process.exit(0);
})();