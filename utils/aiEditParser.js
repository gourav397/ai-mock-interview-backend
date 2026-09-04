// ============================================================
// AI EDIT PARSER — Natural Language Image Editing (v5.0)
// ============================================================
// Supports:
//   English
//   Hindi (Latin/Roman)
//   Hinglish
//   Informal/chat spelling
//   Multiple actions in one command
//   User command order preserved
//
// Examples:
//   "photo HD kar do"
//   "pic ko bright aur clear kar do"
//   "background hata ke HD kar do"
//   "background remove karo aur black white kar do"
//   "face clear karo, brightness thodi badhao"
//   "photo professional bana do"
//   "peeche ki saari extra details hata do"
//   "sirf subject rakho"
//   "background white kar do"
//   "2x bada karo"
//   "1920x1080 kar do"
//   "crop 50%"
//   "90 degree ghumao"
// ============================================================

const COLOR_WORDS = {
  white: "#ffffff",
  safed: "#ffffff",
  safaid: "#ffffff",
  saphed: "#ffffff",

  black: "#000000",
  kala: "#000000",
  kaala: "#000000",

  blue: "#0000ff",
  neela: "#0000ff",
  neeli: "#0000ff",

  red: "#ff0000",
  laal: "#ff0000",
  lal: "#ff0000",

  green: "#00cc66",
  hara: "#00cc66",
  hari: "#00cc66",

  gray: "#808080",
  grey: "#808080",

  yellow: "#ffff00",
  peela: "#ffff00",
  pila: "#ffff00",

  pink: "#ffc0cb",
  gulabi: "#ffc0cb",

  orange: "#ffa500",
  narangi: "#ffa500",

  purple: "#800080",
  baingani: "#800080",
};

// ------------------------------------------------------------
// COMMON HINGLISH / CHAT SPELLINGS
// ------------------------------------------------------------

const SPELLING_RULES = [
  [/\bhataa\b/g, "hata"],
  [/\bhatao\b/g, "hata do"],
  [/\bhtado\b/g, "hata do"],
  [/\bhtade\b/g, "hata de"],
  [/\bhta\b/g, "hata"],

  [/\bnikaldo\b/g, "nikal do"],
  [/\bnikalna\b/g, "nikalna"],

  [/\bkrdo\b/g, "kar do"],
  [/\bkardo\b/g, "kar do"],
  [/\bkrna\b/g, "karna"],
  [/\bkro\b/g, "karo"],
  [/\bkr\b/g, "kar"],

  [/\bbnao\b/g, "bana do"],
  [/\bbanao\b/g, "bana do"],
  [/\bbnado\b/g, "bana do"],

  [/\bbdhao\b/g, "badha do"],
  [/\bbadhaao\b/g, "badha do"],
  [/\bbdhao\b/g, "badha do"],
  [/\bbdhado\b/g, "badha do"],

  [/\bghumao\b/g, "ghuma do"],
  [/\bghumado\b/g, "ghuma do"],

  [/\brhne\b/g, "rehne"],
  [/\brhn\b/g, "rehne"],
  [/\brhndo\b/g, "rehne do"],

  [/\brakho\b/g, "rakho"],
  [/\brkh\b/g, "rakh"],

  [/\bchhodo\b/g, "chhod do"],
  [/\bchodo\b/g, "chhod do"],

  [/\bpiche\b/g, "peeche"],
  [/\bpeechhe\b/g, "peeche"],
  [/\bpeechha\b/g, "peeche"],

  [/\bthoda\b/g, "thoda"],
  [/\bthodi\b/g, "thodi"],

  [/\bzyada\b/g, "zyada"],
  [/\bjyaada\b/g, "zyada"],
  [/\bjayada\b/g, "zyada"],
  [/\bjyada\b/g, "zyada"],

  [/\bsafai\b/g, "saaf"],
];

// ------------------------------------------------------------
// NORMALIZATION
// ------------------------------------------------------------

function normalize(text) {
  let s = String(text || "")
    .toLowerCase()
    .replace(/[“”‘’]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of SPELLING_RULES) {
    s = s.replace(pattern, replacement);
  }

  return s;
}

// ------------------------------------------------------------
// COLOR
// ------------------------------------------------------------

function findColor(text) {
  const s = normalize(text);

  const hex = s.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return hex[0];

  for (const [word, value] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(s)) {
      return value;
    }
  }

  return null;
}

// ------------------------------------------------------------
// INTENSITY
// ------------------------------------------------------------

function intensity(text) {
  const s = normalize(text);

  if (
    /\b(kam|thoda\s+kam|thodi\s+kam|less|decrease|reduce|halka|halki|down)\b/i.test(
      s
    )
  ) {
    return "reduce";
  }

  if (
    /\b(zyada|badha|badhao|more|increase|high|up|boost|strong)\b/i.test(s)
  ) {
    return "increase";
  }

  return "default";
}

// ------------------------------------------------------------
// COMMAND ORDER
// IMPORTANT:
// We DO NOT sort actions by priority.
// User order is preserved.
// ------------------------------------------------------------

const MAX_STEPS = 8;

// ------------------------------------------------------------
// SPLIT COMMANDS
// ------------------------------------------------------------

function splitSegments(instruction) {
  let s = normalize(instruction);

  // Protect black & white from "and/aur" splitting.
  s = s
    .replace(
      /\bblack\s*(?:and|&|aur)\s*white\b/gi,
      "__BLACK_WHITE__"
    )
    .replace(/\bblack\s+white\b/gi, "__BLACK_WHITE__")
    .replace(/\bkala\s*(?:aur|and|&)?\s*safed\b/gi, "__BLACK_WHITE__")
    .replace(/\bkaala\s*(?:aur|and|&)?\s*safaid\b/gi, "__BLACK_WHITE__");

  const parts = s
    .split(
      /\s*(?:,|;|\+|\n)\s*|\s+(?:aur|and|then|phir|fir|also)\s+/i
    )
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.map((x) =>
    x
      .replace(/__BLACK_WHITE__/g, "black and white")
      .trim()
  );
}

// ------------------------------------------------------------
// REMOVE BACKGROUND
// ------------------------------------------------------------

function wantsBackgroundRemoval(s) {
  return (
    /(background|bg|back\s*ground|peeche\s*(?:ka|ki|wala|wali)?)/i.test(s) &&
    /(hata|remove|nikal|delete|erase|clear|saaf|remove\s*kar)/i.test(s)
  ) ||
    /(details?|detail|extra|unwanted|faltu|extra\s*cheeze|cheezein).*(hata|remove|nikal|delete|erase|clear|saaf)/i.test(
      s
    ) ||
    /(sirf|only|just).*(subject|photo|pic|image|person|insaan|face|chehra).*(rakho|rakh|rehne|keep|chhod)/i.test(
      s
    ) ||
    /(subject|photo|pic|image|person|insaan|face|chehra).*(isolate|alag|transparent)/i.test(
      s
    ) ||
    /\btransparent\s+background\b/i.test(s) ||
    /\bbackground\s*(?:ko\s*)?(?:transparent|remove|hata)/i.test(s);
}

// ------------------------------------------------------------
// REPLACE BACKGROUND
// ------------------------------------------------------------

function parseBackgroundReplacement(s) {
  const color = findColor(s);

  if (!color) return null;

  if (
    /(background|bg|peeche|peeche\s+ka|peeche\s+ki)/i.test(s) &&
    /(white|black|blue|red|green|gray|grey|yellow|pink|orange|purple|safed|kala|neela|laal|hara|peela|gulabi|narangi|baingani|change|replace|badal|bana|make|set|lagao|laga)/i.test(
      s
    )
  ) {
    return {
      action: "replace_background",
      color,
    };
  }

  return null;
}

// ------------------------------------------------------------
// BLACK & WHITE
// ------------------------------------------------------------

function wantsBlackWhite(s) {
  return /\b(black\s*(?:and|&)?\s*white|grayscale|greyscale|monochrome|b\s*&\s*w|kala\s*(?:aur|and)?\s*safed|kaala\s*(?:aur|and)?\s*safaid)\b/i.test(
    s
  );
}

// ------------------------------------------------------------
// UPSCALE
// ------------------------------------------------------------

function parseUpscale(s) {
  const multiplier = s.match(/\b([2-4])\s*x\b/i);

  if (
    multiplier ||
    /\b(upscale|enlarge|bada\s+kar|bada\s+do|size\s+badha|resolution\s+badha)\b/i.test(
      s
    )
  ) {
    return {
      action: "upscale",
      scale: multiplier ? Number(multiplier[1]) : 2,
    };
  }

  return null;
}

// ------------------------------------------------------------
// ENHANCE
// ------------------------------------------------------------

function wantsEnhance(s) {
  return /\b(hd|h\.d\.?|high\s*quality|enhance|enhanced|improve|better|behtar|sudhar|sudhaar|sharpen|sharp|clear|clarity|quality|crisp|professional|professional\s+look|clean|clean\s+up|photo\s+ko\s+accha|pic\s+ko\s+accha|photo\s+better|pic\s+better)\b/i.test(s);
}

// ------------------------------------------------------------
// BRIGHTNESS
// ------------------------------------------------------------

function parseBrightness(s) {
  if (
    /\b(bright|brightness|ujala|ujla|ujal|roshan|roshni|light|lighten|chamak)\b/i.test(
      s
    )
  ) {
    return {
      action: "adjust",
      adjustments: {
        brightness: intensity(s) === "reduce" ? 0.75 : 1.3,
      },
    };
  }

  if (/\b(dark|andhera|andhere|dim|darken)\b/i.test(s)) {
    return {
      action: "adjust",
      adjustments: {
        brightness: 0.72,
      },
    };
  }

  return null;
}

// ------------------------------------------------------------
// CONTRAST
// ------------------------------------------------------------

function parseContrast(s) {
  if (!/\bcontrast\b/i.test(s)) return null;

  return {
    action: "adjust",
    adjustments: {
      contrast: intensity(s) === "reduce" ? 0.7 : 1.5,
    },
  };
}

// ------------------------------------------------------------
// SATURATION
// ------------------------------------------------------------

function parseSaturation(s) {
  if (
    /\b(saturation|saturate|vibrant|vivid|chamakdar|rang\s+badha|colors?\s+badha)\b/i.test(
      s
    )
  ) {
    return {
      action: "adjust",
      adjustments: {
        saturation: intensity(s) === "reduce" ? 0.6 : 1.5,
      },
    };
  }

  if (/\b(desaturate|rang\s+kam|rang\s+halka)\b/i.test(s)) {
    return {
      action: "adjust",
      adjustments: {
        saturation: 0.6,
      },
    };
  }

  return null;
}

// ------------------------------------------------------------
// FILTER
// ------------------------------------------------------------

function parseFilter(s) {
  if (/\b(warm|garam|golden|warm\s+tone)\b/i.test(s)) {
    return { action: "filter", filter: "warm" };
  }

  if (/\b(cool|thanda|thand|cool\s+tone)\b/i.test(s)) {
    return { action: "filter", filter: "cool" };
  }

  if (/\b(vintage|retro|old\s+look|old\s+style|purana\s+look)\b/i.test(s)) {
    return { action: "filter", filter: "vintage" };
  }

  if (
    /\b(cinematic|cinema|film\s+look|movie\s+look|film\s+jaisa)\b/i.test(s)
  ) {
    return { action: "filter", filter: "cinematic" };
  }

  if (/\b(soft|smooth|naram|soft\s+look)\b/i.test(s)) {
    return { action: "filter", filter: "soft" };
  }

  if (/\b(dramatic|drama)\b/i.test(s)) {
    return { action: "filter", filter: "dramatic" };
  }

  if (
    /\b(portrait|selfie|face\s+clear|face\s+enhance|chehra\s+clear|chehra\s+saaf)\b/i.test(
      s
    )
  ) {
    return { action: "filter", filter: "portrait" };
  }

  return null;
}

// ------------------------------------------------------------
// RESIZE
// ------------------------------------------------------------

function parseResize(s) {
  const dims = s.match(/(\d{2,5})\s*[xX×]\s*(\d{2,5})/);

  if (!dims) return null;

  const width = Number(dims[1]);
  const height = Number(dims[2]);

  if (
    width < 8 ||
    height < 8 ||
    width > 8192 ||
    height > 8192
  ) {
    return null;
  }

  return {
    action: "resize",
    width,
    height,
  };
}

// ------------------------------------------------------------
// CROP
// ------------------------------------------------------------

function parseCrop(s) {
  if (!/\b(crop|trim|cut|kaat|kat)\b/i.test(s)) {
    return null;
  }

  const percent = s.match(/\b(?:crop\s*(?:to\s*)?)(\d{1,2})\s*%/i);

  if (percent) {
    const p = Math.min(
      Math.max(Number(percent[1]), 10),
      90
    ) / 100;

    return {
      action: "crop_percent",
      percent: p,
    };
  }

  return {
    action: "crop_percent",
    percent: 0.8,
  };
}

// ------------------------------------------------------------
// ROTATE
// ------------------------------------------------------------

function parseRotate(s) {
  if (!/\b(rotate|ghuma|ghumao|ghuma\s+do|turn)\b/i.test(s)) {
    return null;
  }

  if (/\bulta|upside\s*down\b/i.test(s)) {
    return {
      action: "rotate",
      degrees: 180,
    };
  }

  const degree = s.match(
    /\b(90|180|270|360)\s*(?:degree|degrees|deg|°)?\b/i
  );

  return {
    action: "rotate",
    degrees: degree ? Number(degree[1]) % 360 : 90,
  };
}

// ------------------------------------------------------------
// PARSE ONE SEGMENT
//
// IMPORTANT:
// This function can return MULTIPLE actions.
// ------------------------------------------------------------

function parseSegment(segment) {
  const s = normalize(segment);
  const steps = [];

  // Background removal
  if (wantsBackgroundRemoval(s)) {
    steps.push({
      action: "remove_background",
    });
  }

  // Background replacement
  const replacement = parseBackgroundReplacement(s);
  if (replacement) {
    steps.push(replacement);
  }

  // Black & white
  if (wantsBlackWhite(s)) {
    steps.push({
      action: "filter",
      filter: "black-white",
    });
  }

  // Brightness
  const brightness = parseBrightness(s);
  if (brightness) {
    steps.push(brightness);
  }

  // Contrast
  const contrast = parseContrast(s);
  if (contrast) {
    steps.push(contrast);
  }

  // Saturation
  const saturation = parseSaturation(s);
  if (saturation) {
    steps.push(saturation);
  }

  // Filters
  const filter = parseFilter(s);
  if (filter) {
    steps.push(filter);
  }

  // Enhance
  if (wantsEnhance(s)) {
    steps.push({
      action: "enhance",
      scale: 1,
      sharpness: 1.2,
    });
  }

  // Upscale
  const upscale = parseUpscale(s);
  if (upscale) {
    steps.push(upscale);
  }

  // Resize
  const resize = parseResize(s);
  if (resize) {
    steps.push(resize);
  }

  // Crop
  const crop = parseCrop(s);
  if (crop) {
    steps.push(crop);
  }

  // Rotate
  const rotate = parseRotate(s);
  if (rotate) {
    steps.push(rotate);
  }

  return steps;
}

// ------------------------------------------------------------
// DEDUPE
// DOES NOT SORT.
// USER ORDER / DETECTION ORDER IS PRESERVED.
// ------------------------------------------------------------

function dedupe(plan) {
  const seen = new Set();
  const result = [];

  for (const step of plan) {
    const key = JSON.stringify(step);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(step);
    }
  }

  return result.slice(0, MAX_STEPS);
}

// ------------------------------------------------------------
// MAIN PARSER
// ------------------------------------------------------------

function parseAiInstruction(instruction) {
  const original = String(instruction || "").trim();

  if (!original) {
    return {
      ok: false,
      reason: "empty_instruction",
    };
  }

  const segments = splitSegments(original);

  let plan = [];

  // Parse each segment.
  for (const segment of segments) {
    const steps = parseSegment(segment);
    plan.push(...steps);
  }

  // ----------------------------------------------------------
  // Whole-command semantic fallbacks
  // ----------------------------------------------------------

  if (plan.length === 0) {
    const whole = normalize(original);

    // Generic "professional / beautiful / improve" request
    if (
      /\b(professional|beautiful|attractive|acchi|accha|sundar|better|behtar|clean|clear|quality)\b/i.test(
        whole
      )
    ) {
      plan.push({
        action: "enhance",
        scale: 1,
        sharpness: 1.2,
      });
    }

    // Generic light request
    if (
      /\b(roshan|ujala|bright|brightness|light)\b/i.test(whole)
    ) {
      plan.push({
        action: "adjust",
        adjustments: {
          brightness: 1.3,
        },
      });
    }

    // Generic dark request
    if (
      /\b(dark|andhera|dim)\b/i.test(whole)
    ) {
      plan.push({
        action: "adjust",
        adjustments: {
          brightness: 0.72,
        },
      });
    }

    // Generic background request
    if (
      /\b(background|bg|peeche)\b/i.test(whole) &&
      /\b(remove|hata|nikal|clear|saaf)\b/i.test(whole)
    ) {
      plan.push({
        action: "remove_background",
      });
    }
  }

  plan = dedupe(plan);

  if (plan.length === 0) {
    return {
      ok: false,
      reason: "unsupported_instruction",
      normalized: normalize(original),
    };
  }

  return {
    ok: true,
    plan,
    normalized: normalize(original),
    segments,
  };
}

// ------------------------------------------------------------
// HUMAN-READABLE STEP
// ------------------------------------------------------------

function describeStep(step) {
  if (!step) return "unknown action";

  switch (step.action) {
    case "remove_background":
      return "remove background";

    case "replace_background":
      return `replace background with ${step.color}`;

    case "filter":
      return `filter: ${step.filter}`;

    case "adjust": {
      const parts = [];

      if (step.adjustments?.brightness !== undefined) {
        parts.push(
          `brightness ${step.adjustments.brightness}x`
        );
      }

      if (step.adjustments?.contrast !== undefined) {
        parts.push(
          `contrast ${step.adjustments.contrast}x`
        );
      }

      if (step.adjustments?.saturation !== undefined) {
        parts.push(
          `saturation ${step.adjustments.saturation}x`
        );
      }

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
      return `center crop to ${Math.round(
        step.percent * 100
      )}%`;

    case "rotate":
      return `rotate ${step.degrees}°`;

    default:
      return step.action;
  }
}

// ------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------

module.exports = {
  parseAiInstruction,
  describeStep,
  COLOR_WORDS,
};
