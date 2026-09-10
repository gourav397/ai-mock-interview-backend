// ============================================================
// models/PPTGeneration.js — AI PPT Generator history
// Small history model: kaun si PPT kabhi banayi + ownership
// (download endpoint ownership verify isse karta hai).
// NOTE: 30-day TTL index — history bhi auto-cleanup hoti hai.
// ============================================================

const mongoose = require("mongoose");

const PPTGenerationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  topic: { type: String, required: true },
  slideCount: { type: Number, default: 0 },
  language: { type: String, default: "English" },
  type: { type: String, default: "General" },
  theme: { type: String, default: "Modern" },
  addImages: { type: Boolean, default: false },
  fileName: { type: String, required: true, unique: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30, // 30 days — history auto-cleanup
  },
});

module.exports = mongoose.model("PPTGeneration", PPTGenerationSchema);