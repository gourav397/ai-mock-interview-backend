// ============================================================
// AI IMAGE EDITOR — Routes
// Production v7
// Mounted at: /api/image-editor
// ============================================================

"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const {
  ImageProcessor,
  TEMP_DIR,
} = require("../utils/imageProcessor");

const aiEdit = require("../utils/aiEdit");
const vision = require("../utils/vision");

let aiEditParser = null;

try {
  aiEditParser = require("../utils/aiEditParser");
} catch (error) {
  console.warn(
    "[IMAGE EDITOR] aiEditParser unavailable:",
    error.message
  );
}

const router = express.Router();

// ============================================================
// UPLOAD CONFIG
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP.`
        ),
        false
      );
    }
  },
});

// ============================================================
// PATH SAFETY
// ============================================================

const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

function resolveTempPath(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const filename = path.basename(
    value.trim()
  );

  if (
    !filename ||
    !FILENAME_RE.test(filename)
  ) {
    return null;
  }

  const fullPath = path.join(
    TEMP_DIR,
    filename
  );

  const tempRoot =
    path.resolve(TEMP_DIR) + path.sep;

  const resolved =
    path.resolve(fullPath);

  if (!resolved.startsWith(tempRoot)) {
    return null;
  }

  return resolved;
}

// ============================================================
// LOAD IMAGE
// ============================================================

async function loadImageBuffer(req) {
  // Fresh multipart upload
  if (
    req.file &&
    Buffer.isBuffer(req.file.buffer)
  ) {
    return req.file.buffer;
  }

  // Existing saved image
  const imagePath =
    req.body?.imagePath;

  const resolved =
    resolveTempPath(imagePath);

  if (
    resolved &&
    fs.existsSync(resolved)
  ) {
    return fs.promises.readFile(
      resolved
    );
  }

  return null;
}

// ============================================================
// IMAGE VALIDATION MIDDLEWARE
// ============================================================

function validateImage(req, res, next) {
  const hasUpload =
    req.file &&
    Buffer.isBuffer(req.file.buffer);

  const hasPath =
    typeof req.body?.imagePath ===
      "string" &&
    req.body.imagePath.trim();

  if (!hasUpload && !hasPath) {
    return res.status(400).json({
      success: false,
      message:
        "No image provided. Upload an image first.",
    });
  }

  next();
}

// ============================================================
// RESPONSE DATA BUILDER
// ============================================================

function buildImageData(
  filename,
  extra = {}
) {
  const safeFilename =
    typeof filename === "string"
      ? path.basename(filename)
      : "";

  return {
    path: safeFilename,

    filename: safeFilename,

    preview:
      `/api/image-editor/preview/${encodeURIComponent(
        safeFilename
      )}`,

    resultUrl:
      `/api/image-editor/preview/${encodeURIComponent(
        safeFilename
      )}`,

    downloadUrl:
      `/api/image-editor/download/${encodeURIComponent(
        safeFilename
      )}`,

    ...extra,
  };
}

// ============================================================
// SAVE HELPER
// ============================================================

async function saveFrom(
  buffer,
  hint
) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error(
      "Image output buffer is invalid."
    );
  }

  return ImageProcessor.saveTemp(
    buffer,
    hint
  );
}

// ============================================================
// NORMALIZE saveTemp RESULT
// ============================================================

function extractFilename(saved) {
  if (!saved) {
    return null;
  }

  // Most likely current ImageProcessor behavior
  if (typeof saved === "string") {
    return path.basename(saved);
  }

  // Compatibility with object result
  if (
    typeof saved === "object"
  ) {
    if (
      typeof saved.filename ===
      "string"
    ) {
      return path.basename(
        saved.filename
      );
    }

    if (
      typeof saved.path ===
      "string"
    ) {
      return path.basename(
        saved.path
      );
    }

    if (
      typeof saved.name ===
      "string"
    ) {
      return path.basename(
        saved.name
      );
    }
  }

  return null;
}

// ============================================================
// STATUS
// ============================================================

router.get(
  "/status",
  (req, res) => {
    let capabilities = {};

    try {
      if (
        typeof aiEdit.getCapabilities ===
        "function"
      ) {
        capabilities =
          aiEdit.getCapabilities();
      }
    } catch {
      capabilities = {};
    }

    const geminiConfigured =
      Boolean(
        process.env.GEMINI_API_KEYS ||
        process.env.GEMINI_API_KEY
      );

    res.json({
      success: true,

      data: {
        version: "7.0.0",

        mountedAt:
          "/api/image-editor",

        supportedFormats: [
          "image/jpeg",
          "image/png",
          "image/webp",
        ],

        maxUploadMB: 20,

        aiEdit: {
          planner:
            geminiConfigured
              ? "gemini-vision"
              : "deterministic",

          llmConfigured:
            geminiConfigured,

          capabilities,

          honestNote:
            capabilities.inpainting
              ? "Generative image editing is configured."
              : "Local Sharp editing works. Generative text/object editing requires OPENAI_API_KEY.",
        },
      },
    });
  }
);

// ============================================================
// UPLOAD
// ============================================================

router.post(
  "/upload",
  upload.single("image"),
  async (req, res) => {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message:
            "No image uploaded. Field name must be 'image'.",
        });
      }

      const validation =
        ImageProcessor.validateImage(
          file
        );

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message:
            validation.error ||
            "Invalid image.",
        });
      }

      const metadata =
        await ImageProcessor.getMetadata(
          file.buffer
        );

      if (!metadata) {
        return res.status(400).json({
          success: false,
          message:
            "Corrupt or unreadable image.",
        });
      }

      const saved =
        await saveFrom(
          file.buffer,
          req.user?._id
            ? String(req.user._id)
            : "anon"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Image saved but filename was not returned."
        );
      }

      return res.json({
        success: true,

        message: "Uploaded.",

        data: buildImageData(
          filename,
          {
            ...metadata,

            size:
              file.buffer.length,
          }
        ),
      });
    } catch (error) {
      console.error(
        "[IMAGE UPLOAD]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Upload failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// PREVIEW
// ============================================================

router.get(
  "/preview/:filename",
  async (req, res) => {
    try {
      const filePath =
        resolveTempPath(
          req.params.filename
        );

      if (
        !filePath ||
        !fs.existsSync(filePath)
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired or not found.",
        });
      }

      res.setHeader(
        "Cache-Control",
        "private, max-age=300"
      );

      res.setHeader(
        "Cross-Origin-Resource-Policy",
        "cross-origin"
      );

      return res.sendFile(
        filePath
      );
    } catch (error) {
      console.error(
        "[IMAGE PREVIEW]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to preview image.",
      });
    }
  }
);

// ============================================================
// DOWNLOAD
// ============================================================

router.get(
  "/download/:filename",
  async (req, res) => {
    try {
      const filePath =
        resolveTempPath(
          req.params.filename
        );

      if (
        !filePath ||
        !fs.existsSync(filePath)
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired or not found.",
        });
      }

      return res.download(
        filePath,
        path.basename(filePath)
      );
    } catch (error) {
      console.error(
        "[IMAGE DOWNLOAD]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to download image.",
      });
    }
  }
);

// ============================================================
// FILTER
// ============================================================

router.post(
  "/filter",
  validateImage,
  async (req, res) => {
    try {
      const filter =
        String(
          req.body?.filter || ""
        ).trim();

      if (!filter) {
        return res.status(400).json({
          success: false,
          message:
            "filter is required.",
        });
      }

      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired. Re-upload the image.",
        });
      }

      const output =
        await ImageProcessor.applyFilter(
          buffer,
          filter
        );

      const saved =
        await saveFrom(
          output,
          "filter"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Filter output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          `Filter '${filter}' applied.`,

        data:
          buildImageData(
            filename,
            { filter }
          ),
      });
    } catch (error) {
      console.error(
        "[FILTER]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Filter failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// ADJUST
// ============================================================

router.post(
  "/adjust",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired. Re-upload the image.",
        });
      }

      const adjustments =
        req.body?.adjustments ||
        req.body ||
        {};

      const output =
        await ImageProcessor.adjust(
          buffer,
          adjustments
        );

      const saved =
        await saveFrom(
          output,
          "adjust"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Adjustment output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Adjustments applied.",

        data:
          buildImageData(
            filename,
            { adjustments }
          ),
      });
    } catch (error) {
      console.error(
        "[ADJUST]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Adjustment failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// RESIZE
// ============================================================

router.post(
  "/resize",
  validateImage,
  async (req, res) => {
    try {
      const width =
        Number(req.body?.width);

      const height =
        Number(req.body?.height);

      const fit =
        req.body?.fit ||
        "cover";

      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid width and height are required.",
        });
      }

      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const output =
        await ImageProcessor.resize(
          buffer,
          width,
          height,
          fit
        );

      const saved =
        await saveFrom(
          output,
          "resize"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Resize output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Image resized.",

        data:
          buildImageData(
            filename,
            {
              width,
              height,
              fit,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[RESIZE]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Resize failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// CROP
// ============================================================

router.post(
  "/crop",
  validateImage,
  async (req, res) => {
    try {
      const left =
        Number(req.body?.left);

      const top =
        Number(req.body?.top);

      const width =
        Number(req.body?.width);

      const height =
        Number(req.body?.height);

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "left, top, width and height must be valid.",
        });
      }

      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const output =
        await ImageProcessor.crop(
          buffer,
          left,
          top,
          width,
          height
        );

      const saved =
        await saveFrom(
          output,
          "crop"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Crop output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Image cropped.",

        data:
          buildImageData(
            filename,
            {
              left,
              top,
              width,
              height,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[CROP]",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Crop failed.",
      });
    }
  }
);

// ============================================================
// ROTATE
// ============================================================

router.post(
  "/rotate",
  validateImage,
  async (req, res) => {
    try {
      const degrees =
        Number(
          req.body?.degrees
        ) || 90;

      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const output =
        await ImageProcessor.rotate(
          buffer,
          degrees
        );

      const saved =
        await saveFrom(
          output,
          "rotate"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Rotate output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          `Image rotated ${degrees}°.`,

        data:
          buildImageData(
            filename,
            { degrees }
          ),
      });
    } catch (error) {
      console.error(
        "[ROTATE]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Rotate failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// ENHANCE
// ============================================================

router.post(
  "/enhance",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const scale =
        Math.max(
          0.5,
          Math.min(
            Number(
              req.body?.scale
            ) || 1.5,
            4
          )
        );

      const sharpness =
        Math.max(
          0,
          Math.min(
            Number(
              req.body?.sharpness
            ) || 1,
            3
          )
        );

      const result =
        await ImageProcessor.enhance(
          buffer,
          {
            scale,
            sharpness,
          }
        );

      const output =
        result?.buffer ||
        result;

      const saved =
        await saveFrom(
          output,
          "enhance"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Enhance output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Image enhanced.",

        data:
          buildImageData(
            filename,
            {
              scale:
                result?.scale ||
                scale,

              width:
                result?.width,

              height:
                result?.height,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[ENHANCE]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Enhance failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// UPSCALE
// ============================================================

router.post(
  "/upscale",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const scale =
        Math.max(
          1,
          Math.min(
            Number(
              req.body?.scale
            ) || 2,
            4
          )
        );

      const result =
        await ImageProcessor.enhance(
          buffer,
          {
            scale,
            sharpness: 0.8,
          }
        );

      const output =
        result?.buffer ||
        result;

      const saved =
        await saveFrom(
          output,
          "upscale"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Upscale output filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          `Image upscaled ${scale}x.`,

        data:
          buildImageData(
            filename,
            {
              scale:
                result?.scale ||
                scale,

              width:
                result?.width,

              height:
                result?.height,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[UPSCALE]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Upscale failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// REMOVE BACKGROUND
// ============================================================
//
// Uses the provider-aware aiEdit engine.
// No fake PNG conversion.
// ============================================================

router.post(
  "/remove-background",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const plan = [
        {
          action:
            "remove_background",
        },
      ];

      const result =
        await aiEdit.applyPlan(
          buffer,
          plan
        );

      if (
        !result.executed.length ||
        !Buffer.isBuffer(
          result.buffer
        )
      ) {
        return res.status(503).json({
          success: false,

          message:
            result.notes?.join("; ") ||
            "Background removal provider is not configured.",

          data: {
            executed:
              result.executed,

            stepsPending:
              result.notes,

            needsProvider: true,
          },
        });
      }

      const saved =
        await saveFrom(
          result.buffer,
          "nobg"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Background removal filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          result.executed.join(
            " → "
          ),

        data:
          buildImageData(
            filename,
            {
              provider:
                result.executed[0],
              executed:
                result.executed,
              stepsPending:
                result.notes,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[REMOVE BG]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Background removal failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// AI EDIT
// ============================================================

router.post(
  "/ai-edit",
  validateImage,
  async (req, res) => {
    try {
      // --------------------------------------------------------
      // Instruction
      // --------------------------------------------------------

      const instruction =
        String(
          req.body?.instruction ||
          ""
        ).trim();

      if (!instruction) {
        return res.status(400).json({
          success: false,
          message:
            "Instruction required.",
        });
      }

      if (instruction.length > 500) {
        return res.status(400).json({
          success: false,
          message:
            "Instruction is too long. Maximum 500 characters.",
        });
      }

      // --------------------------------------------------------
      // Load image
      // --------------------------------------------------------

      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Source image expired. Re-upload the image.",
        });
      }

      // --------------------------------------------------------
      // Metadata
      // --------------------------------------------------------

      let metadata;

      try {
        metadata =
          await sharp(buffer)
            .metadata();
      } catch {
        return res.status(400).json({
          success: false,
          message:
            "Corrupted or invalid image.",
        });
      }

      const imgW =
        metadata.width || 1;

      const imgH =
        metadata.height || 1;

      // --------------------------------------------------------
      // LAYER 1 — VISION
      // --------------------------------------------------------

      let visionOut = null;

      try {
        if (
          vision &&
          typeof vision.analyseImage ===
            "function"
        ) {
          visionOut =
            await vision.analyseImage(
              buffer,
              instruction,
              {
                imgW,
                imgH,
              }
            );
        }
      } catch (visionError) {
        console.warn(
          "[AI EDIT] Vision failed:",
          visionError.message
        );

        visionOut = null;
      }

      // --------------------------------------------------------
      // LAYER 2 — VISION PLAN
      // --------------------------------------------------------

      let rawSteps = [];

      if (
        visionOut &&
        Array.isArray(
          visionOut.steps
        ) &&
        visionOut.steps.length
      ) {
        rawSteps =
          visionOut.steps;
      }

      // --------------------------------------------------------
      // LAYER 3 — DETERMINISTIC PARSER FALLBACK
      // --------------------------------------------------------

      if (!rawSteps.length) {
        try {
          if (
            aiEditParser &&
            typeof aiEditParser.parseAiInstruction ===
              "function"
          ) {
            const parsed =
              aiEditParser.parseAiInstruction(
                instruction
              );

            if (
              parsed &&
              parsed.ok &&
              Array.isArray(
                parsed.plan
              )
            ) {
              rawSteps =
                parsed.plan;
            }
          }
        } catch (parserError) {
          console.warn(
            "[AI EDIT] Parser failed:",
            parserError.message
          );
        }
      }

      // --------------------------------------------------------
      // LAYER 4 — VALIDATION
      // --------------------------------------------------------

      const plan =
        aiEdit.validatePlan(
          rawSteps
        );

      if (!plan.length) {
        return res.status(400).json({
          success: false,

          message:
            "Instruction samajh nahi aayi / no actionable step.",

          data: {
            instruction,

            examples: [
              "photo HD kar do",
              "background white kar do",
              "brightness badha do",
              "2x upscale",
              "text hata do",
              "ABC ko XYZ kar do",
            ],

            regions:
              visionOut?.regions ||
              [],
          },
        });
      }

      // --------------------------------------------------------
      // LAYER 5 — EXECUTION
      // --------------------------------------------------------

      const execution =
        await aiEdit.applyPlan(
          buffer,
          plan
        );

      const finalBuffer =
        execution.buffer;

      const executed =
        Array.isArray(
          execution.executed
        )
          ? execution.executed
          : [];

      const notes =
        Array.isArray(
          execution.notes
        )
          ? execution.notes
          : [];

      // --------------------------------------------------------
      // NOTHING EXECUTED
      // --------------------------------------------------------

      if (
        !executed.length ||
        !Buffer.isBuffer(
          finalBuffer
        )
      ) {
        return res.status(503).json({
          success: false,

          message:
            notes.join("; ") ||
            "AI edit could not be executed.",

          data: {
            instruction,

            plan,

            executed,

            stepsApplied: 0,

            stepsPending:
              notes,

            needsProvider:
              notes.length > 0,

            regions:
              visionOut?.regions ||
              [],
          },
        });
      }

      // --------------------------------------------------------
      // SAVE RESULT
      // --------------------------------------------------------

      const saved =
        await saveFrom(
          finalBuffer,
          "ai_edit"
        );

      // IMPORTANT:
      // ImageProcessor.saveTemp() may return:
      //   "filename.jpg"
      // OR
      //   { filename: "filename.jpg" }
      //
      // We support both.
      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Image save failed: filename missing."
        );
      }

      // --------------------------------------------------------
      // BUILD URLS
      // --------------------------------------------------------

      const imageData =
        buildImageData(
          filename,
          {
            instruction,

            plan,

            executed,

            stepsApplied:
              executed.length,

            stepsPending:
              notes,

            needsProvider:
              notes.length > 0,

            regions:
              visionOut?.regions ||
              [],

            width:
              metadata.width,

            height:
              metadata.height,
          }
        );

      // --------------------------------------------------------
      // MESSAGE
      // --------------------------------------------------------

      let message =
        `AI applied ${executed.length} step(s): ${executed.join(
          " → "
        )}.`;

      if (notes.length) {
        message +=
          ` Some steps need a provider: ${notes.join(
            "; "
          )}`;
      }

      // --------------------------------------------------------
      // FINAL RESPONSE
      // --------------------------------------------------------

      return res.json({
        success: true,

        message,

        data: imageData,
      });
    } catch (error) {
      console.error(
        "[AI EDIT ERROR]",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          `AI edit failed: ${String(
            error.message
          ).slice(0, 200)}`,
      });
    }
  }
);

// ============================================================
// RESET
// ============================================================

router.post(
  "/reset",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Original image expired.",
        });
      }

      const saved =
        await saveFrom(
          buffer,
          "reset"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Reset filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Image reset.",

        data:
          buildImageData(
            filename
          ),
      });
    } catch (error) {
      console.error(
        "[RESET]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Reset failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// COMPARE
// ============================================================

router.post(
  "/compare",
  validateImage,
  async (req, res) => {
    try {
      const buffer =
        await loadImageBuffer(req);

      if (!buffer) {
        return res.status(404).json({
          success: false,
          message:
            "Image expired.",
        });
      }

      const editType =
        String(
          req.body?.editType ||
          "enhance"
        );

      let result;

      if (
        editType === "enhance"
      ) {
        result =
          await ImageProcessor.enhance(
            buffer,
            {
              scale: 1.5,
              sharpness: 1.1,
            }
          );
      } else {
        result = buffer;
      }

      const output =
        result?.buffer ||
        result;

      const saved =
        await saveFrom(
          output,
          "compare"
        );

      const filename =
        extractFilename(saved);

      if (!filename) {
        throw new Error(
          "Compare filename missing."
        );
      }

      return res.json({
        success: true,

        message:
          "Comparison result generated.",

        data:
          buildImageData(
            filename,
            {
              editType,
            }
          ),
      });
    } catch (error) {
      console.error(
        "[COMPARE]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          `Compare failed: ${error.message}`,
      });
    }
  }
);

// ============================================================
// MULTER / GLOBAL ROUTE ERROR HANDLER
// ============================================================

router.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Maximum image size is 20MB.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          `Upload error: ${error.code}`,
      });
    }

    if (error) {
      console.error(
        "[IMAGE EDITOR ROUTE ERROR]",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Image editor request failed.",
      });
    }

    next();
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;