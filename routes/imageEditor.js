// ============================================================
// IMAGE EDITOR ROUTES — PRODUCTION v5.0
// Existing endpoints preserved + NEW:
//   POST /filter              (adds face-glow, portrait-enhance)
//   POST /background-blur     (low|medium|high)
//   POST /hairstyle           (15 styles — requires OPENAI_API_KEY)
//   POST /ai-edit             (TEXT-ONLY via aiTextEdit engine)
// Response format unchanged: { success, message, filename, preview, download, data }
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const crypto = require("crypto");
const sharp = require("sharp");

const {
  ImageProcessor,
  TEMP_DIR,
  applyFilter,
  applyAdjustments,
  enhance,
  upscale,
  removeBackground,
  generatePreview,
  getMetadata,
} = require("../services/imageProcessor");

const { backgroundBlurWithFallback } = require("../services/imageProcessor");
const { parseTextInstruction, editText } = require("../services/aiTextEdit");

const router = express.Router();

// ============================================================
// CONSTANTS
// ============================================================

const MAX_MB = 20 * 1024 * 1024;

const EXT = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp" };

// Known filters — existing + new (FREE/local)
const KNOWN_FILTERS = [
  "natural", "brighten", "darken", "contrast", "saturate", "desaturate",
  "warm", "cool", "vintage", "black-white", "grayscale", "cinematic",
  "portrait", "soft", "vivid", "dramatic",
  "face-glow", "portrait-enhance",
];

// Hairstyles — AI-only (OpenAI gpt-image-1)
const HAIRSTYLES = {
  original:      "Keep the exact same hairstyle, do not change the hair at all.",
  "short-hair":  "Change the hairstyle to a neat short haircut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  "side-part":   "Change the hairstyle to a classic side part haircut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  classic:       "Change the hairstyle to a classic timeless men's haircut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  "crew-cut":    "Change the hairstyle to a crew cut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  textured:      "Change the hairstyle to a modern textured crop hairstyle. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  wavy:          "Change the hairstyle to natural wavy hair. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  curly:         "Change the hairstyle to curly hair. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  "slick-back":  "Change the hairstyle to a slicked back hairstyle. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  undercut:      "Change the hairstyle to an undercut hairstyle. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  fade:          "Change the hairstyle to a clean fade haircut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  fringe:        "Change the hairstyle to a fringe (bangs) hairstyle. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  "buzz-cut":    "Change the hairstyle to a buzz cut. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  "long-hair":   "Change the hairstyle to long hair. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
  messy:         "Change the hairstyle to a messy casual hairstyle. Preserve the person's face, identity, skin tone, expression, clothing and background exactly.",
};

// ============================================================
// HELPERS
// ============================================================

function safeName(value) {
  if (typeof value !== "string" || !value) return null;
  const name = value.split("\\").pop().split("/").pop();
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  if (!name.includes(".")) return null;
  return name;
}

function abs(filename) {
  return path.join(TEMP_DIR, filename);
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function hasKey(name) {
  return Boolean(process.env[name] && process.env[name].length > 8);
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
    const error = new Error("Source image expired. Re-upload the image.");
    error.code = 404;
    throw error;
  }
  return { buffer: await fspRead(filePath), name: safe };
}

async function fspRead(p) {
  return fsPromises.readFile(p);
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
    return { width: null, height: null, format: "jpeg", size: buffer.length };
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
  const filename = `${hint}_${crypto.randomUUID()}.${ext}`;
  await fsPromises.writeFile(abs(filename), buffer);
  return filename;
}

function previewOf(filename) {
  return `/api/image-editor/preview/${encodeURIComponent(filename)}`;
}

function downloadOf(filename) {
  return `/api/image-editor/download/${encodeURIComponent(filename)}`;
}

async function okRes(res, filename, extra = {}) {
  const buffer = await fspRead(abs(filename));
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
  return res.status(status).json({ success: false, message, error: message, data });
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error("[IMAGE EDITOR ERROR]", error.message);
      const status = Number(error.code) >= 400 ? Number(error.code) : 500;
      return errRes(res, status, error.message || "Server error.");
    });
  };
}

async function loadThenApply(req, res, fn, hint, extra = {}) {
  const filename = req.body.imagePath || req.body.path;
  const { buffer } = await loadBuf(filename);
  const output = await fn(buffer);
  const result = await saveBuf(output, hint);
  return okRes(res, result, extra);
}

// ============================================================
// UPLOAD
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB, files: 1 },
});

router.post(
  "/upload",
  upload.single("image"),
  wrap(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) return errRes(res, 400, "No image received.");
    if (file.size > MAX_MB) return errRes(res, 400, "File too large. Maximum 20MB.");

    const validation = ImageProcessor.validateImage(file);
    if (!validation.valid) return errRes(res, 400, validation.error);

    const png = await sharp(file.buffer).rotate().png().toBuffer();
    const filename = await saveBuf(png, "upload");
    return okRes(res, filename, { originalName: file.originalname || null });
  })
);

// ============================================================
// FILTER — existing + face-glow + portrait-enhance
// ============================================================

router.post(
  "/filter",
  wrap(async (req, res) => {
    const filter = req.body.filter === "bw" ? "black-white" : req.body.filter;

    if (!KNOWN_FILTERS.includes(filter)) {
      return errRes(res, 400, `Unknown filter: ${req.body.filter}`);
    }

    return loadThenApply(
      req,
      res,
      (buffer) => applyFilter(buffer, filter),
      "filtered",
      { filter }
    );
  })
);

// ============================================================
// BACKGROUND BLUR — low | medium | high (free/local + optional segmentation)
// ============================================================

router.post(
  "/background-blur",
  wrap(async (req, res) => {
    const intensity = ["low", "medium", "high"].includes(req.body.intensity)
      ? req.body.intensity
      : "medium";

    return loadThenApply(
      req,
      res,
      async (buffer) => {
        const result = await backgroundBlurWithFallback(buffer, intensity);
        result._provider = result.provider;
        return result.buffer;
      },
      "bgblur",
      { intensity, provider: undefined }
    );
  })
);

// ============================================================
// HAIRSTYLE — AI-only (OpenAI). Honest 409 without key.
// ============================================================

router.post(
  "/hairstyle",
  wrap(async (req, res) => {
    const style = String(req.body.style || "").trim().toLowerCase();

    if (!HAIRSTYLES.hasOwnProperty(style)) {
      return errRes(res, 400, `Unknown hairstyle: ${style || "(none)"}`, {
        available: Object.keys(HAIRSTYLES),
      });
    }

    if (!hasKey("OPENAI_API_KEY")) {
      return errRes(
        res,
        409,
        "Hairstyle preview ke liye OPENAI_API_KEY chahiye (AI generation required). Environment variable add karke redeploy karo.",
        { needsProvider: true, missingKeys: ["OPENAI_API_KEY"], style }
      );
    }

    return loadThenApply(
      req,
      res,
      async (buffer) => {
        const png = await sharp(buffer).rotate().png().toBuffer();

        const form = new FormData();
        form.append("model", process.env.OPENAI_EDIT_MODEL || "gpt-image-1");
        form.append("image", new Blob([png], { type: "image/png" }), "input.png");
        form.append(
          "prompt",
          `Edit ONLY the hair of the person in this photo. ${HAIRSTYLES[style]} Keep the face, facial features, skin tone, body, clothing, pose, lighting and background exactly unchanged. Photorealistic result.`
        );
        form.append("n", "1");
        form.append("size", "auto");

        const response = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        });

        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          const safe = String(json?.error?.message || `OpenAI failed (${response.status})`).replace(
            /sk-[A-Za-z0-9_-]+/g,
            "[redacted]"
          );
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
      },
      "hairstyle",
      { style }
    );
  })
);

// ============================================================
// HAIRSTYLE LIST — frontend ke liye
// ============================================================

router.get(
  "/hairstyles",
  wrap(async (req, res) => {
    return res.json({
      success: true,
      data: {
        hairstyles: Object.keys(HAIRSTYLES),
        requires: "OPENAI_API_KEY",
      },
    });
  })
);

// ============================================================
// ADJUST / ENHANCE / UPSCALE / RESIZE / ROTATE / CROP
// (existing behavior preserved)
// ============================================================

router.post(
  "/adjust",
  wrap(async (req, res) =>
    loadThenApply(
      req,
      res,
      (buffer) => applyAdjustments(buffer, req.body.adjustments || {}),
      "adjusted"
    )
  )
);

router.post(
  "/enhance",
  wrap(async (req, res) =>
    loadThenApply(req, res, (buffer) => enhance(buffer, { scale: 1, sharpness: 1.2 }).then((r) => r.buffer), "enhanced")
  )
);

router.post(
  "/upscale",
  wrap(async (req, res) =>
    loadThenApply(req, res, (buffer) => upscale(buffer, Number(req.body.scale) || 2), "upscaled")
  )
);

router.post(
  "/resize",
  wrap(async (req, res) =>
    loadThenApply(
      req,
      res,
      (buffer) =>
        ImageProcessor.resize(buffer, clamp(req.body.width, 1, 8192), clamp(req.body.height, 1, 8192), req.body.fit),
      "resized"
    )
  )
);

router.post(
  "/rotate",
  wrap(async (req, res) =>
    loadThenApply(req, res, (buffer) => ImageProcessor.rotate(buffer, Number(req.body.degrees) || 90), "rotated")
  )
);

router.post(
  "/crop",
  wrap(async (req, res) =>
    loadThenApply(
      req,
      res,
      (buffer) => ImageProcessor.crop(buffer, req.body.left || 0, req.body.top || 0, req.body.width || 1, req.body.height || 1),
      "cropped"
    )
  )
);

// ============================================================
// REMOVE / REPLACE BACKGROUND (existing behavior preserved)
// ============================================================

router.post(
  "/remove-background",
  wrap(async (req, res) => {
    const filename = req.body.imagePath || req.body.path;
    const { buffer } = await loadBuf(filename);

    const result = await removeBackground(buffer);

    if (result.provider === "fallback") {
      const output = await saveBuf(result.buffer, "nobg");
      return okRes(res, output, {
        provider: "fallback",
        note: "REMOVE_BG_API_KEY not configured — PNG conversion only, no real segmentation.",
      });
    }

    const output = await saveBuf(result.buffer, "nobg");
    return okRes(res, output, { provider: result.provider });
  })
);

router.post(
  "/replace-background",
  wrap(async (req, res) => {
    const filename = req.body.imagePath || req.body.path;
    const { buffer } = await loadBuf(filename);

    let color = String(req.body.color || "#ffffff");
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) color = "#ffffff";

    const output = await ImageProcessor.replaceBackground(buffer, { color });
    const result = await saveBuf(output, "bg");
    return okRes(res, result, { color });
  })
);

// ============================================================
// AI EDIT — TEXT ONLY (strict scope)
// "8978 ko 4567 kar do", "ABC ko XYZ", "change ABC to XYZ",
// "text/watermark hata do"  →  OK
// person/hair/background/object edits → 422
// ============================================================

router.post(
  "/ai-edit",
  wrap(async (req, res) => {
    const instruction = String(req.body.instruction || "").trim();

    if (!instruction) {
      return errRes(res, 400, "No instruction provided.");
    }

    const parsed = parseTextInstruction(instruction);

    if (!parsed.ok) {
      const isScope = /person|object|hair|background|face|skin|cloth/i.test(parsed.reason || "");
      return errRes(res, isScope ? 422 : 422, parsed.reason, { instruction });
    }

    if (!hasKey("OPENAI_API_KEY")) {
      return errRes(
        res,
        409,
        "AI text edit ke liye OPENAI_API_KEY chahiye. Environment variable add karke redeploy karo.",
        { instruction, needsProvider: true, missingKeys: ["OPENAI_API_KEY"] }
      );
    }

    const filename = req.body.imagePath || req.body.path;
    const { buffer } = await loadBuf(filename);

    const output = await editText(parsed, buffer);
    const result = await saveBuf(output, "ai_text");

    return okRes(res, result, {
      instruction,
      editType: parsed.type,
      target: parsed.target || null,
      replacement: parsed.replacement || null,
      aiModel: process.env.OPENAI_EDIT_MODEL || "gpt-image-1",
    });
  })
);

// ============================================================
// RESET / COMPARE (existing behavior preserved)
// ============================================================

router.post(
  "/reset",
  wrap(async (req, res) => {
    const filename = safeName(req.body.imagePath || req.body.path);
    if (!filename) return errRes(res, 400, "Invalid imagePath.");
    return res.json({ success: true, filename, message: "Reset to original upload." });
  })
);

router.post(
  "/compare",
  wrap(async (req, res) => {
    const filename = safeName(req.body.imagePath || req.body.path);
    if (!filename) return errRes(res, 400, "Invalid imagePath.");
    return res.json({
      success: true,
      filename,
      preview: previewOf(filename),
      data: { filename, preview: previewOf(filename) },
    });
  })
);

// ============================================================
// PREVIEW / DOWNLOAD (existing behavior preserved)
// ============================================================

router.get(
  "/preview/:name",
  wrap(async (req, res) => {
    const filename = safeName(req.params.name);
    if (!filename) return errRes(res, 400, "Invalid file name.");

    const filePath = abs(filename);
    if (!fs.existsSync(filePath)) {
      return errRes(res, 404, "Source image expired. Re-upload the image.");
    }

    let type = "image/jpeg";
    if (filename.endsWith(".png")) type = "image/png";
    else if (filename.endsWith(".webp")) type = "image/webp";

    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    return fs.createReadStream(filePath).pipe(res);
  })
);

router.get(
  "/download/:name",
  wrap(async (req, res) => {
    const filename = safeName(req.params.name);
    if (!filename) return errRes(res, 400, "Invalid file name.");

    const filePath = abs(filename);
    if (!fs.existsSync(filePath)) {
      return errRes(res, 404, "Source image expired. Re-upload the image.");
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return fs.createReadStream(filePath).pipe(res);
  })
);

module.exports = router;