// ============================================================
// IMAGE PROCESSOR — Sharp Pipeline (PRODUCTION v3.0)
// Exports: ImageProcessor object + TEMP_DIR + backward-compat functions
// ============================================================

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const crypto = require("crypto");

const TEMP_DIR = path.join(__dirname, "..", "temp", "processed");
const PREVIEW_DIR = path.join(__dirname, "..", "temp", "previews");

// Limits
const MAX_DIMENSION = 8192;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// Ensure temp directories exist (works on Linux/Render and Windows)
[TEMP_DIR, PREVIEW_DIR].forEach((dir) => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.error(`[ImageProcessor] Failed to create dir ${dir}:`, err.message);
  }
});

// ============================================================
// HELPERS
// ============================================================

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

const EXT_MAP = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", tiff: "jpg", gif: "jpg" };

function sanitizeNameHint(nameHint) {
  return (
    String(nameHint || "img")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 60) || "img"
  );
}

function isValidHexColor(color) {
  return typeof color === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);
}

// ============================================================
// FILTER PRESETS
// ============================================================

const FILTER_PRESETS = {
  natural: async (img) => img,
  brighten: async (img) => img.modulate({ brightness: 1.3 }),
  darken: async (img) => img.modulate({ brightness: 0.7 }),
  contrast: async (img) => img.linear(1.5, -128 * 0.5),
  saturate: async (img) => img.modulate({ saturation: 1.8 }),
  desaturate: async (img) => img.modulate({ saturation: 0.2 }),
  warm: async (img) => img.tint({ r: 255, g: 200, b: 150 }).modulate({ saturation: 1.1 }),
  cool: async (img) => img.tint({ r: 150, g: 200, b: 255 }).modulate({ saturation: 1.1 }),
  vintage: async (img) =>
    img.tint({ r: 235, g: 200, b: 160 }).modulate({ saturation: 0.6, brightness: 0.9 }).gamma(1.2),
  bw: async (img) => img.toColorspace("b-w"),
  "black-white": async (img) => img.toColorspace("b-w"), // alias
  grayscale: async (img) => img.toColorspace("b-w"), // alias
  cinematic: async (img) =>
    img.modulate({ saturation: 0.4, brightness: 0.9 }).linear(1.3, -32).gamma(1.1),
  portrait: async (img) => img.modulate({ brightness: 1.1, saturation: 0.9 }).sharpen({ sigma: 1.2 }).blur(0.3),
  soft: async (img) => img.modulate({ brightness: 1.05 }).blur(0.5).gamma(0.9),
  vivid: async (img) => img.modulate({ saturation: 1.6, brightness: 1.1 }).sharpen({ sigma: 0.8 }),
  dramatic: async (img) =>
    img.modulate({ brightness: 0.8, saturation: 1.4 }).linear(1.8, -64).gamma(1.3),
};

// ============================================================
// VALIDATE IMAGE (multer file object)
// Checks: existence, mimetype, size, AND magic bytes (content sniffing)
// ============================================================

function validateImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return { valid: false, error: "No file received." };
  }
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype || "unknown"}. Allowed: JPG, PNG, WebP.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` };
  }
  if (file.buffer.length === 0) {
    return { valid: false, error: "Uploaded file is empty." };
  }

  // Magic byte check — mimetype header alone can be spoofed
  const b = file.buffer;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isWebP =
    b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP";

  if (!isJpeg && !isPng && !isWebP) {
    return { valid: false, error: "File content is not a valid image (JPG/PNG/WebP required)." };
  }

  return { valid: true };
}

// ============================================================
// GET METADATA — returns null on corrupt/invalid buffer
// ============================================================

async function getMetadata(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size || buffer.length,
      space: metadata.space,
      channels: metadata.channels,
    };
  } catch (err) {
    return null;
  }
}

// ============================================================
// SAVE TEMP — writes to TEMP_DIR, returns SAFE filename (basename only)
// Never returns absolute server paths to the client
// ============================================================

async function saveTemp(buffer, nameHint = "img") {
  let ext = "jpg";
  try {
    const meta = await sharp(buffer).metadata();
    ext = EXT_MAP[meta.format] || "jpg";
  } catch (e) {
    ext = "jpg";
  }
  const filename = `${sanitizeNameHint(nameHint)}_${crypto.randomUUID()}.${ext}`;
  await fsPromises.writeFile(path.join(TEMP_DIR, filename), buffer);
  return filename;
}

// ============================================================
// APPLY FILTER
// ============================================================

async function applyFilter(buffer, filterName) {
  if (!FILTER_PRESETS[filterName]) {
    throw new Error(`Unknown filter: ${filterName}`);
  }
  let img = sharp(buffer).rotate(); // auto-orient via EXIF
  img = await FILTER_PRESETS[filterName](img);
  return img.jpeg({ quality: 92 }).toBuffer();
}

// ============================================================
// APPLY ADJUSTMENTS — brightness / contrast / saturation
// contrast is applied around the 128 midpoint so 1.0 = no change
// ============================================================

async function applyAdjustments(buffer, adjustments = {}) {
  let img = sharp(buffer).rotate();
  const mod = {};

  if (adjustments.brightness !== undefined && adjustments.brightness !== null) {
    mod.brightness = clamp(Number(adjustments.brightness), 0.1, 3);
  }
  if (adjustments.saturation !== undefined && adjustments.saturation !== null) {
    mod.saturation = clamp(Number(adjustments.saturation), 0, 3);
  }
  if (Object.keys(mod).length > 0) {
    img = img.modulate(mod);
  }

  if (adjustments.contrast !== undefined && adjustments.contrast !== null) {
    const c = clamp(Number(adjustments.contrast), 0.1, 3);
    // out = c * (in - 128) + 128  → identity when c === 1
    img = img.linear(c, 128 * (1 - c));
  }

  return img.jpeg({ quality: 92 }).toBuffer();
}

// ============================================================
// ENHANCE — optional upscale (lanczos3) + sharpen + tone
// Returns { buffer, width, height, originalWidth, originalHeight, scale }
// ============================================================

async function enhance(buffer, options = {}) {
  const scale = clamp(Number(options.scale) || 1, 1, 4);
  const sharpness = clamp(Number(options.sharpness ?? 1) || 1, 0.5, 3);

  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width || 0;
  const originalHeight = meta.height || 0;

  let img = sharp(buffer).rotate();

  if (scale > 1 && originalWidth > 0 && originalHeight > 0) {
    const newWidth = Math.min(Math.round(originalWidth * scale), MAX_DIMENSION);
    const newHeight = Math.min(Math.round(originalHeight * scale), MAX_DIMENSION);
    img = img.resize(newWidth, newHeight, { kernel: "lanczos3", fit: "fill" });
  }

  const outBuffer = await img
    .modulate({ brightness: 1.05, saturation: 1.1 })
    .sharpen({ sigma: sharpness })
    .gamma(1.05)
    .jpeg({ quality: 95 })
    .toBuffer();

  const outMeta = await sharp(outBuffer).metadata();

  return {
    buffer: outBuffer,
    width: outMeta.width,
    height: outMeta.height,
    originalWidth,
    originalHeight,
    scale,
  };
}

// ============================================================
// UPSCALE — backward compatible, returns buffer
// ============================================================

async function upscale(buffer, factor = 2) {
  const result = await enhance(buffer, { scale: clamp(Number(factor) || 2, 1, 4), sharpness: 0.8 });
  return result.buffer;
}

// ============================================================
// RESIZE
// ============================================================

async function resize(buffer, width, height, fit = "cover") {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    throw new Error("Invalid width/height for resize.");
  }
  const allowedFits = ["cover", "contain", "fill", "inside", "outside"];
  const safeFit = allowedFits.includes(fit) ? fit : "cover";

  return sharp(buffer)
    .rotate()
    .resize(Math.min(w, MAX_DIMENSION), Math.min(h, MAX_DIMENSION), { fit: safeFit })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// CROP — validates bounds against actual image dimensions
// ============================================================

async function crop(buffer, left, top, width, height) {
  const l = Math.round(Number(left));
  const t = Math.round(Number(top));
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));

  if (![l, t, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || l < 0 || t < 0) {
    throw new Error("Invalid crop parameters.");
  }

  const meta = await sharp(buffer).metadata();
  if (l + w > (meta.width || 0) || t + h > (meta.height || 0)) {
    throw new Error(
      `Crop area (${w}x${h} at ${l},${t}) exceeds image bounds (${meta.width}x${meta.height}).`
    );
  }

  return sharp(buffer)
    .rotate()
    .extract({ left: l, top: t, width: Math.min(w, MAX_DIMENSION), height: Math.min(h, MAX_DIMENSION) })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// ROTATE — any degrees, white background for non-90 angles
// ============================================================

async function rotate(buffer, degrees = 90) {
  let deg = Number(degrees);
  if (!Number.isFinite(deg)) deg = 90;
  deg = ((deg % 360) + 360) % 360;

  return sharp(buffer)
    .rotate(deg, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// REMOVE BACKGROUND (FALLBACK)
// NOTE: Local fallback converts to PNG preserving alpha but does NOT
// segment the subject. For real background removal, integrate a provider:
//   remove.bg API  → POST https://api.remove.bg/v1.0/removebg
//   Replicate      → e.g. lucataco/remove-bg model
// Wire the provider here using process.env.BG_REMOVER_PROVIDER.
// ============================================================

async function removeBackground(buffer) {
  return sharp(buffer).rotate().png().toBuffer();
}

// ============================================================
// REPLACE BACKGROUND (FALLBACK — flattens alpha onto color)
// ============================================================

async function replaceBackground(buffer, options = {}) {
  const color = isValidHexColor(options.color) ? options.color : "#ffffff";

  return sharp(buffer)
    .rotate()
    .flatten({ background: color })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// GENERATE PREVIEW THUMBNAIL
// ============================================================

async function generatePreview(buffer) {
  const hash = crypto.createHash("md5").update(buffer).digest("hex");
  const previewPath = path.join(PREVIEW_DIR, `${hash}_preview.jpg`);

  if (fs.existsSync(previewPath)) {
    return previewPath;
  }

  const metadata = await sharp(buffer).metadata();
  const maxDimension = 400;
  const w = metadata.width || 800;
  const h = metadata.height || 600;

  const resizeOpts =
    w > maxDimension || h > maxDimension ? { width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true } : {};

  await sharp(buffer).rotate().resize(resizeOpts).jpeg({ quality: 80 }).toFile(previewPath);

  return previewPath;
}

// ============================================================
// SAVE PROCESSED (backward compat)
// ============================================================

async function saveProcessed(buffer, format = "jpeg") {
  const id = crypto.randomUUID();
  const ext = format === "png" ? "png" : "jpg";
  const outputPath = path.join(TEMP_DIR, `${id}.${ext}`);

  const img = sharp(buffer).rotate();
  if (format === "png") {
    await img.png().toFile(outputPath);
  } else {
    await img.jpeg({ quality: 92 }).toFile(outputPath);
  }

  return { id, path: outputPath, url: `/api/image-editor/result/${id}.${ext}` };
}

// ============================================================
// CLEANUP — deletes only old FILES (never dirs), per-file error safety
// ============================================================

async function cleanup(olderThanMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const dir of [TEMP_DIR, PREVIEW_DIR]) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue; // never touch directories/symlinks
        const filePath = path.join(dir, entry.name);
        try {
          const stat = await fsPromises.stat(filePath);
          if (now - stat.mtimeMs > olderThanMs) {
            await fsPromises.unlink(filePath);
          }
        } catch (e) {
          // ignore individual file errors
        }
      }
    } catch (e) {
      // ignore dir errors
    }
  }
}

// Run cleanup every 30 minutes (unref so it never blocks process exit)
const cleanupTimer = setInterval(() => cleanup(), 30 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

// ============================================================
// PUBLIC API — ImageProcessor object expected by routes/imageEditor.js
// ============================================================

const ImageProcessor = {
  validateImage,
  getMetadata,
  saveTemp,
  enhance,
  upscale,
  applyFilter,
  applyAdjustments,
  adjust: applyAdjustments, // alias used by routes
  resize,
  crop,
  rotate,
  removeBackground,
  replaceBackground,
  generatePreview,
  saveProcessed,
  cleanup,
  FILTER_PRESETS,
};

module.exports = {
  ImageProcessor,
  TEMP_DIR,
  PREVIEW_DIR,

  // Backward-compatible individual exports (old consumers keep working)
  applyFilter,
  applyAdjustments,
  enhance,
  upscale,
  removeBackground,
  generatePreview,
  saveProcessed,
  getMetadata,
  cleanup,
  FILTER_PRESETS,
};