const mongoose = require("mongoose");

const resumeSchema = new mongoose.Schema(
  {
    filename: {
      type: String,
      required: true
    },
    text: {
      type: String,
      default: ""
    },
    // ✅ Array of OBJECTS — "questions: [String]" YAHA GALAT THA
    questions: [
      {
        question: { type: String, required: true },
        type: { type: String, default: "technical" }
      }
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Resume", resumeSchema);