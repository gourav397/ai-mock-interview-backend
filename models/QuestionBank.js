const mongoose = require("mongoose");

const QuestionBankSchema = new mongoose.Schema({
  category: { type: String, required: true },
  difficulty: { type: String, default: "Medium" },
  questions: { type: Array, default: [] },
  // resume support: is bank me last successful add kab hua
  lastRefreshAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

QuestionBankSchema.index({ category: 1, difficulty: 1 }, { unique: true });

module.exports = mongoose.model("QuestionBank", QuestionBankSchema);