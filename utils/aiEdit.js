// ============================================================
// AI EDIT ENGINE — PRODUCTION v8
// ------------------------------------------------------------
// Supports:
//   • validatePlan()
//   • Sharp local editing
//   • OpenAI image editing
//   • remove.bg background removal
//   • honest provider failures
//   • sequential multi-step execution
//   • no fake "AI" results
// ============================================================

"use strict";

const sharp = require("sharp");
const { ImageProcessor } = require("./imageProcessor");

let FormData = null;

try {
  FormData = require("form-data");
} catch {
  FormData = null;
}

// ============================================================
// PROVIDERS
// ============================================================

const OPENAI_KEY =
  process.env.OPENAI_API_KEY ||
  "";

const REPLICATE_TOKEN =
  process.env.REPLICATE_API_TOKEN ||
  "";

const REMOVE_BG_KEY =
  process.env.REMOVE_BG_API_KEY ||
  "";

const OPENAI_IMG_MODEL =
  process.env.OPENAI_IMG_MODEL ||
  "gpt-image-1";

const canInpaint = () => Boolean(OPENAI_KEY);

const canSegment = () =>
  Boolean(REMOVE_BG_KEY || OPENAI_KEY || REPLICATE_TOKEN);

// ============================================================
// ALLOWLIST
// ============================================================

const ALLOW = new Set([
  "remove_background",
  "replace_background",
  "remove_text",
  "replace_text",
  "remove_object",

  "adjust",
  "filter",
  "enhance",
  "upscale",
  "resize",
  "crop",
  "rotate",
]);

// ============================================================
// NUMBER HELPER
// ============================================================

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// ============================================================
// PLAN VALIDATION
// ============================================================

function validatePlan(steps) {
  if (!Array.isArray(steps)) return [];

  const out = [];

  for (const s of steps.slice(0, 8)) {
    if (!s || typeof s !== "object") continue;

    const action = String(s.action || "")
      .trim()
      .toLowerCase();

    if (!ALLOW.has(action)) continue;

    switch (action) {
      // ------------------------------------------------------
      // TEXT
      // ------------------------------------------------------

      case "replace_text": {
        const target =
          s.target_text ??
          s.target_string ??
          s.text ??
          "";

        const replacement =
          s.replacement_text ??
          s.replacement ??
          "";

        if (!String(replacement).trim()) break;

        out.push({
          action,
          target_string: String(target).slice(0, 100),
          replacement: String(replacement).slice(0, 100),
        });

        break;
      }

      case "remove_text": {
        out.push({
          action,
          text: String(
            s.target_text ??
            s.target_string ??
            s.text ??
            ""
          ).slice(0, 100),
        });

        break;
      }

      // ------------------------------------------------------
      // BACKGROUND
      // ------------------------------------------------------

      case "replace_background": {
        const color =
          typeof s.color === "string" &&
          /^#[0-9a-fA-F]{6}$/.test(s.color)
            ? s.color
            : "#ffffff";

        out.push({
          action,
          color,
        });

        break;
      }

      case "remove_background": {
        out.push({
          action,
        });

        break;
      }

      // ------------------------------------------------------
      // OBJECT
      // ------------------------------------------------------

      case "remove_object": {
        out.push({
          action,
          text: String(
            s.text ??
            s.target_text ??
            s.object ??
            ""
          ).slice(0, 100),
        });

        break;
      }

      // ------------------------------------------------------
      // ADJUST
      // ------------------------------------------------------

      case "adjust": {
        out.push({
          action,
          adjust: {
            brightness: num(
              s.adjust?.brightness,
              1
            ),

            contrast: num(
              s.adjust?.contrast,
              1
            ),

            saturation: num(
              s.adjust?.saturation,
              1
            ),
          },
        });

        break;
      }

      // ------------------------------------------------------
      // FILTER
      // ------------------------------------------------------

      case "filter": {
        out.push({
          action,
          filter: String(
            s.filter || "cinematic"
          ).slice(0, 40),
        });

        break;
      }

      // ------------------------------------------------------
      // ENHANCE
      // ------------------------------------------------------

      case "enhance": {
        const scale = Math.max(
          0.5,
          Math.min(
            4,
            num(s.scale, 1.2)
          )
        );

        out.push({
          action,
          scale,
        });

        break;
      }

      // ------------------------------------------------------
      // UPSCALE
      // ------------------------------------------------------

      case "upscale": {
        const scale = Math.max(
          0.5,
          Math.min(
            4,
            num(s.scale, 2)
          )
        );

        out.push({
          action,
          scale,
        });

        break;
      }

      // ------------------------------------------------------
      // RESIZE
      // ------------------------------------------------------

      case "resize": {
        const width = Math.max(
          16,
          Math.round(
            num(s.width, 1920)
          )
        );

        const height = Math.max(
          16,
          Math.round(
            num(s.height, 1080)
          )
        );

        out.push({
          action,
          width,
          height,
        });

        break;
      }

      // ------------------------------------------------------
      // CROP
      // ------------------------------------------------------

      case "crop": {
        const width = Math.max(
          1,
          Math.round(
            num(s.width, 0)
          )
        );

        const height = Math.max(
          1,
          Math.round(
            num(s.height, 0)
          )
        );

        if (width <= 0 || height <= 0) break;

        out.push({
          action,
          x: Math.max(
            0,
            Math.round(
              num(s.x, 0)
            )
          ),

          y: Math.max(
            0,
            Math.round(
              num(s.y, 0)
            )
          ),

          width,
          height,
        });

        break;
      }

      // ------------------------------------------------------
      // ROTATE
      // ------------------------------------------------------

      case "rotate": {
        let degrees = num(
          s.degrees,
          90
        );

        degrees =
          ((degrees % 360) + 360) % 360;

        if (degrees === 0) break;

        out.push({
          action,
          degrees,
        });

        break;
      }

      default:
        break;
    }
  }

  return out.slice(0, 6);
}

// ============================================================
// OPENAI IMAGE EDIT
// ============================================================

async function gptInpaint(
  buffer,
  prompt,
  mask = null
) {
  if (!OPENAI_KEY) {
    return {
      error: "openai:not_configured",
    };
  }

  if (!FormData) {
    return {
      error:
        "openai:form-data package missing",
    };
  }

  try {
    const form = new FormData();

    const png = await sharp(buffer)
      .rotate()
      .png()
      .toBuffer();

    form.append(
      "model",
      OPENAI_IMG_MODEL
    );

    form.append(
      "image",
      png,
      {
        filename: "input.png",
        contentType: "image/png",
      }
    );

    if (mask) {
      const maskPng = await sharp(mask)
        .ensureAlpha()
        .png()
        .toBuffer();

      form.append(
        "mask",
        maskPng,
        {
          filename: "mask.png",
          contentType: "image/png",
        }
      );
    }

    form.append(
      "prompt",
      String(prompt).slice(0, 2000)
    );

    form.append(
      "n",
      "1"
    );

    form.append(
      "output_format",
      "png"
    );

    form.append(
      "size",
      "auto"
    );

    const response = await fetch(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${OPENAI_KEY}`,

          ...form.getHeaders(),
        },

        body: form,
      }
    );

    const json =
      await response
        .json()
        .catch(() => ({}));

    if (
      response.ok &&
      json?.data?.[0]?.b64_json
    ) {
      return {
        buffer: Buffer.from(
          json.data[0].b64_json,
          "base64"
        ),
      };
    }

    const message =
      json?.error?.message ||
      `http_${response.status}`;

    return {
      error:
        `openai:${String(message).slice(0, 180)}`,
    };
  } catch (error) {
    return {
      error:
        `openai:${String(error.message).slice(0, 180)}`,
    };
  }
}

// ============================================================
// REMOVE.BG
// ============================================================

async function removeBgViaRemoveBg(buffer) {
  if (!REMOVE_BG_KEY) {
    return {
      ok: false,
      error: "remove.bg:not_configured",
    };
  }

  if (!FormData) {
    return {
      ok: false,
      error: "form-data package missing",
    };
  }

  try {
    const form = new FormData();

    const png = await sharp(buffer)
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer();

    form.append(
      "image_file",
      png,
      {
        filename: "image.png",
        contentType: "image/png",
      }
    );

    form.append(
      "size",
      "auto"
    );

    const response = await fetch(
      "https://api.remove.bg/v1.0/removebg",
      {
        method: "POST",

        headers: {
          "X-Api-Key":
            REMOVE_BG_KEY,

          ...form.getHeaders(),
        },

        body: form,
      }
    );

    if (response.ok) {
      return {
        ok: true,

        buffer: Buffer.from(
          await response.arrayBuffer()
        ),

        provider: "remove.bg",
      };
    }

    return {
      ok: false,
      error:
        `remove.bg:http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        `remove.bg:${String(error.message).slice(
          0,
          150
        )}`,
    };
  }
}

// ============================================================
// ENSURE ALPHA
// ============================================================

async function ensureAlpha(buffer) {
  try {
    const metadata =
      await sharp(buffer)
        .metadata();

    if (!metadata.hasAlpha) {
      return await sharp(buffer)
        .rotate()
        .ensureAlpha()
        .png()
        .toBuffer();
    }

    return buffer;
  } catch {
    return buffer;
  }
}

// ============================================================
// TRUE BACKGROUND REMOVAL
// ============================================================

async function removeBackground(buffer) {
  // Prefer remove.bg for actual segmentation.
  if (REMOVE_BG_KEY) {
    const result =
      await removeBgViaRemoveBg(
        buffer
      );

    if (result.ok) {
      return {
        buffer:
          await ensureAlpha(
            result.buffer
          ),

        provider:
          result.provider,
      };
    }
  }

  // OpenAI fallback.
  if (OPENAI_KEY) {
    const result =
      await gptInpaint(
        buffer,

        "Remove the entire background from this image. Preserve the main subject exactly. Keep fine details, hair, edges and important object boundaries natural. Make the background transparent. Do not alter the subject."
      );

    if (result.buffer) {
      return {
        buffer:
          await ensureAlpha(
            result.buffer
          ),

        provider:
          "openai",
      };
    }

    return {
      error:
        result.error ||
        "openai background removal failed",
    };
  }

  return {
    error:
      "Background removal provider is not configured. Add REMOVE_BG_API_KEY or OPENAI_API_KEY."
  };
}

// ============================================================
// LOCAL FLAT BACKGROUND
// ============================================================
//
// IMPORTANT:
// This does NOT perform segmentation.
// It is only used when the user asks for a flat
// background and no AI provider exists.
// ============================================================

async function localFlatBackground(
  buffer,
  color
) {
  return sharp(buffer)
    .rotate()
    .flatten({
      background: color,
    })
    .png()
    .toBuffer();
}

// ============================================================
// GENERATIVE TEXT/OBJECT EDIT
// ============================================================

async function generativeEdit(
  buffer,
  action,
  step
) {
  if (!canInpaint()) {
    return {
      error:
        `${action} requires OPENAI_API_KEY.`
    };
  }

  let prompt = "";

  if (action === "remove_text") {
    const target = step.text
      ? ` "${step.text}"`
      : "";

    prompt =
      `Remove the text${target} from the image. ` +
      `Reconstruct the area naturally using surrounding visual content. ` +
      `Do not leave letters, artifacts or visible traces. ` +
      `Preserve everything else unchanged.`;
  }

  else if (action === "replace_text") {
    prompt =
      `Replace the text "${step.target_string}" ` +
      `with "${step.replacement}". ` +
      `Keep the same position, approximate font style, size, alignment, ` +
      `perspective, color and visual appearance. ` +
      `Change only the requested text and preserve the rest of the image.`;
  }

  else if (action === "remove_object") {
    const target = step.text
      ? ` identified as "${step.text}"`
      : "";

    prompt =
      `Remove the object or visual element${target} from the image. ` +
      `Reconstruct the background naturally so there is no visible trace. ` +
      `Preserve all unrelated subjects and details.`;
  }

  else {
    return {
      error:
        "Unsupported generative action."
    };
  }

  return gptInpaint(
    buffer,
    prompt
  );
}

// ============================================================
// MAIN EXECUTOR
// ============================================================

async function applyPlan(
  buffer,
  steps
) {
  const executed = [];
  const notes = [];

  let current = buffer;

  if (!Buffer.isBuffer(current)) {
    throw new Error(
      "Image buffer is invalid."
    );
  }

  for (const step of steps) {
    if (!step?.action) continue;

    const action =
      String(step.action)
        .toLowerCase();

    try {
      // ======================================================
      // ADJUST
      // ======================================================

      if (action === "adjust") {
        current =
          await ImageProcessor.adjust(
            current,
            step.adjust || {}
          );

        executed.push(
          "brightness/contrast/saturation"
        );

        continue;
      }

      // ======================================================
      // FILTER
      // ======================================================

      if (action === "filter") {
        current =
          await ImageProcessor.applyFilter(
            current,
            step.filter
          );

        executed.push(
          `filter:${step.filter}`
        );

        continue;
      }

      // ======================================================
      // ENHANCE
      // ======================================================

      if (action === "enhance") {
        const result =
          await ImageProcessor.enhance(
            current,
            {
              scale:
                step.scale || 1.2,

              sharpness: 1.2,
            }
          );

        current =
          result?.buffer ||
          result;

        executed.push(
          `enhance×${step.scale}`
        );

        continue;
      }

      // ======================================================
      // UPSCALE
      // ======================================================

      if (action === "upscale") {
        const result =
          await ImageProcessor.enhance(
            current,
            {
              scale:
                step.scale || 2,

              sharpness: 0.8,
            }
          );

        current =
          result?.buffer ||
          result;

        executed.push(
          `HD/${step.scale}×`
        );

        continue;
      }

      // ======================================================
      // RESIZE
      // ======================================================

      if (action === "resize") {
        current =
          await ImageProcessor.resize(
            current,
            step.width,
            step.height,
            "fit"
          );

        executed.push(
          `resize ${step.width}×${step.height}`
        );

        continue;
      }

      // ======================================================
      // CROP
      // ======================================================

      if (action === "crop") {
        const metadata =
          await sharp(current)
            .metadata();

        const imageWidth =
          metadata.width || 1;

        const imageHeight =
          metadata.height || 1;

        const left = Math.max(
          0,
          Math.min(
            step.x,
            imageWidth - 1
          )
        );

        const top = Math.max(
          0,
          Math.min(
            step.y,
            imageHeight - 1
          )
        );

        const width =
          Math.min(
            step.width,
            imageWidth - left
          );

        const height =
          Math.min(
            step.height,
            imageHeight - top
          );

        if (
          width <= 0 ||
          height <= 0
        ) {
          notes.push(
            "Crop skipped: invalid crop dimensions."
          );

          continue;
        }

        current =
          await sharp(current)
            .extract({
              left:
                Math.round(left),

              top:
                Math.round(top),

              width:
                Math.round(width),

              height:
                Math.round(height),
            })
            .png()
            .toBuffer();

        executed.push(
          `crop ${Math.round(width)}×${Math.round(height)}`
        );

        continue;
      }

      // ======================================================
      // ROTATE
      // ======================================================

      if (action === "rotate") {
        current =
          await ImageProcessor.rotate(
            current,
            step.degrees
          );

        executed.push(
          `rotate ${step.degrees}°`
        );

        continue;
      }

      // ======================================================
      // REMOVE BACKGROUND
      // ======================================================

      if (action === "remove_background") {
        const result =
          await removeBackground(
            current
          );

        if (result.buffer) {
          current =
            result.buffer;

          executed.push(
            `background removed (${result.provider})`
          );
        } else {
          notes.push(
            result.error ||
            "Background removal failed."
          );
        }

        continue;
      }

      // ======================================================
      // REPLACE BACKGROUND
      // ======================================================

      if (action === "replace_background") {
        if (canInpaint()) {
          const result =
            await gptInpaint(
              current,

              `Change the background to solid color ${step.color}. ` +
              `Preserve the main subject exactly, including edges, ` +
              `details and proportions. Do not change the subject.`
            );

          if (result.buffer) {
            current =
              result.buffer;

            executed.push(
              `background → ${step.color} (AI)`
            );
          } else {
            notes.push(
              `replace_background failed: ${result.error}`
            );
          }
        } else {
          current =
            await localFlatBackground(
              current,
              step.color
            );

          executed.push(
            `background → ${step.color} (local)`
          );

          notes.push(
            "Local flat background was used because no AI background provider is configured."
          );
        }

        continue;
      }

      // ======================================================
      // TEXT / OBJECT GENERATIVE EDITS
      // ======================================================

      if (
        action === "remove_text" ||
        action === "replace_text" ||
        action === "remove_object"
      ) {
        const result =
          await generativeEdit(
            current,
            action,
            step
          );

        if (result.buffer) {
          current =
            result.buffer;

          if (action === "remove_text") {
            executed.push(
              "text removed (AI)"
            );
          }

          else if (
            action === "replace_text"
          ) {
            executed.push(
              "text replaced (AI)"
            );
          }

          else {
            executed.push(
              "object removed (AI)"
            );
          }
        } else {
          notes.push(
            result.error ||
            `${action} failed.`
          );
        }

        continue;
      }
    } catch (error) {
      notes.push(
        `step ${action} failed: ${String(
          error.message
        ).slice(0, 150)}`
      );
    }
  }

  return {
    buffer: current,
    executed,
    notes,
  };
}

// ============================================================
// CAPABILITY INFO
// ============================================================

function getCapabilities() {
  return {
    openai: Boolean(OPENAI_KEY),

    removeBg: Boolean(
      REMOVE_BG_KEY
    ),

    replicate: Boolean(
      REPLICATE_TOKEN
    ),

    inpainting: Boolean(
      OPENAI_KEY
    ),

    backgroundRemoval:
      Boolean(
        REMOVE_BG_KEY ||
        OPENAI_KEY
      ),

    localEditing: true,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  applyPlan,
  validatePlan,

  canInpaint,
  canSegment,

  getCapabilities,

  ALLOW,
};