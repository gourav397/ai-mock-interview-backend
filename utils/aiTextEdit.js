// ============================================================
// AI TEXT EDIT ENGINE — TEXT-ONLY (PRODUCTION v1.0)
// ------------------------------------------------------------
// AI Edit sirf uploaded image ke andar VISIBLE TEXT / LETTERS /
// NUMBERS change karne ke liye hai. Person/object/background edits
// REJECTED hote hain. API key missing par honest error. Koi fake
// result generate nahi hota.
// ============================================================

"use strict";

const sharp = require("sharp");

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_IMG_MODEL = process.env.OPENAI_EDIT_MODEL || "gpt-image-1";

// ------------------------------------------------------------
// REJECT patterns — non-text scope (security + scope enforcement)
// ------------------------------------------------------------
const REJECT_RE =
  /(background|bg|peeche|peche|hair|baal|face|chehra|nose|nak|skin|cloth|kapde|kapda|shirt|dress|body|object|cheez|aadmi|person|insaan|banda|remove\s*(?:the\s*)?(?:person|object|man|woman|bg|background)|hairstyle|beard|daadhi|mooch|moustache|slim|fat|thin|weight|muscle|tatoo|tattoo|smile|muskura)/i;

// ------------------------------------------------------------
// PARSE — sirf text replacement / text removal
// Returns { ok, type, target, replacement } ya { ok:false, reason }
// ------------------------------------------------------------

function parseTextInstruction(raw) {
  const original = String(raw || "").trim();
  if (!original) return { ok: false, reason: "empty_instruction" };

  const text = original
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (REJECT_RE.test(text)) {
    return {
      ok: false,
      reason:
        "AI Edit sirf image ke andar visible TEXT/LETTERS/NUMBERS edit karta hai. Person, object, hair ya background edits support nahi hote.",
    };
  }

  // --- Pattern 1: "X ko Y kar do / kardo / kare" (Hindi/Hinglish) ---
  let m =
    original.match(
      /^\s*["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60})["']?\s+(?:ko|k|to)\s+["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s+(?:kar\s*(?:do|de|dena|karo|na)?|kardo|krdna|bana\s*do|change|replace|swap|kare)\s*(?:do|karo|kar\s*dijiye|please)?\s*$/i
    ) ||
    original.match(
      /^\s*["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60})["']?\s+(?:ko|k)\s+["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s*$/i
    );

  if (m && m[1] && m[2]) {
    return {
      ok: true,
      type: "replace",
      target: m[1].trim(),
      replacement: m[2].trim(),
    };
  }

  // --- Pattern 2: "change/replace X to/with/by Y" (English) ---
  m = original.match(
    /\b(?:change|replace|swap|convert)\s+["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s+(?:to|with|by|into)\s+["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s*$/i
  );

  if (m && m[1] && m[2]) {
    return {
      ok: true,
      type: "replace",
      target: m[1].trim(),
      replacement: m[2].trim(),
    };
  }

  // --- Pattern 3: "X -> Y" / "X to Y" arrow ---
  m = original.match(
    /^\s*["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s*(?:->|→|=>)\s*["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s*$/
  );

  if (m && m[1] && m[2]) {
    return {
      ok: true,
      type: "replace",
      target: m[1].trim(),
      replacement: m[2].trim(),
    };
  }

  // --- Pattern 4: text remove — "text/watermark hata do" ---
  if (
    /\b(?:remove|delete|hata|hataa|hatao|nikal|mita|erase|saaf)\b/i.test(text) &&
    /\b(?:text|word|writing|watermark|likha|letter|letters|number|numbers|digits|date)\b/i.test(text)
  ) {
    // named target: "2025 hata do" / "remove ABC text"
    const named = original.match(
      /["']?([A-Za-z0-9][A-Za-z0-9 .,\/&-]{0,60}?)["']?\s+(?:text|word|watermark|number|likha|writing)\b/i
    );
    return {
      ok: true,
      type: "remove",
      target: named ? named[1].trim() : "",
    };
  }

  return {
    ok: false,
    reason:
      'Instruction samajh nahi aayi. AI Edit ke liye aise likhein: "8978 ko 4567 kar do", "ABC ko XYZ kar do", ya "change ABC to XYZ".',
  };
}

// ------------------------------------------------------------
// OPENAI CALL — image edit (text-only prompt)
// ------------------------------------------------------------

async function openAiTextEdit(buffer, prompt) {
  if (!OPENAI_KEY) {
    const error = new Error(
      "AI text edit ke liye OPENAI_API_KEY chahiye. Environment variable add karke redeploy karo."
    );
    error.code = 409;
    throw error;
  }

  const png = await sharp(buffer).rotate().png().toBuffer();

  const form = new FormData();
  form.append("model", OPENAI_IMG_MODEL);
  form.append("image", new Blob([png], { type: "image/png" }), "input.png");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "auto");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[AI TEXT EDIT ERROR]", json?.error?.message || response.status);
    const message = json?.error?.message || `OpenAI request failed (${response.status})`;
    // Secret leak prevention: message from OpenAI ko sanitize karo
    const safe = String(message).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
    const error = new Error(safe);
    error.code = 502;
    throw error;
  }

  const base64 = json?.data?.[0]?.b64_json;
  if (!base64) {
    const error = new Error("OpenAI returned no image.");
    error.code = 502;
    throw error;
  }

  return Buffer.from(base64, "base64");
}

// ------------------------------------------------------------
// EXECUTE — replace/remove text with identity-preserving prompt
// ------------------------------------------------------------

async function editText(parsed, buffer) {
  let prompt;

  if (parsed.type === "replace") {
    const esc = (s) => String(s).replace(/["\\]/g, "");
    prompt =
      `This image contains visible text. Find the exact text "${esc(parsed.target)}" ` +
      `that is visibly written inside the image and change ONLY those characters so it ` +
      `reads exactly "${esc(parsed.replacement)}". ` +
      `Keep the same font, font size, font weight, color, alignment, angle, perspective ` +
      `and position. Preserve the background behind the text and re-illuminate it naturally. ` +
      `STRICT RULES: Do NOT modify the person, face, skin, hair, clothing, objects, ` +
      `composition or any other part of the image. Do NOT change any other text. ` +
      `Only the specified characters change; everything else stays pixel-identical.`;
  } else {
    const esc = (s) => String(s).replace(/["\\]/g, "");
    prompt =
      (parsed.target
        ? `Find the visible text "${esc(parsed.target)}" in this image. `
        : `Find the visible text/watermark the user wants removed in this image. `) +
      `Remove ONLY that text and reconstruct the area behind it naturally using ` +
      `surrounding background. Do NOT modify the person, face, hair, clothing, objects ` +
      `or any other part of the image. Do NOT remove or change any other text.`;
  }

  return openAiTextEdit(buffer, prompt);
}

// ------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------

module.exports = {
  parseTextInstruction,
  editText,
  canEdit: () => Boolean(OPENAI_KEY),
};