// utils/textReplace.js  (naya file — ya route ke andar daal do)
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const { ImageProcessor, TEMP_DIR } = require("./imageProcessor"); // path adjust karna

// ---- Safe filename (path-traversal guard) ----
function resolveSafeFilename(v) {
  if (typeof v !== "string" || !v) return null;
  const n = v.split("\\").pop().split("/").pop();
  if (!/^[a-zA-Z0-9._-]+$/.test(n) || !n.includes(".")) return null;
  return n;
}
async function readBuffer(fn) {
  const safe = resolveSafeFilename(fn);
  if (!safe) { const e = new Error("Invalid filename"); e.code = 400; throw e; }
  const p = path.join(TEMP_DIR, safe);
  if (!fs.existsSync(p)) { const e = new Error("Source image expired. Re-upload the image."); e.code = 404; throw e; }
  return { buffer: await fsPromises.readFile(p), filename: safe };
}

// ---- Hindi/Hinglish/English replace-pair extraction ----
// Covers: "7360 ko replace kr 7867 k sath", "replace 7360 with 7867",
//         "7869 ko 7875 kar do", "7360 -> 7875", "text X ko Y banao"
function extractReplacePair(raw) {
  const s = String(raw || "").toLowerCase().replace(/\s+/g, " ").trim();

  // "7360 ko replace kr 7867 k sath" / "7360 ko 7875 kar do" / "7869 ko 7875 me badlo"
  let m = s.match(
    /(\d{2,12})\s*ko\s+(?:replace|change|badal|badlo|badla|badal do)?\s*(?:kr|kar|karo)?\s*(\d{2,12})\s*(?:k\s+sath|ke\s+sath|se|k\s*ke\s*sath|sath|me|ke)?/
  );
  // "replace 7360 with 7867" / "replace 7360 by 7867"
  if (!m) m = s.match(/replace\s+(\d{2,12})\s+(?:with|by|se|ko)\s+(\d{2,12})/);
  // "7360 -> 7867" / "7360 to 7867"
  if (!m) m = s.match(/(\d{2,12})\s*(?:->|→|to|ka\s+jagah)\s*(\d{2,12})/);

  if (m) return { oldText: m[1], newText: m[2] };
  return null;
}

// ---- OpenAI /v1/images/edits (real pixel rewrite) ----
async function runOpenAiReplace(inputBuffer, oldText, newText) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_EDIT_MODEL || "gpt-image-2";
  const prompt =
    `In this image there is visible text showing "${oldText}". ` +
    `Change ONLY that text so it reads exactly "${newText}". ` +
    `Keep the exact same font, size, color, style and position as the original. ` +
    `Remove every trace of the old "${oldText}" and do not alter anything else in the image.`;
  const form = new FormData();
  form.append("model", model);
  form.append("image", new Blob([inputBuffer], { type: "image/png" }), "input.png");
  form.append("prompt", prompt);
  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(`OpenAI edit failed (${resp.status}): ${json?.error?.message || "unknown"}`);
    e.code = 502; throw e;
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) { const e = new Error("OpenAI returned no image."); e.code = 502; throw e; }
  return Buffer.from(b64, "base64");
}

// ---- Main handler ----
// Return value: null => koi text-replace nahi, existing logic continue karo.
// Otherwise => { success, status, response } already decided.
async function handleTextReplace(imagePath, instruction) {
  const pair = extractReplacePair(instruction);
  if (!pair) return null; // not a text-replace command -> let existing code run

  let buffer;
  try { ({ buffer } = await readBuffer(imagePath)); }
  catch (e) {
    return { success: false, status: 404,
             response: { success: false, message: e.message,
                         data: { instruction, regions: [], replace: pair } } };
  }

  const hasKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8);
  if (!hasKey) {
    return { success: false, status: 200,
             response: { success: false,
               message: `Text replacement "${pair.oldText}" → "${pair.newText}" ke liye OPENAI_API_KEY chahiye. Bina AI provider ke pixels rewrite karna honest nahi hai. Add karke retry karo.`,
               data: { instruction, regions: [], replace: pair } } };
  }

  try {
    const outBuffer = await runOpenAiReplace(buffer, pair.oldText, pair.newText);
    const filename = await ImageProcessor.saveTemp(outBuffer, "textedit"); // returns STRING
    return { success: true, status: 200,
             response: { success: true,
               message: `Text "${pair.oldText}" ab "${pair.newText}" ho gaya.`,
               data: { filename, preview: `/api/image-editor/preview/${encodeURIComponent(filename)}`,
                       instruction, regions: [], replace: pair } } };
  } catch (e) {
    return { success: false, status: 502,
             response: { success: false, message: e.message, data: { instruction, regions: [], replace: pair } } };
  }
}

module.exports = { handleTextReplace };