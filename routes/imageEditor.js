// ============================================================
// AI IMAGE EDITOR — Routes (v6.0 'True AI Editing' aware)
// Mounted /api/image-editor/*
// ============================================================
const express = require("express");
const multer = require("multer");
const path = require("path");
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

// ---------------- AI-EDIT ----------------
router.post("/ai-edit", validateImage, async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || "").trim();

    if (!instruction) {
      return res.status(400).json({
        success: false,
        message: "Instruction required.",
      });
    }

    const buffer = await loadImageBuffer(req);

    if (!buffer) {
      return res.status(404).json({
        success: false,
        message: "Image expired. Please upload the image again.",
      });
    }

    // --------------------------------------------------------
    // 1. GEMINI VISION PLANNER
    // Image + user's natural-language instruction
    // --------------------------------------------------------
    let visionPlan = null;

    try {
      const meta = await ImageProcessor.getMetadata(buffer);

      const vision = require("../utils/vision");

      visionPlan = await vision.analyseImage(
        buffer,
        instruction,
        {
          imgW: meta?.width || 1,
          imgH: meta?.height || 1,
        }
      );
    } catch (visionError) {
      console.warn(
        "[AI EDIT] Vision planner unavailable:",
        visionError.message
      );
      visionPlan = null;
    }

    // --------------------------------------------------------
    // 2. GET AI PLAN
    // --------------------------------------------------------
    let rawSteps = Array.isArray(visionPlan?.steps)
      ? visionPlan.steps
      : [];

    // --------------------------------------------------------
    // 3. FALLBACK TO EXISTING v5 PARSER
    // --------------------------------------------------------
    if (!rawSteps.length) {
      try {
        const parsed = parseAiInstruction(instruction);

        if (
          parsed &&
          parsed.ok &&
          Array.isArray(parsed.plan)
        ) {
          rawSteps = parsed.plan;
        }
      } catch (parserError) {
        console.warn(
          "[AI EDIT] Parser fallback failed:",
          parserError.message
        );
      }
    }

    // --------------------------------------------------------
    // 4. VALIDATE AI PLAN
    // IMPORTANT:
    // Never execute arbitrary AI-generated actions.
    // --------------------------------------------------------
    const plan = aiEdit.validatePlan(rawSteps);

    if (!plan.length) {
      return res.json({
        success: false,
        message:
          `Instruction samajh nahi aayi. Try: ` +
          `"photo HD kar do", ` +
          `"background hata do", ` +
          `"ABC ko XYZ kar do", ` +
          `"text hata do", ` +
          `"brightness badha do", ` +
          `"2x upscale"`,
        data: {
          instruction,
          regions: visionPlan?.regions || [],
        },
      });
    }

    // --------------------------------------------------------
    // 5. EXECUTE PLAN IN USER'S ORIGINAL ORDER
    // --------------------------------------------------------
    const result = await aiEdit.applyPlan(buffer, plan);

    const finalBuffer = result?.buffer || buffer;
    const executed = Array.isArray(result?.executed)
      ? result.executed
      : [];
    const notes = Array.isArray(result?.notes)
      ? result.notes
      : [];

    // --------------------------------------------------------
    // 6. SAVE FINAL IMAGE
    // --------------------------------------------------------
    const filename = await saveFrom(
      finalBuffer,
      "ai_edit"
    );

    const imageData = buildImageData(filename);

    // --------------------------------------------------------
    // 7. BUILD SAFE RESPONSE
    // --------------------------------------------------------
    const providerRequired = notes.length > 0;

    const planActions = plan.map(
      (step) => step.action
    );

    const message =
      executed.length > 0
        ? `AI applied ${executed.length} step(s): ${executed.join(
            " → "
          )}${providerRequired ? ". " + notes.join(" ") : "."}`
        : notes.length > 0
        ? notes.join(" ")
        : "No image operation was applied.";

    return res.json({
      success: executed.length > 0,
      message,

      data: {
        instruction,

        // Validated plan only
        plan,

        planActions,

        executed,

        stepsApplied: executed.length,

        stepsPending: notes,

        needsProvider: providerRequired,

        // Gemini OCR / detected regions
        regions: visionPlan?.regions || [],

        planner: visionPlan
          ? "gemini-vision"
          : "deterministic-fallback",

        realInpainting: Boolean(
          aiEdit.canInpaint?.()
        ),

        ...imageData,
      },
    });
  } catch (error) {
    console.error(
      "[AI EDIT] Request failed:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: `AI edit failed: ${String(
        error.message
      ).slice(0, 200)}`,
    });
  }
});

router.use((e,req,res,next)=>{ if(e instanceof multer.MulterError) return res.status(400).json({success:false,message:e.code==="LIMIT_FILE_SIZE"?"Max 20MB":`upload ${e.code}`}); if(e) return res.status(400).json({success:false,message:e.message}); next(); });

module.exports = router;