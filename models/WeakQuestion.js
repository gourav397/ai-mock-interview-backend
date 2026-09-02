const mongoose = require("mongoose");

const WeakQuestionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true },
    question: { type: Object, required: true },   // full question doc
    timesWrong: { type: Number, default: 0 },
    lastWrongAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// same user + same question → ek hi record (timesWrong badhta hai)
WeakQuestionSchema.index({ user: 1, category: 1, "question.question": 1 }, { unique: true });

module.exports = mongoose.model("WeakQuestion", WeakQuestionSchema);