// ============================================================
// services/pptGenerator.js — AI PPT Generator core service
//
// FLOW:
//   topic + options
//   → AI content (geminiGenerate — EXISTING infra, chunked,
//     retry, malformed-JSON repair, partial recovery)
//   → validation + slide clamping
//   → real .pptx via pptxgenjs (layouts auto-chosen, themes,
//     speaker notes via slide.addNotes — natively supported,
//     koi limitation nahi)
//   → safe unique file in uploads/ppt + TTL cleanup
//   → returns { fileName, filePath, slideCount }
//
// ISOLATION: ye file existing question-bank/resume/interview/
// cron generation ko touch nahi karti — geminiGenerate reuse
// hai, koi shared utility MODIFY nahi hui.
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const PptxGenJS = require("pptxgenjs");
const { geminiGenerate, extractJSON } = require("../config/geminiClient");
const { keyManager } = require("../config/geminiKeys");
const { getTheme, THEMES } = require("./pptThemes");

// ---------- CONFIG / LIMITS ----------
const PPT_DIR = path.join(__dirname, "..", "uploads", "ppt");
const TTL_HOURS = (() => {
  const t = parseInt(process.env.PPT_FILE_TTL_HOURS || "72", 10);
  return Number.isFinite(t) && t > 0 ? t : 72;
})();

const MIN_SLIDES = 5;
const MAX_SLIDES = 20;
const MAX_TOPIC_LEN = 300;

const LANGUAGES = ["English", "Hindi", "Bilingual"];
const TYPES = ["Student", "Professional", "Educational", "Interview", "General"];
const THEME_NAMES = Object.keys(THEMES);

const CHUNK_SIZE = 8;          // AI chunk me max slides (truncation-safe)
const CONTENT_MAX_BULLETS = 6; // presentation-friendly
const BULLET_MAX_LEN = 160;
const DEVANAGARI_FONT = "Nirmala UI"; // Hindi Unicode readable font

// Devanagari-readable fallback — MAX_TOKENS par kata hua JSON
// isse close ho jaata hai (string-aware bracket balance)
function repairTruncatedJson(text) {
  try {
    let inStr = false;
    let esc = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "[" || c === "{") stack.push(c === "[" ? "]" : "}");
      else if (c === "]" || c === "}") {
        if (stack.length && stack[stack.length - 1] === c) stack.pop();
        else return null;
      }
    }
    let out = text;
    if (inStr) out += '"';
    out = out.replace(/,\s*$/, "");
    while (stack.length) out += stack.pop();
    return out;
  } catch {
    return null;
  }
}

// Malformed JSON recovery: extractJSON fail → truncation repair
function parseAIJson(text) {
  if (!text) return null;
  const direct = extractJSON(text);
  if (direct && typeof direct === "object") return direct;
  let t = String(text);
  const start = t.indexOf("{");
  if (start === -1) return null;
  t = t.slice(start);
  try {
    return JSON.parse(t);
  } catch (_) {}
  const repaired = repairTruncatedJson(t);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch (_) {}
  }
  return null;
}

// ---------- INPUT VALIDATION (route se bhi use hota hai) ----------
function validatePPTOptions(opts) {
  const errors = [];
  const topic = String(opts.topic || "").trim();
  if (!topic) errors.push("Topic required hai");
  if (topic.length > MAX_TOPIC_LEN) errors.push(`Topic max ${MAX_TOPIC_LEN} characters`);
  const slides = parseInt(opts.slides, 10);
  if (!Number.isFinite(slides) || slides < MIN_SLIDES || slides > MAX_SLIDES) {
    errors.push(`Slides ${MIN_SLIDES}-${MAX_SLIDES} ke beech hone chahiye`);
  }
  const language = String(opts.language || "English");
  if (!LANGUAGES.includes(language)) errors.push("Invalid language");
  const type = String(opts.type || "General");
  if (!TYPES.includes(type)) errors.push("Invalid presentation type");
  const theme = String(opts.theme || "Modern");
  if (!THEME_NAMES.includes(theme)) errors.push("Invalid theme");
  return {
    errors,
    clean: {
      topic,
      slides: Number.isFinite(slides) ? Math.min(Math.max(slides, MIN_SLIDES), MAX_SLIDES) : 10,
      language,
      type,
      theme,
      addImages: !!opts.addImages,
      speakerNotes: !!opts.speakerNotes,
    },
  };
}

// ---------- AI CONTENT GENERATION ----------
function buildChunkPrompt(cfg, chunkNo, totalChunks, startNo, count, mainTitle) {
  const langRule =
    cfg.language === "English"
      ? "ALL text in English."
      : cfg.language === "Hindi"
      ? "ALL text in proper Hindi (Devanagari). NOT Roman/Hinglish."
      : 'Bilingual: each bullet = short English text + " | " + short Hindi text (readable, no giant paragraphs). Titles: English | Hindi.';

  return `You are an expert presentation designer. Create a ${cfg.type} presentation.
Topic: "${cfg.topic}"
${langRule}
${mainTitle ? `Main presentation title (keep consistent): "${mainTitle}"` : ""}
This is content chunk ${chunkNo} of ${totalChunks} — slides ${startNo} to ${startNo + count - 1}. Cover the topic PROGRESSIVELY (intro → details → examples → conclusion). Chunks must connect logically, no repeats.

Rules:
1. Slide content = ${CONTENT_MAX_BULLETS - 2}-${CONTENT_MAX_BULLETS} SHORT bullet points (max 14 words each). NEVER giant paragraphs.
2. slideNumber must start at ${startNo} and increment.
3. imagePrompt: short English visual description (slide visuals that benefit from an image).
4. speakerNotes: 1-2 short presenter sentences (what to SAY, not repeat bullets).
5. ${cfg.addImages ? "" : "Set every imagePrompt to empty string \"\". "}
6. ${cfg.speakerNotes ? "" : 'Set every speakerNotes to empty string "". '}
7. Return ONLY valid JSON. No markdown. No extra text.

JSON FORMAT:
{"title":"Presentation Title","subtitle":"Short subtitle","slides":[{"slideNumber":${startNo},"title":"Slide Title","content":["bullet 1","bullet 2"],"imagePrompt":"","speakerNotes":""}]}`;
}

// Ek slide validate + clamp (partial-content recovery ke liye zaroori)
function normalizeSlide(raw, expectedNo) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "").trim();
  if (!title) return null;
  let content = Array.isArray(raw.content) ? raw.content : [];
  content = content
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .map((c) => (c.length > BULLET_MAX_LEN ? c.slice(0, BULLET_MAX_LEN - 1) + "…" : c))
    .slice(0, CONTENT_MAX_BULLETS);
  if (!content.length) return null;
  return {
    slideNumber: Number.isInteger(raw.slideNumber) ? raw.slideNumber : expectedNo,
    title: title.slice(0, 120),
    content,
    imagePrompt: String(raw.imagePrompt || "").trim().slice(0, 200),
    speakerNotes: String(raw.speakerNotes || "").trim().slice(0, 300),
  };
}

async function callAIChunk(cfg, chunkNo, totalChunks, startNo, count, mainTitle, tryNo = 1) {
  const prompt = buildChunkPrompt(cfg, chunkNo, totalChunks, startNo, count, mainTitle);
  const extraHint = tryNo > 1 ? "\n⚠️ PREVIOUS ATTEMPT WAS INVALID — return a non-empty valid JSON object." : "";
  const text = await geminiGenerate(prompt + extraHint, 45000);
  const parsed = parseAIJson(text);
  if (!parsed) {
    if (tryNo < 2 && !keyManager.isQuotaExhausted()) {
      console.log(`📊 [PPT] Chunk ${chunkNo} invalid JSON — retry (${tryNo + 1})`);
      return await callAIChunk(cfg, chunkNo, totalChunks, startNo, count, mainTitle, tryNo + 1);
    }
    return null;
  }
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const slides = rawSlides
    .map((s, i) => normalizeSlide(s, startNo + i))
    .filter(Boolean);
  // Pehle chunk se title/subtitle capture
  return {
    title: String(parsed.title || "").trim().slice(0, 120) || "",
    subtitle: String(parsed.subtitle || "").trim().slice(0, 160) || "",
    slides,
  };
}

// Missing slides ko minimal valid slide se pad karo (partial recovery —
// pura discard nahi karte)
function padSlides(slides, cfg, title) {
  let no = slides.length ? slides[slides.length - 1].slideNumber : 0;
  while (slides.length < cfg.slides) {
    no++;
    slides.push({
      slideNumber: no,
      title: cfg.language === "Hindi" ? `${title} (जारी)` : `${title} (continued)`,
      content:
        cfg.language === "Hindi"
          ? ["मुख्य बिंदु", "उदाहरण", "निष्कर्ष"]
          : cfg.language === "Bilingual"
          ? ["Key point | मुख्य बिंदु", "Example | उदाहरण", "Conclusion | निष्कर्ष"]
          : ["Key point", "Example", "Conclusion"],
      imagePrompt: "",
      speakerNotes: "",
    });
  }
  return slides;
}

async function generatePPTContent(cfg) {
  const chunks = [];
  let made = 0;
  let chunkNo = 0;
  while (made < cfg.slides) {
    const n = Math.min(CHUNK_SIZE, cfg.slides - made);
    chunks.push(n);
    made += n;
  }

  let mainTitle = "";
  let subtitle = "";
  const slides = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    if (keyManager.isQuotaExhausted()) break;
    const startNo = slides.length + 1;
    const result = await callAIChunk(cfg, ci + 1, chunks.length, startNo, chunks[ci], mainTitle);
    if (result) {
      if (!mainTitle && result.title) mainTitle = result.title;
      if (!subtitle && result.subtitle) subtitle = result.subtitle;
      slides.push(...result.slides);
      console.log(`📊 [PPT] Chunk ${ci + 1}/${chunks.length}: +${result.slides.length} slides → ${slides.length}`);
    } else {
      console.log(`📊 [PPT] Chunk ${ci + 1} fail — aage ke chunks continue (partial recovery)`);
    }
  }

  if (!slides.length) {
    throw new Error("AI se presentation content nahi ban paya (quota/model issue) — thodi der baad try karo");
  }

  const finalSlides = padSlides(slides, cfg, mainTitle || cfg.topic).slice(0, cfg.slides);
  // slideNumber re-normalize
  finalSlides.forEach((s, i) => (s.slideNumber = i + 1));

  return {
    title: mainTitle || cfg.topic,
    subtitle,
    slides: finalSlides,
  };
}

// ---------- IMAGES (graceful — fail → slide continues) ----------
// NOTE: project me koi image-GENERATION service nahi hai (image editor
// sirf photo editing hai). Isliye keyless Pollinations.ai use ho raha
// hai. Per-image failure → null → slide text-only format me continue.
function fetchSlideImage(prompt) {
  return new Promise((resolve) => {
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        String(prompt).slice(0, 300)
      )}?width=768&height=512&nologo=true`;
      const req = https.get(url, { timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve(buf.length > 1000 ? buf : null);
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

// ---------- SAFE FILENAMES + TTL CLEANUP ----------
function makeFileName(userId, title) {
  const slug =
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "presentation";
  return `ppt-${userId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.pptx`;
}

// Path traversal reject — sirf hamare pattern ke filenames allow
function isSafeFileName(fileName) {
  if (typeof fileName !== "string") return false;
  if (!/^ppt-[A-Za-z0-9]+-\d{13}-[a-f0-9]{6}\.pptx$/.test(fileName)) return false;
  const resolved = path.resolve(PPT_DIR, fileName);
  return resolved.startsWith(PPT_DIR + path.sep);
}

async function cleanOldPPTFiles() {
  try {
    if (!fs.existsSync(PPT_DIR)) return;
    const cutoff = Date.now() - TTL_HOURS * 60 * 60 * 1000;
    const files = await fs.promises.readdir(PPT_DIR);
    let removed = 0;
    for (const f of files) {
      if (!f.endsWith(".pptx")) continue;
      const full = path.join(PPT_DIR, f);
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs < cutoff) {
          await fs.promises.unlink(full);
          removed++;
        }
      } catch {}
    }
    if (removed) console.log(`🧹 [PPT] ${removed} old PPT files removed (TTL ${TTL_HOURS}h)`);
  } catch (e) {
    console.log("🧹 [PPT] cleanup fail:", e.message);
  }
}

// ---------- PPTX CREATION ----------
// pptxgenjs natively .addNotes() support karta hai — speaker notes
// asli PowerPoint notes pane me dikhte hain (PowerPoint/Slides/Impress).
function buildPPTX(content, cfg) {
  const theme = getTheme(cfg.theme);
  const isHindiText = cfg.language !== "English";
  const bodyFont = isHindiText ? DEVANAGARI_FONT : theme.font;

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.author = "AI PPT Generator";
  pres.title = content.title;

  function styleSlide(slide) {
    slide.background = { color: theme.bg };
  }

  function addHeaderBar(slide, title) {
    slide.addShape("rect", {
      x: 0, y: 0, w: "100%", h: 0.9,
      fill: { color: theme.headerBg },
    });
    slide.addText(title, {
      x: 0.4, y: 0.05, w: "95%", h: 0.8,
      fontSize: 24, bold: true, color: theme.headerText,
      fontFace: bodyFont, valign: "middle", align: "left",
    });
  }

  function addBullets(slide, items, opts = {}) {
    slide.addText(
      items.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true } })),
      {
        x: opts.x ?? 0.6, y: opts.y ?? 1.3,
        w: opts.w ?? "88%", h: opts.h ?? 4.6,
        fontSize: opts.fontSize ?? 17, color: theme.bodyColor,
        fontFace: bodyFont, valign: "top", align: "left", lineSpacingMultiple: 1.3,
      }
    );
  }

  function addNotes(slide, notes) {
    if (cfg.speakerNotes && notes) slide.addNotes(notes);
  }

  function addFooterAccent(slide, slideNo) {
    slide.addShape("rect", {
      x: 0, y: "96%", w: "100%", h: 0.06,
      fill: { color: theme.accent },
    });
    if (slideNo) {
      slide.addText(String(slideNo), {
        x: "92%", y: "91%", w: 0.6, h: 0.3,
        fontSize: 10, color: theme.accent, fontFace: bodyFont, align: "right",
      });
    }
  }

  function isStatsSlide(s) {
    return s.content.filter((c) => /\d+\s*%|\d+\.\d/.test(c)).length >= 2;
  }

  function isComparisonSlide(s) {
    return /\bvs\.?\b|\bversus\b|\||तुलना/i.test(s.title) && s.content.length >= 4;
  }

  function addTitleSlide(slide, s) {
    styleSlide(slide);
    slide.addShape("rect", {
      x: 0, y: "35%", w: "100%", h: 0.08,
      fill: { color: theme.accent },
    });
    slide.addText(content.title, {
      x: 0.6, y: "12%", w: "88%", h: 1.6,
      fontSize: 40, bold: true, color: theme.titleColor, fontFace: bodyFont, align: "left",
    });
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: 0.6, y: "42%", w: "88%", h: 0.8,
        fontSize: 20, color: theme.accent, fontFace: bodyFont, align: "left",
      });
    }
    slide.addText(`${cfg.type} Presentation`, {
      x: 0.6, y: "78%", w: "60%", h: 0.5,
      fontSize: 14, color: theme.bodyColor, fontFace: bodyFont,
    });
    addNotes(slide, s.speakerNotes);
  }

  function addBulletsSlide(slide, s) {
    styleSlide(slide);
    addHeaderBar(slide, s.title);
    addBullets(slide, s.content);
    addFooterAccent(slide, s.slideNumber);
    addNotes(slide, s.speakerNotes);
  }

  function addStatsSlide(slide, s) {
    styleSlide(slide);
    addHeaderBar(slide, s.title);
    const items = s.content.slice(0, 4);
    const slotW = 2.1;
    items.forEach((t, i) => {
      const x = 0.5 + i * (slotW + 0.15);
      slide.addShape("roundRect", {
        x, y: 1.8, w: slotW, h: 2.6,
        fill: { color: theme.panel },
        line: { color: theme.accent, width: 1 },
      });
      slide.addText(t, {
        x: x + 0.1, y: 2.0, w: slotW - 0.2, h: 2.2,
        fontSize: 15, bold: true, color: theme.accent, fontFace: bodyFont,
        align: "center", valign: "middle",
      });
    });
    addFooterAccent(slide, s.slideNumber);
    addNotes(slide, s.speakerNotes);
  }

  function addTwoColumnSlide(slide, s) {
    styleSlide(slide);
    addHeaderBar(slide, s.title);
    const half = Math.ceil(s.content.length / 2);
    addBullets(slide, s.content.slice(0, half), { x: 0.5, w: "45%" });
    addBullets(slide, s.content.slice(half), { x: 5.15, w: "45%" });
    slide.addShape("line", {
      x: "50%", y: 1.3, w: 0, h: 4.4,
      line: { color: theme.accent2, width: 1 },
    });
    addFooterAccent(slide, s.slideNumber);
    addNotes(slide, s.speakerNotes);
  }

  function addImageTextSlide(slide, s, imgBuf) {
    styleSlide(slide);
    addHeaderBar(slide, s.title);
    slide.addImage({
      data: `image/jpeg;base64,${imgBuf.toString("base64")}`,
      x: 0.4, y: 1.4, w: 4.3, h: 3.4,
      sizing: { type: "contain", w: 4.3, h: 3.4 },
    });
    addBullets(slide, s.content, { x: 5.0, w: "45%", fontSize: 15 });
    addFooterAccent(slide, s.slideNumber);
    addNotes(slide, s.speakerNotes);
  }

  function addThankYouSlide(slide, s) {
    styleSlide(slide);
    slide.addText(
      cfg.language === "Hindi" ? "धन्यवाद!" : cfg.language === "Bilingual" ? "Thank You | धन्यवाद!" : "Thank You!",
      {
        x: "10%", y: "30%", w: "80%", h: 1.6,
        fontSize: 44, bold: true, color: theme.titleColor,
        fontFace: bodyFont, align: "center",
      }
    );
    slide.addShape("rect", {
      x: "40%", y: "58%", w: "20%", h: 0.08,
      fill: { color: theme.accent },
    });
    addFooterAccent(slide, s.slideNumber);
    addNotes(slide, s.speakerNotes);
  }

  // Layout auto-choice per slide
  content.slides.forEach(async (s, idx) => {
    const slide = pres.addSlide();
    const isLast = idx === content.slides.length - 1;
    const isThank = isLast && /thank|धन्यवाद|conclusion|निष्कर्ष/i.test(s.title);

    if (idx === 0) return addTitleSlide(slide, s);
    if (isThank) return addThankYouSlide(slide, s);
    if (isStatsSlide(s)) return addStatsSlide(slide, s);

    if (cfg.addImages && s.imagePrompt) {
      // Image fail → text-only slide (PPT kabhi fail nahi hota)
      return fetchSlideImage(s.imagePrompt).then((imgBuf) => {
        if (imgBuf) addImageTextSlide(slide, s, imgBuf);
        else if (isComparisonSlide(s)) addTwoColumnSlide(slide, s);
        else addBulletsSlide(slide, s);
      });
    }
    if (s.content.length > CONTENT_MAX_BULLETS - 2 && isComparisonSlide(s)) {
      return addTwoColumnSlide(slide, s);
    }
    return addBulletsSlide(slide, s);
  });

  return pres;
}

// ---------- MAIN ENTRY ----------
async function generatePPT(opts, userId) {
  const { errors, clean } = validatePPTOptions(opts);
  if (errors.length) {
    const e = new Error(errors.join(", "));
    e.statusCode = 400;
    throw e;
  }

  await cleanOldPPTFiles();

  const content = await generatePPTContent(clean);
  const fileName = makeFileName(userId, content.title);
  const filePath = path.join(PPT_DIR, fileName);

  if (!fs.existsSync(PPT_DIR)) fs.mkdirSync(PPT_DIR, { recursive: true });

  const pres = buildPPTX(content, clean);
  await pres.writeFile({ fileName: filePath });

  const st = fs.statSync(filePath);
  console.log(`📊 [PPT] Generated: ${fileName} (${(st.size / 1024).toFixed(0)} KB, ${content.slides.length} slides)`);

  return { fileName, filePath, slideCount: content.slides.length, content };
}

module.exports = {
  generatePPT,
  validatePPTOptions,
  isSafeFileName,
  cleanOldPPTFiles,
  PPT_DIR,
  MIN_SLIDES,
  MAX_SLIDES,
  LANGUAGES,
  TYPES,
  THEME_NAMES,
};