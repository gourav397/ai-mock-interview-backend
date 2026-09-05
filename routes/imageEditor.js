// ============================================================
// IMAGE EDITOR ROUTES — PRODUCTION, SELF-CONTAINED
// ------------------------------------------------------------------
// Is file ke andar SAB KUCH hai:
//   * NLP parser (Hindi/Hinglish/English + text-replace number pairs)
//   * Sharp-based local edits (filter/adjust/enhance/upscale/...)
//   * OpenAI /v1/images/edits text-replacement (real pixels)
//   * Safe basename file handling (path-traversal proof)
//   * Stateless upload -> filename chaining
// ------------------------------------------------------------------
// Is file ko bahar kisi parser/imageProcessor file se DEPENDENCY NAHI.
// Bas sharp + multer chahiye. Copy-paste ready.
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const sharp = require("sharp");

const router = express.Router();

// ---------------- Temp storage (Render disk is ephemeral) ----------
const TEMP_DIR = path.join(__dirname, "..", "temp", "processed");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const MAX_DIM = 8192;
const MAX_MB = 20 * 1024 * 1024;

// ================= SAFE FILE HELPERS ================================
function safeName(v) {
  if (typeof v !== "string" || !v) return null;
  const n = v.split("\\").pop().split("/").pop(); // strip any path
  if (!/^[a-zA-Z0-9._-]+$/.test(n)) return null;   // blocks ../ and /abs
  if (!n.includes(".")) return null;
  return n;
}
function abs(fn) { return path.join(TEMP_DIR, fn); }

async function loadBuf(fn) {
  const s = safeName(fn);
  if (!s) { const e = new Error("Invalid image filename."); e.code = 400; throw e; }
  const p = abs(s);
  if (!fs.existsSync(p)) {
    const e = new Error("Source image expired. Re-upload the image.");
    e.code = 404; throw e;
  }
  return { buffer: await fsp.readFile(p), name: s };
}

async function saveBuf(buffer, hint = "img") {
  let ext = "jpg";
  try { ext = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp" }[(await sharp(buffer).metadata()).format] || "jpg"; }
  catch { ext = "jpg"; }
  const fn = `${hint}_${crypto.randomUUID()}.${ext}`;
  await fsp.writeFile(abs(fn), buffer);
  return fn; // STRING filename
}

function previewOf(fn) {
  return `/api/image-editor/preview/${encodeURIComponent(fn)}`;
}
function downloadOf(fn) {
  return `/api/image-editor/download/${encodeURIComponent(fn)}`;
}

// Response carries BOTH flat fields (for api.js resolveImageFilename)
// AND a nested data object (for wrapped readers). Either works.
function ok(res, fn, extra = {}) {
  const body = {
    success: true,
    message: "Done.",
    filename: fn,
    preview: previewOf(fn),
    download: downloadOf(fn),
    data: { filename: fn, preview: previewOf(fn), download: downloadOf(fn), ...extra },
  };
  return res.json(body);
}
function err(res, status, msg, data = {}) {
  return res.status(status).json({
    success: false,
    message: msg,
    error: msg,
    data,
  });
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    err(res, Number(e.code) >= 400 ? e.code : 500, e.message || "Server error")
  );

// ================= VALIDATE + UPLOAD ================================
function magicOk(b) {
  const j = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const p = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e;
  const w = b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP";
  return j || p || w;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB, files: 1 },
});

router.post("/upload", upload.single("image"), wrap(async (req, res) => {
  const f = req.file;
  if (!f || !f.buffer) return err(res, 400, "No image received.");
  if (f.size > MAX_MB) return err(res, 400, "File too large (max 20MB).");
  if (!magicOk(f.buffer)) return err(res, 400, "File is not a valid JPG/PNG/WebP image.");
  // Normalize to PNG so edits can carry alpha safely.
  const png = await sharp(f.buffer).rotate().png().toBuffer();
  const fn = await saveBuf(png, "upload");
  return ok(res, fn, { originalName: f.originalname || null });
}));

// ================= LOCAL EDIT HELPERS (sharp) ======================
const clamp = (n, a, b) => Math.min(Math.max(Number(n), a), b);

async function readStep(src) { // src is filename
  const { buffer } = await loadBuf(src);
  return buffer;
}
const getMeta = async (buf) => { try { return await sharp(buf).metadata(); } catch { return {}; } };

// ================= INLINE NLP PARSER ================================
// Return { ok, plan:[] , reason } — route uses plan, no outside dependency.
function norm(s) {
  return String(s || "").toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}
function rep(rules, s) {
  for (const [re, to] of rules) s = s.replace(re, to);
  return s;
}
// chat/Hinglish spelling normalization
const RULES = [
  [/\bhataa?\b/g, "hata"], [/\bhta\b/g, "hata"], [/\bhtado\b/g, "hata do"],
  [/\bkrdo\b/g, "kar do"], [/\bkardo\b/g, "kar do"], [/\bkro\b/g, "karo"],
  [/\bkr\b/g, "kar"], [/\bkrna\b/g, "karna"], [/\bbnao\b/g, "bana do"],
  [/\bbanao\b/g, "bana do"], [/\bbdhao\b/g, "badha do"], [/\brhne\b/g, "rehne"],
  [/\bpiche\b/g, "peeche"], [/\bpeechhe\b/g, "peeche"], [/\bpeechha\b/g, "peeche"],
];

// Extract digit replacement pairs across common phrasings.
function digitPair(s) {
  const m =
    s.match(/(\d{2,12})\s*ko\s+(?:replace|change|badal|badlo|kar\s*do|karo)?\s*\d*\s*(?:kr|kar|karo)?\s*(\d{2,12})\s*(?:k\s+sath|ke\s+sath|sath|se|me|ke)?/) ||
    s.match(/replace\s+(\d{2,12})\s+(?:with|by|se|ko)\s+(\d{2,12})/) ||
    s.match(/(\d{2,12})\s*(?:->|→|to)\s*(\d{2,12})/) ||
    s.match(/(\d{2,12})\s*ko\s*(\d{2,12})\s*(?:kar|karo|banao?|badlo?|k\s+sath)?/);
  if (!m) return null;
  return { oldText: m[1], newText: m[2] };
}

const COLOR = {
  white: "#ffffff", safed: "#ffffff", safaid: "#ffffff", saphed: "#ffffff",
  black: "#000000", kala: "#000000", kaala: "#000000", blue: "#0000ff",
  neela: "#0000ff", red: "#ff0000", laal: "#ff0000", lal: "#ff0000",
  green: "#00cc66", hara: "#00cc66", gray: "#808080", grey: "#808080",
  yellow: "#ffff00", peela: "#ffff00", pink: "#ffc0cb", gulabi: "#ffc0cb",
  orange: "#ffa500", narangi: "#ffa500", purple: "#800080",
};
function hexColor(s) {
  const h = s.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (h) return h[0].toLowerCase();
  for (const [w, v] of Object.entries(COLOR)) if (new RegExp("\\b" + w + "\\b", "i").test(s)) return v;
  return null;
}

function parseSteps(raw) {
  const s = rep(RULES, norm(raw));
  const plan = [];

  // --- text / digit replacement (highest priority, no OCR needed) ---
  const dp = digitPair(s);
  if (dp) plan.push({ action: "ai_replace_text", oldText: dp.oldText, newText: dp.newText });

  // --- remove text (non-digit words like "watermark") ---
  const remTxt = s.match(/(?:text|text\s*ko|word|watermark|writing|likha)\s*ko?\s*(?:hata|remove|delete|nikal|mita)/);
  if (remTxt && !dp) plan.push({ action: "ai_remove_text", rawText: raw });

  // --- remove object / person ---
  const obj = s.match(/(?:object|aadmi|person|insaan|banda|cheez|extra\s*aadmi|sath\s*wala)\s*(?:ko)?\s*(?:hata|remove|delete|nikal|mata|hata\s*do)/);
  if (obj && !dp) plan.push({ action: "ai_remove_object", object: obj[1] || "the object" });

  // --- background removal ---
  const bgRem = /(background|bg|peeche)/.test(s) && /(hata|remove|nikal|delete|clear|saaf)/.test(s);
  const keepOnly = /(sirf|only|just).*(subject|photo|pic|image|person|aadmi|face|chehra).*(rakho|rakh|rehne|keep|chhod)/.test(s);
  const detailsRem = /(details?|extra|faltu).*(hata|remove)/.test(s) && /(rehne|rakho|only|sirf)/.test(s);
  if ((bgRem || keepOnly || detailsRem) && !dp) plan.push({ action: "remove_background" });

  // --- background color replace ---
  const col = hexColor(s);
  if (col && /(background|bg|peeche)/.test(s) && !plan.some(x => x.action === "remove_background")) {
    plan.push({ action: "replace_background", color: col });
  }

  // --- black & white ---
  if (/\b(black\s*(and|&)?\s*white|grayscale|monochrome|kala\s*safed|b\s*w)\b/.test(s))
    plan.push({ action: "filter", filter: "black-white" });

  // --- HD / enhance / quality ---
  if (/\b(hd|enhance|sharpen|clear|quality|professional|better|behtar|accha|clean|bright\s*kar|face\s*clear)\b/.test(s) && !/\bremove\b/.test(s))
    plan.push({ action: "enhance" });

  // --- upscale Nx / bada karo ---
  const up = s.match(/\b([2-4])\s*x\b/);
  if (up || /\b(upscale|bada\s*kar|bada\s*do|badao|size\s*badha|2x)\b/.test(s))
    plan.push({ action: "upscale", scale: up ? +up[1] : 2 });

  // --- brightness ---
  if (/\b(bright|brightness|ujala|roshan|lighten|light|chamak|roshni)\b/.test(s) && !/dark/.test(s))
    plan.push({ action: "adjust", adjustments: { brightness: /\b(kam|less|decrease|thodi\s+kam)\b/.test(s) ? 0.75 : 1.3 } });
  if (/\b(dark|andhera|dim|andhere|darken)\b/.test(s))
    plan.push({ action: "adjust", adjustments: { brightness: 0.72 } });

  // --- contrast ---
  if (/\bcontrast\b/.test(s))
    plan.push({ action: "adjust", adjustments: { contrast: /\b(kam|less|decrease)\b/.test(s) ? 0.7 : 1.5 } });

  // --- saturation / color pop ---
  if (/\b(saturat|vibrant|vivid|color|colour|rang)\b/.test(s) && !/bw/.test(s))
    plan.push({ action: "adjust", adjustments: { saturation: 1.5 } });

  // --- named filters ---
  const FILTERS = { warm: /warm|garam/, cool: /cool|thanda/, vintage: /vintage|retro|old/, cinematic: /cinema|film|movie/, soft: /\bsoft\b|naram/, dramatic: /dramatic/, portrait: /portrait|selfie/, sepia: /sepia/ };
  for (const [name, re] of Object.entries(FILTERS)) if (re.test(s)) plan.push({ action: "filter", filter: name });

  // --- resize (WxH) ---
  const rz = s.match(/(\d{2,5})\s*[xX×]\s*(\d{2,5})/);
  if (rz && !dp) plan.push({ action: "resize", width: +rz[1], height: +rz[2] });

  // --- crop % ---
  if (/crop|trim|kaat|cut/.test(s)) {
    const p = s.match(/crop\s*(\d{1,2})\s*%/);
    plan.push({ action: "crop_percent", percent: p ? clamp(+p[1], 10, 90) / 100 : 0.8 });
  }

  // --- rotate ---
  if (/rotate|ghuma|ghumao|turn/.test(s)) {
    const d = s.match(/(90|180|270)\s*(?:degree|deg|°)?/);
    plan.push({ action: "rotate", degrees: /ulta|upside/.test(s) ? 180 : (d ? +d[1] : 90) });
  }

  // dedupe
  const seen = new Set();
  const out = [];
  for (const st of plan) { const k = JSON.stringify(st); if (!seen.has(k)) { seen.add(k); out.push(st); } }
  return out.slice(0, 8);
}

// ================= OPENAI TEXT REPLACE (real pixels) ===============
async function openAiEdit(inputBuf, prompt) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EDIT_MODEL || "gpt-image-2"; // 1.5 shutdown Dec 1 2026
  const form = new FormData();
  form.append("model", model);
  form.append("image", new Blob([inputBuf], { type: "image/png" }), "input.png");
  form.append("prompt", prompt);
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: "Bearer " + key }, body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("AI edit failed (" + r.status + "): " + (j?.error?.message || "unknown")); e.code = 502; throw e; }
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) { const e = new Error("AI returned no image payload."); e.code = 502; throw e; }
  return Buffer.from(b64, "base64");
}

// ================= EXECUTE PLAN =====================================
async function executePlan(buf, steps) {
  let cur = buf;
  const ran = [];
  for (const st of steps) {
    const a = st.action;

    if (a === "ai_replace_text" || a === "ai_remove_text" || a === "ai_remove_object") {
      if (!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8)) {
        const e = new Error("needsProvider");
        e.code = 409; e.needsProvider = true; e.missingKeys = ["OPENAI_API_KEY"];
        e.honest =
          a === "ai_replace_text"
            ? "Text '" + st.oldText + "' ko '" + st.newText + "' karne ke liye OPENAI_API_KEY chahiye. Bina AI ke rendered digits rewrite karna honest nahi hai."
            : "Object/text removal ke liye OPENAI_API_KEY chahiye.";
        throw e;
      }
      const prompt =
        a === "ai_replace_text"
          ? "In this image, find the visible text \"" + st.oldText + "\" and change ONLY it to read exactly \"" + st.newText + "\". Keep identical font, size, color, style and position. Remove all trace of the old text. Change nothing else."
          : a === "ai_remove_text"
          ? "Remove the text/writing/watermark from this image and inpaint the area so the background behind looks completely natural, as if it was never there."
          : "Remove " + (st.object || "the object/person") + " from this image and inpaint the area so the scene looks fully natural and continuous.";
      cur = await openAiEdit(cur, prompt);
      ran.push(a === "ai_replace_text" ? "text " + st.oldText + " -> " + st.newText : a);
    }

    else if (a === "remove_background") {
      const key = process.env.REMOVE_BG_API_KEY;
      if (key && key.length > 8) {
        try {
          const fd = new FormData();
          fd.append("image_file", new Blob([cur], { type: "image/png" }), "x.png");
          fd.append("size", "auto");
          const rr = await fetch("https://api.remove.bg/v1.0/removebg", {
            method: "POST", headers: { "X-Api-Key": key }, body: fd,
          });
          if (rr.ok) { cur = Buffer.from(await rr.arrayBuffer()); ran.push("background removed"); continue; }
        } catch {}
        const e = new Error("remove.bg failed."); e.code = 502; throw e;
      }
      // Honest: no provider => cannot truly remove background.
      const e = new Error("Background removal ke liye REMOVE_BG_API_KEY (ya OPENAI_API_KEY) chahiye. Bina provider ke fake transparent result nahi de sakte.");
      e.code = 409; e.needsProvider = true; e.missingKeys = ["REMOVE_BG_API_KEY"]; throw e;
    }

    else if (a === "replace_background") {
      cur = await sharp(cur).rotate().flatten({ background: st.color || "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
      ran.push("background " + (st.color || "#ffffff"));
    }
    else if (a === "filter") {
      const f = st.filter;
      let im = sharp(cur).rotate();
      if (f === "black-white") im = im.toColorspace("b-w");
      else if (f === "warm") im = im.tint({ r: 255, g: 200, b: 150 }).modulate({ saturation: 1.1 });
      else if (f === "cool") im = im.tint({ r: 150, g: 200, b: 255 });
      else if (f === "vintage") im = im.tint({ r: 235, g: 200, b: 160 }).modulate({ saturation: 0.6, brightness: 0.9 }).gamma(1.2);
      else if (f === "cinematic") im = im.modulate({ saturation: 0.4, brightness: 0.9 }).linear(1.3, -32);
      else if (f === "soft") im = im.modulate({ brightness: 1.05 }).blur(0.5);
      else if (f === "dramatic") im = im.modulate({ brightness: 0.8, saturation: 1.4 }).linear(1.8, -64);
      else if (f === "portrait") im = im.modulate({ brightness: 1.1, saturation: 0.9 }).sharpen({ sigma: 1.2 });
      else if (f === "sepia") im = im.tint({ r: 255, g: 200, b: 150 }).linear(1.05, 0);
      cur = await im.jpeg({ quality: 92 }).toBuffer();
      ran.push("filter:" + f);
    }
    else if (a === "adjust") {
      let im = sharp(cur).rotate();
      const ad = st.adjustments || {};
      const mod = {};
      if (ad.brightness != null) mod.brightness = clamp(ad.brightness, 0.1, 3);
      if (ad.saturation != null) mod.saturation = clamp(ad.saturation, 0, 3);
      if (Object.keys(mod).length) im = im.modulate(mod);
      if (ad.contrast != null) { const c = clamp(ad.contrast, 0.1, 3); im = im.linear(c, 128 * (1 - c)); }
      cur = await im.jpeg({ quality: 92 }).toBuffer();
      ran.push("adjust");
    }
    else if (a === "enhance") {
      cur = await sharp(cur).rotate().modulate({ brightness: 1.05, saturation: 1.1 }).sharpen({ sigma: 1.2 }).gamma(1.05).jpeg({ quality: 95 }).toBuffer();
      ran.push("enhance");
    }
    else if (a === "upscale") {
      const meta = await getMeta(cur);
      const sc = clamp(st.scale || 2, 1, 4);
      cur = await sharp(cur).rotate()
        .resize(Math.min(Math.round((meta.width || 1000) * sc), MAX_DIM), Math.min(Math.round((meta.height || 1000) * sc), MAX_DIM), { kernel: "lanczos3", fit: "fill" })
        .sharpen({ sigma: 0.8 }).jpeg({ quality: 95 }).toBuffer();
      ran.push("upscale " + sc + "x");
    }
    else if (a === "resize") {
      cur = await sharp(cur).rotate().resize(Math.min(+st.width, MAX_DIM), Math.min(+st.height, MAX_DIM), { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
      ran.push("resize");
    }
    else if (a === "crop_percent") {
      const m = await getMeta(cur);
      const w = Math.round((m.width || 1) * st.percent), h = Math.round((m.height || 1) * st.percent);
      const l = Math.max(0, Math.round(((m.width || 1) - w) / 2)), t = Math.max(0, Math.round(((m.height || 1) - h) / 2));
      cur = await sharp(cur).rotate().extract({ left: l, top: t, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
      ran.push("crop");
    }
    else if (a === "rotate") {
      cur = await sharp(cur).rotate((Number(st.degrees) || 90), { background: { r: 255, g: 255, b: 255, alpha: 1 } }).jpeg({ quality: 92 }).toBuffer();
      ran.push("rotate " + st.degrees);
    }
  }
  return { buffer: cur, ran };
}

// ================= LOCAL ENDPOINTS ==================================
async function simpleEdit(req, res, hint, op) {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const out = await op(buffer);
  const fn = await saveBuf(out, hint);
  return ok(res, fn);
}

router.post("/filter", wrap(async (req, res) => {
  const f = req.body.filter;
  const known = ["natural","brighten","darken","contrast","saturate","desaturate","warm","cool","vintage","black-white","grayscale","cinematic","portrait","soft","vivid","dramatic"];
  if (!known.includes(f)) return err(res, 400, "Unknown filter: " + f);
  // reuse executor by building a filter step
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await executePlan(buffer, [{ action: "filter", filter: f === "grayscale" ? "black-white" : f }]);
  const fn = await saveBuf(out, "filtered");
  return ok(res, fn);
}));

router.post("/adjust", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await executePlan(buffer, [{ action: "adjust", adjustments: req.body.adjustments || {} }]);
  const fn = await saveBuf(out, "adjusted");
  return ok(res, fn);
}));

router.post("/enhance", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await executePlan(buffer, [{ action: "enhance" }]);
  const fn = await saveBuf(out, "enhanced");
  return ok(res, fn);
}));

router.post("/upscale", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await executePlan(buffer, [{ action: "upscale", scale: +req.body.scale || 2 }]);
  const fn = await saveBuf(out, "upscaled");
  return ok(res, fn);
}));

router.post("/resize", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await executePlan(buffer, [{ action: "resize", width: +req.body.width, height: +req.body.height }]);
  const fn = await saveBuf(out, "resized");
  return ok(res, fn);
}));

router.post("/crop", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const m = await getMeta(buffer);
  const l = +req.body.left || 0, t = +req.body.top || 0;
  const w = Math.min(+req.body.width || (m.width || 100), m.width || 100);
  const h = Math.min(+req.body.height || (m.height || 100), m.height || 100);
  const out = await sharp(buffer).rotate().extract({ left: l, top: t, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
  const fn = await saveBuf(out, "cropped");
  return ok(res, fn);
}));

router.post("/rotate", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const out = await sharp(buffer).rotate((+req.body.degrees || 90), { background: { r: 255, g: 255, b: 255, alpha: 1 } }).jpeg({ quality: 92 }).toBuffer();
  const fn = await saveBuf(out, "rotated");
  return ok(res, fn);
}));

router.post("/remove-background", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  try {
    const { buffer: out } = await executePlan(buffer, [{ action: "remove_background" }]);
    const fn = await saveBuf(out, "nobg");
    return ok(res, fn, { provider: "remove.bg" });
  } catch (e) {
    if (e.needsProvider) return err(res, 409, e.honest || e.message, { needsProvider: true, missingKeys: e.missingKeys });
    throw e;
  }
}));

router.post("/replace-background", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const col = hexColor(String(req.body.color || "#ffffff")) || (String(req.body.color || "").match(/^#[0-9a-fA-F]{3,6}$/) ? req.body.color : "#ffffff");
  const out = await sharp(buffer).rotate().flatten({ background: col }).jpeg({ quality: 92 }).toBuffer();
  const fn = await saveBuf(out, "bg");
  return ok(res, fn, { color: col });
}));

// ================= AI EDIT (the big one) ============================
router.post("/ai-edit", wrap(async (req, res) => {
  const instruction = String(req.body.instruction || "").trim();
  if (!instruction) return err(res, 400, "No instruction provided.");

  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);

  const steps = parseSteps(instruction);
  if (steps.length === 0) {
    return err(res, 422, "Instruction samajh nahi aayi / no actionable step. Examples: \"photo HD kar do\", \"background white kar do\", \"brightness badha do\", \"2x bada karo\", \"7869 ko 7875 kar do\".", { instruction });
  }

  try {
    const { buffer: outBuf, ran } = await executePlan(buffer, steps);
    const fn = await saveBuf(outBuf, "ai_edit");
    return ok(res, fn, { instruction, steps: ran.length, applied: ran });
  } catch (e) {
    if (e.needsProvider) {
      return err(res, e.code === 409 ? 200 : 409, e.honest || e.message, {
        needsProvider: true, missingKeys: e.missingKeys, instruction,
      });
    }
    throw e;
  }
}));

// reset: stateless reality — client holds original; we just echo.
router.post("/reset", wrap(async (req, res) => {
  const n = safeName(req.body.imagePath || req.body.path);
  if (!n) return err(res, 400, "Invalid imagePath.");
  return res.json({ success: true, filename: n, message: "Reset to original upload." });
}));

router.post("/compare", wrap(async (req, res) => {
  const n = safeName(req.body.imagePath || req.body.path);
  if (!n) return err(res, 400, "Invalid imagePath.");
  return res.json({ success: true, filename: n, preview: previewOf(n), data: { preview: previewOf(n) } });
}));

// ================= PREVIEW / DOWNLOAD ===============================
router.get("/preview/:name", wrap(async (req, res) => {
  const n = safeName(req.params.name);
  if (!n) return err(res, 400, "Invalid file name.");
  const p = abs(n);
  if (!fs.existsSync(p)) return err(res, 404, "Source image expired. Re-upload the image.");
  const type = n.endsWith(".png") ? "image/png" : n.endsWith(".webp") ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  return fs.createReadStream(p).pipe(res);
}));

router.get("/download/:name", wrap(async (req, res) => {
  const n = safeName(req.params.name);
  if (!n) return err(res, 400, "Invalid file name.");
  const p = abs(n);
  if (!fs.existsSync(p)) return err(res, 404, "Source image expired. Re-upload the image.");
  res.setHeader("Content-Disposition", 'attachment; filename="' + n + '"');
  return fs.createReadStream(p).pipe(res);
}));

module.exports = router;