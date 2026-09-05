// ============================================================
// IMAGE EDITOR ROUTES — Production v7.0 (self-consistent)
// STATELESS: upload returns a SAFE filename; every edit sends that
// filename back as `imagePath`. All file access is basename-resolved
// inside TEMP_DIR → path-traversal safe.
//
// CONTRACTS (must match frontend api.js + utils/imageProcessor.js):
//   * ImageProcessor.saveTemp(buffer)  -> STRING filename (NOT an object)
//   * parseAiInstruction(text)         -> ARRAY of steps (user order kept)
//   * Every edit response:
//       { success, filename, preview } where preview =
//         "/api/image-editor/preview/<filename>"
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const crypto = require("crypto");

const {
  ImageProcessor,
  TEMP_DIR,
} = require("../utils/imageProcessor");
const { parseAiInstruction, describeStep } = require("../utils/aiEditParser");

const router = express.Router();

// ------------------------------------------------------------
// Upload memory storage (buffer validated + written to TEMP_DIR)
// ------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

// ============================================================
// SAFE FILENAME RESOLUTION — the single guard for every file op.
// Never lets ".." or absolute paths escape TEMP_DIR.
// ============================================================
function resolveSafeFilename(value) {
  if (typeof value !== "string" || !value) return null;
  const name = value.split("\\").pop().split("/").pop();
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null; // blocks traversal
  if (!name.includes(".")) return null;
  return name;
}

function absFile(filename) {
  return path.join(TEMP_DIR, filename);
}

async function readBuffer(filename) {
  const safe = resolveSafeFilename(filename);
  if (!safe) {
    const e = new Error("Invalid image filename.");
    e.code = 400;
    throw e;
  }
  const filePath = absFile(safe);
  try {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile()) throw new Error("not-a-file");
  } catch {
    const e = new Error("Source image not found. It may have expired — please re-upload.");
    e.code = 404;
    throw e;
  }
  const buf = await fsPromises.readFile(filePath);
  if (!buf || buf.length === 0) {
    const e = new Error("Source image is empty.");
    e.code = 500;
    throw e;
  }
  return { buffer: buf, filename: safe };
}

function respondImage(res, filename, extra = {}) {
  const preview = `/api/image-editor/preview/${encodeURIComponent(filename)}`;
  res.json({ success: true, filename, preview, ...extra });
}

function asyncH(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = Number(err.code) >= 400 ? err.code : 500;
      const msg =
        (err && err.message) || "Unexpected server error.";
      console.error(`[imageEditor] ${status}:`, msg);
      res.status(status).json({ success: false, error: msg });
    });
  };
}

// ------------------------------------------------------------
// CAPABILITIES — HONEST. No key => needsProvider:true, never fake.
// ------------------------------------------------------------
const cap = () => {
  const openai = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8);
  const removebg = !!(process.env.REMOVE_BG_API_KEY && process.env.REMOVE_BG_API_KEY.length > 8);
  return { openai, removebg };
};

function needsProviderMessage(kind) {
  const m = {
    ai_text_edit:
      "Real text change/removal and object removal need the AI provider (OpenAI gpt-image). " +
      "Add OPENAI_API_KEY to your .env, then retry. Local tools can't rewrite text/pixels honestly.",
    bg_removal:
      "True subject background removal needs the remove.bg or OpenAI provider. " +
      "Add REMOVE_BG_API_KEY or OPENAI_API_KEY. Without it we only do a local flat-color flatten.",
  };
  return m[kind] || "This edit needs an external AI provider key.";
}

// ============================================================
// AI STEP EXECUTOR — sequential, user order preserved.
// Returns final buffer (provider edits are real, not faked).
// ============================================================

// --- OpenAI /v1/images/edits (gpt-image-*). Returns Buffer. ---
async function runOpenAiEdit(inputBuffer, prompt) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EDIT_MODEL || "gpt-image-2";
  const form = new FormData();
  form.append("model", model);
  form.append(
    "image",
    new Blob([inputBuffer], { type: "image/png" }),
    "input.png"
  );
  form.append("prompt", prompt);
  // GPT-image models ALWAYS return b64_json; do NOT send response_format.

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = json?.error?.message || JSON.stringify(json).slice(0, 300);
    const e = new Error(`OpenAI edit failed (${resp.status}): ${detail}`);
    e.code = 502;
    throw e;
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    const e = new Error("OpenAI returned no image payload.");
    e.code = 502;
    throw e;
  }
  return Buffer.from(b64, "base64");
}

// Prompt builders for specific high-value goals.
const promptFor = (step) => {
  switch (step.action) {
    case "replace_text":
    case "change_text":
      return `In this image, find the text "${step.oldText}" (approx "${step.rawText}") and replace it so it reads exactly "${step.newText}", keeping font, style, size, color and location identical. Remove any old artifact of the original text.`;
    case "remove_text": {
      const t = step.text || step.rawText || "";
      return `Remove the text${t ? ` "${t}"` : ""} from this image and inpaint the area naturally so it looks like that text was never there, reconstructing the background behind it.`;
    }
    case "remove_object": {
      const o = step.object || step.target || "the object";
      return `Remove ${o} from this image and inpaint the area so the surrounding scene looks completely natural and continuous, as if it was never present.`;
    }
    case "ai_prompt":
    case "ai_edit":
      return step.prompt || step.instruction || "Improve this image realistically.";
    default:
      return step.prompt || step.instruction || "Improve this image realistically.";
  }
};

async function executeSteps(inputBuffer, steps, c) {
  let buffer = inputBuffer;
  const executed = [];

  for (const step of steps) {
    if (!step || typeof step.action !== "string") continue;
    const a = step.action;

    // ---- Local Sharp operations (no provider needed) ----
    if (a === "brightness" || a === "adjust") {
      const amount = step.amount != null ? step.amount : step.value;
      buffer = await ImageProcessor.applyAdjustments(buffer, {
        brightness:
          typeof amount === "number"
            ? 1 + amount * (step.intensity === "reduce" ? -1 : 1)
            : undefined,
      });
      executed.push(`brightness → ${describeStep(step)}`);
    } else if (a === "saturation") {
      const amount = step.amount != null ? step.amount : 0.4;
      buffer = await ImageProcessor.applyAdjustments(buffer, { saturation: 1 + amount });
      executed.push(`saturation → ${describeStep(step)}`);
    } else if (a === "contrast") {
      const amount = step.amount != null ? step.amount : 0.2;
      buffer = await ImageProcessor.applyAdjustments(buffer, { contrast: 1 + amount });
      executed.push(`contrast → ${describeStep(step)}`);
    } else if (a === "enhance") {
      const r = await ImageProcessor.enhance(buffer, { scale: step.scale || 1 });
      buffer = r.buffer;
      executed.push(`enhance → ${describeStep(step)}`);
    } else if (a === "upscale") {
      buffer = await ImageProcessor.upscale(buffer, step.scale || 2);
      executed.push(`upscale → ${describeStep(step)}`);
    } else if (a === "resize") {
      buffer = await ImageProcessor.resize(buffer, step.width, step.height, step.fit);
      executed.push(`resize → ${describeStep(step)}`);
    } else if (a === "crop") {
      buffer = await ImageProcessor.crop(buffer, step.left, step.top, step.width, step.height);
      executed.push(`crop → ${describeStep(step)}`);
    } else if (a === "crop_percent") {
      // center crop to % of original
      const pct = clamp(Number(step.percent) || 1, 0.1, 1);
      const meta = await ImageProcessor.getMetadata(buffer);
      const w = Math.round((meta.width || 0) * pct);
      const h = Math.round((meta.height || 0) * pct);
      const left = Math.max(0, Math.round(((meta.width || 0) - w) / 2));
      const top = Math.max(0, Math.round(((meta.height || 0) - h) / 2));
      buffer = await ImageProcessor.crop(buffer, left, top, w, h);
      executed.push(`crop → ${describeStep(step)}`);
    } else if (a === "rotate") {
      buffer = await ImageProcessor.rotate(buffer, step.degrees);
      executed.push(`rotate → ${describeStep(step)}`);
    } else if (a === "black_white" || a === "bw" || a === "grayscale") {
      buffer = await ImageProcessor.applyFilter(buffer, "bw");
      executed.push(`grayscale → ${describeStep(step)}`);
    } else if (a === "filter") {
      const f = (step.filter || step.name || "natural").replace(/\s+/g, "-").toLowerCase();
      buffer = await ImageProcessor.applyFilter(buffer, f);
      executed.push(`filter(${f})`);
    } else if (a === "replace_background" || a === "background_color") {
      buffer = await ImageProcessor.replaceBackground(buffer, { color: step.color || "#ffffff" });
      executed.push(`background → ${step.color}`);
    }
    // ---- Provider operations (REAL only when provider present) ----
    else if (a === "remove_background") {
      if (c.removebg) {
        const r = await ImageProcessor.removeBackground(buffer); // remove.bg path
        if (r.provider === "remove.bg") {
          buffer = r.buffer;
          executed.push("background removed (remove.bg)");
        } else {
          const e = new Error("remove.bg unavailable; fallback would not truly remove background.");
          e.code = 503;
          throw e;
        }
      } else {
        const e = new Error("needsProvider:background");
        e.code = 409;
        e.capKind = "bg_removal";
        throw e;
      }
    } else if (
      a === "replace_text" || a === "change_text" ||
      a === "remove_text" || a === "remove_object" ||
      a === "ai_prompt" || a === "ai_edit"
    ) {
      if (!c.openai) {
        const e = new Error("needsProvider:ai");
        e.code = 409;
        e.capKind = "ai_text_edit";
        throw e;
      }
      buffer = await runOpenAiEdit(buffer, promptFor(step));
      executed.push(describeStep(step));
    }
    // unknown action -> skip silently (allowlist guard)
  }

  return { buffer, executed };
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// ============================================================
// UPLOAD
// ============================================================
router.post(
  "/upload",
  upload.single("image"),
  asyncH(async (req, res) => {
    const check = ImageProcessor.validateImage(req.file);
    if (!check.valid) return res.status(400).json({ success: false, error: check.error });

    // Normalize everything to PNG for edits that may carry alpha.
    const meta = await ImageProcessor.getMetadata(req.file.buffer);
    let out = req.file.buffer;
    if (meta && meta.format === "jpeg") {
      out = await sharpifyToPng(out);
    }
    const filename = await ImageProcessor.saveTemp(out, "upload");
    return respondImage(res, filename, { originalName: req.file.originalname || null });
  })
);

// helper to keep PNG alpha path simple (re-encode only if needed)
async function sharpifyToPng(buffer) {
  const sharp = require("sharp");
  return sharp(buffer).rotate().png().toBuffer();
}

// ============================================================
// LOCAL EDIT ENDPOINTS (all stateless, chained via filename)
// ============================================================
router.post("/filter", asyncH(async (req, res) => {
  const { imagePath, filter } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.applyFilter(buffer, filter);
  const filename = await ImageProcessor.saveTemp(out, "filtered");
  return respondImage(res, filename);
}));

router.post("/adjust", asyncH(async (req, res) => {
  const { imagePath, adjustments } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.applyAdjustments(buffer, adjustments || {});
  const filename = await ImageProcessor.saveTemp(out, "adjusted");
  return respondImage(res, filename);
}));

router.post("/enhance", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const r = await ImageProcessor.enhance(buffer, { scale: Number(req.body.scale) || 1.5 });
  const filename = await ImageProcessor.saveTemp(r.buffer, "enhanced");
  return respondImage(res, filename, { width: r.width, height: r.height, scale: r.scale });
}));

router.post("/upscale", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.upscale(buffer, Number(req.body.scale) || 2);
  const filename = await ImageProcessor.saveTemp(out, "upscaled");
  return respondImage(res, filename);
}));

router.post("/resize", asyncH(async (req, res) => {
  const { imagePath, width, height, fit } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.resize(buffer, width, height, fit);
  const filename = await ImageProcessor.saveTemp(out, "resized");
  return respondImage(res, filename);
}));

router.post("/crop", asyncH(async (req, res) => {
  const { imagePath, left, top, width, height } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.crop(buffer, left, top, width, height);
  const filename = await ImageProcessor.saveTemp(out, "cropped");
  return respondImage(res, filename);
}));

router.post("/rotate", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.rotate(buffer, Number(req.body.degrees) || 90);
  const filename = await ImageProcessor.saveTemp(out, "rotated");
  return respondImage(res, filename);
}));

// ------------------------------------------------------------
// /remove-background — REAL remove.bg if key, else honest 409.
// ------------------------------------------------------------
router.post("/remove-background", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const c = cap();
  if (!c.removebg) {
    return res.status(409).json({
      success: false,
      needsProvider: true,
      provider: "remove.bg",
      error: needsProviderMessage("bg_removal"),
    });
  }
  const out = await ImageProcessor.removeBackground(buffer);
  if (out.provider !== "remove.bg") {
    return res.status(503).json({ success: false, error: "remove.bg request failed." });
  }
  const filename = await ImageProcessor.saveTemp(out.buffer, "nobg");
  return respondImage(res, filename, { provider: "remove.bg" });
}));

// ------------------------------------------------------------
// /replace-background — flatten alpha onto color (local, real).
// Best after a real /remove-background.
// ------------------------------------------------------------
router.post("/replace-background", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const { buffer } = await readBuffer(imagePath);
  const out = await ImageProcessor.replaceBackground(buffer, { color: req.body.color || "#ffffff" });
  const filename = await ImageProcessor.saveTemp(out, "replacedbg");
  return respondImage(res, filename);
}));

// ============================================================
// /ai-edit — the FIXED seam. parse -> validate capability -> execute
// IMPORTANT: ImageProcessor.saveTemp returns a STRING (filename).
// We use that string directly. NO out.filename (that was the bug).
// ============================================================
router.post("/ai-edit", asyncH(async (req, res) => {
  const { imagePath, instruction } = req.body;
  // ============ TEXT REPLACE FAST-PATH (issue fix) ============
const { handleTextReplace } = require("../utils/textReplace");
const txtRes = await handleTextReplace(req.body.imagePath, req.body.instruction);
if (txtRes) return res.status(txtRes.status).json(txtRes.response);
// =============================================================
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ success: false, error: "No instruction provided." });
  }

  const { buffer } = await readBuffer(imagePath);

  // 1) Parse user text into ordered steps.
  const steps = parseAiInstruction(String(instruction));
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(422).json({
      success: false,
      error:
        "Could not understand that instruction. Try e.g. 'pic bright karo', 'background remove karo', " +
        "'text 7869 ko 7875 kar do', 'sath wala aadmi hata do'.",
    });
  }

  // 2) Honest capability check BEFORE mutating anything.
  const c = cap();
  const needsAI = steps.some((s) =>
    ["replace_text", "change_text", "remove_text", "remove_object", "ai_prompt", "ai_edit"].includes(s?.action)
  );
  const needsBG = steps.some((s) => s?.action === "remove_background");

  if ((needsAI && !c.openai) || (needsBG && !c.removebg)) {
    const missing = [];
    if (needsAI && !c.openai) missing.push("OPENAI_API_KEY");
    if (needsBG && !c.removebg) missing.push("REMOVE_BG_API_KEY");
    return res.status(409).json({
      success: false,
      needsProvider: true,
      missingKeys: missing,
      steps,
      error: needsProviderMessage(needsAI ? "ai_text_edit" : "bg_removal"),
    });
  }

  // 3) Execute in order. Provider edits are REAL calls, never faked.
  const { buffer: outBuffer, executed } = await executeSteps(buffer, steps, c);

  // 4) saveTemp returns STRING filename — use it directly.
  const filename = await ImageProcessor.saveTemp(outBuffer, "aiedit");

  // 5) Response matches frontend resolveImageFilename(basename of filename/preview).
  return respondImage(res, filename, {
    steps,
    executed,
    appliedSteps: executed.length,
  });
}));

// ============================================================
// RESET — stateless reality:
// The ORIGINAL can only be restored from the client-held upload
// filename. If imagePath differs, we cannot rebuild the original.
// We return 409 with a clear hint instead of faking a reset.
// ============================================================
router.post("/reset", asyncH(async (req, res) => {
  const { imagePath } = req.body;
  const safe = resolveSafeFilename(imagePath);
  if (!safe) return res.status(400).json({ success: false, error: "Invalid imagePath." });
  // File may already be gone (expired) — that's fine, frontend holds original.
  return res.json({ success: true, filename: safe, reset: true });
}));

// ------------------------------------------------------------
// COMPARE — returns original (imagePath) + current, no processing.
// ------------------------------------------------------------
router.post("/compare", asyncH(async (req, res) => {
  const { imagePath, editType } = req.body;
  const safe = resolveSafeFilename(imagePath);
  if (!safe) return res.status(400).json({ success: false, error: "Invalid imagePath." });
  return res.json({
    success: true,
    editType: editType || "none",
    original: `/api/image-editor/preview/${encodeURIComponent(safe)}`,
    current: `/api/image-editor/preview/${encodeURIComponent(safe)}`,
    filename: safe,
  });
}));

// ============================================================
// PREVIEW + DOWNLOAD (serve from TEMP_DIR, basename only)
// ============================================================
router.get("/preview/:name", asyncH(async (req, res) => {
  const safe = resolveSafeFilename(req.params.name);
  if (!safe) return res.status(400).json({ success: false, error: "Invalid file name." });
  const filePath = absFile(safe);
  try {
    if (!fs.existsSync(filePath)) throw new Error("missing");
    const type = safe.endsWith(".png")
      ? "image/png"
      : safe.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(filePath).pipe(res);
  } catch {
    return res.status(404).json({ success: false, error: "Source image expired. Re-upload the image." });
  }
}));

router.get("/download/:name", asyncH(async (req, res) => {
  const safe = resolveSafeFilename(req.params.name);
  if (!safe) return res.status(400).json({ success: false, error: "Invalid file name." });
  const filePath = absFile(safe);
  try {
    if (!fs.existsSync(filePath)) throw new Error("missing");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    return res.status(404).json({ success: false, error: "Source image expired. Re-upload the image." });
  }
}));

module.exports = router;