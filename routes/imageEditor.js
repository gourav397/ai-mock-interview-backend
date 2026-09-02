// ============================================================
// AI IMAGE EDITOR — Routes (PRODUCTION v4.0)
// Mounted at /api/image-editor/*
// Stateless: client sends `imagePath` (server filename) for chained edits.
// Safe against path traversal — only basenames inside TEMP_DIR resolve.
// ai-edit uses utils/aiEditParser for Hindi/Hinglish/English + multi-step.
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { ImageProcessor, TEMP_DIR } = require("../utils/imageProcessor");
const { parseAiInstruction, describeStep } = require("../utils/aiEditParser");

const router = express.Router();

// ============================================
// MULTER — memory storage, validation happens after
// ============================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP.`), false);
    }
  },
});

// ============================================
// PATH SAFETY — resolve a filename strictly inside TEMP_DIR
// ============================================

const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

function resolveTempPath(imagePath) {
  if (!imagePath || typeof imagePath !== "string") return null;
  const safeName = path.basename(imagePath.trim());
  if (!safeName || !FILENAME_RE.test(safeName)) return null;
  const full = path.join(TEMP_DIR, safeName);
  if (!full.startsWith(TEMP_DIR + path.sep) && full !== TEMP_DIR) return null;
  return full;
}

// Load working buffer: uploaded file first, otherwise imagePath from body
async function loadImageBuffer(req) {
  if (req.file && req.file.buffer) {
    return req.file.buffer;
  }
  const resolved = resolveTempPath(req.body?.imagePath);
  if (resolved && fs.existsSync(resolved)) {
    return fs.promises.readFile(resolved);
  }
  return null;
}

// ============================================
// Middleware: validate image source exists
// ============================================
const validateImage = (req, res, next) => {
  if (!req.file && !req.body?.imagePath && !req.session?.lastImage) {
    return res.status(400).json({
      success: false,
      message: "No image provided. Upload an image first or send imagePath.",
    });
  }
  next();
};

// Shared response builder — returns filename (basename) + URLs
function buildImageData(filename, extra = {}) {
  return {
    path: filename,
    filename,
    preview: `/api/image-editor/preview/${filename}`,
    resultUrl: `/api/image-editor/preview/${filename}`,
    downloadUrl: `/api/image-editor/download/${filename}`,
    ...extra,
  };
}

// ============================================
// AI EDIT — plan executor
// Executes the parsed plan sequentially on the buffer.
// Returns { buffer, executed, notices, failedAt }
// ============================================

async function executePlan(buffer, plan) {
  let current = buffer;
  const executed = [];
  const notices = [];

  for (const step of plan) {
    try {
      switch (step.action) {
        case "remove_background": {
          const result = await ImageProcessor.removeBackground(current);
          current = result.buffer;
          if (result.provider === "fallback") {
            notices.push(
              "Background removal used local fallback (PNG conversion only — no real segmentation). Set REMOVE_BG_API_KEY for real background removal."
            );
          } else {
            notices.push("Background removed using remove.bg provider.");
          }
          break;
        }
        case "replace_background":
          current = await ImageProcessor.replaceBackground(current, { color: step.color });
          break;
        case "filter":
          current = await ImageProcessor.applyFilter(current, step.filter);
          break;
        case "adjust":
          current = await ImageProcessor.adjust(current, step.adjustments);
          break;
        case "enhance":
          current = (await ImageProcessor.enhance(current, { scale: step.scale || 1, sharpness: step.sharpness || 1.2 })).buffer;
          break;
        case "upscale":
          current = (await ImageProcessor.enhance(current, { scale: step.scale, sharpness: 0.8 })).buffer;
          break;
        case "resize":
          current = await ImageProcessor.resize(current, step.width, step.height);
          break;
        case "crop":
          current = await ImageProcessor.crop(current, step.left, step.top, step.width, step.height);
          break;
        case "crop_percent": {
          // Center crop to a percentage of current dimensions
          const meta = await ImageProcessor.getMetadata(current);
          const w = meta?.width || 0;
          const h = meta?.height || 0;
          const cw = Math.max(1, Math.round(w * step.percent));
          const ch = Math.max(1, Math.round(h * step.percent));
          const left = Math.round((w - cw) / 2);
          const top = Math.round((h - ch) / 2);
          current = await ImageProcessor.crop(current, left, top, cw, ch);
          break;
        }
        case "rotate":
          current = await ImageProcessor.rotate(current, step.degrees);
          break;
        default:
          throw new Error(`Unknown plan action: ${step.action}`);
      }
      executed.push(step);
    } catch (err) {
      return { buffer: current, executed, notices, failedAt: step, error: err.message };
    }
  }

  return { buffer: current, executed, notices, failedAt: null, error: null };
}

// ============================================
// GET /api/image-editor/status
// ============================================
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      version: "4.0.0",
      supportedFormats: ["image/jpeg", "image/png", "image/webp"],
      maxFileSize: "20MB",
      maxDimensions: "8192px",
      filters: Object.keys(ImageProcessor.FILTER_PRESETS).map((id) => ({ id, free: true })),
      editingCapabilities: [
        "enhance", "upscale", "filters", "adjust", "resize", "crop", "rotate",
        "remove-background", "replace-background", "ai-edit", "compare", "download",
      ],
      aiEdit: {
        languages: ["english", "hindi", "hinglish"],
        multiStep: true,
        backgroundRemovalProvider: process.env.REMOVE_BG_API_KEY ? "remove.bg" : "fallback",
      },
      freeUserLimits: {
        maxFileSize: "10MB (free), 20MB (premium)",
        dailyEdits: 50,
      },
    },
  });
});

// ============================================
// POST /api/image-editor/upload  (multipart field: "image")
// ============================================
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No image uploaded. Field name must be 'image'." });
    }

    const validation = ImageProcessor.validateImage(file);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const metadata = await ImageProcessor.getMetadata(file.buffer);
    if (!metadata) {
      return res.status(400).json({ success: false, message: "Could not read image. File may be corrupted." });
    }

    const userId = req.user?._id?.toString() || "anon";
    const savedName = await ImageProcessor.saveTemp(file.buffer, userId);

    if (req.session) {
      req.session.lastImage = savedName;
    }

    return res.json({
      success: true,
      message: "Image uploaded successfully.",
      data: buildImageData(savedName, {
        originalname: file.originalname,
        size: file.buffer.length,
        ...metadata,
      }),
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    return res.status(500).json({ success: false, message: `Upload failed: ${err.message}` });
  }
});

// ============================================
// GET /api/image-editor/preview/:filename
// ============================================
router.get("/preview/:filename", (req, res) => {
  const filePath = resolveTempPath(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Image not found or expired." });
  }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(filePath);
});

// ============================================
// POST /api/image-editor/enhance
// ============================================
router.post("/enhance", validateImage, async (req, res) => {
  try {
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const scale = Number(req.body?.scale) || 1;
    const sharpness = Number(req.body?.sharpness) || 1.0;

    const result = await ImageProcessor.enhance(buffer, { scale, sharpness });
    const savedName = await ImageProcessor.saveTemp(result.buffer, "enhanced");

    return res.json({
      success: true,
      message: `Image enhanced at ${result.scale}x with sharpness ${sharpness}.`,
      data: buildImageData(savedName, {
        width: result.width,
        height: result.height,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        scale: result.scale,
      }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Enhancement failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/upscale
// ============================================
router.post("/upscale", validateImage, async (req, res) => {
  try {
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const scale = Math.min(Math.max(Number(req.body?.scale) || 2, 1), 4);
    const result = await ImageProcessor.enhance(buffer, { scale, sharpness: 0.8 });
    const savedName = await ImageProcessor.saveTemp(result.buffer, "upscaled");

    return res.json({
      success: true,
      message: `Image upscaled ${result.scale}x.`,
      data: buildImageData(savedName, {
        width: result.width,
        height: result.height,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        scale: result.scale,
      }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Upscale failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/filter
// ============================================
router.post("/filter", validateImage, async (req, res) => {
  try {
    const { filter } = req.body || {};
    if (!filter || typeof filter !== "string") {
      return res.status(400).json({ success: false, message: "Filter name is required." });
    }

    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.applyFilter(buffer, filter);
    const savedName = await ImageProcessor.saveTemp(result, `f_${filter}`);

    return res.json({
      success: true,
      message: `Filter "${filter}" applied.`,
      data: buildImageData(savedName, { filter }),
    });
  } catch (err) {
    const status = String(err.message || "").startsWith("Unknown filter") ? 400 : 500;
    return res.status(status).json({ success: false, message: `Filter failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/adjust
// ============================================
router.post("/adjust", validateImage, async (req, res) => {
  try {
    const adjustments = req.body?.adjustments || req.body || {};
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.adjust(buffer, adjustments);
    const savedName = await ImageProcessor.saveTemp(result, "adjusted");

    return res.json({
      success: true,
      message: "Adjustments applied.",
      data: buildImageData(savedName, { adjustments }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Adjust failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/resize
// ============================================
router.post("/resize", validateImage, async (req, res) => {
  try {
    const { width, height, fit = "cover" } = req.body || {};
    if (!width || !height) {
      return res.status(400).json({ success: false, message: "width and height are required." });
    }

    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.resize(buffer, width, height, fit);
    const savedName = await ImageProcessor.saveTemp(result, "resized");

    return res.json({
      success: true,
      message: `Image resized to ${Math.round(width)}x${Math.round(height)}.`,
      data: buildImageData(savedName, { width: Math.round(width), height: Math.round(height), fit }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Resize failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/crop
// ============================================
router.post("/crop", validateImage, async (req, res) => {
  try {
    const { left, top, width, height } = req.body || {};
    if (left === undefined || top === undefined || !width || !height) {
      return res.status(400).json({ success: false, message: "left, top, width, height are required." });
    }

    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.crop(buffer, left, top, width, height);
    const savedName = await ImageProcessor.saveTemp(result, "cropped");

    return res.json({
      success: true,
      message: `Image cropped to ${Math.round(width)}x${Math.round(height)}.`,
      data: buildImageData(savedName, { width: Math.round(width), height: Math.round(height) }),
    });
  } catch (err) {
    const status = String(err.message || "").includes("bounds") ? 400 : 500;
    return res.status(status).json({ success: false, message: `Crop failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/rotate
// ============================================
router.post("/rotate", validateImage, async (req, res) => {
  try {
    const degrees = Number(req.body?.degrees) || 90;

    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.rotate(buffer, degrees);
    const savedName = await ImageProcessor.saveTemp(result, "rotated");

    return res.json({
      success: true,
      message: `Image rotated ${degrees}°.`,
      data: buildImageData(savedName, { degrees }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Rotation failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/remove-background  (+ /remove-bg alias)
// ============================================
const removeBackgroundHandler = async (req, res) => {
  try {
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.removeBackground(buffer);
    const savedName = await ImageProcessor.saveTemp(result.buffer, "nobg");

    const message =
      result.provider === "remove.bg"
        ? "Background removed using remove.bg."
        : "Background removal fallback applied (PNG conversion only — no real segmentation). Set REMOVE_BG_API_KEY for real background removal.";

    return res.json({
      success: true,
      message,
      data: buildImageData(savedName, { provider: result.provider }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Background removal failed: ${err.message}` });
  }
};
router.post("/remove-background", validateImage, removeBackgroundHandler);
router.post("/remove-bg", validateImage, removeBackgroundHandler); // alias for older clients

// ============================================
// POST /api/image-editor/replace-background
// ============================================
router.post("/replace-background", validateImage, async (req, res) => {
  try {
    const color = req.body?.color || "#ffffff";
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const result = await ImageProcessor.replaceBackground(buffer, { color });
    const savedName = await ImageProcessor.saveTemp(result, "bg_replaced");

    return res.json({
      success: true,
      message: `Background replaced with ${color}.`,
      data: buildImageData(savedName, { color }),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Background replacement failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/ai-edit — Natural Language Editing
// Hindi / Hinglish / English + multi-step commands
// ============================================
router.post("/ai-edit", validateImage, async (req, res) => {
  try {
    const { instruction } = req.body || {};
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return res.status(400).json({ success: false, message: "Instruction text is required." });
    }

    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const parsed = parseAiInstruction(instruction);

    if (!parsed.ok) {
      // Fallback: don't show a generic error — suggest what IS supported
      return res.json({
        success: false,
        message: `Instruction "${instruction.trim()}" samajh nahi aayi. Try: "background hata do", "photo HD kar do", "brightness badha do", "black and white kar do", "background white kar do", "vintage look do", "1920x1080 kar do", "rotate 90", "crop 50%", "contrast badha do" — ya multi-step: "background hata do aur HD kar do".`,
        supportedInstructions: [
          "Remove the background / background hata do",
          "Replace background with color / background white kar do",
          "Enhance / HD kar do / photo behtar kar do",
          "Brightness badha do / kam kar do",
          "Contrast / saturation badha do ya kam karo",
          "Black and white / kala safed kar do",
          "Warm / cool / vintage / cinematic / soft / dramatic look do",
          "Resize to WxH / image ko 1920x1080 kar do",
          "Crop / crop 50% / center crop karo",
          "Rotate 90 / photo ghumao",
          "Multi-step: 'background hata do aur HD kar do'",
        ],
      });
    }

    const { buffer: resultBuffer, executed, notices, failedAt, error } = await executePlan(buffer, parsed.plan);

    if (executed.length === 0) {
      return res.status(500).json({
        success: false,
        message: `AI edit failed at step "${failedAt ? describeStep(failedAt) : "unknown"}": ${error}`,
      });
    }

    const savedName = await ImageProcessor.saveTemp(resultBuffer, "ai_edit");
    const stepNames = executed.map(describeStep);

    return res.json({
      success: true,
      message: `AI applied ${executed.length} step${executed.length > 1 ? "s" : ""}: ${stepNames.join(" → ")}.${notices.length > 0 ? " " + notices.join(" ") : ""}${
        failedAt ? ` Note: step "${describeStep(failedAt)}" failed (${error}) — earlier steps applied.` : ""
      }`,
      data: {
        instruction: instruction.trim(),
        action: "ai_edit_plan",
        plan: parsed.plan,
        executed: stepNames,
        stepsApplied: executed.length,
        notices,
        ...buildImageData(savedName),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `AI edit failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/reset — returns the given image as current
// ============================================
router.post("/reset", validateImage, async (req, res) => {
  try {
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }
    const resolved = resolveTempPath(req.body.imagePath);
    const filename = path.basename(resolved);
    return res.json({
      success: true,
      message: "Reset to image.",
      data: buildImageData(filename),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Reset failed: ${err.message}` });
  }
});

// ============================================
// GET /api/image-editor/download/:filename
// ============================================
router.get("/download/:filename", (req, res) => {
  const filePath = resolveTempPath(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found or expired." });
  }
  res.download(filePath, `edited-${path.basename(filePath)}`);
});

// ============================================
// POST /api/image-editor/compare — before/after (size-safe base64)
// ============================================
async function toCompareDataUrl(buffer) {
  const meta = await ImageProcessor.getMetadata(buffer);
  let w = meta?.width || 800;
  let h = meta?.height || 600;
  const max = 1200;
  if (w > max || h > max) {
    const r = max / Math.max(w, h);
    w = Math.max(1, Math.round(w * r));
    h = Math.max(1, Math.round(h * r));
  }
  const resized = await ImageProcessor.resize(buffer, w, h, "inside");
  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}

router.post("/compare", validateImage, async (req, res) => {
  try {
    const buffer = await loadImageBuffer(req);
    if (!buffer) {
      return res.status(404).json({ success: false, message: "Image not found or expired. Upload again." });
    }

    const editType = req.body?.editType || "enhance";
    let resultBuffer;

    switch (editType) {
      case "enhance":
        resultBuffer = (await ImageProcessor.enhance(buffer, { scale: 2 })).buffer;
        break;
      case "filter":
        resultBuffer = await ImageProcessor.applyFilter(buffer, req.body?.filter || "natural");
        break;
      case "brightness":
        resultBuffer = await ImageProcessor.adjust(buffer, { brightness: Number(req.body?.brightness) || 1.3 });
        break;
      default:
        resultBuffer = await ImageProcessor.enhance(buffer, { scale: 1.5 });
    }

    const original = await toCompareDataUrl(buffer);
    const edited = await toCompareDataUrl(resultBuffer);

    return res.json({
      success: true,
      data: { original, edited, editType },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Comparison failed: ${err.message}` });
  }
});

// ============================================
// ROUTER-LEVEL ERROR HANDLER — catches Multer errors with proper status
// ============================================
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File too large. Maximum is 20MB."
        : `Upload error: ${err.code}`;
    return res.status(400).json({ success: false, message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message || "Request failed." });
  }
  next();
});

module.exports = router;