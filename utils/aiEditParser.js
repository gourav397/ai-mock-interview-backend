// ============================================================
// AI EDIT PARSER — Natural Language Intent Detection
// Supports: English, Hindi (Latin script), Hinglish
// Produces an ordered execution PLAN of editing steps.
// Multi-step support: split on "aur / and / then / phir / fir / , / +"
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
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Protect "black and white" / "black & white" from being split on "and"
function protectPhrases(text) {
  return text
    .replace(/black\s*(?:and|&| Aur )\s*white/gi, "«BLACKWHITE»")
    .replace(/b\s*&\s*w/gi, "«BW»")
    .replace(/kala\s*(?:and|&| aur )\s*safed/gi, "«BLACKWHITE»")
    .replace(/kaala\s*(?:and|&| aur )\s*safaid/gi, "«BLACKWHITE»");
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
  // hex color literal: #fff / #ffffff
  const hexMatch = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hexMatch) return hexMatch[0];
  return null;
}

// "kam / thoda / less" vs "zyada / badha / more" modifiers
function intensity(text) {
  if (/\b(kam|thoda|thodi|less|decrease|halka|halki|reduce|down)\b/i.test(text)) return "reduce";
  if (/\b(zyada|jyada|badha|badhao|badha\s*do|thoda\s*zyada|more|increase|high|up|boost)\b/i.test(text)) return "increase";
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
// ------------------------------------------------------------

function parseSegment(segment) {
  const s = normalize(segment);

  // ---------- REMOVE BACKGROUND ----------
  // "background hata do", "pic me se background hatao", "remove background"
  if (
    /((?:background|bg|back\s*ground)\s*(?:hata|hatao|hataana|hatana|remove|delete|erase|hataa\s*do|hata\s*do))/.test(s) ||
    /(hata(?:o|ana|ana)?\s*(?:do|de)?\s*(?:the\s+)?(?:background|bg|peechhe|piche|peeche))/.test(s) ||
    /(remove|delete|erase)\s+(?:the\s+)?(background|bg)/.test(s) ||
    /(background|bg)\s+(?:nikal|remove|delete|hata)/.test(s) ||
    /(peechhe|piche|peeche)\s*(?:ka|ki)?\s*(?:hata|cheez\s*hata)/.test(s)
  ) {
    return { action: "remove_background" };
  }

  // ---------- REPLACE BACKGROUND ----------
  // "background white kar do", "background ko blue kar do", "white background lagao"
  const color = findColor(s);
  if (
    color &&
    /(background|bg|peechhe|piche|peeche)/.test(s) &&
    /(kar|karo|karna|do|de|lagao|laga|change|replace|badal|set|bana|banana|make)/.test(s)
  ) {
    return { action: "replace_background", color };
  }
  if (
    /(replace|change|badal)\s+(?:the\s+)?(background|bg)/.test(s) &&
    color
  ) {
    return { action: "replace_background", color };
  }

  // ---------- BLACK & WHITE ----------
  if (
    /(black\s*(and|&)\s*white|grayscale|greyscale|monochrome|b\s*&\s*w|kala\s*(?:aur\s*)?safed|kaala\s*(?:aur\s*)?safaid)/.test(s)
  ) {
    return { action: "filter", filter: "black-white" };
  }

  // ---------- UPSCALE ----------
  // "2x upscale", "photo bada kar do", "4x kar do"
  if (/(upscale|enlarge|bada\s*kar|badha\s*(?:do|de)\s*(?:size|resolution))/.test(s) || /\b([234])\s*x\b/.test(s)) {
    const m = s.match(/\b([234])\s*x\b/);
    const factor = m ? parseInt(m[1], 10) : 2;
    return { action: "upscale", scale: factor };
  }

  // ---------- ENHANCE / HD ----------
  // "photo ko HD kar do", "face ko clear kar do", "quality improve karo"
  if (
    /(hd|h\.d\.?|high\s*quality|enhance|improve|better|behtar|sudhar|sudhaar|sharpen|sharp\s*kar|clear\s*kar|clear\s*karo|saaf\s*kar|quality\s*(?:badha|improve|acchi|theek))/.test(s)
  ) {
    return { action: "enhance", scale: 1, sharpness: 1.2 };
  }

  // ---------- BRIGHTNESS ----------
  // "brightness thodi badha do", "ujala karo", "photo roshan kar do", "dark kar do"
  if (/(bright|brightness|ujala|ujlaa|ujal|roshan|roshni|light\s*kar|lighten|chamak\s*(?:badha)?)/.test(s)) {
    const level = intensity(s);
    if (/(dark|andhera|dheema|dim|kam)/.test(s) || level === "reduce") {
      return { action: "adjust", adjustments: { brightness: 0.72 } };
    }
    return { action: "adjust", adjustments: { brightness: 1.3 } };
  }
  if (/(dark|andhera|andhere|dheema|dim\s*kar|darken)/.test(s)) {
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
    /(saturat|vibrant|vivid|chamakdar|colors?\s*(?:badha|zyada|vibrant)|rang\s*(?:badha|zyada|gahra)|saturation)/.test(s)
  ) {
    const level = intensity(s);
    if (level === "reduce" || /(kam|desaturate|halka)/.test(s)) {
      return { action: "adjust", adjustments: { saturation: 0.6 } };
    }
    return { action: "adjust", adjustments: { saturation: 1.5 } };
  }
  if (/(desaturate|saturate\s*kam|saturation\s*kam|rang\s*(?:kam|halka|hate))/.test(s)) {
    return { action: "adjust", adjustments: { saturation: 0.6 } };
  }

  // ---------- FILTERS ----------
  if (/(warm|garam|golden|warm\s*tone)/.test(s)) {
    return { action: "filter", filter: "warm" };
  }
  if (/(cool|thanda|thand|cool\s*tone)/.test(s)) {
    return { action: "filter", filter: "cool" };
  }
  if (/(vintage|retro|purane\s*(?:zamaane\s*)?(?:look|style)|old\s*(?:look|style|photo))/ .test(s)) {
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
  if (/(natural\s*(?:look|enhance)?)/.test(s) && /(filter|look|kar|bana)/.test(s)) {
    return { action: "filter", filter: "natural" };
  }
  if (/(portrait|face\s*(?:clear|enhance|better|behtar|saaf)|chehra\s*(?:clear|saaf|behtar)|selfie)/.test(s)) {
    return { action: "filter", filter: "portrait" };
  }

  // ---------- RESIZE ----------
  // "image ko 1920x1080 kar do", "resize to 800x600"
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
  if (/(crop|kaat|kat\s*do|kaat\s*do|trim|cut\s*kar|center\s*crop)/.test(s)) {
    // Optional explicit crop box: "crop 100,100 400x400"
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
    // Center crop to a percentage if given: "crop 50%" → 50% area
    const pct = s.match(/crop\s*(?:to\s*)?(\d{1,2})\s*%/);
    if (pct) {
      const p = Math.min(Math.max(parseInt(pct[1], 10), 10), 90) / 100;
      return { action: "crop_percent", percent: p };
    }
    // Default: center crop to 80%
    return { action: "crop_percent", percent: 0.8 };
  }

  // ---------- ROTATE ----------
  if (/(rotate|ghuma|ghumao|ghuma\s*do|turn)/.test(s)) {
    const deg = s.match(/(\d{1,3})\s*(?:degree|deg|°|dharan)?/);
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
// Returns { ok: true, plan } or { ok: false, suggestions }
// ------------------------------------------------------------

function parseAiInstruction(instruction) {
  const segments = splitSegments(instruction);
  let plan = [];

  for (const segment of segments) {
    const step = parseSegment(segment);
    if (step) plan.push(step);
  }

  // Whole-instruction fallbacks (multi-word patterns spanning segments)
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

  // Flag ambiguous resize (no dimensions) — executor applies 1024x1024
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