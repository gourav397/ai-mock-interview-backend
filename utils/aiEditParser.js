// ============================================================
// AI EDIT PARSER — Natural Language Intent Detection (v4.1)
// Supports: English, Hindi (Latin script), Hinglish
// NEW: Hinglish spelling normalization (hta → hata, rhne → rehne, ...)
// NEW: "details ko hta de pic me se only pic ko rhne de"
//      → recognized as remove background / unwanted surroundings
// NEW: "black white" (without "and"), "sirf subject rakho", "isolate",
//      "transparent background"
// Multi-step: split on "aur / and / then / phir / fir / , / + / or / ya"
// No external AI API required — deterministic rule-based parser.
// ============================================================

// ------------------------------------------------------------
// COLOR VOCABULARY (hex values)
// ------------------------------------------------------------
const COLOR_WORDS = {
  white: "#ffffff", safed: "#ffffff", safaid: "#ffffff", saphed: "#ffffff",
  black: "#000000", kaala: "#000000", kala: "#000000",
  blue: "#0000ff", neela: "#0000ff", neeli: "#0000ff",
  red: "#ff0000", laal: "#ff0000", lal: "#ff0000", surkh: "#ff0000",
  green: "#00cc66", hara: "#00cc66", sabz: "#00cc66",
  gray: "#808080", grey: "#808080", slati: "#808080", slate: "#808080",
  yellow: "#ffff00", peela: "#ffff00", pila: "#ffff00",
  pink: "#ffc0cb", gulabi: "#ffc0cb",
  orange: "#ffa500", narangi: "#ffa500",
  purple: "#800080", baingani: "#800080",
};

// ------------------------------------------------------------
// HINGLISH SPELLING NORMALIZATION
// Maps common truncated/informal spellings to canonical forms
// BEFORE intent matching. Order matters.
// ------------------------------------------------------------
const SPELLING_RULES = [
  [/\bhataa\b/g, "hata"],
  [/\bhatade\b/g, "hata de"],
  [/\bhatao\b/g, "hata do"],
  [/\bhta\b/g, "hata"],           // "hta" → "hata"
  [/\bhtade\b/g, "hata de"],
  [/\bnikaldo\b/g, "nikal do"],
  [/\bhatado\b/g, "hata do"],
  [/\bkrdo\b/g, "kar do"],
  [/\bkardo\b/g, "kar do"],
  [/\bkr\b/g, "kar"],             // "kr" → "kar"
  [/\bkro\b/g, "karo"],
  [/\bkrna\b/g, "karna"],
  [/\bkarke\b/g, "kar ke"],
  [/\brhne\b/g, "rehne"],         // "rhne" → "rehne"
  [/\brehn\b/g, "rehne"],
  [/\brhndo\b/g, "rehne do"],
  [/\brakho\b/g, "rakho"],
  [/\brakhna\b/g, "rakhna"],
  [/\bchhodo\b/g, "chhod do"],
  [/\bchodo\b/g, "chhod do"],
  [/\bbanao\b/g, "bana do"],
  [/\bbadhaao\b/g, "badha do"],
  [/\bbdhao\b/g, "badha do"],
  [/\bbada\b/g, "bada"],
  [/\bpiche\b/g, "peeche"],
  [/\bpeechhe\b/g, "peeche"],
  [/\bpeechha\b/g, "peeche"],
  [/\bsafed\b/g, "safed"],
  [/\bko\s+htado\b/g, "ko hata do"],
  [/\bhata\s+de\b/g, "hata de"],
  [/\bde\s+do\b/g, "de do"],
];

// ------------------------------------------------------------
// Step priority — background ops first, geometry last
// ------------------------------------------------------------
const STEP_PRIORITY = {
  remove_background: 0,
  replace_background: 0,
  filter: 1,
  adjust: 1,
  enhance: 2,
  upscale: 2,
  resize: 3,
  crop: 3,
  rotate: 3,
};

const MAX_STEPS = 5;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function normalize(text) {
  let s = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();

  // Apply Hinglish spelling normalization
  for (const [pattern, replacement] of SPELLING_RULES) {
    s = s.replace(pattern, replacement);
  }

  return s;
}

// Protect "black and white" style phrases from being split on "and"/"aur"
function protectPhrases(text) {
  return text
    .replace(/black\s*(?:and|&|aur)\s*white/gi, "«BLACKWHITE»")
    .replace(/black\s+white/gi, "«BLACKWHITE»") // "black white kar do"
    .replace(/b\s*&\s*w/gi, "«BW»")
    .replace(/kala\s*(?:and|&|aur)?\s*safed/gi, "«BLACKWHITE»")
    .replace(/kaala\s*(?:and|&|aur)?\s*safaid/gi, "«BLACKWHITE»");
}

function restorePhrases(text) {
  return text
    .replace(/«BLACKWHITE»/g, "black and white")
    .replace(/«BW»/g, "b&w");
}

function splitSegments(instruction) {
  const protectedText = protectPhrases(normalize(instruction));
  return protectedText
    .split(/[,+\n]+|\s+(?:aur|and|then|phir|fir|or|ya|also)\s+/i)
    .map(restorePhrases)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findColor(text) {
  for (const [name, hex] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return hex;
  }
  const hexMatch = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hexMatch) return hexMatch[0];
  return null;
}

// "kam / thoda / less" vs "zyada / badha / more" modifiers
function intensity(text) {
  if (/\b(kam|thoda|thodi|less|decrease|halka|halki|reduce|down)\b/i.test(text)) return "reduce";
  if (/\b(zyada|jyada|badha|more|increase|high|up|boost)\b/i.test(text)) return "increase";
  return "default";
}

function dedupeAndSort(plan) {
  const seen = new Set();
  const unique = [];
  for (const step of plan) {
    const key = JSON.stringify(step);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(step);
    }
  }
  return unique
    .sort((a, b) => (STEP_PRIORITY[a.action] ?? 9) - (STEP_PRIORITY[b.action] ?? 9))
    .slice(0, MAX_STEPS);
}

// ------------------------------------------------------------
// SINGLE SEGMENT PARSER — detects one intent from one phrase
// REMOVE BACKGROUND is checked FIRST (highest semantic priority)
// ------------------------------------------------------------

function parseSegment(segment) {
  const s = normalize(segment);

  // ---------- REMOVE BACKGROUND ----------
  // Matches (after normalization):
  //   "background hata do" / "background remove kar do" / "bg nikal do"
  //   "pic ka background hata de"
  //   "details ko hata de pic me se only pic ko rehne de"   ← the failing case
  //   "sirf main subject rakho" / "only photo rehne do"
  //   "photo ko isolate kar do" / "background remove karke transparent kar do"
  if (
    // background + removal verb (any order)
    /(background|bg|peeche\s+ka|peeche\s+ki)\s*(?:ko|to)?\s*(?:se\s*)?(hata|remove|nikal|delete|erase|clear|saaf)/.test(s) ||
    /(hata|remove|nikal|delete|erase)\s*(?:do|de|dijiye|karo|kar)?\s*(?:the\s+)?(background|bg)/.test(s) ||
    /(background|bg)\s+(?:nikal|hata|remove|delete)/.test(s) ||
    // "details ko hata de ..." — remove unwanted surrounding details
    /(details?|detail)\s*(?:ko|to)?\s*(?:se\s*)?(hata|remove|nikal|delete|erase)/.test(s) ||
    // "only/sirf ... subject/photo/pic ... rakho/rehne do/keep"
    /(only|sirf|sirph|just)\s+(?:main\s+|subject\s+|photo\s+|pic\s+|image\s+)*(subject|photo|pic|image|person|insaan|object|chehra|face)\s*(?:ko)?\s*(rakho|rakh|rehne|rehn|keep|chhod)/.test(s) ||
    /(sirf|only)\s+(?:main\s+)?(photo|pic|image|subject)\s+(?:rehne|rakho|rakh)/.test(s) ||
    // "photo ko isolate kar do" / "transparent background"
    /(photo|pic|image|subject)\s*(?:ko)?\s*(isolate|transparent)\s*(?:kar|karo|karna)?/.test(s) ||
    /(transparent\s+background)/.test(s) ||
    /(unwanted)\s+(?:details?|surroundings?|background)/.test(s)
  ) {
    return { action: "remove_background" };
  }

  // ---------- REPLACE BACKGROUND ----------
  const color = findColor(s);
  if (
    color &&
    /(background|bg|peeche|peeche\s+ka)/.test(s) &&
    /(kar|karo|karna|do|de|lagao|laga|change|replace|badal|set|bana|banana|make)/.test(s)
  ) {
    return { action: "replace_background", color };
  }
  if (/(replace|change|badal)\s+(?:the\s+)?(background|bg)/.test(s) && color) {
    return { action: "replace_background", color };
  }

  // ---------- BLACK & WHITE ----------
  if (
    /(black\s*(?:and|&)?\s*white|grayscale|greyscale|monochrome|b\s*&\s*w|kala\s*(?:aur\s*)?safed|kaala\s*(?:aur\s*)?safaid)/.test(s)
  ) {
    return { action: "filter", filter: "black-white" };
  }

  // ---------- UPSCALE ----------
  // "2x bada kar do", "2x upscale", "photo bada kar do"
  if (/(upscale|enlarge|bada\s*kar|badha\s*(?:do|de)?\s*(?:size|resolution))/.test(s) || /\b([234])\s*x\b/.test(s)) {
    const m = s.match(/\b([234])\s*x\b/);
    const factor = m ? parseInt(m[1], 10) : 2;
    return { action: "upscale", scale: factor };
  }

  // ---------- ENHANCE / HD / CLEAR ----------
  if (
    /(hd|h\.d\.?|high\s*quality|enhance|improve|better|behtar|sudhar|sudhaar|sharpen|sharp|clear|saaf\s*kar|quality|crisp)/.test(s)
  ) {
    return { action: "enhance", scale: 1, sharpness: 1.2 };
  }

  // ---------- BRIGHTNESS ----------
  if (/(bright|brightness|ujala|ujlaa|ujal|roshan|roshni|light|lighten|chamak)/.test(s)) {
    const level = intensity(s);
    if (/(dark|andhera|dheema|dim)/.test(s) || level === "reduce") {
      return { action: "adjust", adjustments: { brightness: 0.72 } };
    }
    return { action: "adjust", adjustments: { brightness: 1.3 } };
  }
  if (/(dark|andhera|andhere|dheema|dim|darken)/.test(s)) {
    return { action: "adjust", adjustments: { brightness: 0.72 } };
  }

  // ---------- CONTRAST ----------
  if (/contrast/.test(s)) {
    const level = intensity(s);
    if (level === "reduce") return { action: "adjust", adjustments: { contrast: 0.7 } };
    return { action: "adjust", adjustments: { contrast: 1.5 } };
  }

  // ---------- SATURATION ----------
  if (
    /(saturat|vibrant|vivid|chamakdar|colors?\s*(?:badha|zyada|vibrant)|rang\s*(?:badha|zyada|gahra))/.test(s)
  ) {
    const level = intensity(s);
    if (level === "reduce" || /(kam|desaturate|halka)/.test(s)) {
      return { action: "adjust", adjustments: { saturation: 0.6 } };
    }
    return { action: "adjust", adjustments: { saturation: 1.5 } };
  }
  if (/(desaturate|saturation\s*kam|rang\s*(?:kam|halka|hate))/.test(s)) {
    return { action: "adjust", adjustments: { saturation: 0.6 } };
  }

  // ---------- FILTERS ----------
  if (/(warm|garam|golden|warm\s*tone)/.test(s)) {
    return { action: "filter", filter: "warm" };
  }
  if (/(cool|thanda|thand|cool\s*tone)/.test(s)) {
    return { action: "filter", filter: "cool" };
  }
  if (/(vintage|retro|purane\s*(?:zamaane\s*)?(?:look|style)|old\s*(?:look|style|photo))/.test(s)) {
    return { action: "filter", filter: "vintage" };
  }
  if (/(cinematic|film\s*look|movie\s*look|film\s*jaisa)/.test(s)) {
    return { action: "filter", filter: "cinematic" };
  }
  if (/(soft|naram|smooth|soft\s*look)/.test(s)) {
    return { action: "filter", filter: "soft" };
  }
  if (/(dramatic|drama)/.test(s)) {
    return { action: "filter", filter: "dramatic" };
  }
  if (/(portrait|face\s*(?:clear|enhance|better|behtar|saaf)|chehra\s*(?:clear|saaf|behtar)|selfie)/.test(s)) {
    return { action: "filter", filter: "portrait" };
  }

  // ---------- RESIZE ----------
  const dims = s.match(/(\d{2,5})\s*[xX×]\s*(\d{2,5})/);
  if (dims) {
    const w = parseInt(dims[1], 10);
    const h = parseInt(dims[2], 10);
    if (w >= 8 && h >= 8 && w <= 8192 && h <= 8192) {
      return { action: "resize", width: w, height: h };
    }
  }
  if (/(resize|size\s*badal|size\s*change)/.test(s)) {
    return { action: "resize", width: 1024, height: 1024, _ambiguous: "no dimensions given" };
  }

  // ---------- CROP ----------
  if (/(crop|kaat|kaat\s*do|kat\s*do|trim|cut\s*kar|center\s*crop)/.test(s)) {
    const box = s.match(/(\d{1,5})\s*[, ]\s*(\d{1,5})\s*(?:\(|,| )?\s*(\d{2,5})\s*[xX×]\s*(\d{2,5})/);
    if (box) {
      return {
        action: "crop",
        left: parseInt(box[1], 10),
        top: parseInt(box[2], 10),
        width: parseInt(box[3], 10),
        height: parseInt(box[4], 10),
      };
    }
    const pct = s.match(/crop\s*(?:to\s*)?(\d{1,2})\s*%/);
    if (pct) {
      const p = Math.min(Math.max(parseInt(pct[1], 10), 10), 90) / 100;
      return { action: "crop_percent", percent: p };
    }
    return { action: "crop_percent", percent: 0.8 };
  }

  // ---------- ROTATE ----------
  if (/(rotate|ghuma|ghumao|turn)/.test(s)) {
    const deg = s.match(/(\d{1,3})\s*(?:degree|deg|°)?/);
    if (deg) {
      const d = parseInt(deg[1], 10);
      if (d > 0 && d <= 359) return { action: "rotate", degrees: d };
    }
    if (/(ulta|upside)/.test(s)) return { action: "rotate", degrees: 180 };
    return { action: "rotate", degrees: 90 };
  }
  if (/\b(90|180|270)\s*(?:degree|deg|°)?\b/.test(s) && /(photo|image|pic|kar|do)/.test(s)) {
    const d = parseInt(s.match(/\b(90|180|270)\b/)[1], 10);
    return { action: "rotate", degrees: d };
  }

  return null; // segment not understood
}

// ------------------------------------------------------------
// MAIN PARSER
// Returns { ok: true, plan } or { ok: false }
// ------------------------------------------------------------

function parseAiInstruction(instruction) {
  const segments = splitSegments(instruction);
  let plan = [];

  for (const segment of segments) {
    const step = parseSegment(segment);
    if (step) plan.push(step);
  }

  // Whole-instruction fallbacks (patterns spanning segments)
  if (plan.length === 0) {
    const whole = normalize(instruction);

    if (/(hd|enhance|behtar|saaf|clear|quality)/.test(whole)) {
      plan.push({ action: "enhance", scale: 1, sharpness: 1.2 });
    }
    if (/(bright|ujala|roshan)/.test(whole)) {
      plan.push({ action: "adjust", adjustments: { brightness: 1.3 } });
    }
    if (plan.length === 0) {
      return { ok: false };
    }
  }

  plan = dedupeAndSort(plan);
  return { ok: true, plan };
}

// ------------------------------------------------------------
// HUMAN-READABLE STEP NAMES (for response messages)
// ------------------------------------------------------------

function describeStep(step) {
  switch (step.action) {
    case "remove_background":
      return "remove background";
    case "replace_background":
      return `replace background with ${step.color}`;
    case "filter":
      return `filter: ${step.filter}`;
    case "adjust": {
      const parts = [];
      if (step.adjustments.brightness !== undefined) parts.push(`brightness ${step.adjustments.brightness}x`);
      if (step.adjustments.contrast !== undefined) parts.push(`contrast ${step.adjustments.contrast}x`);
      if (step.adjustments.saturation !== undefined) parts.push(`saturation ${step.adjustments.saturation}x`);
      return `adjust (${parts.join(", ")})`;
    }
    case "enhance":
      return `enhance ${step.scale || 1}x`;
    case "upscale":
      return `upscale ${step.scale}x`;
    case "resize":
      return `resize to ${step.width}x${step.height}`;
    case "crop":
      return `crop ${step.width}x${step.height} at (${step.left},${step.top})`;
    case "crop_percent":
      return `center crop to ${Math.round(step.percent * 100)}%`;
    case "rotate":
      return `rotate ${step.degrees}°`;
    default:
      return step.action;
  }
}

module.exports = {
  parseAiInstruction,
  describeStep,
  COLOR_WORDS,
};