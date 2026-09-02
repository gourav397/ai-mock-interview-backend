const mongoose = require("mongoose");

const FeedbackSchema = new mongoose.Schema(
  {
    score: { type: Number, default: null },          // 0-10
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    suggestedAnswer: { type: String, default: "" }
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["ai", "user"], required: true },
    question: { type: String, default: "" },
    answer: { type: String, default: "" },
    feedback: { type: FeedbackSchema, default: () => ({}) }
  },
  { _id: false }
);

const InterviewSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true },
    difficulty: { type: String, default: "Medium" },
    status: { type: String, enum: ["ongoing", "completed", "abandoned"], default: "ongoing" },
    messages: { type: [MessageSchema], default: [] },
    totalQuestions: { type: Number, default: 8 },
    answeredQuestions: { type: Number, default: 0 },
    finalScore: { type: Number, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

InterviewSessionSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("InterviewSession", InterviewSessionSchema);