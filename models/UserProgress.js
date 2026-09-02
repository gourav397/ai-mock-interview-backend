const mongoose = require("mongoose");

const DailyActivitySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    questionsAttempted: { type: Number, default: 0 },
    questionsCorrect: { type: Number, default: 0 },
    interviewsTaken: { type: Number, default: 0 }
  },
  { _id: false }
);

const UserProgressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    streak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: "" },
    lastCheckIn: { type: String, default: "" },   // ⬅️ nayi field
    bestScore: { type: Number, default: 0 },
    totalInterviews: { type: Number, default: 0 },
    totalCorrect: { type: Number, default: 0 },
    totalAttempted: { type: Number, default: 0 },
    history: { type: [DailyActivitySchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProgress", UserProgressSchema);