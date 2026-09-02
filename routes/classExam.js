const express = require("express");
const router = express.Router();

// ⭐ CLASS 11/12 CBSE — Science / Commerce / Humanities (Arts)
const CLASS_STRUCTURE = {
  "Class 11": {
    "Science": [
      "Physics", "Chemistry", "Biology", "Mathematics",
      "Computer Science", "English Core"
    ],
    "Commerce": [
      "Accountancy", "Business Studies", "Economics",
      "Mathematics", "English Core"
    ],
    "Humanities": [
      "History", "Geography", "Political Science", "Economics",
      "Psychology", "Sociology", "English Core"
    ]
  },
  "Class 12": {
    "Science": [
      "Physics", "Chemistry", "Biology", "Mathematics",
      "Computer Science", "English Core"
    ],
    "Commerce": [
      "Accountancy", "Business Studies", "Economics",
      "Mathematics", "English Core"
    ],
    "Humanities": [
      "History", "Geography", "Political Science", "Economics",
      "Psychology", "Sociology", "English Core"
    ]
  }
};

// category string jo QuestionBank me save hogi
function toCategory(cls, stream, subject) {
  return `${cls} ${stream} - ${subject}`;
}

// ---------- GET /api/class-exam/structure ----------
// Frontend isi se Class → Stream → Subjects render karega
router.get("/structure", (req, res) => {
  res.json(CLASS_STRUCTURE);
});

// ---------- GET /api/class-exam/categories ----------
// Flat list — warm/cron scripts me daalne ke liye reference
router.get("/categories", (req, res) => {
  const list = [];
  for (const cls of Object.keys(CLASS_STRUCTURE)) {
    for (const stream of Object.keys(CLASS_STRUCTURE[cls])) {
      for (const subject of CLASS_STRUCTURE[cls][stream]) {
        list.push(toCategory(cls, stream, subject));
      }
    }
  }
  res.json({ categories: [...new Set(list)] });
});

module.exports = router;