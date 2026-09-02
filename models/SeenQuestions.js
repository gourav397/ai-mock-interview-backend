const mongoose = require("mongoose");

const SeenQuestionsSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true }, // user id
  category: { type: String, required: true },
  seen: { type: [String], default: [] }, // question keys jo user dekh chuka hai
  updatedAt: { type: Date, default: Date.now }
});

// ek user + ek category ka sirf ek record
SeenQuestionsSchema.index({ user: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("SeenQuestions", SeenQuestionsSchema);