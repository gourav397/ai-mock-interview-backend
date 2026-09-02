// ============================================================
// AI IMAGE EDITOR — Routes
// Mounted at /api/image-editor/*
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { ImageProcessor, TEMP_DIR } = require("../utils/imageProcessor");

const router = express.Router();

// ============================================
// MULTER — memory storage for validation first
// ============================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  },
});

// ============================================
// Middleware: validate image exists
// ============================================
const validateImage = (req, res, next) => {
  if (!req.file && !req.body.imagePath && !req.session?.lastImage) {
    return res.status(400).json({ success: false, message: "No image provided. Upload an image first." });
  }
  next();
};

// ============================================
// GET /api/image-editor/status
// ============================================
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      version: "1.0.0",
      supportedFormats: ["image/jpeg", "image/png", "image/webp"],
      maxFileSize: "20MB",
      maxDimensions: "4096px",
      filters: [
        { id: "natural", name: "Natural Enhancement", free: true },
        { id: "brightness", name: "Brighten", free: true },
        { id: "brightness-low", name: "Darken", free: true },
        { id: "contrast", name: "Contrast", free: true },
        { id: "saturation", name: "Saturate", free: true },
        { id: "desaturate", name: "Desaturate", free: true },
        { id: "warm", name: "Warm Tone", free: true },
        { id: "cool", name: "Cool Tone", free: true },
        { id: "vintage", name: "Vintage", free: true },
        { id: "black-white", name: "Black & White", free: true },
        { id: "cinematic", name: "Cinematic", free: true },
        { id: "portrait", name: "Portrait Enhance", free: true },
        { id: "soft", name: "Soft", free: true },
        { id: "vivid", name: "Vivid", free: true },
        { id: "dramatic", name: "Dramatic", free: true },
      ],
      editingCapabilities: [
        "enhance", "upscale", "filters", "adjust",
        "resize", "crop", "rotate", "remove-background",
        "replace-background", "portrait-enhance",
      ],
      aiProviders: {
        upscale: process.env.UPSCALE_PROVIDER || "local_sharp",
        bgRemoval: process.env.BG_REMOVER_PROVIDER || "local_fallback",
        aiEdit: process.env.AI_EDIT_PROVIDER || "none_configured",
      },
      freeUserLimits: {
        maxFileSize: "10MB (free), 20MB (premium)",
        dailyEdits: 50,
      },
    },
  });
});

// ============================================
// POST /api/image-editor/upload
// ============================================
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No image uploaded." });
    }

    // Server-side validation
    const validation = ImageProcessor.validateImage(file);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // Get metadata
    const metadata = await ImageProcessor.getMetadata(file.buffer);
    if (!metadata) {
      return res.status(400).json({ success: false, message: "Could not read image. File may be corrupted." });
    }

    // Save temp
    const userId = req.user?._id?.toString() || req.ip || "anon";
    const savedPath = await ImageProcessor.saveTemp(file.buffer, userId);

    // Store for session
    if (!req.session) req.session = {};
    req.session.lastImage = savedPath;
    req.session.lastBuffer = file.buffer.toString("base64");

    res.json({
      success: true,
      message: "Image uploaded successfully.",
      data: {
        path: savedPath,
        filename: file.originalname,
        size: file.buffer.length,
        ...metadata,
        preview: `/api/image-editor/preview/${path.basename(savedPath)}`,
      },
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ success: false, message: `Upload failed: ${err.message}` });
  }
});

// ============================================
// GET /api/image-editor/preview/:filename
// ============================================
router.get("/preview/:filename", (req, res) => {
  const safeName = path.basename(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = path.join(TEMP_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Image not found or expired." });
  }

  res.sendFile(filePath);
});

// ============================================
// POST /api/image-editor/enhance
// ============================================
router.post("/enhance", validateImage, async (req, res) => {
  try {
    const { scale = 2, sharpness = 1.0 } = req.body;
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");

    const result = await ImageProcessor.enhance(buffer, { scale: Math.min(Math.max(scale, 1), 4), sharpness });

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result.buffer, `${userId}_enhanced`);

    res.json({
      success: true,
      message: `Image enhanced at ${scale}x with sharpness ${sharpness}.`,
      data: {
        path: savedPath,
        width: result.width,
        height: result.height,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        scale: result.scale,
        preview: `/api/image-editor/preview/${path.basename(savedPath)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Enhancement failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/filter
// ============================================
router.post("/filter", validateImage, async (req, res) => {
  try {
    const { filter } = req.body;
    if (!filter) {
      return res.status(400).json({ success: false, message: "Filter name is required." });
    }

    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.applyFilter(buffer, filter);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_${filter}`);

    res.json({
      success: true,
      message: `Filter "${filter}" applied.`,
      data: {
        path: savedPath,
        filter,
        preview: `/api/image-editor/preview/${path.basename(savedPath)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Filter failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/adjust
// ============================================
router.post("/adjust", validateImage, async (req, res) => {
  try {
    const adjustments = req.body;
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");

    const result = await ImageProcessor.adjust(buffer, adjustments);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_adjusted`);

    res.json({
      success: true,
      message: "Adjustments applied.",
      data: {
        path: savedPath,
        adjustments,
        preview: `/api/image-editor/preview/${path.basename(savedPath)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Adjust failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/resize
// ============================================
router.post("/resize", validateImage, async (req, res) => {
  try {
    const { width, height, fit = "cover" } = req.body;
    if (!width || !height) {
      return res.status(400).json({ success: false, message: "width and height are required." });
    }

    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.resize(buffer, width, height, fit);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_resized`);

    res.json({
      success: true,
      message: `Image resized to ${width}x${height}.`,
      data: { path: savedPath, width, height, fit, preview: `/api/image-editor/preview/${path.basename(savedPath)}` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Resize failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/crop
// ============================================
router.post("/crop", validateImage, async (req, res) => {
  try {
    const { left, top, width, height } = req.body;
    if (left === undefined || top === undefined || !width || !height) {
      return res.status(400).json({ success: false, message: "left, top, width, height are required." });
    }

    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.crop(buffer, left, top, width, height);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_cropped`);

    res.json({
      success: true,
      message: `Image cropped to ${width}x${height}.`,
      data: { path: savedPath, width, height, preview: `/api/image-editor/preview/${path.basename(savedPath)}` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Crop failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/rotate
// ============================================
router.post("/rotate", validateImage, async (req, res) => {
  try {
    const { degrees = 90 } = req.body;
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.rotate(buffer, degrees);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_rotated`);

    res.json({
      success: true,
      message: `Image rotated ${degrees}°.`,
      data: { path: savedPath, degrees, preview: `/api/image-editor/preview/${path.basename(savedPath)}` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Rotation failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/remove-background
// ============================================
router.post("/remove-background", validateImage, async (req, res) => {
  try {
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.removeBackground(buffer);

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_nobg`);

    res.json({
      success: true,
      message: "Background removed.",
      data: { path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Background removal failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/replace-background
// ============================================
router.post("/replace-background", validateImage, async (req, res) => {
  try {
    const { color = "#ffffff" } = req.body;
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const result = await ImageProcessor.replaceBackground(buffer, { color });

    const userId = req.user?._id || "anon";
    const savedPath = await ImageProcessor.saveTemp(result, `${userId}_bg_replaced`);

    res.json({
      success: true,
      message: `Background replaced with ${color}.`,
      data: { path: savedPath, color, preview: `/api/image-editor/preview/${path.basename(savedPath)}` },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Background replacement failed: ${err.message}` });
  }
});

// ============================================
// POST /api/image-editor/ai-edit — Natural Language Editing
// ============================================
router.post("/ai-edit", validateImage, async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || typeof instruction !== "string") {
      return res.status(400).json({ success: false, message: "Instruction text is required." });
    }

    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const lower = instruction.toLowerCase().trim();

    // Natural language → action mapping
    if (/remove\s+(the\s+)?background/i.test(lower) || /delete\s+background/i.test(lower)) {
      const result = await ImageProcessor.removeBackground(buffer);
      const savedPath = await ImageProcessor.saveTemp(result, `${req.user?._id || "anon"}_ai_bg`);
      return res.json({ success: true, message: "Background removed.", data: { instruction, action: "remove_background", path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    if (/replace\s+(the\s+)?background/i.test(lower)) {
      // Extract color from instruction
      const colors = { white: "#ffffff", black: "#000000", blue: "#0000ff", red: "#ff0000", green: "#00ff00", gray: "#808080", grey: "#808080" };
      let color = "#ffffff";
      for (const [name, hex] of Object.entries(colors)) {
        if (lower.includes(name)) { color = hex; break; }
      }
      const result = await ImageProcessor.replaceBackground(buffer, { color });
      const savedPath = await ImageProcessor.saveTemp(result, `${req.user?._id || "anon"}_ai_bgrep`);
      return res.json({ success: true, message: `Background replaced with ${color}.`, data: { instruction, action: "replace_background", color, path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    if (/(improve|enhance|make\s+better|upscale|hd|high\s+quality)/i.test(lower)) {
      const scale = /2x|4x|high|ultra|hd/i.test(lower) ? 2 : 1.5;
      const result = await ImageProcessor.enhance(buffer, { scale });
      const savedPath = await ImageProcessor.saveTemp(result.buffer, `${req.user?._id || "anon"}_ai_enhanced`);
      return res.json({ success: true, message: "Image enhanced.", data: { instruction, action: "enhance", scale, path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    if (/(bright|darker|lighten)/i.test(lower)) {
      const isBright = /bright|lighten/i.test(lower);
      const result = await ImageProcessor.adjust(buffer, { brightness: isBright ? 1.3 : 0.7 });
      const savedPath = await ImageProcessor.saveTemp(result, `${req.user?._id || "anon"}_ai_bright`);
      return res.json({ success: true, message: isBright ? "Image brightened." : "Image darkened.", data: { instruction, action: "adjust_brightness", path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    if (/(black\s*(and|&)\s*white|grayscale|monochrome|b&w)/i.test(lower)) {
      const result = await ImageProcessor.applyFilter(buffer, "black-white");
      const savedPath = await ImageProcessor.saveTemp(result, `${req.user?._id || "anon"}_ai_bw`);
      return res.json({ success: true, message: "Converted to black & white.", data: { instruction, action: "black_white", path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    if (/(crop|trim|cut)/i.test(lower) && /(\d+)\s*x\s*(\d+)/.test(lower)) {
      const match = lower.match(/(\d+)\s*x\s*(\d+)/);
      const meta = await ImageProcessor.getMetadata(buffer);
      const w = parseInt(match[1]), h = parseInt(match[2]);
      const result = await ImageProcessor.resize(buffer, w, h);
      const savedPath = await ImageProcessor.saveTemp(result, `${req.user?._id || "anon"}_ai_resize`);
      return res.json({ success: true, message: `Image resized to ${w}x${h}.`, data: { instruction, action: "resize", width: w, height: h, path: savedPath, preview: `/api/image-editor/preview/${path.basename(savedPath)}` } });
    }

    // Unknown instruction
    return res.json({
      success: false,
      message: `I couldn't understand the instruction: "${instruction}".`,
      supportedInstructions: [
        "Remove the background",
        "Replace the background with [color]",
        "Enhance / improve image quality",
        "Make it brighter / darker",
        "Convert to black and white",
        "Crop to WxH dimensions",
        "Apply filter: [natural/brightness/contrast/saturation/vintage/cinematic/portrait]",
      ],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `AI edit failed: ${err.message}` });
  }
});

// ============================================
// GET /api/image-editor/download/:filename
// ============================================
router.get("/download/:filename", (req, res) => {
  const safeName = path.basename(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = path.join(TEMP_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found or expired." });
  }

  res.download(filePath, `edited-${safeName}`);
});

// ============================================
// POST /api/image-editor/compare — before/after
// ============================================
router.post("/compare", validateImage, async (req, res) => {
  try {
    const buffer = req.file?.buffer || Buffer.from(req.session.lastBuffer, "base64");
    const editType = req.body.editType || "enhance";

    let resultBuffer;
    switch (editType) {
      case "enhance":
        resultBuffer = (await ImageProcessor.enhance(buffer, { scale: 2 })).buffer;
        break;
      case "filter":
        resultBuffer = await ImageProcessor.applyFilter(buffer, req.body.filter || "natural");
        break;
      case "brightness":
        resultBuffer = await ImageProcessor.adjust(buffer, { brightness: req.body.brightness || 1.3 });
        break;
      default:
        resultBuffer = await ImageProcessor.enhance(buffer, { scale: 1.5 });
    }

    // Return both as base64 for frontend comparison
    const originalBase64 = buffer.toString("base64");
    const editedBase64 = resultBuffer.toString("base64");

    res.json({
      success: true,
      data: {
        original: `data:image/png;base64,${originalBase64}`,
        edited: `data:image/png;base64,${editedBase64}`,
        editType,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Comparison failed: ${err.message}` });
  }
});

module.exports = router;