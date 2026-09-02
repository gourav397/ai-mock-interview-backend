const mongoose = require("mongoose");

const projectMemorySchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  category: {
    type: String,
    enum: ["architecture", "known_bug", "previous_incident", "fix", "deployment", "decision", "test_result", "component_map", "config", "lesson"],
    required: true,
  },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  tags: [{ type: String }],
  ttl: { type: Number },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

projectMemorySchema.index({ category: 1 });
projectMemorySchema.index({ tags: 1 });

projectMemorySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("ProjectMemory", projectMemorySchema);