// ============================================================
// AI IMAGE EDITOR — Routes (v8 Consistent)
// Mounted /api/image-editor/*
// Depends ONLY on: imageProcessor.js (v4) , aiEdit.js (v8), aiEditParser.js (v5), vision.js
// ============================================================
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");                          // FIX: sharp imported
const { ImageProcessor, TEMP_DIR } = require("../utils/imageProcessor");
const aiEdit = require("../utils/aiEdit");               // v8: validatePlan, applyPlan, getCapabilities
const vision = require("../utils/vision");               // analyseImage
const parser = require("../utils/aiEditParser");         // v5: parseAiInstruction

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ["image/jpeg","image/png","image/webp"].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported type: ${file.mimetype}`), false);
  },
});

// ---- path safety: basename only, TEMP_DIR scoped ----
const FILENAME_RE = /^[a-zA-Z0-9._-]+$/;
function resolveTempPath(p) {
  if (!p || typeof p !== "string") return null;
  const n = path.basename(p.trim());
  if (!n || !FILENAME_RE.test(n)) return null;
  const full = path.join(TEMP_DIR, n);
  return full.startsWith(TEMP_DIR + path.sep) && fs.existsSync(full) ? full : null;
}
async function loadImageBuffer(req) {
  if (req.file && req.file.buffer) return req.file.buffer;
  const r = resolveTempPath(req.body?.imagePath);
  return r ? fs.promises.readFile(r) : null;
}
const validateImage = (req, res, next) => {
  if (!req.file && !req.body?.imagePath) return res.status(400).json({ success:false, message:"No image. Upload first." });
  next();
};
// saveFrom returns a STRING filename
const saveFrom = (buf, hint) => ImageProcessor.saveTemp(buf, hint);
function buildImageData(f, e = {}) {
  return {
    path: f, filename: f,
    preview: `/api/image-editor/preview/${f}`,
    resultUrl: `/api/image-editor/preview/${f}`,
    downloadUrl: `/api/image-editor/download/${f}`,
    ...e,
  };
}

// ---------------- STATUS (uses real getCapabilities) ----------------
router.get("/status", (req, res) => {
  const c = aiEdit.getCapabilities();
  res.json({ success:true, data:{
    version:"8.0.0", supportedFormats:["image/jpeg","image/png","image/webp"],
    aiEdit: {
      planner: visionConfigured() ? "gemini-vision" : "deterministic",
      ...c,
      honestNote: c.inpainting
        ? "True AI text/object editing ENABLED"
        : "Text/object removal needs OPENAI_API_KEY. Sharp ops always work.",
    }
  }});
});
const visionConfigured = () => Boolean(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);

// ---------------- UPLOAD / PREVIEW / DOWNLOAD ----------------
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, message:"Field 'image' required." });
    const v = ImageProcessor.validateImage(req.file);
    if (!v.valid) return res.status(400).json({ success:false, message:v.error });
    const md = await ImageProcessor.getMetadata(req.file.buffer);
    if (!md) return res.status(400).json({ success:false, message:"Corrupt image." });
    const name = await saveFrom(req.file.buffer, "orig");
    res.json({ success:true, message:"Uploaded.", data: buildImageData(name, { ...md, size: req.file.buffer.length }) });
  } catch (e) { res.status(500).json({ success:false, message:`Upload failed: ${e.message}` }); }
});
router.get("/preview/:filename", (req, res) => {
  const p = resolveTempPath(req.params.filename);
  if (!p) return res.status(404).json({ success:false, message:"Image expired." });
  res.setHeader("Cache-Control","private, max-age=300");
  res.sendFile(p);
});
router.get("/download/:filename", (req, res) => {
  const p = resolveTempPath(req.params.filename);
  if (!p) return res.status(404).json({ success:false, message:"Image expired." });
  res.download(p, path.basename(p));
});

// ---------------- Sharp-only ops (filters / adjust / enhance / upscale / resize / crop / rotate) ----------------
router.post("/filter", validateImage, async (req,res)=>{ try{
  const { filter } = req.body||{}; if(!filter) return res.status(400).json({success:false,message:"filter required"});
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const n=await saveFrom(await ImageProcessor.applyFilter(b,filter),"filter");
  res.json({success:true,data:buildImageData(n)});
}catch(e){res.status(500).json({success:false,message:e.message})}});

router.post("/adjust", validateImage, async (req,res)=>{ try{
  const a=req.body?.adjustments||req.body?.adjust||{};
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const n=await saveFrom(await ImageProcessor.adjust(b,a),"adjust");
  res.json({success:true,data:buildImageData(n)});
}catch(e){res.status(500).json({success:false,message:e.message})}});

router.post("/enhance", validateImage, async (req,res)=>{ try{
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const sc=Math.min(4,Math.max(1,Number(req.body?.scale)||1));
  const r=await ImageProcessor.enhance(b,{scale:sc,sharpness:Number(req.body?.sharpness)||1.2});
  const n=await saveFrom(r.buffer,"enhance");
  res.json({success:true,data:buildImageData(n,{width:r.width,height:r.height,scale:r.scale})});
}catch(e){res.status(500).json({success:false,message:e.message})}});

router.post("/upscale", validateImage, async (req,res)=>{ try{
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const sc=Math.min(4,Math.max(1,Number(req.body?.scale)||2));
  const r=await ImageProcessor.enhance(b,{scale:sc,sharpness:0.8});
  const n=await saveFrom(r.buffer,"upscale");
  res.json({success:true,data:buildImageData(n,{width:r.width,height:r.height,scale:r.scale})});
}catch(e){res.status(500).json({success:false,message:e.message})}});

router.post("/resize", validateImage, async (req,res)=>{ try{
  const { width, height, fit="cover" }=req.body||{};
  if(!width||!height) return res.status(400).json({success:false,message:"width & height required"});
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const n=await saveFrom(await ImageProcessor.resize(b,width,height,fit),"resized");
  res.json({success:true,data:buildImageData(n,{width:+width,height:+height})});
}catch(e){res.status(500).json({success:false,message:e.message})}});

router.post("/crop", validateImage, async (req,res)=>{ try{
  const { left,top,width,height }=req.body||{};
  if(left===undefined||top===undefined||!width||!height) return res.status(400).json({success:false,message:"left,top,width,height"});
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const n=await saveFrom(await ImageProcessor.crop(b,left,top,width,height),"crop");
  res.json({success:true,data:buildImageData(n)});
}catch(e){res.status(400).json({success:false,message:e.message})}});

router.post("/rotate", validateImage, async (req,res)=>{ try{
  const deg=Number(req.body?.degrees)||90;
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const n=await saveFrom(await ImageProcessor.rotate(b,deg),"rotated");
  res.json({success:true,data:buildImageData(n)});
}catch(e){res.status(500).json({success:false,message:e.message})}});

// ---------------- BACKGROUND (real remove.bg if key; honest fallback) ----------------
router.post("/remove-background", validateImage, async (req,res)=>{ try{
  const b=await loadImageBuffer(req); if(!b) return res.status(404).json({success:false,message:"expired"});
  const r=await ImageProcessor.removeBackground(b);          // {buffer, provider:"remove.bg"|"fallback"}
  const n=await saveFrom(r.buffer,"nobg");
  const honest = r.provider==="remove.bg"
    ? "Background removed via remove.bg."
    : "Local PNG fallback only (no real segmentation). Set REMOVE_BG_API_KEY/OPENAI_API_KEY for true BG removal.";
  res.json({success:true, message:honest, data:buildImageData(n,{provider:r.provider})});
}catch(e){res.status(500).json({success:false,message:e.message})}});

// ---------------- AI-EDIT (order-preserving, honest) ----------------
// Convert raw AI/parser steps into the schema aiEdit.applyPlan expects.
const clampNum = (v,min,max,fb)=>{ const n=Number(v); return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fb; };
function toEngine(rawSteps) {
  const out=[];
  for (const s of (rawSteps||[])) {
    const a=String(s?.action||"").trim().toLowerCase();
    const t=s||{};
    switch(a){
      case "remove_background": out.push({action:"remove_background"}); break;
      case "replace_background": out.push({action:"replace_background", color:/^#[0-9a-fA-F]{6}$/.test(t.color||"")?t.color:"#ffffff"}); break;
      case "remove_text":       out.push({action:"remove_text", text:String(t.text??t.target_text??"").slice(0,100)}); break;
      case "replace_text":      out.push({action:"replace_text", target_string:String(t.target_text??t.text??"").slice(0,100), replacement:String(t.replacement_text??t.replacement??"").slice(0,100)}); break;
      case "remove_object":     out.push({action:"remove_object", text:String(t.text??t.object??"").slice(0,100)}); break;
      case "adjust": {
        const adj=t.adjustments||t.adjust||{};
        out.push({action:"adjust", adjust:{ brightness:clampNum(adj.brightness,0.1,3,1), contrast:clampNum(adj.contrast,0.1,3,1), saturation:clampNum(adj.saturation,0,3,1) }});
        break;
      }
      case "filter": out.push({action:"filter", filter:String(t.filter||"cinematic").slice(0,40)}); break;
      case "enhance": out.push({action:"enhance", scale:clampNum(t.scale,0.5,4,1.2)}); break;
      case "upscale": out.push({action:"upscale", scale:clampNum(t.scale,0.5,4,2)}); break;
      case "rotate": { let d=Math.abs(Number(t.degrees)||90)%360; if(d) out.push({action:"rotate", degrees:d}); break; }
      // resize & crop_percent: resize only when explicit dims present
      case "resize": { const w=Number(t.width), h=Number(t.height); if(w>0&&h>0) out.push({action:"resize", width:w, height:h}); break; }
      default: break; // unknown action rejected
    }
  }
  return out.slice(0,6);
}

router.post("/ai-edit", validateImage, async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) return res.json({ success:false, message:"Instruction required." });

    const buf = await loadImageBuffer(req);
    if (!buf) return res.status(404).json({ success:false, message:"Source expired. Re-upload." });

    let meta={width:0,height:0};
    try { meta = await sharp(buf).metadata(); } catch { return res.status(400).json({success:false,message:"Corrupted image."}); }

    // LAYER 1: Vision+OCR plan (if Gemini key) -> else v5 regex parser floor
    let rawSteps=null, regions=[];
    const vis = await vision.analyseImage(buf, instruction, { imgW:meta.width||1, imgH:meta.height||1 });
    if (vis?.steps?.length) { rawSteps=vis.steps; regions=vis.regions||[]; }
    else { const p=parser.parseAiInstruction(instruction); if(p?.ok) rawSteps=p.plan; }

    // LAYER 2: normalize + strict allowlist validation (engine schema)
    const plan = aiEdit.validatePlan(toEngine(rawSteps));
    if (!plan.length) {
      return res.json({ success:false,
        message:`Instruction samajh nahi aayi / no actionable step. Examples: "photo HD kar do", "background white kar do", "brightness badha do", "2x bada karo".`,
        data:{ instruction, regions } });
    }

    // LAYER 3: execute in order (Sharp local + real providers via aiEdit)
    const { buffer: finalBuf, executed, notes } = await aiEdit.applyPlan(buf, plan);
    const filename = await saveFrom(finalBuf, "ai_edit");     // STRING (FIX)
    const build = buildImageData(filename);
    const pending = notes.length>0;

    res.json({
      success:true,
      message: executed.length
        ? `Applied: ${executed.join(" → ")}${pending ? " | Remaining need provider: "+notes.join("; ") : ""}`
        : notes.join("; "),
      data:{
        instruction, plan, executed, stepsApplied: executed.length,
        stepsPending: notes, needsProvider: pending,
        regions, filename, preview: build.preview, resultUrl: build.resultUrl, downloadUrl: build.downloadUrl,
      },
    });
  } catch (e) { res.status(500).json({ success:false, message:`AI edit failed: ${String(e.message).slice(0,160)}` }); }
});

// ---------------- error middleware ----------------
router.use((e, req, res, next) => {
  if (e instanceof multer.MulterError) return res.status(400).json({ success:false, message: e.code==="LIMIT_FILE_SIZE" ? "Max 20MB" : `Upload: ${e.code}` });
  if (e) return res.status(400).json({ success:false, message: e.message });
  next();
});

module.exports = router;