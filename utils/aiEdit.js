// ============================================================
// AI EDIT ENGINE (v7) — validation + operation router + executor
// ------------------------------------------------------------
// In:  buffer (current png buffer) + validated plan
// Out: final buffer + executed[] + honest notes[]
// Provider-gated; never fake pixel edits.
// ============================================================
"use strict";
const sharp = require("sharp");
const { ImageProcessor } = require("./imageProcessor");
const FormData = (()=>{ try { return require("form-data"); } catch { return null; } })();

// ---------- provider config (server scope only) ----------
const OPENAI_KEY        = process.env.OPENAI_API_KEY        || "";
const REPLICATE_TOKEN   = process.env.REPLICATE_API_TOKEN   || "";
const REMOVE_BG_KEY     = process.env.REMOVE_BG_API_KEY     || "";

const canInpaint = () => Boolean(OPENAI_KEY);
const canSegment = () => Boolean(OPENAI_KEY);   // remove.bg only does bg; we prefer gpt-image

// ---------- allowlist of actions we may EVER execute ----------
const ALLOW = new Set([
  "remove_background","replace_background",
  "remove_text","replace_text","remove_object",
  "adjust","filter","enhance","upscale","resize","crop","rotate"
]);

// Validate & prune any AI/ad-derived plan. Unknown actions rejected.
function validatePlan(steps) {
  if (!Array.isArray(steps)) return [];
  const out = [];
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const a = String(s.action || "").toLowerCase();
    if (!ALLOW.has(a)) continue;
    switch (a) {
      case "replace_text":
        if (s.replacement_text != null) { out.push({ action:a, target_string:String(s.target_text||"").slice(0,80), replacement:String(s.replacement_text).slice(0,80)}); }
        break;
      case "remove_text":      out.push({ action:a, text:String(s.target_text||s.text||"").slice(0,80) }); break;
      case "replace_background": out.push({ action:a, color:/^#[0-9a-fA-F]{6}$/.test(s.color||"") ? s.color : "#ffffff" }); break;
      case "remove_background":  out.push({ action:a }); break;
      case "remove_object":   out.push({ action:a, text:String(s.text||"").slice(0,80) }); break;
      case "adjust":          out.push({ action:a, adjust:{ brightness:num(s.adjust?.brightness), contrast:num(s.adjust?.contrast), saturation:num(s.adjust?.saturation) } }); break;
      case "filter":          out.push({ action:a, filter: String(s.filter||"cinematic") }); break;
      case "enhance":         out.push({ action:a, scale: Math.max(.5, Math.min(4, Number(s.scale)||1.2)) }); break;
      case "upscale":         out.push({ action:a, scale: Math.max(.5, Math.min(4, Number(s.scale)||2)) }); break;
      case "resize":          out.push({ action:a, width: Math.max(16, Number(s.width)||1920), height: Math.max(16, Number(s.height)||1080) }); break;
      case "crop":            out.push({ action:a, x:num(s.x), y:num(s.y), width:Math.max(1,Number(s.width)||0), height:Math.max(1,Number(s.height)||0) }); break;
      case "rotate":          out.push({ action:a, degrees: Math.abs(Number(s.degrees)||90) % 360 }); break;
      // remove_background included
      default: break;
    }
  }
  return out;
}
const num = x => (isFinite(Number(x)) ? Number(x) : 0);

// ------------------------------------------------------------
// OpenAI gpt-image inpainting (region mask optional).
// Returns { buffer } | { error }
// ------------------------------------------------------------
async function gptInpaint(buffer, prompt, mask) {
  if (!OPENAI_KEY) return { error: "openai:not_configured" };
  const FD = FormData;
  if (!FD) return { error: "openai:formdata_missing" };
  return new Promise(async (resolve) => {
    try {
      const f = new FD();
      const png = await sharp(buffer).rotate().png().toBuffer();
      f.append("model", process.env.OPENAI_IMG_MODEL || "gpt-image-1");
      f.append("image", png, { filename: "input.png", contentType: "image/png" });
      if (mask) { // RGB mask: white = region allowed to change
        f.append("mask", await sharp(mask).ensureAlpha().png().toBuffer(), { filename: "mask.png", contentType: "image/png" });
      }
      f.append("prompt", prompt);
      f.append("n", "1");
      f.append("output_format", "png");
      f.append("size", "auto");
      const r = await fetch("https://api.openai.com/v1/images/edits", {
        method:"POST", headers:{ Authorization:`Bearer ${OPENAI_KEY}`, ...f.getHeaders() }, body: f
      });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j?.data?.[0]?.b64_json) {
        resolve({ buffer: Buffer.from(j.data[0].b64_json, "base64") });
      } else {
        const detail = j?.error?.message || `http_${r.status}`;
        resolve({ error: `openai::${detail}` });
      }
    } catch (e) { resolve({ error: `openai::${String(e.message).slice(0,120)}` }); }
  });
}

// Build an RGBA inpainting mask (white = allowed region) from a box.
function regionMaskFromBox(buffer, box) {
  // returns sharp pipeline producing white box on transparent/black bg
  return sharp({ create: { width: box.w, height: box.h, channels: 4,
      background: { r:255,g:255,b:255,alpha:255 } } })
    .png().toBuffer()
    .then(maskBytes => (
      // we need mask same size as source: handled upstream as "tile over full canvas"
      maskBytes
    ));
}

// ------------------------------------------------------------
// MAIN: apply plan to current buffer, in order.
// ------------------------------------------------------------
async function applyPlan(buffer, steps) {
  const executed = [];
  const notes = [];
  let cur = buffer;

  for (const s of steps) {
    const a = s.action;
    try {
      if (a === "adjust") {
        cur = await ImageProcessor.adjust(cur, s.adjust);
        executed.push("brightness/contrast/saturation");
      } else if (a === "filter") {
        cur = await ImageProcessor.applyFilter(cur, s.filter);
        executed.push(`filter:${s.filter}`);
      } else if (a === "enhance") {
        cur = (await ImageProcessor.enhance(cur, { scale: s.scale, sharpness: 1.2 })).buffer;
        executed.push(`enhance×${s.scale}`);
      } else if (a === "upscale") {
        cur = (await ImageProcessor.enhance(cur, { scale: s.scale, sharpness: .8 })).buffer;
        executed.push(`HD/${s.scale}×`);
      } else if (a === "resize") {
        cur = await ImageProcessor.resize(cur, s.width, s.height, "fit");
        executed.push(`resize ${s.width}×${s.height}`);
      } else if (a === "rotate") {
        cur = await ImageProcessor.rotate(cur, s.degrees);
        executed.push(`rotate ${s.degrees}°`);
      } else if (a === "crop") { /* handled upstream w/ metadata */ }
      // ---- GENERATIVE (real provider needed) ----
      else if (a === "replace_background") {
        // Open gpt-image approach: prompt to recolor/flatten bg, or local flat
        if (canInpaint()) {
          const o = await gptInpaint(cur, `Change the background to solid color ${s.color}, keep the subject/foreground unchanged and sharp, natural edges.`, null);
          if (o.buffer) { cur = o.buffer; executed.push(`bg→${s.color}`); }
          else if (a) notes.push(`replace_background needs provider: ${o.error}`);
        } else {
          // local flat bg only when color requested
          const flat = await sharp(cur).rotate().flatten({ background: s.color }).png().toBuffer();
          cur = flat; executed.push(`bg flat ${s.color} (local)`);
        }
      }
      else if (a === "remove_background") {
        if (canSegment) {
          const o = await gptInpaint(cur, "Remove the background entirely, keep only the main subject with natural edges, transparent background.", null);
          if (o.buffer) { cur = await ensureAlpha(o.buffer); executed.push("background removed (AI)"); }
          else notes.push(`remove_background needs provider: ${o.error}`);
        } else if (REMOVE_BG_KEY) {
          // remove.bg path (plain bg only) - real segmentation
          const o = await removeBgViaRemoveBg(cur);
          if (o.ok) { cur = o.buffer; executed.push("background removed (remove.bg)"); }
          else notes.push(`remove.bg failed: ${o.error}`);
        } else {
          notes.push("background removal provider not configured (OpenAI/remove.bg needed) — background NOT removed (no fake result).");
        }
      }
      else if (a === "remove_text" || a === "replace_text") {
        const desc = a==="remove_text" ? `Remove the text${s.text?` "${s.text}"`:""}, fill the area naturally with surrounding content, no trace of letters.` 
                       : `Replace the text "${s.target_string}" with "${s.replacement}", matching the same font size, style, position and color as the original.`;
        if (canInpaint()) {
          const o = await gptInpaint(cur, desc, null);
          if (o.buffer) { cur = o.buffer; executed.push(`text ${a==="remove_text"?"removed":"replaced"}`); }
          else { notes.push(`${a} needs provider: ${o.error}`); }
        } else {
          notes.push(`"${a}" needs a real inpainting provider (OpenAI gpt-image). Configure OPENAI_API_KEY to enable. Text NOT silently removed.`);
        }
      }
      else if (a === "remove_object") {
        if (canInpaint()) {
          const o = await gptInpaint(cur, `Remove the object/element${s.text?` (${s.text})`:""}, reconstruct the background so no trace remains.`, null);
          if (o.buffer) { cur = o.buffer; executed.push("object removed"); }
          else notes.push(`remove_object needs provider: ${o.error}`);
        } else notes.push("object removal needs OpenAI gpt-image provider (not configured) — skipped honestly.");
      }
    } catch (e) { notes.push(`step ${a} failed: ${String(e.message).slice(0,80)}`); }
  }
  return { buffer: cur, executed, notes };
}

// ensure png has alpha for real "transparent bg"
async function ensureAlpha(buf) {
  try { const meta = await sharp(buf).metadata(); if (!meta.hasAlpha) return await sharp(buf).rotate().ensureAlpha().png().toBuffer(); } catch {}
  return buf;
}

async function removeBgViaRemoveBg(buffer) {
  try {
    const FD = FormData;
    const png = await sharp(buffer).rotate().ensureAlpha().png().toBuffer();
    const f = new FD();
    f.append("image_file", png, { filename: "img.png", contentType: "image/png" });
    f.append("size", "auto");
    const r = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": REMOVE_BG_KEY, ...f.getHeaders() },
      body: f,
    });
    if (r.ok) return { ok:true, buffer: Buffer.from(await r.arrayBuffer()), provider:"remove.bg" };
    return { ok:false, error:`remove.bg http_${r.status}` };
  } catch (e) { return { ok:false, error: String(e.message).slice(0,100) }; }
}

module.exports = { applyPlan, validatePlan, canInpaint, canSegment, ALLOW };