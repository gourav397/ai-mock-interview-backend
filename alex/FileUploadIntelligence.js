// ============================================================
// ALEX FILE UPLOAD INTELLIGENCE v1.0 — PREMIUM
// Owner file upload karta hai -> ALEX samajhta hai -> fix karta hai
// -> 100% working modified code + explanation wapas deta hai
// ============================================================
// FLOW:
//   1. Multer se file receive (memory storage)
//   2. Language detect (js/ts/py/java/cpp/html/css/json etc.)
//   3. Gemini se deep analysis (bugs, security, best practices)
//   4. Gemini se FIXED code generate (poora file, koi TODO nahi)
//   5. Syntax validation (JS: node --check, JSON: JSON.parse)
//   6. Report + fixed code + diff summary return
// ============================================================

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { callGemini } = require("./utils/gemini");
const config = require("./config");

const MAX_FILE_SIZE = 500 * 1024; // 500KB per file
const MAX_TOTAL_FILES = 5;

// ------------------------------------------------------------
// LANGUAGE DETECTION
// ------------------------------------------------------------
const LANGUAGE_MAP = {
  ".js":   { name: "JavaScript", runCmd: (f) => [process.execPath, ["--check", f]] },
  ".mjs":  { name: "JavaScript (ESM)", runCmd: (f) => [process.execPath, ["--check", f]] },
  ".cjs":  { name: "JavaScript (CJS)", runCmd: (f) => [process.execPath, ["--check", f]] },
  ".jsx":  { name: "React JSX", runCmd: (f) => [process.execPath, ["--check", f]] },
  ".ts":   { name: "TypeScript", runCmd: null },
  ".tsx":  { name: "React TSX", runCmd: null },
  ".py":   { name: "Python", runCmd: (f) => ["python", ["-m", "py_compile", f]] },
  ".java": { name: "Java", runCmd: null },
  ".cpp":  { name: "C++", runCmd: null },
  ".c":    { name: "C", runCmd: null },
  ".html": { name: "HTML", runCmd: null },
  ".css":  { name: "CSS", runCmd: null },
  ".json": { name: "JSON", runCmd: null },
  ".sql":  { name: "SQL", runCmd: null },
  ".sh":   { name: "Shell", runCmd: null },
  ".md":   { name: "Markdown", runCmd: null },
  ".go":   { name: "Go", runCmd: null },
  ".rb":   { name: "Ruby", runCmd: null },
  ".php":  { name: "PHP", runCmd: null },
};

function detectLanguage(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  return LANGUAGE_MAP[ext] ? { ext, ...LANGUAGE_MAP[ext] } : null;
}

// ------------------------------------------------------------
// SYNTAX VALIDATION
// ------------------------------------------------------------
function validateSyntax(lang, code, tempFile) {
  // JSON inline validate
  if (lang.ext === ".json") {
    try { JSON.parse(code); return { valid: true }; }
    catch (e) { return { valid: false, error: "JSON parse error: " + e.message }; }
  }
  if (!lang.runCmd) return { valid: true, note: "No automated syntax checker for " + lang.name };

  try {
    const [cmd, args] = lang.runCmd(tempFile);
    execFileSync(cmd, args, { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
    return { valid: true };
  } catch (e) {
    return { valid: false, error: String(e.stderr || e.message).slice(0, 500) };
  }
}

// ------------------------------------------------------------
// STEP 1 — ANALYZE (read-only)
// ------------------------------------------------------------
async function analyzeCode(filename, code, lang, ownerHint) {
  const prompt = `You are ALEX — a senior ${lang.name} engineer with 15+ years experience.

ANALYZE this file and find EVERY issue.

FILE: ${filename} (${lang.name})
${ownerHint ? "OWNER'S REQUEST/HINT: ${ownerHint}" : ""}

CODE:
\`\`\`${lang.ext.replace(".", "")}
${code.slice(0, 30000)}
\`\`\`

Return ONLY valid JSON:
{
  "summary": "2-3 sentence overall assessment in Hinglish",
  "issues": [
    { "severity": "CRITICAL|HIGH|MEDIUM|LOW", "line": number_or_null, "title": "...", "explanation": "...", "fix": "exact fix description" }
  ],
  "improvements": ["best-practice improvements"],
  "securityConcerns": ["any security issues found"]
}

Rules:
- Be thorough but honest. If code is already good, say so.
- Never invent issues that don't exist.
- severity: CRITICAL = breaks/crashes/security hole, HIGH = real bug, MEDIUM = bad practice, LOW = style.`;

  try {
    const res = await callGemini(prompt, { temperature: 0.1, timeoutMs: 45000 });
    if (res && !res.error) {
      const parsed = typeof res === "string" ? JSON.parse(res) : res;
      if (parsed && Array.isArray(parsed.issues)) return parsed;
    }
  } catch (e) {
    console.log("[ALEX-UPLOAD] Analysis AI error:", e.message);
  }
  return {
    summary: "AI analysis unavailable right now — manual review recommended.",
    issues: [], improvements: [], securityConcerns: [],
    _fallback: true,
  };
}

// ------------------------------------------------------------
// STEP 2 — FIX / IMPROVE (generate complete working code)
// ------------------------------------------------------------
async function fixCode(filename, code, lang, analysis, ownerHint) {
  const issueSummary = (analysis.issues || [])
    .slice(0, 25)
    .map(i => `[${i.severity}] ${i.title}: ${i.fix}`)
    .join("\n");

  const prompt = `You are ALEX — an elite ${lang.name} engineer.

Rewrite this file as COMPLETE, PRODUCTION-READY, 100% WORKING code.

FILE: ${filename} (${lang.name})
${ownerHint ? "OWNER SPECIFICALLY WANTS: ${ownerHint}" : "OWNER WANTS: all bugs fixed + best practices applied"}

ISSUES FOUND (fix ALL of these):
${issueSummary || "General code quality improvement requested."}

ORIGINAL CODE:
\`\`\`${lang.ext.replace(".", "")}
${code.slice(0, 30000)}
\`\`\`

STRICT RULES:
1. Output the COMPLETE file — no placeholders, no "// TODO", no "...rest of code".
2. Fix every listed issue AND any other bugs you spot.
3. Keep the original purpose/intent of the code EXACTLY.
4. Keep function/variable names the same unless they're part of the bug.
5. Add ONLY necessary comments (in Hinglish where natural).
6. Output ONLY the raw code — no markdown fences, no explanation. Just pure code.

Return the complete fixed file now:`;

  try {
    const res = await callGemini(prompt, { temperature: 0.2, timeoutMs: 60000, maxOutputTokens: 8192 });
    let fixed = typeof res === "string" ? res : (res?.text || res?.raw || "");
    if (!fixed) throw new Error("AI returned empty fix");

    // Strip accidental markdown fences
    fixed = fixed.replace(/^\s*\`\`\`[a-zA-Z0-9_-]*\s*\n/, "").replace(/\n?\s*\`\`\`\s*$/, "").trim();
    return fixed;
  } catch (e) {
    console.log("[ALEX-UPLOAD] Fix AI error:", e.message);
    return null;
  }
}

// ------------------------------------------------------------
// STEP 3 — EXPLAIN THE CHANGES
// ------------------------------------------------------------
async function explainChanges(filename, original, fixed, lang) {
  const prompt = `You are ALEX. The owner uploaded "${filename}" and you fixed it.

Briefly explain in Hinglish (friendly, like a smart friend):
1. What was wrong (top 3-5 issues, short)
2. What you changed
3. How to use the fixed code

Keep it under 200 words. Be specific, mention actual changes.`;

  try {
    const res = await callGemini(prompt, { temperature: 0.5, timeoutMs: 20000 });
    const text = typeof res === "string" ? res : (res?.text || res?.raw);
    return text ? String(text).slice(0, 2000) : null;
  } catch { return null; }
}

// ------------------------------------------------------------
// MAIN PIPELINE — one file
// ------------------------------------------------------------
async function processUploadedFile(file, options = {}) {
  // file: multer file object { originalname, buffer, size, mimetype }
  const ownerHint = String(options.hint || "").slice(0, 500);

  if (!file) return { success: false, error: "No file received." };
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `File too large: ${(file.size / 1024).toFixed(0)}KB (max ${MAX_FILE_SIZE / 1024}KB).` };
  }

  const lang = detectLanguage(file.originalname);
  if (!lang) {
    return {
      success: false,
      error: `Unsupported file type: ${path.extname(file.originalname)}. Supported: ${Object.keys(LANGUAGE_MAP).join(", ")}`,
      supported: Object.keys(LANGUAGE_MAP),
    };
  }

  const originalCode = file.buffer.toString("utf8");
  if (!originalCode.trim()) return { success: false, error: "File is empty." };

  // ---- 1. Validate original syntax (so we know if it was broken) ----
  const tempDir = path.join(require("os").tmpdir(), "alex-upload-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, path.basename(file.originalname));
  fs.writeFileSync(tempFile, originalCode);

  const originalValidation = validateSyntax(lang, originalCode, tempFile);

  // ---- 2. AI Analysis ----
  const analysis = await analyzeCode(file.originalname, originalCode, lang, ownerHint);

  // ---- 3. AI Fix ----
  let fixedCode = null;
  if (config.ai?.available !== false) {
    fixedCode = await fixCode(file.originalname, originalCode, lang, analysis, ownerHint);
  }

  let fixValidation = null;
  if (fixedCode) {
    fs.writeFileSync(tempFile, fixedCode);
    fixValidation = validateSyntax(lang, fixedCode, tempFile);
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

  const severityCount = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const i of (analysis.issues || [])) severityCount[i.severity] = (severityCount[i.severity] || 0) + 1;

  return {
    success: true,
    fileName: file.originalname,
    language: lang.name,
    sizeBytes: file.size,
    original: {
      code: originalCode,
      syntaxValid: originalValidation.valid,
      syntaxError: originalValidation.error || null,
    },
    analysis: {
      summary: analysis.summary,
      issues: (analysis.issues || []).slice(0, 30),
      improvements: analysis.improvements || [],
      securityConcerns: analysis.securityConcerns || [],
      severityCount,
    },
    fixed: fixedCode ? {
      code: fixedCode,
      syntaxValid: fixValidation?.valid,
      syntaxError: fixValidation?.valid === false ? fixValidation.error : null,
      codeLength: fixedCode.length,
    } : null,
    explanation: fixedCode ? await explainChanges(file.originalname, originalCode, fixedCode, lang) : null,
    note: fixedCode
      ? (fixValidation?.valid
          ? "✅ Fixed code passed syntax validation."
          : "⚠️ Fixed code has a syntax issue — review before using.")
      : "⚠️ AI fix unavailable (quota/network). Analysis still provided.",
    followUps: [
      "Copy the fixed code and replace your file, OR say 'create file " + file.originalname + " with content: <code>' to save it directly in the project.",
      "Ask 'isme aur kya improve ho sakta hai?' for deeper review.",
    ],
  };
}

// ------------------------------------------------------------
// MULTI-FILE BATCH
// ------------------------------------------------------------
async function processUploadedFiles(files, options = {}) {
  if (!files || !files.length) return { success: false, error: "No files uploaded." };
  const batch = files.slice(0, MAX_TOTAL_FILES);
  const results = [];
  for (const f of batch) {
    results.push(await processUploadedFile(f, options));
  }
  return {
    success: true,
    total: results.length,
    results,
    allFixed: results.every(r => r.success && r.fixed),
    note: results.length < files.length
      ? `Only first ${MAX_TOTAL_FILES} files processed.`
      : undefined,
  };
}

module.exports = {
  processUploadedFile,
  processUploadedFiles,
  detectLanguage,
  MAX_FILE_SIZE,
  MAX_TOTAL_FILES,
};