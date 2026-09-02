const mongoose = require("mongoose");

const MockAnswerSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    selectedOption: { type: String, default: "" },
    correctOption: { type: String, default: "" },
    isCorrect: { type: Boolean, default: false }
  },
  { _id: false }
);

const MockTestSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, default: "Full Syllabus Mock" },
    categories: { type: [String], default: [] },
    questions: { type: [Object], default: [] },
    answers: { type: [MockAnswerSchema], default: [] },
    durationMinutes: { type: Number, default: 20 },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    status: { type: String, enum: ["ongoing", "submitted", "expired"], default: "ongoing" },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

MockTestSessionSchema.index({ user: 1, createdAt: -1 });
module.exports = mongoose.model("MockTestSession", MockTestSessionSchema);