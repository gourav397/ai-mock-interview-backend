// ============================================================
// AI IMAGE EDITOR — Routes (v6.0 'True AI Editing' aware)
// Mounted /api/image-editor/*
// ============================================================
const express = require("express");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const { ImageProcessor, TEMP_DIR } = require("../utils/imageProcessor");
const aiEdit = require("../utils/aiEdit");
const { parseAiInstruction, describeStep } = (() => {
  try { return require("../utils/aiEditParser"); }        // your v5 parser
  catch (e) { return { parseAiInstruction: () => ({ ok:false }), describeStep: () => "?" }; }
})();

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP.`), false);
  },
});

// ---- Path safety (unchanged) ----
const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
function resolveTempPath(p) {
  if (!p || typeof p !== "string") return null;
  const n = path.basename(p.trim());
  if (!n || !FILENAME_RE.test(n)) return null;
  const full = path.join(TEMP_DIR, n);
  if (full.startsWith(TEMP_DIR + path.sep)) return full;
  return null;
}
async function loadImageBuffer(req) {
  if (req.file && req.file.buffer) return req.file.buffer;
  const r = resolveTempPath(req.body?.imagePath);
  if (r && fs.existsSync(r)) return fs.promises.readFile(r);
  return null;
}
const validateImage = (req, res, next) => {
  if (!req.file && !req.body?.imagePath && !req.session?.lastImage)
    return res.status(400).json({ success:false, message:"No image provided. Upload first." });
  next();
};
function buildImageData(f, e = {}) {
  return {
    path: f, filename: f,
    preview: `/api/image-editor/preview/${f}`,
    resultUrl: `/api/image-editor/preview/${f}`,
    downloadUrl: `/api/image-editor/download/${f}`,
    ...e,
  };
}
async function saveFrom(buf, hint) {
  return ImageProcessor.saveTemp(buf, hint);
}

// ---------------- STATUS -----------------
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      version: "6.0.0",
      supportedFormats: ["image/jpeg","image/png","image/webp"],
      aiEdit: {
        planner: aiEdit.hasGemini ? "gemini-vision" : "deterministic",
        llmConfigured: aiEdit.hasGemini,
        realInpainting: aiEdit.hasRealInpainting,        // openai || replicate
        backgroundAI: aiEdit.hasBackgroundAI,
        supportedPixelProviders: aiEdit.hasOpenAI ? ["openai"] : aiEdit.hasReplicate ? ["replicate"] : [],
        honestNote: aiEdit.hasRealInpainting
          ? "true AI text/object remove/replace enabled"
          : "Text/object removal needs OPENAI_API_KEY or REPLICATE_API_TOKEN. Sharp-only ops stay available.",
      },
    },
  });
});

// ---------------- UPLOAD / PREVIEW / DOWNLOAD (keep v4) ----------------
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success:false, message:"No image uploaded. Field 'image' required." });
    const v = ImageProcessor.validateImage(file);
    if (!v.valid) return res.status(400).json({ success:false, message:v.error });
    const md = await ImageProcessor.getMetadata(file.buffer);
    if (!md) return res.status(400).json({ success:false, message:"Corrupt image." });
    const name = await saveFrom(file.buffer, req.user?._id ? String(req.user._id) : "anon");
    return res.json({ success:true, message:"Uploaded.", data: buildImageData(name, { ...md, size: file.buffer.length }) });
  } catch (e) { res.status(500).json({ success:false, message:`Upload failed: ${e.message}` }); }
});

router.get("/preview/:filename", (req, res) => {
  const p = resolveTempPath(req.params.filename);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ success:false, message:"Image expired." });
  res.setHeader("Cache-Control","private, max-age=300");
  res.sendFile(p);
});

// ---------------- FILTER / ADJUST / etc (keep) ----------------
const ops = [
  ["filter",   "filter",   (b,h)=>({act:()=>ImageProcessor.applyFilter(b,h.filter)})],
  ["adjust",   "adjust",   (b,h)=>ImageProcessor.adjust(b,h.adjustments||h)],
  ["resize",   "resize",   (b,h)=>ImageProcessor.resize(b,h.width,h.height,h.fit)],
  ["crop",     "crop",     (b,h)=>ImageProcessor.crop(b,h.left,h.top,h.width,h.height)],
  ["rotate",   "rotate",   (b,h)=>ImageProcessor.rotate(b,h.degrees||90)],
];

function genericHandler(label) {
  return async (req, res) => {
    try {
      const b = await loadImageBuffer(req);
      if (!b) return res.status(404).json({ success:false, message:"Image expired." });
      let out;
      if (label === "filter") {
        if (!req.body.filter) return res.status(400).json({ success:false, message:"filter required" });
        out = await ImageProcessor.applyFilter(b, req.body.filter);
      } else if (label === "adjust") {
        out = await ImageProcessor.adjust(b, req.body.adjustments || req.body);
      } else if (label === "rotate") { out = await ImageProcessor.rotate(b, req.body.degrees || 90); }
      const name = await saveFrom(out, label);
      res.json({ success:true, message:`${label} applied`, data: buildImageData(name) });
    } catch (e) { res.status(500).json({ success:false, message:`${label} failed: ${e.message}` }); }
  };
}
router.post("/filter", validateImage, genericHandler("filter"));
router.post("/adjust", validateImage, genericHandler("adjust"));
router.post("/rotate", validateImage, genericHandler("rotate"));
router.post("/resize", validateImage, async (req,res)=>{ try{
  const { width, height, fit="cover" } = req.body||{};
  if(!width||!height) return res.status(400).json({success:false,message:"width & height required"});
  const b = await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const o = await ImageProcessor.resize(b,width,height,fit); const n = await saveFrom(o,"resized");
  res.json({success:true,data:buildImageData(n,{width:+width,height:+height,fit})});
}catch(e){res.status(500).json({success:false,message:`resize failed: ${e.message}`})}});
router.post("/crop", validateImage, async(req,res)=>{try{
  const {left,top,width,height}=req.body||{};
  if(left===undefined||top===undefined||!width||!height) return res.status(400).json({success:false,message:"left,top,width,height"});
  const b=await loadImageBuffer(req); if(!b)return res.status(404).json({success:false,message:"expired"});
  const o=await ImageProcessor.crop(b,left,top,width,height); const n=await saveFrom(o,"crop");
  res.json({success:true,data:buildImageData(n)});
}catch(e){res.status(400).json({success:false,message:e.message.includes('bounds')?e.message:`crop failed`})}});
router.post("/enhance", validateImage, async(req,res)=>{try{
  const b=await loadImageBuffer(req); if(!b)return res.status(404).json({success:false,message:"expired"});
  const sc=Number(req.body?.scale)||1; const sh=Number(req.body?.sharpness)||1;
  const r=await ImageProcessor.enhance(b,{scale:sc,sharpness:sh}); const n=await saveFrom(r.buffer,"enhance");
  res.json({success:true,data:buildImageData(n,{scale:r.scale,width:r.width,height:r.height})});
}catch(e){res.status(500).json({success:false,message:e.message})}});
router.post("/upscale", validateImage, async(req,res)=>{try{
  const b=await loadImageBuffer(req); if(!b)return res.status(404).json({success:false,message:"expired"});
  const sc=Math.min(Math.max(Number(req.body?.scale)||2,1),4);
  const r=await ImageProcessor.enhance(b,{scale:sc,sharpness:.8}); const n=await saveFrom(r.buffer,"upscale");
  res.json({success:true,data:buildImageData(n,{scale:r.scale,width:r.width,height:r.height})});
}catch(e){res.status(500).json({success:false,message:e.message})}});

// ---------------- BACKGROUND (real provider if configured) ----------------
async function removeBgReal(b){
  if (aiEdit.hasRealInpainting){
    // openai or replicate can also do bg: pass prompt
    return runPixelInstruct(b);
  }
  if (process.env.REMOVE_BG_API_KEY){
    const form = new FormData();
    form.append("image_file", new Blob([b],{type:"image/png"}),"image.png");
    form.append("size","auto");
    const r = await fetch("https://api.remove.bg/v1.0/removebg",{method:"POST",headers:{"X-Api-Key":process.env.REMOVE_BG_API_KEY},body:form});
    if (r.ok) return { ok:true, buf: Buffer.from(await r.arrayBuffer()), provider:"remove.bg" };
  }
  // honest fallback
  const png = await sharp(b).rotate().png().toBuffer();   // note sharp import desired
  return { ok:true, buf: png, provider:"fallback" };
}
router.post("/remove-background", validateImage, async(req,res)=>{
  const b = await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  try{
    const out = await removeBgReal(b);
    const n = await saveFrom(out.buf,"nobg");
    res.json({ success:true, message: out.provider==="fallback"
      ? "Background: local PNG fallback only (no real segmentation). Configure REMOVE_BG_API_KEY/OPENAI_API_KEY for real BG removal."
      : `Background removed via ${out.provider}.`, data: buildImageData(n,{provider:out.provider}) });
  }catch(e){res.status(500).json({success:false,message:e.message})}
});

// --- NEW /ai-edit handler (order-preserving, honest) ---
const vision = require("../utils/vision");
const aiEditParser = require("../utils/aiEditParser"); // your v5 floor (optional import)

router.post("/ai-edit", validateImage, async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) return res.json({ success:false, message:"Instruction required." });

    const buf = await loadImageBuffer(req);  // reuse your existing buffer-loader
    if (!buf) return res.status(404).json({ success:false, message:"Source image expired. Re-upload." });

    let meta = { width: 0, height: 0 };
    try { meta = await sharp(buf).metadata(); } catch { return res.status(400).json({ success:false, message:"Corrupted/invalid image." }); }

    // ----- LAYER 1: Vision+OCR (Gemini) => plan + detected regions -----
    const visionOut = await vision.analyseImage(buf, instruction, {
      imgW: meta.width, imgH: meta.height,
    });

    // ----- LAYER 1b: deterministic v5 parser as fallback floor -----
    let rawSteps = [];
    if (visionOut && visionOut.steps && visionOut.steps.length) {
      rawSteps = visionOut.steps;
    } else {
      try {
        const p = (aiEditParser && aiEditParser.parseAiInstruction) ? aiEditParser.parseAiInstruction(instruction) : null;
        if (p && p.ok && Array.isArray(p.plan)) rawSteps = p.plan;
      } catch { rawSteps = []; }
    }

    // ----- LAYER 2: validation / allowlist -----
    const plan = aiEdit.validatePlan(rawSteps);
    if (!plan.length) {
      const samples = ['"photo HD kar do"','"background white kar do"','"ABC ko XYZ bana do"','"text hata do"','"brightness badha do"','"2x upscale"'];
      return res.json({ success:false, message:`Instruction samajh nahi aayi / no actionable step. Examples: ${samples.join(", ")}`,
        data: { instruction, regions: visionOut?.regions || [] } });
    }

    // ----- LAYER 3: execute in order -----
    const { buffer: finalBuf, executed, notes } = await aiEdit.applyPlan(buf, plan);

    // save via existing helper (saveFrom returns {filename, ...})
    const out = await saveFrom(finalBuf, "ai_edit");
    const build = buildImageData(out.filename); // reuse existing -> {preview, downloadUrl, resultUrl,...}

    const actionNames = plan.map(s => s.action);
    const allApplied = executed.length >= plan.length;

    // ----- RESPONSE -----
    const hasPending = notes.length > 0;
    res.json({
      success: true,           // request processed; honest caveats in notes
      message: executed.length
        ? `AI applied ${executed.length} step(s): ${executed.join(" → ")}${hasPending ? " (some steps need a provider)" : "."}`
        : notes.join("; "),
      data: {
        instruction,
        plan: plan,            // validated actions (never raw AI strings)
        executed,
        stepsApplied: executed.length,
        stepsPending: notes,
        needsProvider: hasPending,           // true → text/object/bg steps skipped; NOT faked
        regions: visionOut?.regions || [],   // OCR detections (de-scaled px)
        filename: out.filename,
        preview: build.preview,
        resultUrl: build.preview,
        downloadUrl: build.downloadUrl,
      },
    });
  } catch (e) {
    res.status(500).json({ success:false, message:`AI edit failed: ${String(e.message).slice(0,160)}` /* key-safe */ });
  }
});

router.use((e,req,res,next)=>{ if(e instanceof multer.MulterError) return res.status(400).json({success:false,message:e.code==="LIMIT_FILE_SIZE"?"Max 20MB":`upload ${e.code}`}); if(e) return res.status(400).json({success:false,message:e.message}); next(); });

module.exports = router;