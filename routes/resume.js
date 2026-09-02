const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { extractResumeText } = require("../utils/resumeParser");
const { callJSON } = require("../utils/aiChat");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safe = (req.user?._id || "anon").toString();
      cb(null, `${safe}-${Date.now()}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx|txt)$/i.test(file.originalname);
    cb(ok ? null : new Error("Sirf PDF/DOCX/TXT allowed"), ok);
  }
});

// ---------- ANALYZE: resume se profile nikaalo ----------
router.post("/analyze", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Resume file chahiye (PDF/DOCX)" });
    const text = await extractResumeText(req.file.path);
    if (!text.trim()) return res.status(400).json({ message: "Resume se text nahi mila" });

    const profile = await callJSON(`
Ye resume text hai:
${text.slice(0, 6000)}

Return sirf JSON:
{
  "name": "...",
  "email": "...",
  "skills": ["..."],
  "experienceYears": 0,
  "projects": ["..."],
  "education": ["..."],
  "summary": "2-line summary"
}`, { temperature: 0.3 });

    res.json({ profile, rawPreview: text.slice(0, 500) });
  } catch (e) {
    console.log("RESUME ANALYZE ERROR:", e.message);
    res.status(500).json({ message: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

// ---------- RESUME-BASED QUESTIONS ----------
router.post("/questions", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Resume file chahiye" });
    const text = await extractResumeText(req.file.path);

    const result = await callJSON(`
Resume:
${text.slice(0, 6000)}

Is resume ke basis pe 8 interview questions banao — projects, skills, gaps, responsibilities se.
Return sirf JSON: { "questions": ["q1", "q2", "..."] } — har question "English / Hindi" format me.`, { temperature: 0.6 });

    res.json({ questions: result.questions || [] });
  } catch (e) {
    console.log("RESUME QUESTIONS ERROR:", e.message);
    res.status(500).json({ message: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

module.exports = router;