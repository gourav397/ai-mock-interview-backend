const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true
    },
    explanation: {
      type: String,
      default: ""
    }
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true
    },

    options: {
      type: [optionSchema],
      default: []
    },

    correctAnswer: {
      type: String,
      default: ""
    },

    topic: {
      type: String,
      default: ""
    },

    page: {
      type: Number,
      default: 1
    },

    difficulty: {
      type: String,
      default: "Medium"
    },

    type: {
      type: String,
      default: "technical"
    }
  },
  { _id: false }
);

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

    questions: {
      type: [questionSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Resume", resumeSchema);