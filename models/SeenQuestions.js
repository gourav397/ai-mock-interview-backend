const mongoose = require("mongoose");

const SeenQuestionsSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  category: { type: String, required: true },
  seen: { type: [String], default: [] },
  updatedAt: { type: Date, default: Date.now }
});

SeenQuestionsSchema.index({ user: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("SeenQuestions", SeenQuestionsSchema);