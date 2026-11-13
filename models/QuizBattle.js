
"use strict";

const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["joined", "started", "submitted", "expired"],
      default: "joined",
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    answers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    correctQuestions: {
      type: Number,
      default: 0,
    },

    wrongQuestions: {
      type: Number,
      default: 0,
    },

    skippedQuestions: {
      type: Number,
      default: 0,
    },

    score: {
      type: Number,
      default: 0,
    },

    percentage: {
      type: Number,
      default: 0,
    },

    timeTakenSeconds: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const QuizBattleSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    category: {
      type: String,
      required: true,
    },

    difficulty: {
      type: String,
      default: "Medium",
    },

    totalQuestions: {
      type: Number,
      required: true,
    },

    timeLimitSeconds: {
      type: Number,
      required: true,
    },

    // Same fixed question set is shared by both participants.
    questions: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
    },

    participants: {
      type: [ParticipantSchema],
      default: [],
    },

    status: {
      type: String,
      enum: ["waiting", "active", "completed"],
      default: "waiting",
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

QuizBattleSchema.index({ roomCode: 1 }, { unique: true });

module.exports = mongoose.model("QuizBattle", QuizBattleSchema);
