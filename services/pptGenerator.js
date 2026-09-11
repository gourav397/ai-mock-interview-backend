// ============================================================
// services/pptGenerator.js — PRO AI PPT Generator (upgraded)
//
// UPGRADES (is version mein):
//  - AI SMART LAYOUTS: AI har slide ka layout choose karta hai
//    (title/bullets/twoColumn/threeCards/comparison/timeline/process/
//    stats/quote/imageText/fullImage/flow/summary/thanks) + heuristic
//    fallback. Same-layout-every-slide problem fixed.
//  - CHARTS: numeric data par native pptxgenjs charts (bar/line/pie/
//    doughnut) — real editable charts. No data → NO fake chart.
//  - DIAGRAMS: timeline/process/flow/KPI — native shapes (editable).
//  - TRANSITIONS: OOXML post-processor (JSZip) se real <p:transition>
//    (fade / push) inject — pptxgenjs native support nahi karta.
//  - ANIMATIONS: OOXML <p:timing> fade-entrance, click-staggered,
//    shape IDs slide XML se parse karke. Unsupported XML kabhi
//    corrupt nahi karta — post-process fail → original file deliver.
//  - NARRATION: AI narration script per slide → notes me embed +
//    API response mein (browser SpeechSynthesis playback frontend).
//    Reliable TTS audio embedding is platform par available nahi —
//    documented fallback architecture.
//  - PREVIEW: real slide data JSON response mein (frontend preview).
//  - QC: file exists + size + JSZip open-test + slide count + titles.
//  - Backward compatible: purane request fields waise hi kaam karte hain.
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");
const { geminiGenerate, extractJSON } = require("../config/geminiClient");
const { keyManager } = require("../config/geminiKeys");
const { getTheme, THEMES, GRID } = require("./pptThemes");

// ---------- CONFIG / LIMITS ----------
const PPT_DIR = path.join(__dirname, "..", "uploads", "ppt");
const TTL_HOURS = (() => {
  const t = parseInt(process.env.PPT_FILE_TTL_HOURS || "72", 10);
  return Number.isFinite(t) && t > 0 ? t : 72;
})();

const MIN_SLIDES = 5;
const MAX_SLIDES = 20;
const MAX_TOPIC_LEN = 300;
const DEVANAGARI_FONT = "Nirmala UI";

const LANGUAGES = ["English", "Hindi", "Bilingual"];
const TYPES = ["Student", "Professional", "Educational", "Interview", "General"];
const THEME_NAMES = Object.keys(THEMESivr || THEMES);
const LAYOUT_STYLES = ["AI Auto", "Professional", "Visual", "Academic"];
const TRANSITION_MODES = ["Off", "Subtle", "Dynamic"];
const ANIMATION_MODES = ["Off", "Subtle", "Professional"];
const CHART_MODES = ["Auto", "Off"];
const NARRATION_MODES = ["Off", "On"];

const KNOWN_LAYOUTS = [
  "title", "bullets", "twoColumn", "threeCards", "comparison", "timeline",
  "process", "stats", "quote", "imageText", "fullImage", "flow", "summary", "thanks",
];

const CHUNK_SIZE = 8;
const CONTENT_MAX_BULLETS = 6;
const BULLET_MAX_LEN = 160;

// ---------- JSON repair (truncation-safe) ----------
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

// ---------- INPUT VALIDATION (backward compatible) ----------
function pick(value, allowed, fallback) {
  const v = String(value || "");
  return allowed.includes(v) ? v : fallback;
}

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
  if (!THEMES[theme]) errors.push("Invalid theme");

  // Naye optional controls — unknown/missing values silently default
  // (backward compat: purane clients in fields bhejte hi nahi)
  return {
    errors,
    clean: {
      topic,
      slides: Number.isFinite(slides) ? Math.min(Math.max(slides, MIN_SLIDES), MAX_SLIDES) : 10,
      language,
      type,
      theme,
      addImages: !!opts.addImages,
      speakerNotes: opts.speakerNotes !== false, // default ON (purana behavior)
      layoutStyle: pick(opts.layoutStyle, LAYOUT_STYLES, "AI Auto"),
      transitions: pick(opts.transitions, TRANSITION_MODES, "Subtle"),
      animations: pick(opts.animations, ANIMATION_MODES, "Subtle"),
      charts: pick(opts.charts, CHART_MODES, "Auto"),
      narration: opts.narration === "On" || opts.narration === true,
    },
  };
}

// ---------- LAYOUT HINTS (layoutStyle ke hisab se AI ko bias) ----------
function layoutBiasHint(layoutStyle) {
  switch (layoutStyle) {
    case "Professional":
      return "Layout preference: mostly 'bullets', 'twoColumn', 'threeCards', 'stats' — clean corporate look. Avoid 'fullImage'.";
    case "Visual":
      return "Layout preference: heavily visual — 'imageText', 'fullImage', 'flow', 'timeline', 'stats', 'threeCards'. Minimal plain bullets.";
    case "Academic":
      return "Layout preference: 'bullets', 'twoColumn', 'quote', 'timeline', 'summary' — scholarly structure.";
    default: // AI Auto
      return "Choose the BEST layout per slide for maximum variety and impact. NEVER use the same layout twice in a row.";
  }
}

// ---------- AI CONTENT ----------
function buildChunkPrompt(cfg, chunkNo, totalChunks, startNo, count, mainTitle) {
  const langRule =
    cfg.language === "English"
      ? "ALL text in English."
      : cfg.language === "Hindi"
      ? "ALL text in proper Hindi (Devanagari). NOT Roman/Hinglish."
      : 'Bilingual: each bullet = short English + " | " + short Hindi. Titles: English | Hindi.';

  const firstSlideRule =
    chunkNo === 1
      ? 'First slide MUST be layout "title". '
      : "";

  return `You are an expert presentation designer. Create a ${cfg.type} presentation.
Topic: "${cfg.topic}"
${langRule}
${mainTitle ? `Main presentation title (keep consistent): "${mainTitle}"` : ""}
${layoutBiasHint(cfg.layoutStyle)}
${firstSlideRule}This is content chunk ${chunkNo} of ${totalChunks} — slides ${startNo} to ${startNo + count - 1}. Structure the topic PROGRESSIVELY: introduction → main concepts → examples/visual explanation → summary. Last chunk's final slide should be layout "summary" or "thanks". No repeats across chunks.

Available layouts (pick the BEST per slide): title, bullets, twoColumn, threeCards, comparison, timeline, process, stats, quote, imageText, fullImage, flow, summary, thanks.
Layout rules:
- "stats": ONLY when the content has real numbers/percentages (each bullet like "Label: 42%").
- "timeline": chronological steps/events. "process"/"flow": step-by-step how-to.
- "quote": one memorable quote or key statement + who said it.
- "comparison": two things being contrasted (use " | " separators).
- "imageText"/"fullImage": visually explainable slide (set imagePrompt).

Rules:
1. content = 3-${CONTENT_MAX_BULLETS} SHORT bullets (max 14 words each). NEVER paragraphs.
2. slideNumber starts at ${startNo}, increments.
3. imagePrompt: short English visual description (only for visual slides, else "").
4. speakerNotes: 1-2 sentences of WHAT TO SAY (not bullet repetition).
5. narrationScript: 2-3 spoken sentences presenting this slide naturally${cfg.narration ? "" : ' (set to "" if narration disabled)'}.
6. ${cfg.addImages ? "" : 'Every imagePrompt = "". '}
7. Return ONLY valid JSON. No markdown.

JSON FORMAT:
{"title":"Presentation Title","subtitle":"Short subtitle","slides":[{"slideNumber":${startNo},"title":"Slide Title","layout":"bullets","content":["bullet 1","bullet 2"],"imagePrompt":"","speakerNotes":"","narrationScript":""}]}`;
}

// Numeric data extraction — "Label: 42%" / "Label - 1.2M" patterns
function extractChartData(slide) {
  const items = [];
  for (const c of slide.content || []) {
    const m = String(c).match(/^(.{1,40}?)\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*%?/);
    if (m) items.push({ label: m[1].trim(), value: parseFloat(m[2]) });
  }
  return items.length >= 2 && items.length <= 6 ? items : null;
}

// Heuristic layout fallback — AI ka layout galat/missing ho to
function heuristicLayout(slide, cfg) {
  const text = `${slide.title} ${(slide.content || []).join(" ")}`;
  if (extractChartData(slide)) return cfg.charts === "Auto" ? "stats" : "bullets";
  if (/thank|धन्यवाद/i.test(slide.title)) return "thanks";
  if (/summary|निष्कर्ष|conclusion/i.test(slide.title)) return "summary";
  if (/\bvs\.?\b|versus|तुलना|vs /i.test(slide.title) && (slide.content || []).length >= 4) return "comparison";
  if (/timeline|इतिहास|history|chronolog|क्रम/i.test(text)) return "timeline";
  if (/step|प्रक्रिया|process|how to|कैसे/i.test(text)) return "process";
  if (/^(["'\u201C])/.test((slide.content || [])[0] || "")) return "quote";
  if ((slide.content || []).length >= 5) return "twoColumn";
  return "bullets";
}

function normalizeLayout(l, slide, cfg) {
  const v = String(l || "").trim();
  if (KNOWN_LAYOUTS.includes(v)) return v;
  return heuristicLayout(slide, cfg);
}

function normalizeSlide(raw, expectedNo, cfg) {
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

  const base = {
    slideNumber: Number.isInteger(raw.slideNumber) ? raw.slideNumber : expectedNo,
    title: title.slice(0, 120),
    content,
    imagePrompt: String(raw.imagePrompt || "").trim().slice(0, 200),
    speakerNotes: String(raw.speakerNotes || "").trim().slice(0, 300),
    narrationScript: String(raw.narrationScript || "").trim().slice(0, 500),
  };
  base.layout = normalizeLayout(raw.layout, base, cfg);
  return base;
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
    .map((s, i) => normalizeSlide(s, startNo + i, cfg))
    .filter(Boolean);
  return {
    title: String(parsed.title || "").trim().slice(0, 120) || "",
    subtitle: String(parsed.subtitle || "").trim().slice(0, 160) || "",
    slides,
  };
}

// Fallback pad slide (partial recovery — pura discard nahi)
function padSlides(slides, cfg, title) {
  let no = slides.length ? slides[slides.length - 1].slideNumber : 0;
  while (slides.length < cfg.slides) {
    no++;
    const isLast = slides.length + 1 === cfg.slides;
    slides.push({
      slideNumber: no,
      title: isLast
        ? cfg.language === "Hindi" ? "निष्कर्ष" : cfg.language === "Bilingual" ? "Summary | निष्कर्ष" : "Summary"
        : cfg.language === "Hindi" ? `${title} (जारी)` : `${title} (continued)`,
      layout: isLast ? "summary" : "bullets",
      content:
        cfg.language === "Hindi"
          ? ["मुख्य बिंदु", "उदाहरण", "निष्कर्ष"]
          : cfg.language === "Bilingual"
          ? ["Key point | मुख्य बिंदु", "Example | उदाहरण", "Conclusion | निष्कर्ष"]
          : ["Key point", "Example", "Conclusion"],
      imagePrompt: "",
      speakerNotes: "",
      narrationScript: "",
    });
  }
  return slides;
}

// Layout variety enforcement — lagatar same layout todein (AI Auto me)
function enforceVariety(slides, cfg) {
  if (cfg.layoutStyle !== "AI Auto") return slides;
  for (let i = 1; i < slides.length - 1; i++) {
    if (slides[i].layout === slides[i - 1].layout && slides[i].layout === slides[i + 1].layout) {
      if (slides[i].layout === "bullets") slides[i].layout = "threeCards";
      else if (slides[i].layout === "twoColumn") slides[i].layout = "bullets";
      else slides[i].layout = "bullets";
    }
  }
  return slides;
}

async function generatePPTContent(cfg) {
  const chunks = [];
  let made = 0;
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
      console.log(`📊 [PPT] Chunk ${ci + 1}/${chunks.length}: +${result.slides.length} → ${slides.length}`);
    } else {
      console.log(`📊 [PPT] Chunk ${ci + 1} fail — partial recovery continue`);
    }
  }

  if (!slides.length) {
    throw new Error("AI se presentation content nahi ban paya (quota/model issue) — thodi der baad try karo");
  }

  // First slide MUST be title
  if (slides[0].layout !== "title") slides[0].layout = "title";
  // Last slide ko summary/thanks banao (agar nahi hai)
  const last = slides[slides.length - 1];
  if (last.layout !== "thanks" && last.layout !== "summary") last.layout = "summary";

  const finalSlides = enforceVariety(padSlides(slides, cfg, mainTitle || cfg.topic), cfg).slice(0, cfg.slides);
  finalSlides.forEach((s, i) => (s.slideNumber = i + 1));

  return { title: mainTitle || cfg.topic, subtitle, slides: finalSlides };
}

// ---------- IMAGES (graceful) ----------
function fetchSlideImage(prompt) {
  return new Promise((resolve) => {
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        String(prompt).slice(0, 300)
      )}?width=832&height=512&nologo=true`;
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
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

// ---------- SAFE FILENAMES + TTL ----------
function makeFileName(userId, title) {
  const slug =
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "presentation";
  return `ppt-${String(userId).replace(/[^A-Za-z0-9]/g, "")}-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")}.pptx`;
}

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
    if (removed) console.log(`🧹 [PPT] ${removed} old files removed (TTL ${TTL_HOURS}h)`);
  } catch (e) {
    console.log("🧹 [PPT] cleanup fail:", e.message);
  }
}

// ============================================================
// OOXML POST-PROCESSOR — Transitions + Animations
// pptxgenjs inko natively support nahi karta, isliye real
// PowerPoint XML slideN.xml mein inject karte hain (JSZip).
// Kisi bhi failure par original (valid) file deliver hoti hai —
// PPT kabhi corrupt nahi hota.
// ============================================================

function transitionXML(mode, slideIdx) {
  if (mode === "Off") return "";
  if (mode === "Dynamic") {
    // Alternate push/fade — variety, blind-identical nahi
    return slideIdx % 2 === 0
      ? '<p:transition spd="med"><p:push dir="l"/></p:transition>'
      : '<p:transition spd="med"><p:fade/></p:transition>';
  }
  return '<p:transition spd="med"><p:fade/></p:transition>'; // Subtle
}

// Timing XML: har shape par click-triggered Fade entrance (presetID 10)
function buildTimingXML(shapeIds) {
  if (!shapeIds.length) return "";
  let id = 10;
  const pars = shapeIds
    .map((spid, i) => {
      const c1 = id++, c2 = id++, c3 = id++, c4 = id++, c5 = id++;
      const trigger = i === 0 ? "clickEffect" : "afterEffect";
      const delay = i === 0 ? 0 : 300; // staggered 300ms after previous
      return `<p:par><p:cTn id="${c1}" fill="hold"><p:stCondLst><p:cond delay="${i === 0 ? "indefinite" : delay}"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${c2}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${c3}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="${trigger}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${c4}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${c5}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
    })
    .join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${pars}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

async function postProcessPPTX(filePath, { transitions, animations }) {
  const needTransitions = transitions !== "Off";
  const needAnimations = animations !== "Off";
  if (!needTransitions && !needAnimations) return;

  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)[1], 10);
      const nb = parseInt(b.match(/(\d+)/)[1], 10);
      return na - nb;
    });

  let slideIdx = 0;
  for (const name of slideFiles) {
    let xml = await zip.file(name).async("string");
    // Pehle se timing/transition ho to skip (idempotent)
    if (!xml.includes("<p:transition") && needTransitions) {
      xml = xml.replace("</p:sld>", `${transitionXML(transitions, slideIdx)}</p:sld>`);
    }
    if (!xml.includes("<p:timing") && needAnimations) {
      // Shape IDs parse karo — animation targets (max 6, professional limit)
      const ids = [];
      const re = /<p:cNvPr id="(\d+)" name="[^"]*"/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const id = parseInt(m[1], 10);
        if (id > 1) ids.push(id); // id 1 = slide root — skip
        if (ids.length >= 6) break;
      }
      if (ids.length) {
        xml = xml.replace("</p:sld>", `${buildTimingXML(ids)}</p:sld>`);
      }
    }
    zip.file(name, xml);
    slideIdx++;
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(filePath, buf);
}

// ---------- QUALITY CONTROL ----------
async function validateOutput(filePath, content, cfg) {
  const issues = [];
  if (!fs.existsSync(filePath)) issues.push("file-missing");
  const st = fs.statSync(filePath);
  if (st.size < 10 * 1024) issues.push("file-too-small");

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    if (slideFiles.length < content.slides.length) issues.push("slide-count-mismatch");
    // Har slide ka title/content non-empty check (content-level)
    const emptySlides = content.slides.filter(
      (s) => !s.title || !s.content || !s.content.length
    ).length;
    if (emptySlides) issues.push(`${emptySlides}-empty-slides`);
  } catch (e) {
    issues.push("zip-invalid: " + e.message.slice(0, 80));
  }

  if (issues.length) {
    console.warn(`📊 [PPT] QC warnings: ${issues.join(", ")}`);
  }
  return issues;
}

// ============================================================
// PPTX CREATION — real layouts, native charts/diagrams
// ============================================================
function buildPPTX(content, cfg) {
  const theme = getTheme(cfg.theme);
  const isHindiText = cfg.language !== "English";
  const HFONT = isHindiText ? DEVANAGARI_FONT : theme.fontPair.heading;
  const BFONT = isHindiText ? DEVANAGARI_FONT : theme.fontPair.body;
  const M = GRID;

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.author = "AI PPT Generator";
  pres.title = content.title;

  const imageQueue = []; // { slide, prompt, place } — async images baad me

  function newSlide() {
    const s = pres.addSlide();
    s.background = { color: theme.bg };
    return s;
  }

  function headerBar(slide, title) {
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: M.headerH, fill: { color: theme.headerBg } });
    slide.addText(title, {
      x: M.marginX, y: 0.04, w: "95%", h: M.headerH - 0.08,
      fontSize: theme.headingSize * 0.8, bold: true, color: theme.headerText,
      fontFace: HFONT, valign: "middle",
    });
  }

  function footer(slide, no) {
    slide.addShape("rect", { x: 0, y: M.footerY, w: "100%", h: 0.05, fill: { color: theme.accent } });
    if (no) slide.addText(String(no), {
      x: "93%", y: M.footerY - 0.32, w: 0.5, h: 0.3,
      fontSize: 10, color: theme.accent, fontFace: BFONT, align: "right",
    });
  }

  function bulletOpts(items) {
    return items.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true } }));
  }

  function addBullets(slide, items, o = {}) {
    // Auto font-size: zyada/lambe bullets → chhota font (overflow prevention)
    const maxLen = Math.max(...items.map((t) => t.length), 0);
    let size = o.fontSize || theme.bodySize;
    if (items.length > 5 || maxLen > 110) size = Math.max(size - 3, 12);
    if (maxLen > 140) size = Math.max(size - 2, 11);
    slide.addText(bulletOpts(items), {
      x: o.x ?? M.marginX + 0.15, y: o.y ?? M.contentTop + 0.15,
      w: o.w ?? "88%", h: o.h ?? M.contentH,
      fontSize: size, color: theme.bodyColor, fontFace: BFONT,
      valign: "top", lineSpacingMultiple: 1.25,
    });
  }

  function addCard(slide, x, y, w, h, text, opts = {}) {
    slide.addShape("roundRect", {
      x, y, w, h, fill: { color: opts.fill || theme.panel },
      line: { color: opts.border || theme.panelBorder, width: 1 }, rectRadius: 0.06,
    });
    slide.addText(text, {
      x: x + 0.1, y: y + 0.08, w: w - 0.2, h: h - 0.16,
      fontSize: opts.fontSize || 14, bold: !!opts.bold,
      color: opts.color || theme.titleColor, fontFace: BFONT,
      align: opts.align || "left", valign: opts.valign || "middle",
    });
  }

  function addNotes(slide, s) {
    let notes = cfg.speakerNotes && s.speakerNotes ? s.speakerNotes : "";
    if (cfg.narration && s.narrationScript) {
      notes = `${notes ? notes + "\n\n" : ""}🔊 NARRATION: ${s.narrationScript}`;
    }
    if (notes) slide.addNotes(notes);
  }

  function queueImage(slide, s, place) {
    if (cfg.addImages && s.imagePrompt) imageQueue.push({ slide, prompt: s.imagePrompt, place });
  }

  // ---------------- LAYOUT RENDERERS ----------------

  function rTitle(slide, s) {
    slide.addShape("rect", { x: 0, y: "36%", w: "100%", h: 0.07, fill: { color: theme.accent } });
    slide.addText(content.title, {
      x: M.marginX, y: "13%", w: "88%", h: 1.5,
      fontSize: 38, bold: true, color: theme.titleColor, fontFace: HFONT,
    });
    if (content.subtitle) slide.addText(content.subtitle, {
      x: M.marginX, y: "43%", w: "88%", h: 0.7,
      fontSize: 19, color: theme.accent, fontFace: BFONT,
    });
    slide.addText(`${cfg.type} Presentation`, {
      x: M.marginX, y: "80%", w: "55%", h: 0.4,
      fontSize: 13, color: theme.bodyColor, fontFace: BFONT,
    });
    queueImage(slide, s, "right-decor");
    addNotes(slide, s);
  }

  function rBullets(slide, s) {
    headerBar(slide, s.title);
    addBullets(slide, s.content);
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rTwoColumn(slide, s) {
    headerBar(slide, s.title);
    const half = Math.ceil(s.content.length / 2);
    addBullets(slide, s.content.slice(0, half), { x: M.marginX, w: "44%" });
    addBullets(slide, s.content.slice(half), { x: 5.1, w: "44%" });
    slide.addShape("line", { x: "49.5%", y: M.contentTop, w: 0, h: M.contentH, line: { color: theme.accent2, width: 1 } });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rThreeCards(slide, s) {
    headerBar(slide, s.title);
    const items = s.content.slice(0, 3);
    const w = 2.9, gap = 0.25, x0 = M.marginX + 0.05;
    items.forEach((t, i) => addCard(slide, x0 + i * (w + gap), 1.6, w, 3.1, t, { fontSize: 15, align: "left", valign: "top" }));
    if (s.content.length > 3) {
      slide.addText(bulletOpts(s.content.slice(3)), {
        x: M.marginX, y: 4.85, w: "90%", h: 0.6, fontSize: 12,
        color: theme.bodyColor, fontFace: BFONT, valign: "top",
      });
    }
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rComparison(slide, s) {
    headerBar(slide, s.title);
    const half = Math.ceil(s.content.length / 2);
    const left = s.content.slice(0, half), right = s.content.slice(half);
    slide.addShape("roundRect", { x: 0.4, y: 1.3, w: 4.4, h: 3.9, fill: { color: theme.panel }, line: { color: theme.accent, width: 1 }, rectRadius: 0.06 });
    slide.addShape("roundRect", { x: 5.2, y: 1.3, w: 4.4, h: 3.9, fill: { color: theme.bg }, line: { color: theme.accent2, width: 1 }, rectRadius: 0.06 });
    addBullets(slide, left, { x: 0.6, y: 1.5, w: 4.0, h: 3.5, fontSize: 14 });
    addBullets(slide, right, { x: 5.4, y: 1.5, w: 4.0, h: 3.5, fontSize: 14 });
    slide.addText("A", { x: 0.55, y: 5.25, w: 0.4, h: 0.3, fontSize: 14, bold: true, color: theme.accent, fontFace: HFONT });
    slide.addText("B", { x: 5.35, y: 5.25, w: 0.4, h: 0.3, fontSize: 14, bold: true, color: theme.accent2, fontFace: HFONT });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rTimeline(slide, s) {
    headerBar(slide, s.title);
    const items = s.content.slice(0, 5);
    const y = 3.1;
    slide.addShape("line", { x: 0.7, y, w: 8.6, h: 0, line: { color: theme.accent, width: 2 } });
    items.forEach((t, i) => {
      const x = 0.9 + i * (8.2 / Math.max(items.length - 1, 1));
      slide.addShape("ellipse", { x: x - 0.12, y: y - 0.12, w: 0.24, h: 0.24, fill: { color: i % 2 ? theme.accent2 : theme.accent } });
      const above = i % 2 === 0;
      slide.addText(t, {
        x: Math.min(x - 0.85, 8.2), y: above ? y - 1.55 : y + 0.25, w: 1.7, h: 1.3,
        fontSize: 11.5, color: theme.bodyColor, fontFace: BFONT,
        align: "center", valign: above ? "bottom" : "top",
      });
    });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rProcess(slide, s) {
    headerBar(slide, s.title);
    const items = s.content.slice(0, 4);
    const w = 2.05, gap = 0.35, y = 2.2, h = 1.9;
    items.forEach((t, i) => {
      const x = 0.45 + i * (w + gap);
      slide.addShape("chevron", { x, y, w, h, fill: { color: i % 2 ? theme.accent2 : theme.accent } });
      slide.addText(`Step ${i + 1}`, { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: 0.35, fontSize: 12, bold: true, color: "FFFFFF", fontFace: HFONT });
      slide.addText(t, { x: x + 0.15, y: y + 0.5, w: w - 0.35, h: h - 0.65, fontSize: 11, color: "FFFFFF", fontFace: BFONT, valign: "top" });
    });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rStats(slide, s) {
    headerBar(slide, s.title);
    const data = extractChartData(s);

    // CHART — real native pptxgenjs chart (editable in PowerPoint)
    if (data && cfg.charts === "Auto") {
      const chartType = data.length >= 4 ? "bar" : "doughnut";
      pres.addChart(
        chartType,
        [{ name: s.title, labels: data.map((d) => d.label), values: data.map((d) => d.value) }],
        {
          x: 0.5, y: 1.2, w: 5.4, h: 4.0,
          chartColors: [theme.accent, theme.accent2, "10B981", "F59E0B", "EF4444", "6366F1"],
          showLegend: chartType === "doughnut", legendPos: "b",
          dataLabelColor: theme.dark ? "FFFFFF" : "111827",
          showValue: true,
        }
      );
      // Side KPI blocks
      data.slice(0, 3).forEach((d, i) => {
        addCard(slide, 6.2, 1.4 + i * 1.25, 3.3, 1.05, `${d.label}: ${d.value}`, { fontSize: 13, bold: true, color: theme.accent, align: "center" });
      });
    } else {
      // KPI blocks (no numeric data — NO fake chart)
      const items = s.content.slice(0, 4);
      items.forEach((t, i) => {
        addCard(slide, 0.5 + i * 2.35, 1.9, 2.2, 2.5, t, { fontSize: 14, bold: true, color: theme.accent, align: "center" });
      });
    }
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rQuote(slide, s) {
    headerBar(slide, s.title);
    const quote = s.content[0] || "";
    const attribution = s.content[1] || "";
    slide.addText("“", { x: 0.4, y: 0.9, w: 1.2, h: 1.4, fontSize: 90, bold: true, color: theme.accent, fontFace: HFONT });
    slide.addText(quote, {
      x: 1.3, y: 1.7, w: 7.4, h: 2.2,
      fontSize: 22, italic: true, color: theme.titleColor, fontFace: HFONT, valign: "middle", align: "center",
    });
    if (attribution) slide.addText(`— ${attribution}`, {
      x: 1.3, y: 4.1, w: 7.4, h: 0.5,
      fontSize: 14, color: theme.accent, fontFace: BFONT, align: "center",
    });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rImageText(slide, s) {
    headerBar(slide, s.title);
    // Image placeholder rect — actual image async baad me overlay hogi
    slide.addShape("roundRect", { x: 0.4, y: 1.3, w: 4.3, h: 3.6, fill: { color: theme.panel }, line: { color: theme.panelBorder, width: 1 }, rectRadius: 0.05 });
    slide.addText("🖼️", { x: 2.0, y: 2.6, w: 1.0, h: 1.0, fontSize: 40, align: "center" });
    queueImage(slide, s, { x: 0.4, y: 1.3, w: 4.3, h: 3.6 });
    addBullets(slide, s.content, { x: 5.0, w: "45%", fontSize: 14 });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rFullImage(slide, s) {
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: "100%", fill: { color: theme.panel } });
    queueImage(slide, s, { x: 0, y: 0, w: "100%", h: "100%", full: true });
    // Title band bottom — image ke upar readable
    slide.addShape("rect", { x: 0, y: "78%", w: "100%", h: "22%", fill: { color: theme.dark ? "000000" : theme.headerBg, transparency: 25 } });
    slide.addText(s.title, {
      x: M.marginX, y: "79%", w: "94%", h: "20%",
      fontSize: 24, bold: true, color: theme.headerText, fontFace: HFONT, valign: "middle",
    });
    addNotes(slide, s);
  }

  function rFlow(slide, s) {
    headerBar(slide, s.title);
    const items = s.content.slice(0, 4);
    const boxW = 1.9, boxH = 1.5;
    items.forEach((t, i) => {
      const row = Math.floor(i / 2), col = i % 2;
      const x = 0.7 + col * 4.5, y = 1.5 + row * 1.9;
      addCard(slide, x, y, boxW, boxH, t, { fontSize: 12.5, align: "center" });
      if (col === 0) slide.addShape("rightArrow", { x: x + boxW + 0.1, y: y + boxH / 2 - 0.18, w: 0.55, h: 0.36, fill: { color: theme.accent2 } });
      else if (i < items.length - 1) slide.addShape("downArrow", { x: x + boxW / 2 - 0.18, y: y + boxH + 0.08, w: 0.36, h: 0.5, fill: { color: theme.accent2 } });
    });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rSummary(slide, s) {
    headerBar(slide, s.title);
    addBullets(slide, s.content, { fontSize: 15 });
    slide.addShape("rect", { x: 0, y: M.contentTop - 0.1, w: 0.12, h: M.contentH, fill: { color: theme.accent } });
    footer(slide, s.slideNumber);
    addNotes(slide, s);
  }

  function rThanks(slide, s) {
    slide.addText(
      cfg.language === "Hindi" ? "धन्यवाद!" : cfg.language === "Bilingual" ? "Thank You | धन्यवाद!" : "Thank You!",
      { x: "10%", y: "30%", w: "80%", h: 1.5, fontSize: 44, bold: true, color: theme.titleColor, fontFace: HFONT, align: "center" }
    );
    slide.addShape("rect", { x: "40%", y: "58%", w: "20%", h: 0.07, fill: { color: theme.accent } });
    if (s.content.length) slide.addText(s.content[0], {
      x: "15%", y: "66%", w: "70%", h: 0.6, fontSize: 14, color: theme.bodyColor, fontFace: BFONT, align: "center",
    });
    addNotes(slide, s);
  }

  const RENDERERS = {
    title: rTitle, bullets: rBullets, twoColumn: rTwoColumn, threeCards: rThreeCards,
    comparison: rComparison, timeline: rTimeline, process: rProcess, stats: rStats,
    quote: rQuote, imageText: rImageText, fullImage: rFullImage, flow: rFlow,
    summary: rSummary, thanks: rThanks,
  };

  content.slides.forEach((s) => {
    const slide = newSlide();
    (RENDERERS[s.layout] || rBullets)(slide, s);
  });

  // ---- ASYNC IMAGES (sab slides banne ke baad; fail → placeholder rahe,
  //      PPT kabhi fail nahi hota) ----
  return (async () => {
    await Promise.allSettled(
      imageQueue.map(({ slide, prompt, place }) =>
        fetchSlideImage(prompt).then((buf) => {
          if (!buf) return;
          if (place.full) {
            slide.addImage({ data: `image/jpeg;base64,${buf.toString("base64")}`, x: 0, y: 0, w: "100%", h: "100%", sizing: { type: "cover", w: "100%", h: "100%" } });
          } else {
            slide.addImage({ data: `image/jpeg;base64,${buf.toString("base64")}`, x: place.x, y: place.y, w: place.w, h: place.h, sizing: { type: "contain", w: place.w, h: place.h } });
          }
        })
      )
    );
    return pres;
  })();
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

  const pres = await buildPPTX(content, clean);
  await pres.writeFile({ fileName: filePath });

  // OOXML post-process — transitions + animations (fail → original file)
  try {
    await postProcessPPTX(filePath, clean);
  } catch (e) {
    console.warn(`📊 [PPT] post-process fail (file delivered without effects): ${e.message}`);
  }

  // QUALITY CONTROL
  const qcIssues = await validateOutput(filePath, content, clean);
  if (qcIssues.includes("file-missing") || qcIssues.includes("zip-invalid")) {
    throw new Error("PPT file valid nahi bani — thodi der baad try karo");
  }

  const st = fs.statSync(filePath);
  console.log(`📊 [PPT] Generated: ${fileName} (${(st.size / 1024).toFixed(0)} KB, ${content.slides.length} slides, transitions=${clean.transitions}, animations=${clean.animations}, narration=${clean.narration})`);

  // Preview data — real slide content (frontend rendered preview)
  const preview = {
    title: content.title,
    subtitle: content.subtitle,
    slides: content.slides.map((s) => ({
      slideNumber: s.slideNumber,
      title: s.title,
      layout: s.layout,
      content: s.content,
      imagePrompt: clean.addImages ? s.imagePrompt : "",
      hasChart: !!(clean.charts === "Auto" && extractChartData(s)),
      narrationScript: clean.narration ? s.narrationScript : "",
    })),
  };

  return { fileName, filePath, slideCount: content.slides.length, content, preview, cfg: clean };
}

module.exports = {
  generatePPT,
  validatePPTOptions,
  isSafeFileName,
  cleanOldPPTFiles,
  extractChartData,
  PPT_DIR,
  MIN_SLIDES,
  MAX_SLIDES,
  LANGUAGES,
  TYPES,
  THEME_NAMES: Object.keys(THEMES),
  LAYOUT_STYLES,
  TRANSITION_MODES,
  ANIMATION_MODES,
  CHART_MODES,
  NARRATION_MODES,
};