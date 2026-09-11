// ============================================================
// models/PPTGeneration.js — AI PPT Generator history (upgraded)
// CHANGES: naye optional fields (layoutStyle/transitions/animations/
// narration) — PURANE DOCUMENTS BINA MIGRATION SAFE (sab optional).
// 30-day TTL preserved.
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
  // 🆕 upgrade fields — optional, purane docs safe
  layoutStyle: { type: String, default: "AI Auto" },
  transitions: { type: String, default: "Subtle" },
  animations: { type: String, default: "Subtle" },
  narration: { type: Boolean, default: false },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30, // 30 days — history auto-cleanup
  },
});

module.exports = mongoose.model("PPTGeneration", PPTGenerationSchema);