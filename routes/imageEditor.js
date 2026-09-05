// ============================================================
// IMAGE EDITOR — PRODUCTION VERSION
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const sharp = require("sharp");

const router = express.Router();

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const TEMP_DIR = path.join(__dirname, "..", "temp", "processed");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const MAX_DIM = 8192;
const MAX_MB = 20 * 1024 * 1024;

const EXT = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
};

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function safeName(value) {
  if (typeof value !== "string" || !value) return null;

  const name = value
    .split("\\")
    .pop()
    .split("/")
    .pop();

  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  if (!name.includes(".")) return null;

  return name;
}

function abs(filename) {
  return path.join(TEMP_DIR, filename);
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(Number(value), min),
    max
  );
}

function hasKey(name) {
  return Boolean(
    process.env[name] &&
    process.env[name].length > 8
  );
}

function editModel() {
  return process.env.OPENAI_EDIT_MODEL || "gpt-image-1";
}

async function loadBuf(filename) {
  const safe = safeName(filename);

  if (!safe) {
    const error = new Error("Invalid image filename.");
    error.code = 400;
    throw error;
  }

  const filePath = abs(safe);

  if (!fs.existsSync(filePath)) {
    const error = new Error(
      "Source image expired. Re-upload the image."
    );
    error.code = 404;
    throw error;
  }

  return {
    buffer: await fsp.readFile(filePath),
    name: safe,
  };
}

async function metaOf(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();

    return {
      width: metadata.width || null,
      height: metadata.height || null,
      format: EXT[metadata.format] || "jpeg",
      size: buffer.length,
    };
  } catch {
    return {
      width: null,
      height: null,
      format: "jpeg",
      size: buffer.length,
    };
  }
}

async function saveBuf(buffer, hint = "img") {
  let ext = "jpg";

  try {
    const metadata = await sharp(buffer).metadata();
    ext = EXT[metadata.format] || "jpg";
  } catch {
    ext = "jpg";
  }

  const filename =
    `${hint}_${crypto.randomUUID()}.${ext}`;

  await fsp.writeFile(abs(filename), buffer);

  return filename;
}

function previewOf(filename) {
  return `/api/image-editor/preview/${encodeURIComponent(filename)}`;
}

function downloadOf(filename) {
  return `/api/image-editor/download/${encodeURIComponent(filename)}`;
}

async function okRes(res, filename, extra = {}) {
  const buffer = await fsp.readFile(abs(filename));
  const metadata = await metaOf(buffer);

  return res.json({
    success: true,
    message: "Done.",
    filename,
    preview: previewOf(filename),
    download: downloadOf(filename),

    data: {
      filename,
      preview: previewOf(filename),
      download: downloadOf(filename),
      ...metadata,
      ...extra,
    },
  });
}

function errRes(res, status, message, data = {}) {
  return res.status(status).json({
    success: false,
    message,
    error: message,
    data,
  });
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error("[IMAGE EDITOR ERROR]", error);

      const status =
        Number(error.code) >= 400
          ? Number(error.code)
          : 500;

      return errRes(
        res,
        status,
        error.message || "Server error."
      );
    });
  };
}

// ============================================================
// OPENAI AI IMAGE EDIT
// ============================================================

async function openAiEdit(inputBuffer, prompt) {
  if (!hasKey("OPENAI_API_KEY")) {
    const error = new Error(
      "OPENAI_API_KEY missing in environment variables."
    );

    error.code = 409;
    throw error;
  }

  const form = new FormData();

  form.append("model", editModel());

  form.append(
    "image",
    new Blob([inputBuffer], {
      type: "image/png",
    }),
    "input.png"
  );

  form.append("prompt", prompt);

  const response = await fetch(
    "https://api.openai.com/v1/images/edits",
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${process.env.OPENAI_API_KEY}`,
      },

      body: form,
    }
  );

  const json = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    console.error(
      "[OPENAI IMAGE ERROR]",
      json
    );

    const message =
      json?.error?.message ||
      `OpenAI request failed (${response.status})`;

    const error = new Error(message);
    error.code = 502;

    throw error;
  }

  const base64 =
    json?.data?.[0]?.b64_json;

  if (!base64) {
    const error = new Error(
      "OpenAI returned no image."
    );

    error.code = 502;
    throw error;
  }

  return Buffer.from(base64, "base64");
}

// ============================================================
// NLP
// ============================================================

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const REPLACEMENTS = [
  [/\bhataa?\b/g, "hata"],
  [/\bhta\b/g, "hata"],
  [/\bhtado\b/g, "hata do"],
  [/\bkrdo\b/g, "kar do"],
  [/\bkardo\b/g, "kar do"],
  [/\bkro\b/g, "karo"],
  [/\bkr\b/g, "kar"],
  [/\bkrna\b/g, "karna"],
  [/\bbnao\b/g, "bana do"],
  [/\bbanao\b/g, "bana do"],
  [/\bbdhao\b/g, "badha do"],
  [/\bpiche\b/g, "peeche"],
  [/\bpeechhe\b/g, "peeche"],
  [/\bpeechha\b/g, "peeche"],
];

const COLORS = {
  white: "#ffffff",
  safed: "#ffffff",
  safaid: "#ffffff",

  black: "#000000",
  kala: "#000000",
  kaala: "#000000",

  blue: "#0000ff",
  neela: "#0000ff",

  red: "#ff0000",
  laal: "#ff0000",

  green: "#00cc66",
  hara: "#00cc66",

  gray: "#808080",
  grey: "#808080",

  yellow: "#ffff00",
  peela: "#ffff00",

  pink: "#ffc0cb",
  gulabi: "#ffc0cb",

  orange: "#ffa500",
  narangi: "#ffa500",

  purple: "#800080",
};

function hasNumberPair(text) {
  const numbers =
    text.match(/\d{2,12}/g) || [];

  if (numbers.length < 2) {
    return null;
  }

  const intent =
    /(replace|change|badal|swap|with|by|ko\s+(kar|karo|kr|bana|badal)|ke?\s+sath|k\s+sath|->|→)/i
      .test(text);

  if (intent) {
    return {
      oldText: numbers[0],
      newText: numbers[1],
    };
  }

  return null;
}

function parseSteps(rawInstruction) {
  const original = String(rawInstruction || "");
  let text = normalize(original);

  for (const [regex, replacement] of REPLACEMENTS) {
    text = text.replace(regex, replacement);
  }

  const plan = [];

  // ----------------------------------------------------------
  // TEXT / NUMBER REPLACE
  // ----------------------------------------------------------

  const pair = hasNumberPair(text);

  if (pair) {
    plan.push({
      action: "ai_replace_text",
      oldText: pair.oldText,
      newText: pair.newText,
    });
  }

  // ----------------------------------------------------------
  // TEXT REMOVE
  // ----------------------------------------------------------

  if (
    !pair &&
    /(text|word|watermark|writing|likha|number|digit).*(hata|remove|delete|nikal|mita|erase)/i
      .test(text)
  ) {
    plan.push({
      action: "ai_remove_text",
    });
  }

  // ----------------------------------------------------------
  // OBJECT / PERSON REMOVE
  // ----------------------------------------------------------

  if (
    !pair &&
    /(object|aadmi|person|insaan|banda|cheez|sath wala).*(hata|remove|delete|nikal|mita|erase)/i
      .test(text)
  ) {
    plan.push({
      action: "ai_remove_object",
    });
  }

  // ----------------------------------------------------------
  // BACKGROUND REMOVE
  // ----------------------------------------------------------

  const backgroundRemove =
    /(background|bg|peeche)/i.test(text) &&
    /(hata|remove|nikal|delete|clear|saaf)/i.test(text);

  if (!pair && backgroundRemove) {
    plan.push({
      action: "remove_background",
    });
  }

  // ----------------------------------------------------------
  // BACKGROUND COLOR
  // ----------------------------------------------------------

  let backgroundColor = null;

  const hex =
    text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);

  if (hex) {
    backgroundColor = hex[0];
  } else {
    for (const [word, value] of Object.entries(COLORS)) {
      const regex = new RegExp(
        `\\b${word}\\b`,
        "i"
      );

      if (regex.test(text)) {
        backgroundColor = value;
        break;
      }
    }
  }

  if (
    backgroundColor &&
    /(background|bg|peeche)/i.test(text) &&
    !plan.some(
      (step) =>
        step.action === "remove_background"
    )
  ) {
    plan.push({
      action: "replace_background",
      color: backgroundColor,
    });
  }

  // ----------------------------------------------------------
  // BLACK & WHITE
  // ----------------------------------------------------------

  if (
    /(black\s*(and|&)?\s*white|grayscale|monochrome|b\s*w|kala\s*safed)/i
      .test(text)
  ) {
    plan.push({
      action: "filter",
      filter: "black-white",
    });
  }

  // ----------------------------------------------------------
  // ENHANCE
  // ----------------------------------------------------------

  if (
    /\b(hd|h\.d|enhance|sharpen|clear|clarity|quality|professional|behtar|better|accha|acchi)\b/i
      .test(text) &&
    !/(remove|hata)/i.test(text)
  ) {
    plan.push({
      action: "enhance",
    });
  }

  // ----------------------------------------------------------
  // UPSCALE
  // ----------------------------------------------------------

  const upscaleMatch =
    text.match(/\b([2-4])\s*x\b/i);

  if (
    upscaleMatch ||
    /\b(upscale|bada kar|bada do|badao|size badha|large|2x)\b/i
      .test(text)
  ) {
    plan.push({
      action: "upscale",
      scale: upscaleMatch
        ? Number(upscaleMatch[1])
        : 2,
    });
  }

  // ----------------------------------------------------------
  // BRIGHTNESS
  // ----------------------------------------------------------

  if (
    /\b(bright|brightness|ujala|roshan|lighten|light|chamak|roshni)\b/i
      .test(text) &&
    !/dark/i.test(text)
  ) {
    plan.push({
      action: "adjust",
      adjustments: {
        brightness:
          /(kam|less|decrease|thodi kam)/i.test(text)
            ? 0.75
            : 1.3,
      },
    });
  }

  // ----------------------------------------------------------
  // DARKNESS
  // ----------------------------------------------------------

  if (
    /\b(dark|andhera|dim|andhere|darken)\b/i
      .test(text)
  ) {
    plan.push({
      action: "adjust",
      adjustments: {
        brightness: 0.72,
      },
    });
  }

  // ----------------------------------------------------------
  // CONTRAST
  // ----------------------------------------------------------

  if (/\bcontrast\b/i.test(text)) {
    plan.push({
      action: "adjust",
      adjustments: {
        contrast:
          /(kam|less)/i.test(text)
            ? 0.7
            : 1.5,
      },
    });
  }

  // ----------------------------------------------------------
  // SATURATION
  // ----------------------------------------------------------

  if (
    /\b(saturat|vibrant|vivid|colour|color|rang)\b/i
      .test(text) &&
    !/\bb\s*w\b/i.test(text)
  ) {
    plan.push({
      action: "adjust",
      adjustments: {
        saturation: 1.5,
      },
    });
  }

  // ----------------------------------------------------------
  // FILTERS
  // ----------------------------------------------------------

  const FILTERS = {
    warm: /warm|garam/i,
    cool: /cool|thanda/i,
    vintage: /vintage|retro|old/i,
    cinematic: /cinema|film|movie/i,
    soft: /\bsoft\b|naram/i,
    dramatic: /dramatic/i,
    portrait: /portrait|selfie/i,
    sepia: /sepia/i,
  };

  for (const [name, regex] of Object.entries(FILTERS)) {
    if (regex.test(text)) {
      plan.push({
        action: "filter",
        filter: name,
      });
    }
  }

  // ----------------------------------------------------------
  // RESIZE
  // ----------------------------------------------------------

  const resizeMatch =
    text.match(
      /(\d{2,5})\s*[xX×]\s*(\d{2,5})/
    );

  if (resizeMatch && !pair) {
    plan.push({
      action: "resize",
      width: Number(resizeMatch[1]),
      height: Number(resizeMatch[2]),
    });
  }

  // ----------------------------------------------------------
  // CROP
  // ----------------------------------------------------------

  if (/crop|trim|kaat|cut/i.test(text)) {
    const cropMatch =
      text.match(/crop\s*(\d{1,2})\s*%/i);

    plan.push({
      action: "crop_percent",
      percent: cropMatch
        ? clamp(
            Number(cropMatch[1]),
            10,
            90
          ) / 100
        : 0.8,
    });
  }

  // ----------------------------------------------------------
  // ROTATE
  // ----------------------------------------------------------

  if (
    /rotate|ghuma|ghumao|turn|ghtao/i.test(text)
  ) {
    const rotateMatch =
      text.match(/(90|180|270)\s*(degree|deg|°)?/i);

    plan.push({
      action: "rotate",
      degrees:
        /ulta|upside/i.test(text)
          ? 180
          : rotateMatch
          ? Number(rotateMatch[1])
          : 90,
    });
  }

  // ----------------------------------------------------------
  // FREE FORM AI
  // ----------------------------------------------------------

  if (plan.length === 0) {
    if (text.length >= 4) {
      plan.push({
        action: "ai_prompt",
        prompt: original,
      });
    }
  }

  // ----------------------------------------------------------
  // DEDUPE
  // ----------------------------------------------------------

  const seen = new Set();
  const output = [];

  for (const step of plan) {
    const key = JSON.stringify(step);

    if (!seen.has(key)) {
      seen.add(key);
      output.push(step);
    }
  }

  return output.slice(0, 6);
}

// ============================================================
// EXECUTE PLAN
// ============================================================

async function execPlan(buffer, steps) {
  let current = buffer;

  const applied = [];

  for (const step of steps) {
    const action = step.action;

    // --------------------------------------------------------
    // OPENAI AI OPERATIONS
    // --------------------------------------------------------

    if (
      action === "ai_replace_text" ||
      action === "ai_remove_text" ||
      action === "ai_remove_object" ||
      action === "ai_prompt"
    ) {
      let prompt;

      if (action === "ai_replace_text") {
        prompt =
          `In this image, find the visible text "${step.oldText}" ` +
          `and change ONLY that text so it reads exactly ` +
          `"${step.newText}". Keep the same font, size, color, ` +
          `style and position. Do not change anything else.`;
      } else if (action === "ai_remove_text") {
        prompt =
          "Remove the requested text, writing or watermark " +
          "from the image. Naturally reconstruct the area " +
          "behind it. Do not change anything else.";
      } else if (action === "ai_remove_object") {
        prompt =
          "Remove the requested object or person from the image. " +
          "Naturally reconstruct the background behind it. " +
          "Do not change anything else.";
      } else {
        prompt = String(step.prompt || "");
      }

      current = await openAiEdit(
        current,
        prompt
      );

      applied.push(action);

      continue;
    }

    // --------------------------------------------------------
    // BACKGROUND REMOVE
    // --------------------------------------------------------

    if (action === "remove_background") {
      if (hasKey("REMOVE_BG_API_KEY")) {
        const form = new FormData();

        form.append(
          "image_file",
          new Blob([current], {
            type: "image/png",
          }),
          "image.png"
        );

        form.append("size", "auto");

        const response = await fetch(
          "https://api.remove.bg/v1.0/removebg",
          {
            method: "POST",

            headers: {
              "X-Api-Key":
                process.env.REMOVE_BG_API_KEY,
            },

            body: form,
          }
        );

        if (response.ok) {
          current = Buffer.from(
            await response.arrayBuffer()
          );

          applied.push(
            "background removed"
          );

          continue;
        }
      }

      if (hasKey("OPENAI_API_KEY")) {
        current = await openAiEdit(
          current,
          "Remove the background from the main subject. " +
            "Keep the subject intact and make the background " +
            "transparent or cleanly isolated."
        );

        applied.push(
          "background removed"
        );

        continue;
      }

      const error = new Error(
        "Background removal ke liye REMOVE_BG_API_KEY ya OPENAI_API_KEY chahiye."
      );

      error.code = 409;
      throw error;
    }

    // --------------------------------------------------------
    // BACKGROUND COLOR
    // --------------------------------------------------------

    if (action === "replace_background") {
      current = await sharp(current)
        .rotate()
        .flatten({
          background:
            step.color || "#ffffff",
        })
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push(
        "background color"
      );

      continue;
    }

    // --------------------------------------------------------
    // FILTER
    // --------------------------------------------------------

    if (action === "filter") {
      const filter = step.filter;

      let image = sharp(current).rotate();

      if (filter === "black-white") {
        image = image
          .grayscale();
      } else if (filter === "warm") {
        image = image
          .tint({
            r: 255,
            g: 200,
            b: 150,
          })
          .modulate({
            saturation: 1.1,
          });
      } else if (filter === "cool") {
        image = image.tint({
          r: 150,
          g: 200,
          b: 255,
        });
      } else if (filter === "vintage") {
        image = image
          .tint({
            r: 235,
            g: 200,
            b: 160,
          })
          .modulate({
            saturation: 0.6,
            brightness: 0.9,
          })
          .gamma(1.2);
      } else if (filter === "cinematic") {
        image = image
          .modulate({
            saturation: 0.4,
            brightness: 0.9,
          })
          .linear(1.3, -32);
      } else if (filter === "soft") {
        image = image
          .modulate({
            brightness: 1.05,
          })
          .blur(0.5);
      } else if (filter === "dramatic") {
        image = image
          .modulate({
            brightness: 0.8,
            saturation: 1.4,
          })
          .linear(1.8, -64);
      } else if (filter === "portrait") {
        image = image
          .modulate({
            brightness: 1.1,
            saturation: 0.9,
          })
          .sharpen({
            sigma: 1.2,
          });
      } else if (filter === "sepia") {
        image = image.tint({
          r: 255,
          g: 200,
          b: 150,
        });
      } else if (
        filter === "brighten"
      ) {
        image = image.modulate({
          brightness: 1.3,
        });
      } else if (
        filter === "darken"
      ) {
        image = image.modulate({
          brightness: 0.72,
        });
      } else if (
        filter === "saturate"
      ) {
        image = image.modulate({
          saturation: 1.5,
        });
      } else if (
        filter === "desaturate"
      ) {
        image = image.modulate({
          saturation: 0,
        });
      } else if (
        filter === "contrast"
      ) {
        image = image.linear(
          1.5,
          128 * (1 - 1.5)
        );
      } else if (
        filter === "vivid"
      ) {
        image = image.modulate({
          saturation: 1.7,
          brightness: 1.05,
        });
      }

      current = await image
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push(
        `filter:${filter}`
      );

      continue;
    }

    // --------------------------------------------------------
    // ADJUST
    // --------------------------------------------------------

    if (action === "adjust") {
      const adjustments =
        step.adjustments || {};

      let image =
        sharp(current).rotate();

      const modulate = {};

      if (
        adjustments.brightness != null
      ) {
        modulate.brightness =
          clamp(
            adjustments.brightness,
            0.1,
            3
          );
      }

      if (
        adjustments.saturation != null
      ) {
        modulate.saturation =
          clamp(
            adjustments.saturation,
            0,
            3
          );
      }

      if (
        Object.keys(modulate).length
      ) {
        image =
          image.modulate(modulate);
      }

      if (
        adjustments.contrast != null
      ) {
        const contrast =
          clamp(
            adjustments.contrast,
            0.1,
            3
          );

        image = image.linear(
          contrast,
          128 * (1 - contrast)
        );
      }

      current = await image
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push("adjust");

      continue;
    }

    // --------------------------------------------------------
    // ENHANCE
    // --------------------------------------------------------

    if (action === "enhance") {
      current = await sharp(current)
        .rotate()
        .modulate({
          brightness: 1.05,
          saturation: 1.1,
        })
        .sharpen({
          sigma: 1.2,
        })
        .gamma(1.05)
        .jpeg({
          quality: 95,
        })
        .toBuffer();

      applied.push("enhance");

      continue;
    }

    // --------------------------------------------------------
    // UPSCALE
    // --------------------------------------------------------

    if (action === "upscale") {
      const metadata =
        await sharp(current).metadata();

      const scale = clamp(
        step.scale || 2,
        1,
        4
      );

      const width = Math.min(
        Math.round(
          (metadata.width || 1000) *
            scale
        ),
        MAX_DIM
      );

      const height = Math.min(
        Math.round(
          (metadata.height || 1000) *
            scale
        ),
        MAX_DIM
      );

      current = await sharp(current)
        .rotate()
        .resize(
          width,
          height,
          {
            kernel: "lanczos3",
            fit: "fill",
          }
        )
        .sharpen({
          sigma: 0.8,
        })
        .jpeg({
          quality: 95,
        })
        .toBuffer();

      applied.push(
        `upscale:${scale}x`
      );

      continue;
    }

    // --------------------------------------------------------
    // RESIZE
    // --------------------------------------------------------

    if (action === "resize") {
      const width = clamp(
        step.width,
        1,
        MAX_DIM
      );

      const height = clamp(
        step.height,
        1,
        MAX_DIM
      );

      current = await sharp(current)
        .rotate()
        .resize(
          width,
          height,
          {
            fit: "cover",
          }
        )
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push("resize");

      continue;
    }

    // --------------------------------------------------------
    // CROP
    // --------------------------------------------------------

    if (action === "crop_percent") {
      const metadata =
        await sharp(current).metadata();

      const originalWidth =
        metadata.width || 1;

      const originalHeight =
        metadata.height || 1;

      const width = Math.max(
        1,
        Math.round(
          originalWidth *
            step.percent
        )
      );

      const height = Math.max(
        1,
        Math.round(
          originalHeight *
            step.percent
        )
      );

      const left = Math.max(
        0,
        Math.round(
          (originalWidth - width) / 2
        )
      );

      const top = Math.max(
        0,
        Math.round(
          (originalHeight - height) / 2
        )
      );

      current = await sharp(current)
        .rotate()
        .extract({
          left,
          top,
          width,
          height,
        })
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push("crop");

      continue;
    }

    // --------------------------------------------------------
    // ROTATE
    // --------------------------------------------------------

    if (action === "rotate") {
      current = await sharp(current)
        .rotate(
          Number(step.degrees) || 90,
          {
            background: {
              r: 255,
              g: 255,
              b: 255,
              alpha: 1,
            },
          }
        )
        .jpeg({
          quality: 92,
        })
        .toBuffer();

      applied.push(
        `rotate:${step.degrees}`
      );
    }
  }

  return {
    buffer: current,
    applied,
  };
}

// ============================================================
// UPLOAD
// ============================================================

function magicOk(buffer) {
  const jpeg =
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const png =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  const webp =
    buffer.slice(0, 4).toString("ascii") ===
      "RIFF" &&
    buffer.slice(8, 12).toString("ascii") ===
      "WEBP";

  return jpeg || png || webp;
}

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_MB,
    files: 1,
  },
});

router.post(
  "/upload",
  upload.single("image"),
  wrap(async (req, res) => {
    const file = req.file;

    if (!file || !file.buffer) {
      return errRes(
        res,
        400,
        "No image received."
      );
    }

    if (file.size > MAX_MB) {
      return errRes(
        res,
        400,
        "File too large. Maximum 20MB."
      );
    }

    if (!magicOk(file.buffer)) {
      return errRes(
        res,
        400,
        "File is not a valid JPG, PNG or WebP image."
      );
    }

    const png = await sharp(file.buffer)
      .rotate()
      .png()
      .toBuffer();

    const filename =
      await saveBuf(png, "upload");

    return okRes(
      res,
      filename,
      {
        originalName:
          file.originalname || null,
      }
    );
  })
);

// ============================================================
// SIMPLE EDIT HELPER
// ============================================================

async function loadThenExec(
  req,
  res,
  steps,
  hint
) {
  const filename =
    req.body.imagePath ||
    req.body.path;

  const { buffer } =
    await loadBuf(filename);

  const result =
    await execPlan(buffer, steps);

  const output =
    await saveBuf(
      result.buffer,
      hint
    );

  return okRes(res, output, {
    appliedSteps:
      result.applied,
  });
}

// ============================================================
// FILTER
// ============================================================

router.post(
  "/filter",
  wrap(async (req, res) => {
    const known = [
      "natural",
      "brighten",
      "darken",
      "contrast",
      "saturate",
      "desaturate",
      "warm",
      "cool",
      "vintage",
      "black-white",
      "grayscale",
      "cinematic",
      "portrait",
      "soft",
      "vivid",
      "dramatic",
    ];

    if (!known.includes(req.body.filter)) {
      return errRes(
        res,
        400,
        `Unknown filter: ${req.body.filter}`
      );
    }

    return loadThenExec(
      req,
      res,
      [
        {
          action: "filter",
          filter:
            req.body.filter ===
            "grayscale"
              ? "black-white"
              : req.body.filter,
        },
      ],
      "filtered"
    );
  })
);

// ============================================================
// ADJUST
// ============================================================

router.post(
  "/adjust",
  wrap(async (req, res) =>
    loadThenExec(
      req,
      res,
      [
        {
          action: "adjust",
          adjustments:
            req.body.adjustments || {},
        },
      ],
      "adjusted"
    )
  )
);

// ============================================================
// ENHANCE
// ============================================================

router.post(
  "/enhance",
  wrap(async (req, res) =>
    loadThenExec(
      req,
      res,
      [{ action: "enhance" }],
      "enhanced"
    )
  )
);

// ============================================================
// UPSCALE
// ============================================================

router.post(
  "/upscale",
  wrap(async (req, res) =>
    loadThenExec(
      req,
      res,
      [
        {
          action: "upscale",
          scale:
            Number(req.body.scale) || 2,
        },
      ],
      "upscaled"
    )
  )
);

// ============================================================
// RESIZE
// ============================================================

router.post(
  "/resize",
  wrap(async (req, res) =>
    loadThenExec(
      req,
      res,
      [
        {
          action: "resize",
          width:
            Number(req.body.width),
          height:
            Number(req.body.height),
        },
      ],
      "resized"
    )
  )
);

// ============================================================
// ROTATE
// ============================================================

router.post(
  "/rotate",
  wrap(async (req, res) =>
    loadThenExec(
      req,
      res,
      [
        {
          action: "rotate",
          degrees:
            Number(req.body.degrees) ||
            90,
        },
      ],
      "rotated"
    )
  )
);

// ============================================================
// CROP
// ============================================================

router.post(
  "/crop",
  wrap(async (req, res) => {
    const filename =
      req.body.imagePath ||
      req.body.path;

    const { buffer } =
      await loadBuf(filename);

    const metadata =
      await sharp(buffer).metadata();

    const originalWidth =
      metadata.width || 100;

    const originalHeight =
      metadata.height || 100;

    const width = Math.min(
      Number(req.body.width) ||
        originalWidth,
      originalWidth
    );

    const height = Math.min(
      Number(req.body.height) ||
        originalHeight,
      originalHeight
    );

    const left = Math.max(
      0,
      Math.min(
        Number(req.body.left) || 0,
        originalWidth - width
      )
    );

    const top = Math.max(
      0,
      Math.min(
        Number(req.body.top) || 0,
        originalHeight - height
      )
    );

    const output =
      await sharp(buffer)
        .rotate()
        .extract({
          left,
          top,
          width,
          height,
        })
        .jpeg({
          quality: 92,
        })
        .toBuffer();

    const result =
      await saveBuf(
        output,
        "cropped"
      );

    return okRes(
      res,
      result
    );
  })
);

// ============================================================
// REMOVE BACKGROUND
// ============================================================

router.post(
  "/remove-background",
  wrap(async (req, res) => {
    const filename =
      req.body.imagePath ||
      req.body.path;

    const { buffer } =
      await loadBuf(filename);

    const result =
      await execPlan(
        buffer,
        [
          {
            action:
              "remove_background",
          },
        ]
      );

    const output =
      await saveBuf(
        result.buffer,
        "nobg"
      );

    return okRes(
      res,
      output,
      {
        provider: hasKey(
          "REMOVE_BG_API_KEY"
        )
          ? "remove.bg"
          : "openai",
      }
    );
  })
);

// ============================================================
// REPLACE BACKGROUND
// ============================================================

router.post(
  "/replace-background",
  wrap(async (req, res) => {
    const filename =
      req.body.imagePath ||
      req.body.path;

    const { buffer } =
      await loadBuf(filename);

    let color =
      String(
        req.body.color ||
          "#ffffff"
      );

    if (
      !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
        .test(color)
    ) {
      color = "#ffffff";
    }

    const output =
      await sharp(buffer)
        .rotate()
        .flatten({
          background: color,
        })
        .jpeg({
          quality: 92,
        })
        .toBuffer();

    const result =
      await saveBuf(
        output,
        "bg"
      );

    return okRes(
      res,
      result,
      { color }
    );
  })
);

// ============================================================
// AI EDIT
// ============================================================

router.post(
  "/ai-edit",
  wrap(async (req, res) => {
    const instruction =
      String(
        req.body.instruction || ""
      ).trim();

    if (!instruction) {
      return errRes(
        res,
        400,
        "No instruction provided."
      );
    }

    const filename =
      req.body.imagePath ||
      req.body.path;

    const { buffer } =
      await loadBuf(filename);

    const steps =
      parseSteps(instruction);

    if (!steps.length) {
      return errRes(
        res,
        422,
        "Instruction samajh nahi aayi.",
        {
          instruction,
        }
      );
    }

    const aiActions = [
      "ai_replace_text",
      "ai_remove_text",
      "ai_remove_object",
      "ai_prompt",
    ];

    const needsAI =
      steps.some((step) =>
        aiActions.includes(
          step.action
        )
      );

    if (
      needsAI &&
      !hasKey("OPENAI_API_KEY")
    ) {
      return errRes(
        res,
        409,
        "Iss AI edit ke liye OPENAI_API_KEY chahiye. Environment variable add karke redeploy karo.",
        {
          instruction,
          needsProvider: true,
          missingKeys: [
            "OPENAI_API_KEY",
          ],
        }
      );
    }

    const result =
      await execPlan(
        buffer,
        steps
      );

    const output =
      await saveBuf(
        result.buffer,
        "ai_edit"
      );

    return okRes(
      res,
      output,
      {
        instruction,
        appliedSteps:
          result.applied,
        aiModel:
          needsAI
            ? editModel()
            : null,
      }
    );
  })
);

// ============================================================
// RESET
// ============================================================

router.post(
  "/reset",
  wrap(async (req, res) => {
    const filename = safeName(
      req.body.imagePath ||
        req.body.path
    );

    if (!filename) {
      return errRes(
        res,
        400,
        "Invalid imagePath."
      );
    }

    return res.json({
      success: true,
      filename,
      message:
        "Reset to original upload.",
    });
  })
);

// ============================================================
// COMPARE
// ============================================================

router.post(
  "/compare",
  wrap(async (req, res) => {
    const filename = safeName(
      req.body.imagePath ||
        req.body.path
    );

    if (!filename) {
      return errRes(
        res,
        400,
        "Invalid imagePath."
      );
    }

    return res.json({
      success: true,
      filename,
      preview:
        previewOf(filename),

      data: {
        filename,
        preview:
          previewOf(filename),
      },
    });
  })
);

// ============================================================
// PREVIEW
// ============================================================

router.get(
  "/preview/:name",
  wrap(async (req, res) => {
    const filename =
      safeName(req.params.name);

    if (!filename) {
      return errRes(
        res,
        400,
        "Invalid file name."
      );
    }

    const filePath =
      abs(filename);

    if (!fs.existsSync(filePath)) {
      return errRes(
        res,
        404,
        "Source image expired. Re-upload the image."
      );
    }

    let type =
      "image/jpeg";

    if (
      filename.endsWith(".png")
    ) {
      type = "image/png";
    } else if (
      filename.endsWith(".webp")
    ) {
      type = "image/webp";
    }

    res.setHeader(
      "Content-Type",
      type
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return fs
      .createReadStream(filePath)
      .pipe(res);
  })
);

// ============================================================
// DOWNLOAD
// ============================================================

router.get(
  "/download/:name",
  wrap(async (req, res) => {
    const filename =
      safeName(req.params.name);

    if (!filename) {
      return errRes(
        res,
        400,
        "Invalid file name."
      );
    }

    const filePath =
      abs(filename);

    if (!fs.existsSync(filePath)) {
      return errRes(
        res,
        404,
        "Source image expired. Re-upload the image."
      );
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    return fs
      .createReadStream(filePath)
      .pipe(res);
  })
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;