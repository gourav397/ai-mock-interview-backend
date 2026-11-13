
"use strict";

const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const { userAuth } = require("../middleware/userAuth");
const QuestionBank = require("../models/QuestionBank");
const QuizBattle = require("../models/QuizBattle");

router.use(userAuth);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function getUserId(req) {
  return String(req.user?.userId || req.user?.id || req.user?._id || "");
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function generateRoomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function normalizeAnswer(value) {
  if (value === undefined || value === null) return "";

  if (typeof value === "object") {
    value =
      value.value ??
      value.answer ??
      value.text ??
      value.label ??
      "";
  }

  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function getCorrectAnswer(question) {
  const possibleKeys = [
    "correctAnswer",
    "correct_answer",
    "answer",
    "correctOption",
    "correct_option",
    "correct",
    "rightAnswer",
    "right_answer",
  ];

  for (const key of possibleKeys) {
    if (
      question &&
      Object.prototype.hasOwnProperty.call(question, key) &&
      question[key] !== undefined &&
      question[key] !== null
    ) {
      return question[key];
    }
  }

  return null;
}

// ------------------------------------------------------------
// Remove answers and explanations before sending questions
// to students. Original questions in MongoDB remain unchanged.
// ------------------------------------------------------------

function getPublicQuestion(question) {
  const copy = { ...question };

  const hiddenKeys = [
    "correctAnswer",
    "correct_answer",
    "answer",
    "correctOption",
    "correct_option",
    "correct",
    "rightAnswer",
    "right_answer",
    "explanation",
    "explanation_en",
    "explanation_hi",
    "explain",
    "solution",
    "solution_en",
    "solution_hi",
    "isCorrect",
    "is_correct",
  ];

  for (const key of hiddenKeys) {
    delete copy[key];
  }

  // Hide explanations and answer indicators inside options too.
  if (Array.isArray(copy.options)) {
    copy.options = copy.options.map((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return option;
      }

      const cleanOption = { ...option };

      for (const key of hiddenKeys) {
        delete cleanOption[key];
      }

      return cleanOption;
    });
  }

  return copy;
}

function getAnswerReview(questions, answers) {
  return questions.map((question, index) => {
    const correctAnswer = getCorrectAnswer(question);
    const yourAnswer = answers?.[String(index)] ?? "";

    return {
      questionIndex: index,
      question: getPublicQuestion(question),
      yourAnswer,
      correctAnswer,
      isCorrect:
        yourAnswer !== "" &&
        normalizeAnswer(yourAnswer) === normalizeAnswer(correctAnswer),
      explanation:
        question.explanation ||
        question.explanation_en ||
        question.explanation_hi ||
        question.explain ||
        question.solution ||
        question.solution_en ||
        question.solution_hi ||
        "",
    };
  });
}

function calculateResult(questions, answers) {
  let correct = 0;
  let wrong = 0;
  let skipped = 0;

  questions.forEach((question, index) => {
    const submitted = answers?.[String(index)];
    const correctAnswer = getCorrectAnswer(question);

    if (submitted === undefined || submitted === null || submitted === "") {
      skipped++;
      return;
    }

    if (correctAnswer === null) {
      wrong++;
      return;
    }

    if (normalizeAnswer(submitted) === normalizeAnswer(correctAnswer)) {
      correct++;
    } else {
      wrong++;
    }
  });

  const total = questions.length;
  const score = correct;
  const percentage = total
    ? Number(((correct / total) * 100).toFixed(2))
    : 0;

  return {
    correctQuestions: correct,
    wrongQuestions: wrong,
    skippedQuestions: skipped,
    score,
    percentage,
  };
}

function getParticipant(room, userId) {
  return room.participants.find(
    (participant) => String(participant.user) === String(userId)
  );
}

function getParticipantView(participant, room) {
  if (!participant) return null;

  const now = Date.now();
  let remainingSeconds = null;

  if (participant.startedAt && participant.expiresAt) {
    remainingSeconds = Math.max(
      0,
      Math.ceil((new Date(participant.expiresAt).getTime() - now) / 1000)
    );
  }

  return {
    user: participant.user,
    status: participant.status,
    joinedAt: participant.joinedAt,
    startedAt: participant.startedAt,
    submittedAt: participant.submittedAt,
    remainingSeconds,
    correctQuestions: participant.correctQuestions,
    wrongQuestions: participant.wrongQuestions,
    skippedQuestions: participant.skippedQuestions,
    score: participant.score,
    percentage: participant.percentage,
    timeTakenSeconds: participant.timeTakenSeconds,
  };
}

function getBattleResponse(room, userId) {
  const me = getParticipant(room, userId);

  const opponent = room.participants.find(
    (participant) => String(participant.user) !== String(userId)
  );

  const isCompleted =
    room.participants.length === 2 &&
    room.participants.every((participant) =>
      ["submitted", "expired"].includes(participant.status)
    );

  let winner = null;

  if (isCompleted) {
    const [first, second] = room.participants;

    if (first.score > second.score) {
      winner = String(first.user);
    } else if (second.score > first.score) {
      winner = String(second.user);
    } else if (first.timeTakenSeconds < second.timeTakenSeconds) {
      winner = String(first.user);
    } else if (second.timeTakenSeconds < first.timeTakenSeconds) {
      winner = String(second.user);
    } else {
      winner = "draw";
    }
  }

  return {
    roomCode: room.roomCode,
    category: room.category,
    difficulty: room.difficulty,
    totalQuestions: room.totalQuestions,
    timeLimitSeconds: room.timeLimitSeconds,
    status: isCompleted ? "completed" : room.status,

    questions: room.questions.map(getPublicQuestion),

    me: getParticipantView(me, room),
    opponent: getParticipantView(opponent, room),

    results: isCompleted
  ? room.participants.map((participant) => ({
      user: participant.user,
      status: participant.status,
      correctQuestions: participant.correctQuestions,
      wrongQuestions: participant.wrongQuestions,
      skippedQuestions: participant.skippedQuestions,
      score: participant.score,
      percentage: participant.percentage,
      timeTakenSeconds: participant.timeTakenSeconds,

      answerReview: getAnswerReview(
        room.questions,
        participant.answers || {}
      ),
    }))
  : null,

    winner,
    completedAt: room.completedAt,
  };
}

async function finishParticipant(room, participant, expired = false) {
  if (["submitted", "expired"].includes(participant.status)) {
    return;
  }

  const result = calculateResult(room.questions, participant.answers || {});

  participant.correctQuestions = result.correctQuestions;
  participant.wrongQuestions = result.wrongQuestions;
  participant.skippedQuestions = result.skippedQuestions;
  participant.score = result.score;
  participant.percentage = result.percentage;

  if (participant.startedAt) {
    const elapsed = Math.floor(
      (Date.now() - new Date(participant.startedAt).getTime()) / 1000
    );

    participant.timeTakenSeconds = Math.max(
      0,
      Math.min(elapsed, room.timeLimitSeconds)
    );
  }

  participant.submittedAt = new Date();
  participant.status = expired ? "expired" : "submitted";

  if (
    room.participants.length === 2 &&
    room.participants.every((item) =>
      ["submitted", "expired"].includes(item.status)
    )
  ) {
    room.status = "completed";
    room.completedAt = new Date();
  }

  await room.save();
}

// ------------------------------------------------------------
// POST /api/quiz-battles/create
// Create a room and select one fixed question set.
// ------------------------------------------------------------

router.post("/create", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const category = String(req.body.category || "").trim();
    const difficulty = String(req.body.difficulty || "Medium").trim();

    const totalQuestions = Math.min(
      150,
      Math.max(1, Number(req.body.totalQuestions) || 50)
    );

    const timeLimitMinutes = Math.min(
      180,
      Math.max(1, Number(req.body.timeLimitMinutes) || 60)
    );

    if (!category) {
      return res.status(400).json({ message: "Category is required" });
    }

    if (!["Easy", "Medium", "Hard"].includes(difficulty)) {
      return res.status(400).json({ message: "Invalid difficulty" });
    }

    const bank = await QuestionBank.findOne({
      category,
      difficulty,
    }).lean();

    if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
      return res.status(404).json({
        message: `No questions available for ${category} (${difficulty})`,
      });
    }

    if (bank.questions.length < totalQuestions) {
      return res.status(400).json({
        message: "Not enough questions in this question bank",
        availableQuestions: bank.questions.length,
        requestedQuestions: totalQuestions,
      });
    }

    const selectedQuestions = shuffle(bank.questions).slice(
      0,
      totalQuestions
    );

    if (
      selectedQuestions.some(
        (question) => getCorrectAnswer(question) === null
      )
    ) {
      return res.status(400).json({
        message:
          "Some questions do not have a recognized correct-answer field. Please check the question bank format before creating a battle.",
      });
    }

    let roomCode;
    let exists = true;

    while (exists) {
      roomCode = generateRoomCode();
      exists = await QuizBattle.exists({ roomCode });
    }

    const room = await QuizBattle.create({
      roomCode,
      createdBy: userId,
      category,
      difficulty,
      totalQuestions,
      timeLimitSeconds: timeLimitMinutes * 60,
      questions: selectedQuestions,
      participants: [{ user: userId }],
      status: "waiting",
    });

    return res.status(201).json({
      message: "Battle room created successfully",
      battle: getBattleResponse(room, userId),
    });
  } catch (error) {
    console.error("[QUIZ BATTLE CREATE]", error);

    return res.status(500).json({
      message: "Could not create battle room",
      error: error.message,
    });
  }
});

// ------------------------------------------------------------
// POST /api/quiz-battles/:roomCode/join
// Join an existing room. Maximum two different students.
// ------------------------------------------------------------

router.post("/:roomCode/join", async (req, res) => {
  try {
    const userId = getUserId(req);
    const roomCode = String(req.params.roomCode || "").trim().toUpperCase();

    const room = await QuizBattle.findOne({ roomCode });

    if (!room) {
      return res.status(404).json({ message: "Battle room not found" });
    }

    const existing = getParticipant(room, userId);

    if (existing) {
      return res.json({
        message: "You are already in this battle",
        battle: getBattleResponse(room, userId),
      });
    }

    if (room.status === "completed" || room.participants.length >= 2) {
      return res.status(400).json({
        message: "This battle room is already full or completed",
      });
    }

    room.participants.push({ user: userId });
    await room.save();

    return res.json({
      message: "Joined battle successfully",
      battle: getBattleResponse(room, userId),
    });
  } catch (error) {
    console.error("[QUIZ BATTLE JOIN]", error);

    return res.status(500).json({
      message: "Could not join battle room",
      error: error.message,
    });
  }
});

// ------------------------------------------------------------
// POST /api/quiz-battles/:roomCode/start
// Each participant starts their own timer independently.
// ------------------------------------------------------------

router.post("/:roomCode/start", async (req, res) => {
  try {
    const userId = getUserId(req);
    const roomCode = String(req.params.roomCode || "").trim().toUpperCase();

    const room = await QuizBattle.findOne({ roomCode });

    if (!room) {
      return res.status(404).json({ message: "Battle room not found" });
    }

    const participant = getParticipant(room, userId);

    if (!participant) {
      return res.status(403).json({
        message: "Join this battle before starting",
      });
    }

    if (room.status === "completed") {
      return res.status(400).json({ message: "Battle is already completed" });
    }

    if (participant.status === "joined") {
      const now = new Date();

      participant.status = "started";
      participant.startedAt = now;
      participant.expiresAt = new Date(
        now.getTime() + room.timeLimitSeconds * 1000
      );

      room.status = "active";
      await room.save();
    }

    if (participant.status !== "started") {
      return res.status(400).json({
        message: "You have already submitted this battle",
      });
    }

    return res.json({
      message: "Your battle timer has started",
      battle: getBattleResponse(room, userId),
    });
  } catch (error) {
    console.error("[QUIZ BATTLE START]", error);

    return res.status(500).json({
      message: "Could not start battle",
      error: error.message,
    });
  }
});

// ------------------------------------------------------------
// GET /api/quiz-battles/:roomCode
// Get room, same questions, own timer and opponent status.
// ------------------------------------------------------------

router.get("/:roomCode", async (req, res) => {
  try {
    const userId = getUserId(req);
    const roomCode = String(req.params.roomCode || "").trim().toUpperCase();

    const room = await QuizBattle.findOne({ roomCode });

    if (!room) {
      return res.status(404).json({ message: "Battle room not found" });
    }

    const participant = getParticipant(room, userId);

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this battle",
      });
    }

    if (
      participant.status === "started" &&
      participant.expiresAt &&
      Date.now() >= new Date(participant.expiresAt).getTime()
    ) {
      await finishParticipant(room, participant, true);
    }

    return res.json({
      battle: getBattleResponse(room, userId),
    });
  } catch (error) {
    console.error("[QUIZ BATTLE GET]", error);

    return res.status(500).json({
      message: "Could not load battle",
      error: error.message,
    });
  }
});

// ------------------------------------------------------------
// POST /api/quiz-battles/:roomCode/submit
// Save answers and calculate score on the server.
// ------------------------------------------------------------

router.post("/:roomCode/submit", async (req, res) => {
  try {
    const userId = getUserId(req);
    const roomCode = String(req.params.roomCode || "").trim().toUpperCase();

    const room = await QuizBattle.findOne({ roomCode });

    if (!room) {
      return res.status(404).json({ message: "Battle room not found" });
    }

    const participant = getParticipant(room, userId);

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this battle",
      });
    }

    if (participant.status !== "started") {
      return res.status(400).json({
        message: "Start the battle before submitting",
      });
    }

    if (
      participant.expiresAt &&
      Date.now() >= new Date(participant.expiresAt).getTime()
    ) {
      await finishParticipant(room, participant, true);

      return res.json({
        message: "Time is over. Your answers have been submitted.",
        battle: getBattleResponse(room, userId),
      });
    }

    const answers = req.body.answers;

    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return res.status(400).json({
        message: "Answers must be an object with question indexes",
      });
    }

    const cleanAnswers = {};

    for (let i = 0; i < room.questions.length; i++) {
      const value = answers[String(i)];

      if (value !== undefined && value !== null && value !== "") {
        cleanAnswers[String(i)] = value;
      }
    }

    participant.answers = cleanAnswers;

    await finishParticipant(room, participant, false);

    return res.json({
      message: "Battle submitted successfully",
      battle: getBattleResponse(room, userId),
    });
  } catch (error) {
    console.error("[QUIZ BATTLE SUBMIT]", error);

    return res.status(500).json({
      message: "Could not submit battle",
      error: error.message,
    });
  }
});

module.exports = router;
