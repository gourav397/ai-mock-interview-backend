// ============================================================
// VISION LAYER (v7) — Gemini image understanding + OCR + planning
// ------------------------------------------------------------
// Returns bounding-box coords in [0..1000] (Gemini convention),
// caller de-scales to real pixels.
// No API key configured  => returns null (caller falls back to regex).
// NEVER logs the key. Uses response_mime_type=application/json so
// the model returns pure JSON we can parse safely.
// ============================================================
"use strict";
const sharp = require("sharp");

const GEMINI_KEY = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
// Current stable vision model w/ bbox support (per Gemini docs).
const VISION_MODEL = process.env.AI_VISION_MODEL || "gemini-3.5-flash";
const HOPEFUL_MAX = 1024; // square-cap thumb for cost/speed (bbox still scales)

async function toVisionPng(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: HOPEFUL_MAX, height: HOPEFUL_MAX, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

// Bounding boxes returned by Gemini are normalized to [0..1000].
// Convert to absolute pixel bbox using the ORIGINAL image dims.
function descaleBoxes(boxes, imgW, imgH) {
  return (boxes || []).map((b) => {
    const x = (b.x / 1000) * imgW;
    const y = (b.y / 1000) * imgH;
    const w = (b.width / 1000) * imgW;
    const h = (b.height / 1000) * imgH;
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), text: b.text || "", confidence: b.confidence ?? 1 };
  });
}

// ------------------------------------------------------------------
// analyseImage(imageBuffer, instruction, {imgW,imgH}) -> JSON | null
//   1. describe scene + detect all text w/ bbox  (OCR)
//   2. decide intent + strict action plan (schema below)
// Returns parsed JSON plan + detected regions, validated lightly here.
// ------------------------------------------------------------------
async function analyseImage(imageBuffer, instruction, { imgW, imgH }) {
  if (!GEMINI_KEY) return null;
  const png = await toVisionPng(imageBuffer).catch(() => imageBuffer);

  const SYSTEM = `You visually analyse one image and return JSON ONLY (no prose, no markdown).
Respond with this EXACT schema:
{
  "understanding": "one line summary of what is in the image",
  "dimensions_ok": true,
  "regions": [ { "class":"text|object|person|background_element", "text":"", "x":0,"y":0,"width":0,"height":0,"confidence":0 } ],
  "steps": [ { "action":"...", "target_text":"", "replacement_text":"", "text":"","color":"","degrees":0,"scale":0,"width":0,"height":0,"adjust":{},"filter":"" } ]
}
Rules:
- ALL bounding boxes use the [0..1000] normalized coordinate convention (x,y,width,height each 0..1000; origin top-left).
- Detect EVERY visible text region -> regions[] with class "text" + exact text + box. This is your OCR.
- Understand the user instruction in English/Hindi/Hinglish + INFORMAL spellings.
- Resolve positional words using region boxes: "upar wala text" -> that text region, "left/kheeno wali cheez" -> that region.
- Map to actions, ONLY these (allowlist):
  remove_background, replace_background, remove_text, replace_text, remove_object,
  adjust, filter, enhance, upscale, resize, crop, rotate
- replace_text/replace_text: set target_text (from detected text) + replacement_text.
- remove_text: set target_text if the user names known text, else text:""  (means "all/that one").
- bg color ops -> replace_background with color "#hex".
- upscale -> scale (1..4). Enhance/HD -> enhance. brightness etc -> adjust {brightness:±, contrast:±}.
- Reorder steps to match the USER'S command order.
- Hard ceiling of 6 steps.
Max action word ~4 tokens combined.`

  const USER = `User instruction: ${String(instruction).slice(0, 400)}`;

  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: "image/png", data: png.toString("base64") } },
      { text: SYSTEM },
      { text: USER }
    ]}],
    generationConfig: { temperature: 0, maxOutputTokens: 1200,
      responseMimeType: "application/json" }  // forces clean JSON
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(VISION_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const j = await r.json();
    const t = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    if (!t) return null;
    const data = JSON.parse(t);
    if (!Array.isArray(data.steps) && !Array.isArray(data.regions)) return null;

    // de-scale boxes to real pixels
    if (Array.isArray(data.regions)) data.regions = descaleBoxes(data.regions, imgW || 1, imgH || 1);
    // validate steps against allowlist
    const ALLOW = new Set(["remove_background","replace_background","remove_text","replace_text","remove_object","adjust","filter","enhance","upscale","resize","crop","rotate"]);
    data.steps = (data.steps||[]).filter(s => s && ALLOW.has(s.action)).slice(0,6);
    return data;
  } catch (e) {
    // never expose key; silent fail so caller reaches regex floor
    return null;
  }
}

module.exports = { analyseImage, descaleBoxes };