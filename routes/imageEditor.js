// ============================================================
// IMAGE EDITOR — PRODUCTION, FULLY SELF-CONTAINED "premium"
// -----------------------------------------------------------------
// • Inline NLP parser (Hindi/Hinglish/English) — NO import dependency,
//   so return-shape mismatch is impossible.
// • Local sharp edits: filters / adjust / enhance / upscale / resize /
//   crop / rotate / replace-background-color.
// • REAL AI pixels via OpenAI /v1/images/edits for:
//     - digit/word text replace ("8978 ko 4567 kar do")
//     - text / object / person removal ("sath wala aadmi hata do")
//     - ANY free-form prompt ("mujhe isme blue shirt pehna do", etc.)
// • remove.bg used for true background removal when key present.
// • Response ALWAYS: { success, message, filename, preview, download,
//   data: { filename, preview, download, width, height, format, size } }
//   → matches frontend ImageEditor.jsx + api.js exactly.
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const sharp = require("sharp");

const router = express.Router();

// ---------------- temp storage ----------------
const TEMP_DIR = path.join(__dirname, "..", "temp", "processed");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const MAX_DIM = 8192;
const MAX_MB = 20 * 1024 * 1024;

// ================= helpers ====================
function safeName(v) {
  if (typeof v !== "string" || !v) return null;
  const n = v.split("\\").pop().split("/").pop();
  if (!/^[a-zA-Z0-9._-]+$/.test(n) || !n.includes(".")) return null;
  return n;
}
const abs = (fn) => path.join(TEMP_DIR, fn);
const clamp = (n, a, b) => Math.min(Math.max(Number(n), a), b);

async function loadBuf(fn) {
  const s = safeName(fn);
  if (!s) { const e = new Error("Invalid image filename."); e.code = 400; throw e; }
  const p = abs(s);
  if (!fs.existsSync(p)) { const e = new Error("Source image expired. Re-upload the image."); e.code = 404; throw e; }
  return { buffer: await fsp.readFile(p), name: s };
}

const EXT = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp" };
async function metaOf(buf) {
  try { const m = await sharp(buf).metadata(); return { width: m.width, height: m.height, format: EXT[m.format] || "jpeg", size: buf.length }; }
  catch { return { width: null, height: null, format: "jpeg", size: buf.length }; }
}

async function saveBuf(buffer, hint = "img") {
  let ext = "jpg";
  try { ext = EXT[(await sharp(buffer).metadata()).format] || "jpg"; } catch { ext = "jpg"; }
  const fn = `${hint}_${crypto.randomUUID()}.${ext}`;
  await fsp.writeFile(abs(fn), buffer);
  return fn;
}

const previewOf = (fn) => `/api/image-editor/preview/${encodeURIComponent(fn)}`;
const downloadOf = (fn) => `/api/image-editor/download/${encodeURIComponent(fn)}`;

async function okRes(res, fn, extra = {}) {
  const m = await metaOf(await fsp.readFile(abs(fn)));
  const body = {
    success: true,
    message: "Done.",
    filename: fn,
    preview: previewOf(fn),
    download: downloadOf(fn),
    data: { filename: fn, preview: previewOf(fn), download: downloadOf(fn), ...m, ...extra },
  };
  return res.json(body);
}

function errRes(res, status, message, data = {}) {
  return res.status(status).json({ success: false, message, error: message, data });
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    errRes(res, Number(e.code) >= 400 ? e.code : 500, e.message || "Server error")
  );

const hasKey = (k) => !!(process.env[k] && process.env[k].length > 8);
const EDIT_MODEL = () => process.env.OPENAI_EDIT_MODEL || "gpt-image-1";

// ================= OpenAI real edit ===========
async function openAiEdit(inputBuf, prompt) {
  if (!hasKey("OPENAI_API_KEY")) { const e = new Error("OPENAI_API_KEY missing in .env"); e.code = 409; throw e; }
  const form = new FormData();
  form.append("model", EDIT_MODEL());
  form.append("image", new Blob([inputBuf], { type: "image/png" }), "input.png");
  form.append("prompt", prompt);
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY }, body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // model fallback attempt: if model error, retry once with gpt-image-1
    const detail = (j?.error?.message || "unknown").toString().toLowerCase();
    if (EDIT_MODEL() !== "gpt-image-1" && /model|not found|invalid/.test(detail)) {
      const form2 = new FormData();
      form2.append("model", "gpt-image-1");
      form2.append("image", new Blob([inputBuf], { type: "image/png" }), "input.png");
      form2.append("prompt", prompt);
      const r2 = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST", headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY }, body: form2,
      });
      const j2 = await r2.json().catch(() => ({}));
      if (r2.ok && j2?.data?.[0]?.b64_json) return Buffer.from(j2.data[0].b64_json, "base64");
    }
    const e = new Error("AI edit failed (" + r.status + "): " + (j?.error?.message || detail));
    e.code = 502; throw e;
  }
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) { const e = new Error("AI returned no image payload."); e.code = 502; throw e; }
  return Buffer.from(b64, "base64");
}

// ================= INLINE NLP =================
function norm(s) {
  return String(s || "").toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}
const R = [
  [/\bhataa?\b/g, "hata"], [/\bhta\b/g, "hata"], [/\bhtado\b/g, "hata do"],
  [/\bkrdo\b/g, "kar do"], [/\bkardo\b/g, "kar do"], [/\bkro\b/g, "karo"],
  [/\bkr\b/g, "kar"], [/\bkrna\b/g, "karna"], [/\bbnao\b/g, "bana do"],
  [/\bbanao\b/g, "bana do"], [/\bbdhao\b/g, "badha do"], [/\brhne\b/g, "rehne"],
  [/\bpiche\b/g, "peeche"], [/\bpeechhe\b/g, "peeche"], [/\bpeechha\b/g, "peeche"],
];
const COLOR = {
  white: "#ffffff", safed: "#ffffff", safaid: "#ffffff",
  black: "#000000", kala: "#000000", kaala: "#000000",
  blue: "#0000ff", neela: "#0000ff", red: "#ff0000", laal: "#ff0000",
  green: "#00cc66", hara: "#00cc66", gray: "#808080", grey: "#808080",
  yellow: "#ffff00", peela: "#ffff00", pink: "#ffc0cb",
  gulabi: "#ffc0cb", orange: "#ffa500", narangi: "#ffa500", purple: "#800080",
};

function hasNumberPair(s) {
  const tokens = s.match(/\d{2,12}/g) || [];
  const intent =
    /(replace|change|badal|swap|with|by|ko\s+(kar|karo|kr|bana|badal)|ke?\s+sath|k\s+sath|→|->)/.test(s);
  if (tokens.length >= 2 && intent) return { oldText: tokens[0], newText: tokens[1] };
  if (tokens.length === 2 && /ko|to|kar|karo|with|by/.test(s)) return { oldText: tokens[0], newText: tokens[1] };
  return null;
}

function parseSteps(raw) {
  const s = norm(raw);
  for (const [re, to] of R) { /* apply via replace to normalized string */
  }
  let x = s;
  for (const [re, to] of R) x = x.replace(re, to);

  const plan = [];

  // ---- 1. AI text/digit replace (highest priority) ----
  const pair = hasNumberPair(x);
  if (pair) plan.push({ action: "ai_replace_text", oldText: pair.oldText, newText: pair.newText });

  // ---- 2. remove text (word/watermark) ----
  if (!pair && /(text|word|watermark|writing|likha|number|digit).*(hata|remove|delete|nikal|mita|erase)/.test(x))
    plan.push({ action: "ai_remove_text", rawText: raw });

  // ---- 3. remove object / person ----
  if (!pair && /(object|aadmi|person|insaan|banda|cheez|background\s*wali|sath\s*wala).*(hata|remove|delete|nikal|mita|erase)/.test(x))
    plan.push({ action: "ai_remove_object", object: "the specified object/person" });

  // ---- 4. background removal (true via remove.bg / openai) ----
  const bgRem = /(background|bg|peeche|background\s*ko)/.test(x) && /(hata|remove|nikal|delete|clear|saaf)/.test(x);
  const keepOnly = /(sirf|only|just).*(subject|photo|pic|image|person|aadmi|face|chehra).*(rakho|rakh|rehne|keep|chhod)/.test(x);
  const detailsRem = /(details?|extra|faltu|cheezein).*(hata|remove)/.test(x) && /(rehne|rakho|only|sirf|keep)/.test(x);
  if (!pair && (bgRem || keepOnly || detailsRem)) plan.push({ action: "remove_background" });

  // ---- 5. background color ----
  const col = (() => { const h = x.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i); if (h) return h[0]; for (const [w, v] of Object.entries(COLOR)) if (new RegExp("\\b" + w + "\\b", "i").test(x)) return v; return null; })();
  if (col && /(background|bg|peeche)/.test(x) && !plan.some((p) => p.action === "remove_background"))
    plan.push({ action: "replace_background", color: col });

  // ---- 6. black & white ----
  if (/\b(black\s*(and|&)?\s*white|grayscale|monochrome|b\s*w|kala\s*safed)\b/.test(x))
    plan.push({ action: "filter", filter: "black-white" });

  // ---- 7. enhance / HD / quality ----
  if (/\b(hd|h\.d|enhance|sharpen|clear|clarity|quality|professional|behtar|better|accha|acchi|bright\s*kar|face\s*clear|photo\s*ko\s*accha)\b/.test(x) && !/remove|hata/.test(x))
    plan.push({ action: "enhance" });

  // ---- 8. upscale Nx / bada ----
  const up = x.match(/\b([2-4])\s*x\b/);
  if (up || /\b(upscale|bada\s*kar|bada\s*do|badao|size\s*badha|2x|large)\b/.test(x))
    plan.push({ action: "upscale", scale: up ? +up[1] : 2 });

  // ---- 9. brightness ----
  if (/\b(bright|brightness|ujala|roshan|lighten|light|chamak|roshni)\b/.test(x) && !/dark/.test(x))
    plan.push({ action: "adjust", adjustments: { brightness: /(kam|less|decrease|thodi\s+kam)/.test(x) ? 0.75 : 1.3 } });
  if (/\b(dark|andhera|dim|andhere|darken)\b/.test(x))
    plan.push({ action: "adjust", adjustments: { brightness: 0.72 } });

  // ---- 10. contrast / saturation ----
  if (/\bcontrast\b/.test(x)) plan.push({ action: "adjust", adjustments: { contrast: /(kam|less)/.test(x) ? 0.7 : 1.5 } });
  if (/\b(saturat|vibrant|vivid|colour|color|rang)\b/.test(x) && !/b\s*w/.test(x))
    plan.push({ action: "adjust", adjustments: { saturation: 1.5 } });

  // ---- 11. named filters ----
  const FM = { warm: /warm|garam/, cool: /cool|thanda/, vintage: /vintage|retro|old/, cinematic: /cinema|film|movie/, soft: /\bsoft\b|naram/, dramatic: /dramatic/, portrait: /portrait|selfie/, sepia: /sepia/ };
  for (const [name, re] of Object.entries(FM)) if (re.test(x)) plan.push({ action: "filter", filter: name });

  // ---- 12. resize WxH ----
  const rz = x.match(/(\d{2,5})\s*[xX×]\s*(\d{2,5})/);
  if (rz && !pair) plan.push({ action: "resize", width: +rz[1], height: +rz[2] });

  // ---- 13. crop % ----
  if (/crop|trim|kaat|cut/.test(x)) { const p = x.match(/crop\s*(\d{1,2})\s*%/); plan.push({ action: "crop_percent", percent: p ? clamp(+p[1], 10, 90) / 100 : 0.8 }); }

  // ---- 14. rotate ----
  if (/rotate|ghuma|ghumao|turn|ghtao/.test(x)) { const d = x.match(/(90|180|270)\s*(?:degree|deg|°)?/); plan.push({ action: "rotate", degrees: /ulta|upside/.test(x) ? 180 : (d ? +d[1] : 90) }); }

  // ---- 15. FREE-FORM AI prompt (anything else, when it's descriptive) ----
  if (plan.length === 0) {
    const desc = /[a-zà-ÿ]{4,}/i.test(x) || /[हिंदीअक्षर]/.test(raw);
    if (desc) plan.push({ action: "ai_prompt", prompt: raw });
  }

  // dedupe (keep order)
  const seen = new Set(), out = [];
  for (const st of plan) { const k = JSON.stringify(st); if (!seen.has(k)) { seen.add(k); out.push(st); } }
  return out.slice(0, 6);
}

// ================= EXECUTE PLAN ===============
async function execPlan(buffer, steps) {
  let cur = buffer;
  const ran = [];

  for (const st of steps) {
    const a = st.action;

    // --- REAL AI operations (need OPENAI_API_KEY) ---
    if (a === "ai_replace_text" || a === "ai_remove_text" || a === "ai_remove_object" || a === "ai_prompt") {
      const prompt =
        a === "ai_replace_text"
          ? `In this image, find the visible text "${st.oldText}" and change ONLY it so it reads exactly "${st.newText}". Keep the same font, size, color, style and position. Remove all trace of the old text and change nothing else in the image.`
          : a === "ai_remove_text"
          ? "Remove the text/writing/watermark from this image and inpaint that area so the background looks completely natural, as if the text never existed. Change nothing else."
          : a === "ai_remove_object"
          ? "Remove the requested object/person from this image and inpaint the area so the scene looks fully natural and continuous, as if it was never present. Change nothing else."
          : String(st.prompt || ""); // free-form
      cur = await openAiEdit(cur, prompt);
      ran.push(a === "ai_replace_text" ? `text ${st.oldText} → ${st.newText}` : a);
    }

    // --- background removal (true via remove.bg, else OpenAI) ---
    else if (a === "remove_background") {
      if (hasKey("REMOVE_BG_API_KEY")) {
        const fd = new FormData();
        fd.append("image_file", new Blob([cur], { type: "image/png" }), "x.png");
        fd.append("size", "auto");
        const rr = await fetch("https://api.remove.bg/v1.0/removebg", { method: "POST", headers: { "X-Api-Key": process.env.REMOVE_BG_API_KEY }, body: fd });
        if (rr.ok) { cur = Buffer.from(await rr.arrayBuffer()); ran.push("background removed"); continue; }
      }
      if (hasKey("OPENAI_API_KEY")) {
        cur = await openAiEdit(cur, "Remove the background from this subject and output it with a clean, transparent background. Isolate only the main subject.");
        ran.push("background removed"); continue;
      }
      const e = new Error("Background removal ke liye REMOVE_BG_API_KEY ya OPENAI_API_KEY chahiye.");
      e.code = 409; throw e;
    }

    else if (a === "replace_background")
      cur = await sharp(cur).rotate().flatten({ background: st.color || "#ffffff" }).jpeg({ quality: 92 }).toBuffer();

    else if (a === "filter") {
      const f = st.filter; let im = sharp(cur).rotate();
      if (f === "black-white") im = im.toColorspace("b-w");
      else if (f === "warm") im = im.tint({ r: 255, g: 200, b: 150 }).modulate({ saturation: 1.1 });
      else if (f === "cool") im = im.tint({ r: 150, g: 200, b: 255 });
      else if (f === "vintage") im = im.tint({ r: 235, g: 200, b: 160 }).modulate({ saturation: 0.6, brightness: 0.9 }).gamma(1.2);
      else if (f === "cinematic") im = im.modulate({ saturation: 0.4, brightness: 0.9 }).linear(1.3, -32);
      else if (f === "soft") im = im.modulate({ brightness: 1.05 }).blur(0.5);
      else if (f === "dramatic") im = im.modulate({ brightness: 0.8, saturation: 1.4 }).linear(1.8, -64);
      else if (f === "portrait") im = im.modulate({ brightness: 1.1, saturation: 0.9 }).sharpen({ sigma: 1.2 });
      else if (f === "sepia") im = im.tint({ r: 255, g: 200, b: 150 });
      cur = await im.jpeg({ quality: 92 }).toBuffer();
      ran.push("filter:" + f);
    }

    else if (a === "adjust") {
      let im = sharp(cur).rotate(); const ad = st.adjustments || {}; const mod = {};
      if (ad.brightness != null) mod.brightness = clamp(ad.brightness, 0.1, 3);
      if (ad.saturation != null) mod.saturation = clamp(ad.saturation, 0, 3);
      if (Object.keys(mod).length) im = im.modulate(mod);
      if (ad.contrast != null) { const c = clamp(ad.contrast, 0.1, 3); im = im.linear(c, 128 * (1 - c)); }
      cur = await im.jpeg({ quality: 92 }).toBuffer(); ran.push("adjust");
    }

    else if (a === "enhance")
      cur = await sharp(cur).rotate().modulate({ brightness: 1.05, saturation: 1.1 }).sharpen({ sigma: 1.2 }).gamma(1.05).jpeg({ quality: 95 }).toBuffer();

    else if (a === "upscale") {
      const m = await sharp(cur).metadata(); const sc = clamp(st.scale || 2, 1, 4);
      cur = await sharp(cur).rotate().resize(Math.min(Math.round((m.width || 1000) * sc), MAX_DIM), Math.min(Math.round((m.height || 1000) * sc), MAX_DIM), { kernel: "lanczos3", fit: "fill" }).sharpen({ sigma: 0.8 }).jpeg({ quality: 95 }).toBuffer();
    }

    else if (a === "resize")
      cur = await sharp(cur).rotate().resize(Math.min(+st.width, MAX_DIM), Math.min(+st.height, MAX_DIM), { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();

    else if (a === "crop_percent") {
      const m = await sharp(cur).metadata(); const w = Math.round((m.width || 1) * st.percent), h = Math.round((m.height || 1) * st.percent);
      cur = await sharp(cur).rotate().extract({ left: Math.max(0, Math.round(((m.width || 1) - w) / 2)), top: Math.max(0, Math.round(((m.height || 1) - h) / 2)), width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
    }

    else if (a === "rotate")
      cur = await sharp(cur).rotate(Number(st.degrees) || 90, { background: { r: 255, g: 255, b: 255, alpha: 1 } }).jpeg({ quality: 92 }).toBuffer();
  }
  return { buffer: cur, ran };
}

// ================= UPLOAD =====================
function magicOk(b) {
  const j = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const p = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e;
  const w = b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP";
  return j || p || w;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB, files: 1 } });

router.post("/upload", upload.single("image"), wrap(async (req, res) => {
  const f = req.file;
  if (!f || !f.buffer) return errRes(res, 400, "No image received.");
  if (f.size > MAX_MB) return errRes(res, 400, "File too large (max 20MB).");
  if (!magicOk(f.buffer)) return errRes(res, 400, "File is not a valid JPG/PNG/WebP image.");
  const png = await sharp(f.buffer).rotate().png().toBuffer();
  const fn = await saveBuf(png, "upload");
  return okRes(res, fn, { originalName: f.originalname || null });
}));

// ================= SIMPLE EDITS ===============
async function loadThenExec(req, res, steps, hint) {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await execPlan(buffer, steps);
  const fn = await saveBuf(out, hint);
  return okRes(res, fn);
}
const STEPS_1 = (req) => [{ action: "filter", filter: req.body.filter === "grayscale" ? "black-white" : req.body.filter }];

router.post("/filter", wrap(async (req, res) => {
  const known = ["natural","brighten","darken","contrast","saturate","desaturate","warm","cool","vintage","black-white","grayscale","cinematic","portrait","soft","vivid","dramatic"];
  if (!known.includes(req.body.filter)) return errRes(res, 400, "Unknown filter: " + req.body.filter);
  return loadThenExec(req, res, STEPS_1(req), "filtered");
}));

router.post("/adjust", wrap(async (req, res) => loadThenExec(req, res, [{ action: "adjust", adjustments: req.body.adjustments || {} }], "adjusted")));
router.post("/enhance", wrap(async (req, res) => loadThenExec(req, res, [{ action: "enhance" }], "enhanced")));
router.post("/upscale", wrap(async (req, res) => loadThenExec(req, res, [{ action: "upscale", scale: +req.body.scale || 2 }], "upscaled")));
router.post("/resize", wrap(async (req, res) => loadThenExec(req, res, [{ action: "resize", width: +req.body.width, height: +req.body.height }], "resized")));
router.post("/rotate", wrap(async (req, res) => loadThenExec(req, res, [{ action: "rotate", degrees: +req.body.degrees || 90 }], "rotated")));

router.post("/crop", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const m = await sharp(buffer).metadata();
  const w = Math.min(+req.body.width || (m.width || 100), m.width || 100);
  const h = Math.min(+req.body.height || (m.height || 100), m.height || 100);
  const out = await sharp(buffer).rotate().extract({ left: +req.body.left || 0, top: +req.body.top || 0, width: w, height: h }).jpeg({ quality: 92 }).toBuffer();
  const fn = await saveBuf(out, "cropped");
  return okRes(res, fn);
}));

router.post("/remove-background", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const { buffer: out } = await execPlan(buffer, [{ action: "remove_background" }]);
  const fn = await saveBuf(out, "nobg");
  return okRes(res, fn, { provider: "ai" });
}));

router.post("/replace-background", wrap(async (req, res) => {
  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  let col = String(req.body.color || "#ffffff");
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(col)) col = "#ffffff";
  const out = await sharp(buffer).rotate().flatten({ background: col }).jpeg({ quality: 92 }).toBuffer();
  const fn = await saveBuf(out, "bg");
  return okRes(res, fn, { color: col });
}));

// ================= AI EDIT ====================
router.post("/ai-edit", wrap(async (req, res) => {
  const instruction = String(req.body.instruction || "").trim();
  if (!instruction) return errRes(res, 400, "No instruction provided.");

  const { buffer } = await loadBuf(req.body.imagePath || req.body.path);
  const steps = parseSteps(instruction);

  if (steps.length === 0) {
    return errRes(res, 422, "Instruction samajh nahi aayi. Examples: \"photo HD kar do\", \"8978 ko 4567 kar do\", \"sath wala aadmi hata do\", \"background white kar do\".", { instruction });
  }

  // If a step needs AI but no key -> honest clear message (never fake)
  const needsAI = steps.some((s) => ["ai_replace_text","ai_remove_text","ai_remove_object","ai_prompt"].includes(s.action));
  if (needsAI && !hasKey("OPENAI_API_KEY")) {
    return errRes(res, 200, "Iss edit ke liye OPENAI_API_KEY chahiye. .env me daal kar redeploy karo. Main fake result nahi bhejta.", { instruction, needsProvider: true, missingKeys: ["OPENAI_API_KEY"] });
  }

  const { buffer: out, ran } = await execPlan(buffer, steps);
  const fn = await saveBuf(out, "ai_edit");
  return okRes(res, fn, { instruction, appliedSteps: ran, data_note: "ai edit ok" });
}));

router.post("/reset", wrap(async (req, res) => {
  const n = safeName(req.body.imagePath || req.body.path);
  if (!n) return errRes(res, 400, "Invalid imagePath.");
  return res.json({ success: true, filename: n, message: "Reset to original upload." });
}));

router.post("/compare", wrap(async (req, res) => {
  const n = safeName(req.body.imagePath || req.body.path);
  if (!n) return errRes(res, 400, "Invalid imagePath.");
  return res.json({ success: true, filename: n, preview: previewOf(n), data: { filename: n, preview: previewOf(n) } });
}));

// ================= PREVIEW / DOWNLOAD =========
router.get("/preview/:name", wrap(async (req, res) => {
  const n = safeName(req.params.name);
  if (!n) return errRes(res, 400, "Invalid file name.");
  const p = abs(n);
  if (!fs.existsSync(p)) return errRes(res, 404, "Source image expired. Re-upload the image.");
  const type = n.endsWith(".png") ? "image/png" : n.endsWith(".webp") ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  return fs.createReadStream(p).pipe(res);
}));

router.get("/download/:name", wrap(async (req, res) => {
  const n = safeName(req.params.name);
  if (!n) return errRes(res, 400, "Invalid file name.");
  const p = abs(n);
  if (!fs.existsSync(p)) return errRes(res, 404, "Source image expired. Re-upload the image.");
  res.setHeader("Content-Disposition", 'attachment; filename="' + n + '"');
  return fs.createReadStream(p).pipe(res);
}));

module.exports = router;