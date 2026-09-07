// ============================================================
// IMAGE PROCESSOR — Sharp Pipeline (PRODUCTION v5.0)
// + Face Glow, Portrait Enhance, Background Blur (Low/Med/High)
// removeBackground: real remove.bg if key set, else honest PNG fallback
// ============================================================

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const crypto = require("crypto");

const TEMP_DIR = path.join(__dirname, "..", "temp", "processed");
const PREVIEW_DIR = path.join(__dirname, "..", "temp", "previews");

const MAX_DIMENSION = 8192;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

[TEMP_DIR, PREVIEW_DIR].forEach((dir) => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
// FILTER PRESETS — modular: naya filter yahin add karo
// ============================================================

const FILTER_PRESETS = {
  natural: async (img) => img,
  brighten: async (img) => img.modulate({ brightness: 1.3 }),
  darken: async (img) => img.modulate({ brightness: 0.7 }),
  contrast: async (img) => img.linear(1.5, -64),
  saturate: async (img) => img.modulate({ saturation: 1.8 }),
  desaturate: async (img) => img.modulate({ saturation: 0.2 }),
  warm: async (img) => img.tint({ r: 255, g: 200, b: 150 }).modulate({ saturation: 1.1 }),
  cool: async (img) => img.tint({ r: 150, g: 200, b: 255 }).modulate({ saturation: 1.1 }),
  vintage: async (img) =>
    img.tint({ r: 235, g: 200, b: 160 }).modulate({ saturation: 0.6, brightness: 0.9 }).gamma(1.2),
  bw: async (img) => img.toColorspace("b-w"),
  "black-white": async (img) => img.toColorspace("b-w"),
  grayscale: async (img) => img.toColorspace("b-w"),
  cinematic: async (img) =>
    img.modulate({ saturation: 0.4, brightness: 0.9 }).linear(1.3, -32).gamma(1.1),
  portrait: async (img) =>
    img.modulate({ brightness: 1.1, saturation: 0.9 }).sharpen({ sigma: 1.2 }).blur(0.3),
  soft: async (img) => img.modulate({ brightness: 1.05 }).blur(0.5).gamma(0.9),
  vivid: async (img) => img.modulate({ saturation: 1.6, brightness: 1.1 }).sharpen({ sigma: 0.8 }),
  dramatic: async (img) =>
    img.modulate({ brightness: 0.8, saturation: 1.4 }).linear(1.8, -64).gamma(1.3),

  // --------------------------------------------------------
  // FACE GLOW — natural brighten, no over-processing
  // --------------------------------------------------------
  "face-glow": async (img) =>
    img
      .modulate({ brightness: 1.06, saturation: 1.05 })
      .gamma(1.03)
      .sharpen({ sigma: 0.6, m1: 0.5, m2: 2 })
      .linear(1.03, -6),

  // --------------------------------------------------------
  // PORTRAIT ENHANCE — mild skin/lighting improvement
  // --------------------------------------------------------
  "portrait-enhance": async (img) =>
    img
      .modulate({ brightness: 1.05, saturation: 0.98 })
      .gamma(1.04)
      .blur(0.4)
      .sharpen({ sigma: 1.0 })
      .linear(1.04, -8),
};

// ============================================================
// BACKGROUND BLUR — local (free) subject-center approximation
// Base image sharp rehti hai; blur elliptical mask ke bahar
// lagta hai. Real segmentation ke liye remove.bg path bhi hai.
// ============================================================

async function backgroundBlur(buffer, intensity = "medium", subjectMaskPng = null) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 800;
  const h = meta.height || 800;

  const sigma = { low: 5, medium: 12, high: 22 }[intensity] || 12;

  let blurredLayer;

  if (subjectMaskPng) {
    // Real segmentation mask (white = subject, black = bg)
    const mask = await sharp(subjectMaskPng)
      .ensureAlpha()
      .resize(w, h, { fit: "fill" })
      .extractChannel("alpha")
      .toBuffer();

    const inverted = await sharp(mask).negate().toBuffer();

    blurredLayer = await sharp(buffer)
      .blur(sigma)
      .joinChannel(inverted, { raw: undefined })
      .png()
      .toBuffer();

    // composite: blurred layer with inverted-mask alpha over original
    const blurredWithAlpha = await sharp(blurredLayer)
      .composite([])
      .toBuffer();

    return sharp(buffer)
      .composite([
        {
          input: await sharp(await sharp(buffer).blur(sigma).png().toBuffer())
            .joinChannel(inverted)
            .png()
            .toBuffer(),
          blend: "over",
        },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
  }

  // FREE local fallback — center-subject elliptical mask
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.33;
  const ry = h * 0.42;

  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}">
       <rect width="${w}" height="${h}" fill="black"/>
       <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>
     </svg>`
  );

  // blurred version, alpha = inverse of ellipse mask
  const blurred = await sharp(buffer).blur(sigma).png().toBuffer();
  const maskPng = await sharp(maskSvg).png().toBuffer();

  const blurredBg = await sharp(blurred)
    .composite([{ input: maskPng, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(buffer)
    .composite([{ input: blurredBg, blend: "over" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// VALIDATE / METADATA / SAVE
// ============================================================

function validateImage(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return { valid: false, error: "No file received." };
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype || "unknown"}. Allowed: JPG, PNG, WebP.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` };
  }
  if (file.buffer.length === 0) return { valid: false, error: "Uploaded file is empty." };

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
  } catch {
    return null;
  }
}

async function saveTemp(buffer, nameHint = "img") {
  let ext = "jpg";
  try {
    const meta = await sharp(buffer).metadata();
    ext = EXT_MAP[meta.format] || "jpg";
  } catch {
    ext = "jpg";
  }
  const filename = `${sanitizeNameHint(nameHint)}_${crypto.randomUUID()}.${ext}`;
  await fsPromises.writeFile(path.join(TEMP_DIR, filename), buffer);
  return filename;
}

// ============================================================
// BASIC OPS
// ============================================================

async function applyFilter(buffer, filterName) {
  if (!FILTER_PRESETS[filterName]) throw new Error(`Unknown filter: ${filterName}`);
  let img = sharp(buffer).rotate();
  img = await FILTER_PRESETS[filterName](img);
  return img.jpeg({ quality: 92 }).toBuffer();
}

async function applyAdjustments(buffer, adjustments = {}) {
  let img = sharp(buffer).rotate();
  const mod = {};

  if (adjustments.brightness != null) mod.brightness = clamp(Number(adjustments.brightness), 0.1, 3);
  if (adjustments.saturation != null) mod.saturation = clamp(Number(adjustments.saturation), 0, 3);
  if (Object.keys(mod).length > 0) img = img.modulate(mod);

  if (adjustments.contrast != null) {
    const c = clamp(Number(adjustments.contrast), 0.1, 3);
    img = img.linear(c, 128 * (1 - c));
  }

  const meta = await sharp(buffer).metadata();
  if (meta.format === "png" && meta.hasAlpha) return img.png().toBuffer();
  return img.jpeg({ quality: 92 }).toBuffer();
}

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

async function upscale(buffer, factor = 2) {
  const result = await enhance(buffer, { scale: clamp(Number(factor) || 2, 1, 4), sharpness: 0.8 });
  return result.buffer;
}

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
    .extract({
      left: l,
      top: t,
      width: Math.min(w, MAX_DIMENSION),
      height: Math.min(h, MAX_DIMENSION),
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

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
// REMOVE BACKGROUND — remove.bg (real) if key, else honest PNG fallback
// ============================================================

async function removeBackground(buffer) {
  const apiKey = process.env.REMOVE_BG_API_KEY;

  if (apiKey && typeof globalThis.fetch === "function") {
    try {
      const form = new FormData();
      form.append("image_file", new Blob([buffer], { type: "image/png" }), "image.png");
      form.append("size", "auto");

      const res = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": apiKey },
        body: form,
      });

      if (res.ok) {
        const outBuffer = Buffer.from(await res.arrayBuffer());
        return { buffer: outBuffer, provider: "remove.bg" };
      }

      console.error(`[ImageProcessor] remove.bg failed (${res.status}). Falling back.`);
    } catch (err) {
      console.error(`[ImageProcessor] remove.bg error: ${err.message}. Using fallback.`);
    }
  }

  const fallbackBuffer = await sharp(buffer).rotate().png().toBuffer();
  return { buffer: fallbackBuffer, provider: "fallback" };
}

// ============================================================
// BACKGROUND BLUR PUBLIC WRAPPER
// provider: "segmented" (remove.bg mask) ya "local" (elliptical)
// ============================================================

async function backgroundBlurWithFallback(buffer, intensity = "medium") {
  const apiKey = process.env.REMOVE_BG_API_KEY;

  if (apiKey && typeof globalThis.fetch === "function") {
    try {
      const form = new FormData();
      const png = await sharp(buffer).rotate().png().toBuffer();
      form.append("image_file", new Blob([png], { type: "image/png" }), "image.png");
      form.append("size", "auto");

      const res = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": apiKey },
        body: form,
      });

      if (res.ok) {
        const cutout = Buffer.from(await res.arrayBuffer());
        // remove.bg returns subject w/ transparent bg; its alpha = subject mask
        const result = await backgroundBlur(buffer, intensity, cutout);
        return { buffer: result, provider: "segmented" };
      }
    } catch (err) {
      console.error(`[ImageProcessor] bg-blur segmentation failed: ${err.message}`);
    }
  }

  const result = await backgroundBlur(buffer, intensity);
  return { buffer: result, provider: "local" };
}

async function replaceBackground(buffer, options = {}) {
  const color = isValidHexColor(options.color) ? options.color : "#ffffff";
  return sharp(buffer)
    .rotate()
    .flatten({ background: color })
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ============================================================
// PREVIEW / SAVE PROCESSED / CLEANUP
// ============================================================

async function generatePreview(buffer) {
  const hash = crypto.createHash("md5").update(buffer).digest("hex");
  const previewPath = path.join(PREVIEW_DIR, `${hash}_preview.jpg`);

  if (fs.existsSync(previewPath)) return previewPath;

  const metadata = await sharp(buffer).metadata();
  const maxDimension = 400;
  const w = metadata.width || 800;
  const h = metadata.height || 600;

  const resizeOpts =
    w > maxDimension || h > maxDimension
      ? { width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true }
      : {};

  await sharp(buffer).rotate().resize(resizeOpts).jpeg({ quality: 80 }).toFile(previewPath);
  return previewPath;
}

async function saveProcessed(buffer, format = "jpeg") {
  const id = crypto.randomUUID();
  const ext = format === "png" ? "png" : "jpg";
  const outputPath = path.join(TEMP_DIR, `${id}.${ext}`);

  const img = sharp(buffer).rotate();
  if (format === "png") await img.png().toFile(outputPath);
  else await img.jpeg({ quality: 92 }).toFile(outputPath);

  return { id, path: outputPath, url: `/api/image-editor/result/${id}.${ext}` };
}

async function cleanup(olderThanMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const dir of [TEMP_DIR, PREVIEW_DIR]) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(dir, entry.name);
        try {
          const stat = await fsPromises.stat(filePath);
          if (now - stat.mtimeMs > olderThanMs) await fsPromises.unlink(filePath);
        } catch {}
      }
    } catch {}
  }
}

const cleanupTimer = setInterval(() => cleanup(), 30 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

// ============================================================
// PUBLIC API
// ============================================================

const ImageProcessor = {
  validateImage,
  getMetadata,
  saveTemp,
  enhance,
  upscale,
  applyFilter,
  applyAdjustments,
  adjust: applyAdjustments,
  resize,
  crop,
  rotate,
  removeBackground,
  backgroundBlur: backgroundBlurWithFallback,
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
  applyFilter,
  applyAdjustments,
  enhance,
  upscale,
  removeBackground,
  backgroundBlurWithFallback,
  generatePreview,
  saveProcessed,
  getMetadata,
  cleanup,
  FILTER_PRESETS,
};