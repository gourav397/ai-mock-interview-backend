// ============================================================
// services/pptGenerator.js
// TRUE PREMIUM / PROFESSIONAL AI PRESENTATION DESIGN ENGINE
// Backward-compatible with the existing PPT API.
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

const PPT_DIR = path.join(__dirname, "..", "uploads", "ppt");
const TTL_HOURS = positiveInt(process.env.PPT_FILE_TTL_HOURS, 72);
const MIN_SLIDES = 5;
const MAX_SLIDES = 20;
const MAX_TOPIC_LEN = 300;
const CHUNK_SIZE = 7;
const CONTENT_MAX_BULLETS = 6;
const BULLET_MAX_LEN = 160;
const IMAGE_TIMEOUT_MS = 10000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const DEVANAGARI_FONT = "Nirmala UI";

const LANGUAGES = ["English", "Hindi", "Bilingual"];
const TYPES = ["Student", "Professional", "Educational", "Interview", "General"];
const THEME_NAMES = Object.keys(THEMES);
const LAYOUT_STYLES = ["AI Auto", "Professional", "Visual", "Academic"];
const TRANSITION_MODES = ["Off", "Subtle", "Dynamic"];
const ANIMATION_MODES = ["Off", "Subtle", "Professional"];
const CHART_MODES = ["Auto", "Off"];
const NARRATION_MODES = ["Off", "On"];

const KNOWN_LAYOUTS = [
  "title", "section", "bullets", "twoColumn", "threeCards", "fourCards",
  "fiveCards", "comparison", "timeline", "process", "stats", "quote",
  "imageText", "textImage", "fullImage", "flow", "grid", "problemSolution",
  "beforeAfter", "prosCons", "diagram", "summary", "thanks",
];

const PRESENTATION_W = GRID.width;
const PRESENTATION_H = GRID.height;

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ============================================================
// JSON / TEXT
// ============================================================

function repairTruncatedJson(text) {
  try {
    let inString = false;
    let escaped = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") {
        if (stack[stack.length - 1] !== c) return null;
        stack.pop();
      }
    }
    let output = text;
    if (inString) output += '"';
    output = output.replace(/,\s*$/, "");
    while (stack.length) output += stack.pop();
    return output;
  } catch {
    return null;
  }
}

function parseAIJson(text) {
  if (!text) return null;
  try {
    const value = extractJSON(text);
    if (value && typeof value === "object") return value;
  } catch {}
  const raw = String(text);
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const value = raw.slice(start);
  try { return JSON.parse(value); } catch {}
  const repaired = repairTruncatedJson(value);
  try { return repaired ? JSON.parse(repaired) : null; } catch { return null; }
}

function cleanText(value, max = BULLET_MAX_LEN) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function shorten(text, max) {
  const value = cleanText(text, max);
  if (String(text || "").length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function pick(value, allowed, fallback) {
  const v = String(value || "");
  return allowed.includes(v) ? v : fallback;
}

function parseBool(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on" || value === "On";
}

function validatePPTOptions(opts = {}) {
  const errors = [];
  const topic = cleanText(opts.topic, MAX_TOPIC_LEN);
  if (!topic) errors.push("Topic required hai");
  if (topic.length > MAX_TOPIC_LEN) errors.push(`Topic max ${MAX_TOPIC_LEN} characters`);

  const requestedSlides = opts.slides ?? opts.slideCount;
  const slides = parseInt(requestedSlides, 10);
  if (!Number.isFinite(slides) || slides < MIN_SLIDES || slides > MAX_SLIDES) {
    errors.push(`Slides ${MIN_SLIDES}-${MAX_SLIDES} ke beech hone chahiye`);
  }

  const language = String(opts.language || "English");
  const type = String(opts.type || "General");
  const theme = String(opts.theme || THEME_NAMES[0] || "Modern");
  if (!LANGUAGES.includes(language)) errors.push("Invalid language");
  if (!TYPES.includes(type)) errors.push("Invalid presentation type");
  if (!THEMES[theme]) errors.push("Invalid theme");

  return {
    errors,
    clean: {
      topic,
      slides: Number.isFinite(slides) ? Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, slides)) : 10,
      language,
      type,
      theme,
      addImages: parseBool(opts.addImages),
      speakerNotes: opts.speakerNotes !== false,
      layoutStyle: pick(opts.layoutStyle, LAYOUT_STYLES, "AI Auto"),
      transitions: pick(opts.transitions, TRANSITION_MODES, "Subtle"),
      animations: pick(opts.animations, ANIMATION_MODES, "Off"),
      charts: pick(opts.charts, CHART_MODES, "Auto"),
      narration: parseBool(opts.narration),
    },
  };
}

// ============================================================
// CONTENT-AWARE DESIGN PLAN
// ============================================================

function layoutBiasHint(style) {
  if (style === "Professional") return "Use executive, corporate layouts: stats, comparison, twoColumn, fourCards, process, summary. Use imagery sparingly.";
  if (style === "Visual") return "Strongly prefer imageText, textImage, fullImage, timeline, process, flow, grid, stats and section slides. Minimize bullet-only slides.";
  if (style === "Academic") return "Prefer twoColumn, timeline, diagram, quote, comparison, summary and evidence-focused layouts.";
  return "Use the best layout for the content. Never repeat a layout on consecutive slides unless structurally necessary.";
}

function languageRule(language) {
  if (language === "Hindi") return "ALL visible presentation text must be proper Hindi in Devanagari. Never use Roman Hindi.";
  if (language === "Bilingual") return 'Visible titles and bullets should use the format "English | Hindi". Keep each side concise.';
  return "ALL visible presentation text must be in English.";
}

function buildChunkPrompt(cfg, chunkNo, totalChunks, startNo, count, mainTitle) {
  return `
You are a world-class presentation strategist and premium presentation designer.
Create content for a professional ${cfg.type} presentation.

TOPIC: ${cfg.topic}
LANGUAGE: ${cfg.language}
${languageRule(cfg.language)}
DESIGN STYLE: ${cfg.layoutStyle}
${layoutBiasHint(cfg.layoutStyle)}

This is content chunk ${chunkNo}/${totalChunks}, for slides ${startNo}-${startNo + count - 1}.
Main title: ${mainTitle || cfg.topic}

STORYTELLING:
Build a coherent narrative. Think like a premium consultant deck:
cover -> context/problem -> key concepts -> evidence/examples -> visual explanation -> insights -> conclusion.
Do not make slides feel like disconnected notes.

AVAILABLE LAYOUTS:
${KNOWN_LAYOUTS.join(", ")}

LAYOUT SELECTION RULES:
- title = premium cover only.
- section = major section/divider, minimal text.
- bullets = only when bullets are genuinely the best representation.
- twoColumn = two related groups or contrasting ideas.
- threeCards/fourCards/fiveCards = distinct categories/features; keep each item concise.
- comparison = explicit A vs B / alternative comparison.
- timeline = dates, eras or chronological progression.
- process = sequential steps.
- flow = logical workflow / system flow.
- stats = meaningful numeric/KPI data. Include chartData with 3-6 objects.
- quote = memorable quote + attribution.
- imageText/textImage = meaningful image plus concise content.
- fullImage = highly visual statement slide; still include readable title/overlay content.
- grid = 4-6 categorized items.
- problemSolution = problem on one side, solution on the other.
- beforeAfter = before/current vs after/future.
- prosCons = advantages vs limitations.
- diagram = hierarchy, relationship or system explanation.
- summary = key takeaways/conclusion.
- thanks = final slide only.

CONTENT QUALITY:
- 3-6 concise content strings per normal slide.
- Prefer short phrases over paragraphs.
- Each content string should normally be under 110 characters.
- Never invent fake statistics. Use stats only when the topic supports real/clearly framed illustrative numbers; mark illustrative data in the text when appropriate.
- Never repeat the same idea across slides.
- For imagePrompt, write an English visual description, no text inside the image.
- For quote, content[0] is quote and content[1] is attribution.
- For problemSolution/beforeAfter/prosCons, split content clearly using labels such as "Problem: ..." / "Solution: ...".
- speakerNotes: 1-2 sentences.
- narrationScript: natural 2-3 sentence spoken script.

IMPORTANT:
1. Slide ${startNo} is title ONLY if startNo is 1.
2. The final requested slide should be thanks or summary depending on chunk position; the server will enforce the final bookend.
3. Do not return markdown.
4. Return ONLY valid JSON.

JSON:
{
  "title": "...",
  "subtitle": "...",
  "slides": [
    {
      "slideNumber": ${startNo},
      "layout": "bullets",
      "title": "...",
      "content": ["...", "...", "..."],
      "imagePrompt": "",
      "speakerNotes": "",
      "narrationScript": "",
      "chartData": [{"label":"...","value":10}]
    }
  ]
}
`;
}

function normalizeSlide(raw, expectedNo, cfg) {
  if (!raw || typeof raw !== "object") return null;
  const title = shorten(raw.title, 120);
  if (!title) return null;

  let content = Array.isArray(raw.content) ? raw.content : [];
  content = content.map((x) => shorten(x, 150)).filter(Boolean).slice(0, CONTENT_MAX_BULLETS);
  if (!content.length) content = [title];

  let layout = String(raw.layout || "").trim();
  if (!KNOWN_LAYOUTS.includes(layout)) layout = heuristicLayout({ title, content, chartData: raw.chartData }, cfg);
  if (expectedNo === 1) layout = "title";

  return {
    slideNumber: expectedNo,
    title,
    content,
    layout,
    imagePrompt: cfg.addImages ? shorten(raw.imagePrompt || "", 240) : "",
    speakerNotes: shorten(raw.speakerNotes || "", 600),
    narrationScript: cfg.narration ? shorten(raw.narrationScript || "", 700) : "",
    chartData: normalizeChartData(raw.chartData),
  };
}

function normalizeChartData(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = shorten(item.label, 36);
    const value = Number(item.value);
    if (label && Number.isFinite(value)) out.push({ label, value });
  }
  return out.length >= 3 && out.length <= 8 ? out : null;
}

function extractChartData(slide) {
  if (slide && Array.isArray(slide.chartData) && slide.chartData.length >= 3) return slide.chartData;
  const items = [];
  for (const item of slide?.content || []) {
    const text = String(item).trim();
    const match = text.match(/^(.{1,45}?)\s*(?::|=|-|–)\s*(\d+(?:\.\d+)?)\s*%?\s*$/);
    if (match) items.push({ label: shorten(match[1], 36), value: Number(match[2]) });
  }
  return items.length >= 3 && items.length <= 8 ? items : null;
}

function heuristicLayout(slide, cfg) {
  const title = String(slide.title || "");
  const content = slide.content || [];
  const text = `${title} ${content.join(" ")}`.toLowerCase();
  if (slide.slideNumber === 1) return "title";
  if (/thank|धन्यवाद/.test(text)) return "thanks";
  if (/summary|takeaway|conclusion|निष्कर्ष|सारांश/.test(text)) return "summary";
  if (extractChartData(slide) && cfg.charts === "Auto") return "stats";
  if (/problem.*solution|challenge.*solution|समस्या.*समाधान/.test(text)) return "problemSolution";
  if (/before.*after|पहले.*बाद/.test(text)) return "beforeAfter";
  if (/pros.*cons|advantages.*disadvantages|फायदे.*नुकसान/.test(text)) return "prosCons";
  if (/\bvs\b|versus|comparison|तुलना/.test(text)) return "comparison";
  if (/timeline|history|historical|chronolog|इतिहास|क्रम/.test(text)) return "timeline";
  if (/step|process|how to|workflow|कैसे|प्रक्रिया/.test(text)) return "process";
  if (/quote|says|according to|उद्धरण/.test(text) || /^[“"']/.test(content[0] || "")) return "quote";
  if (/system|architecture|hierarchy|relationship|ecosystem|ढांचा|संबंध/.test(text)) return "diagram";
  if (/\b(3|4|5|6)\b.*(features|types|categories|ways)|categories|features|types/.test(text)) return "fourCards";
  if (cfg.addImages && content.length <= 4) return cfg.layoutStyle === "Visual" ? "imageText" : "textImage";
  if (content.length >= 5) return "twoColumn";
  return "bullets";
}

function fallbackSlide(no, total, cfg, title) {
  const isFirst = no === 1;
  const isLast = no === total;
  if (isFirst) {
    return {
      slideNumber: no, title: title || cfg.topic, content: [
        cfg.type === "General" ? "Professional presentation" : `${cfg.type} presentation`,
        cfg.language === "Hindi" ? "मुख्य विषय और महत्वपूर्ण अंतर्दृष्टियाँ" : "Key concepts, insights and practical takeaways",
      ], layout: "title", imagePrompt: "", speakerNotes: "", narrationScript: "", chartData: null,
    };
  }
  if (isLast) {
    return {
      slideNumber: no,
      title: cfg.language === "Hindi" ? "धन्यवाद" : cfg.language === "Bilingual" ? "Thank You | धन्यवाद" : "Thank You",
      content: [cfg.language === "Hindi" ? "मुख्य सीख के लिए धन्यवाद" : cfg.language === "Bilingual" ? "Key takeaways | मुख्य सीख" : "Key takeaways"],
      layout: "thanks", imagePrompt: "", speakerNotes: "", narrationScript: "", chartData: null,
    };
  }
  return {
    slideNumber: no,
    title: `${title || cfg.topic} — Key Insight ${no - 1}`,
    content: cfg.language === "Hindi"
      ? ["मुख्य अवधारणा", "व्यावहारिक महत्व", "महत्वपूर्ण उदाहरण"]
      : cfg.language === "Bilingual"
      ? ["Core concept | मुख्य अवधारणा", "Practical value | व्यावहारिक महत्व", "Key example | महत्वपूर्ण उदाहरण"]
      : ["Core concept", "Practical value", "Key example"],
    layout: no % 4 === 0 ? "threeCards" : no % 3 === 0 ? "twoColumn" : "bullets",
    imagePrompt: "", speakerNotes: "", narrationScript: "", chartData: null,
  };
}

async function callAIChunk(cfg, startNo, count, mainTitle, chunkNo, totalChunks) {
  if (keyManager && typeof keyManager.isQuotaExhausted === "function" && keyManager.isQuotaExhausted()) return null;
  try {
    const text = await geminiGenerate(buildChunkPrompt(cfg, chunkNo, totalChunks, startNo, count, mainTitle), 60000);
    const parsed = parseAIJson(text);
    if (!parsed || !Array.isArray(parsed.slides)) return null;
    const slides = parsed.slides.map((s, i) => normalizeSlide(s, startNo + i, cfg)).filter(Boolean);
    return { title: shorten(parsed.title || "", 120), subtitle: shorten(parsed.subtitle || "", 180), slides };
  } catch (error) {
    console.warn(`[PPT] AI chunk ${chunkNo}/${totalChunks} failed:`, error.message);
    return null;
  }
}

function enforceBookends(slides, cfg, total) {
  if (!slides.length) return slides;
  slides[0] = { ...slides[0], slideNumber: 1, layout: "title" };
  if (slides.length >= 2) {
    const last = slides[slides.length - 1];
    slides[slides.length - 1] = {
      ...last,
      slideNumber: slides.length,
      layout: "thanks",
      title: cfg.language === "Hindi" ? "धन्यवाद" : cfg.language === "Bilingual" ? "Thank You | धन्यवाद" : "Thank You",
      content: last.content?.length ? last.content.slice(0, 1) : [cfg.language === "Hindi" ? "मुख्य सीख" : "Key takeaways"],
    };
  }
  return slides;
}

function enforceVariety(slides, cfg) {
  const result = [...slides];
  const alternatives = ["threeCards", "twoColumn", "grid", "process", "stats", "quote", "imageText", "textImage", "diagram", "summary"];
  for (let i = 1; i < result.length - 1; i++) {
    if (result[i].layout !== result[i - 1].layout) continue;
    const candidate = alternatives[(i + result[i].title.length) % alternatives.length];
    if (candidate === "stats" && !extractChartData(result[i])) continue;
    if (["imageText", "textImage"].includes(candidate) && !cfg.addImages) continue;
    result[i] = { ...result[i], layout: candidate };
  }
  return result;
}

async function generatePPTContent(cfg) {
  const total = cfg.slides;
  const chunks = [];
  for (let start = 1; start <= total; start += CHUNK_SIZE) chunks.push({ start, count: Math.min(CHUNK_SIZE, total - start + 1) });

  const slides = [];
  let mainTitle = cfg.topic;
  let subtitle = "";

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i];
    const result = await callAIChunk(cfg, part.start, part.count, mainTitle, i + 1, chunks.length);
    if (result) {
      if (result.title) mainTitle = result.title;
      if (result.subtitle && !subtitle) subtitle = result.subtitle;
      slides.push(...result.slides);
    }
  }

  const normalized = [];
  const seen = new Set();
  for (const slide of slides) {
    const key = `${slide.title.toLowerCase()}|${slide.content[0]?.toLowerCase() || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(slide);
    if (normalized.length >= total) break;
  }

  while (normalized.length < total) normalized.push(fallbackSlide(normalized.length + 1, total, cfg, mainTitle));
  normalized.length = total;
  normalized.forEach((s, i) => { s.slideNumber = i + 1; });

  // Guarantee valid content and layouts.
  for (let i = 0; i < normalized.length; i++) {
    if (!normalized[i].title) normalized[i].title = `${mainTitle} — ${i + 1}`;
    if (!Array.isArray(normalized[i].content) || !normalized[i].content.length) normalized[i].content = [normalized[i].title];
    normalized[i].layout = KNOWN_LAYOUTS.includes(normalized[i].layout) ? normalized[i].layout : heuristicLayout(normalized[i], cfg);
  }

  const varied = enforceVariety(normalized, cfg);
  enforceBookends(varied, cfg, total);
  varied.forEach((s, i) => { s.slideNumber = i + 1; });

  return { title: mainTitle || cfg.topic, subtitle, slides: varied };
}

// ============================================================
// IMAGE PIPELINE
// ============================================================

function fetchSlideImage(prompt) {
  return new Promise((resolve) => {
    if (!prompt) return resolve(null);
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    const timer = setTimeout(() => finish(null), IMAGE_TIMEOUT_MS);
    try {
      const safePrompt = encodeURIComponent(`${String(prompt).slice(0, 260)}, premium presentation photography, no text, no watermark`);
      const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=1280&height=720&nologo=true`;
      const request = https.get(url, { timeout: IMAGE_TIMEOUT_MS, headers: { "User-Agent": "AI-PPT-Generator/2.0" } }, (response) => {
        if (response.statusCode !== 200) { response.resume(); clearTimeout(timer); return finish(null); }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > IMAGE_MAX_BYTES) { response.destroy(); clearTimeout(timer); finish(null); return; }
          chunks.push(chunk);
        });
        response.on("end", () => { clearTimeout(timer); const buffer = Buffer.concat(chunks); finish(buffer.length > 1500 ? buffer : null); });
        response.on("error", () => { clearTimeout(timer); finish(null); });
      });
      request.on("timeout", () => { request.destroy(); clearTimeout(timer); finish(null); });
      request.on("error", () => { clearTimeout(timer); finish(null); });
    } catch { clearTimeout(timer); finish(null); }
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); } catch { results[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function prepareImages(content, cfg) {
  const imageSlides = content.slides.map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => cfg.addImages && ["imageText", "textImage", "fullImage"].includes(slide.layout) && slide.imagePrompt);
  const buffers = await mapWithConcurrency(imageSlides, 3, async ({ slide, index }) => {
    const buffer = await fetchSlideImage(slide.imagePrompt);
    if (!buffer) console.warn(`[PPT] image fallback on slide ${slide.slideNumber}`);
    return { index, buffer };
  });
  const map = new Map();
  for (const item of buffers) if (item) map.set(item.index, item.buffer);
  return map;
}

// ============================================================
// PPTX DESIGN SYSTEM
// ============================================================

function fontConfig(cfg, theme) {
  const devanagari = cfg.language !== "English";
  return {
    heading: devanagari ? DEVANAGARI_FONT : (theme.fontPair?.heading || "Aptos Display"),
    body: devanagari ? DEVANAGARI_FONT : (theme.fontPair?.body || "Aptos"),
  };
}

function shape(slide, type, opts) {
  try { slide.addShape(type, opts); } catch (error) { console.warn("[PPT] shape failed:", error.message); }
}

function text(slide, value, opts, fonts) {
  if (value == null || String(value).trim() === "") return;
  const base = { fontFace: fonts?.body || "Aptos", color: "334155", margin: 0, breakLine: false, fit: "shrink" };
  try { slide.addText(String(value), Object.assign(base, opts || {})); } catch (error) { console.warn("[PPT] text failed:", error.message); }
}

function addSoftShadow(slide, x, y, w, h, theme, radius = 0.16) {
  shape(slide, "roundRect", { x: x + 0.035, y: y + 0.05, w, h, rectRadius: radius, fill: { color: theme.dark ? "05070C" : "D9E2EC", transparency: 68 }, line: { color: theme.dark ? "05070C" : "D9E2EC", transparency: 100 } });
}

function addCard(slide, x, y, w, h, theme, opts = {}) {
  addSoftShadow(slide, x, y, w, h, theme);
  shape(slide, "roundRect", {
    x, y, w, h,
    rectRadius: 0.16,
    fill: { color: opts.fill || theme.panel, transparency: opts.transparency || 0 },
    line: { color: opts.line || theme.panelBorder, width: opts.lineWidth || 0.7, transparency: opts.lineTransparency ?? 20 },
  });
}

function addBackground(slide, theme, index, total) {
  slide.background = { color: theme.bg };
  // Subtle brand geometry; intentionally restrained.
  shape(slide, "ellipse", { x: 11.35, y: -0.65, w: 2.45, h: 2.45, fill: { color: theme.primary, transparency: theme.dark ? 80 : 92 }, line: { color: theme.primary, transparency: 100 } });
  shape(slide, "ellipse", { x: -0.75, y: 6.45, w: 1.9, h: 1.9, fill: { color: theme.secondary, transparency: theme.dark ? 88 : 94 }, line: { color: theme.secondary, transparency: 100 } });
  if (index > 0 && index < total - 1) {
    shape(slide, "rect", { x: 0, y: 0, w: 0.07, h: 7.5, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
  }
}

function addTitle(slide, title, theme, fonts, opts = {}) {
  const size = opts.size || theme.headingSize || 28;
  text(slide, title, { x: opts.x ?? GRID.marginX, y: opts.y ?? 0.5, w: opts.w ?? 11.9, h: opts.h ?? 0.72, fontSize: size, bold: true, color: opts.color || theme.titleColor, fontFace: fonts.heading, valign: "mid", fit: "shrink" }, fonts);
  if (opts.kicker) text(slide, opts.kicker.toUpperCase(), { x: opts.x ?? GRID.marginX, y: (opts.y ?? 0.5) - 0.25, w: opts.w ?? 11.9, h: 0.2, fontSize: 9, bold: true, charSpacing: 1.4, color: theme.accent, fontFace: fonts.body }, fonts);
}

function addAccentLine(slide, theme, x = GRID.marginX, y = 1.28, w = 1.1) {
  shape(slide, "roundRect", { x, y, w, h: 0.055, rectRadius: 0.03, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
}

function addFooter(slide, theme, number, total, fonts) {
  shape(slide, "line", { x: 0.62, y: 6.92, w: 12.05, h: 0, line: { color: theme.panelBorder, width: 0.5, transparency: 25 } });
  text(slide, "AI Interview", { x: 0.62, y: 7.02, w: 2, h: 0.22, fontSize: 8.5, bold: true, color: theme.mutedColor, fontFace: fonts.body }, fonts);
  text(slide, `${number} / ${total}`, { x: 11.6, y: 7.02, w: 1.05, h: 0.22, fontSize: 8.5, bold: true, align: "right", color: theme.mutedColor, fontFace: fonts.body }, fonts);
}

function addBullets(slide, items, theme, fonts, box, opts = {}) {
  const list = items.filter(Boolean).slice(0, opts.max || CONTENT_MAX_BULLETS);
  const size = opts.fontSize || 16;
  const bulletColor = opts.bulletColor || theme.accent;
  const rows = list.map((item) => ({ text: shorten(item, 125), options: { bullet: { code: "2022" }, breakLine: true, color: theme.textColor, bulletColor } }));
  try {
    slide.addText(rows, {
      x: box.x, y: box.y, w: box.w, h: box.h, fontFace: fonts.body, fontSize: size,
      color: theme.textColor, valign: "top", paraSpaceAfterPt: opts.paraSpaceAfterPt || 12,
      breakLine: false, fit: "shrink", margin: 0.02, bullet: { type: "ul" },
      lineSpacingMultiple: 1.08,
    });
  } catch (error) {
    console.warn("[PPT] bullets failed:", error.message);
    text(slide, list.join("\n"), { x: box.x, y: box.y, w: box.w, h: box.h, fontFace: fonts.body, fontSize: size, color: theme.textColor, fit: "shrink", valign: "top" }, fonts);
  }
}

function addPill(slide, label, x, y, theme, fonts, opts = {}) {
  const width = Math.max(0.8, Math.min(2.4, String(label).length * 0.075 + 0.45));
  shape(slide, "roundRect", { x, y, w: width, h: 0.34, rectRadius: 0.17, fill: { color: opts.color || theme.primary, transparency: opts.transparency || 8 }, line: { color: opts.color || theme.primary, transparency: 100 } });
  text(slide, label, { x: x + 0.08, y: y + 0.04, w: width - 0.16, h: 0.24, fontSize: 8.5, bold: true, align: "center", color: opts.textColor || "FFFFFF", fontFace: fonts.body, fit: "shrink" }, fonts);
  return width;
}

function addNumberBadge(slide, number, x, y, theme, fonts, size = 0.48) {
  shape(slide, "ellipse", { x, y, w: size, h: size, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  text(slide, String(number), { x, y: y + 0.05, w: size, h: size - 0.05, fontSize: 13, bold: true, align: "center", color: "FFFFFF", fontFace: fonts.body }, fonts);
}

function addImage(slide, buffer, box) {
  if (!buffer) return false;
  try {
    slide.addImage({ data: `data:image/jpeg;base64,${buffer.toString("base64")}`, x: box.x, y: box.y, w: box.w, h: box.h, sizing: { type: "cover", x: box.x, y: box.y, w: box.w, h: box.h } });
    return true;
  } catch (error) {
    console.warn("[PPT] image add failed:", error.message);
    return false;
  }
}

function addImageFrame(slide, buffer, box, theme, opts = {}) {
  addSoftShadow(slide, box.x, box.y, box.w, box.h, theme);
  shape(slide, "roundRect", { x: box.x, y: box.y, w: box.w, h: box.h, rectRadius: 0.16, fill: { color: theme.panel }, line: { color: theme.panelBorder, transparency: 35, width: 0.7 } });
  if (buffer && addImage(slide, buffer, box)) {
    if (opts.overlay) shape(slide, "rect", { x: box.x, y: box.y, w: box.w, h: box.h, fill: { color: opts.overlay, transparency: opts.transparency || 40 }, line: { color: opts.overlay, transparency: 100 } });
    return true;
  }
  return false;
}

function safeLayoutForImageFailure(data) {
  if (data.layout === "fullImage") return "summary";
  if (data.layout === "imageText" || data.layout === "textImage") return data.content.length >= 4 ? "threeCards" : "twoColumn";
  return "bullets";
}

// ============================================================
// RENDERERS
// ============================================================

function renderTitle(slide, data, theme, fonts, cfg) {
  // Premium cover: asymmetric composition + accent geometry.
  shape(slide, "rect", { x: 0, y: 0, w: 8.15, h: 7.5, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
  shape(slide, "rect", { x: 7.72, y: 0, w: 0.43, h: 7.5, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  shape(slide, "ellipse", { x: 9.0, y: -0.4, w: 4.7, h: 4.7, fill: { color: theme.secondary, transparency: 28 }, line: { color: theme.secondary, transparency: 100 } });
  shape(slide, "ellipse", { x: 10.2, y: 3.9, w: 3.3, h: 3.3, fill: { color: theme.accent, transparency: 58 }, line: { color: theme.accent, transparency: 100 } });
  addPill(slide, cfg.type, 0.72, 0.72, theme, fonts, { color: theme.accent });
  text(slide, data.title, { x: 0.72, y: 1.55, w: 6.35, h: 2.25, fontSize: 34, bold: true, color: "FFFFFF", fontFace: fonts.heading, valign: "mid", fit: "shrink", breakLine: false }, fonts);
  text(slide, data.content[0] || cfg.topic, { x: 0.74, y: 4.2, w: 5.9, h: 0.95, fontSize: 16, color: "E2E8F0", fontFace: fonts.body, fit: "shrink" }, fonts);
  text(slide, "AI Interview", { x: 0.74, y: 6.72, w: 2.3, h: 0.28, fontSize: 10, bold: true, charSpacing: 0.8, color: "FFFFFF", fontFace: fonts.body }, fonts);
  text(slide, "PREMIUM PRESENTATION", { x: 9.0, y: 6.75, w: 3.3, h: 0.25, fontSize: 8, bold: true, charSpacing: 1.2, color: theme.mutedColor, align: "right", fontFace: fonts.body }, fonts);
}

function renderSection(slide, data, theme, fonts) {
  shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
  shape(slide, "rect", { x: 0.7, y: 0.78, w: 0.08, h: 5.9, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  text(slide, "SECTION", { x: 1.12, y: 1.35, w: 2, h: 0.3, fontSize: 10, bold: true, charSpacing: 2, color: theme.accent, fontFace: fonts.body }, fonts);
  text(slide, data.title, { x: 1.12, y: 2.0, w: 9.6, h: 1.6, fontSize: 34, bold: true, color: "FFFFFF", fontFace: fonts.heading, fit: "shrink" }, fonts);
  text(slide, data.content[0] || "A focused part of the story", { x: 1.14, y: 4.15, w: 7.6, h: 0.7, fontSize: 16, color: theme.dark ? "CBD5E1" : "E2E8F0", fontFace: fonts.body, fit: "shrink" }, fonts);
  shape(slide, "ellipse", { x: 10.1, y: 1.2, w: 2.1, h: 2.1, fill: { color: theme.accent, transparency: 45 }, line: { color: theme.accent, transparency: 100 } });
  shape(slide, "ellipse", { x: 10.9, y: 3.2, w: 1.2, h: 1.2, fill: { color: theme.secondary, transparency: 20 }, line: { color: theme.secondary, transparency: 100 } });
}

function renderBullets(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Key idea" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 6);
  items.forEach((item, i) => {
    const y = 1.62 + i * 0.78;
    addNumberBadge(slide, i + 1, 0.66, y, theme, fonts, 0.38);
    text(slide, item, { x: 1.22, y: y - 0.02, w: 10.9, h: 0.55, fontSize: items.length > 5 ? 14 : 16, color: theme.textColor, fontFace: fonts.body, valign: "mid", fit: "shrink" }, fonts);
    if (i < items.length - 1) shape(slide, "line", { x: 1.22, y: y + 0.63, w: 10.65, h: 0, line: { color: theme.panelBorder, transparency: 35, width: 0.5 } });
  });
}

function renderTwoColumn(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts);
  addAccentLine(slide, theme);
  const mid = Math.ceil(data.content.length / 2);
  const groups = [data.content.slice(0, mid), data.content.slice(mid)];
  groups.forEach((group, g) => {
    const x = g === 0 ? 0.62 : 6.88;
    addCard(slide, x, 1.62, 5.83, 4.95, theme, { fill: theme.panel });
    addPill(slide, g === 0 ? "CORE" : "IMPACT", x + 0.32, 1.95, theme, fonts, { color: g === 0 ? theme.primary : theme.secondary });
    addBullets(slide, group, theme, fonts, { x: x + 0.38, y: 2.52, w: 5.0, h: 3.55 }, { fontSize: 14, max: 4, paraSpaceAfterPt: 11 });
  });
}

function renderCards(slide, data, theme, fonts, count) {
  addTitle(slide, data.title, theme, fonts);
  addAccentLine(slide, theme);
  const items = data.content.slice(0, count);
  const gap = 0.18;
  const width = (12.08 - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = 0.62 + i * (width + gap);
    addCard(slide, x, 1.68, width, 4.78, theme);
    shape(slide, "rect", { x: x, y: 1.68, w: width, h: 0.08, fill: { color: i % 2 ? theme.secondary : theme.accent }, line: { color: i % 2 ? theme.secondary : theme.accent, transparency: 100 } });
    addNumberBadge(slide, i + 1, x + 0.28, 2.05, theme, fonts, 0.44);
    text(slide, shorten(item, count >= 5 ? 85 : 110), { x: x + 0.28, y: 2.72, w: width - 0.56, h: 2.2, fontSize: count >= 5 ? 11.5 : 13.5, bold: count <= 3, color: theme.textColor, fontFace: fonts.body, valign: "mid", align: count <= 3 ? "center" : "left", fit: "shrink" }, fonts);
  });
}

function renderComparison(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Compare" });
  addAccentLine(slide, theme);
  const mid = Math.ceil(data.content.length / 2);
  const left = data.content.slice(0, mid);
  const right = data.content.slice(mid);
  const labels = ["OPTION A", "OPTION B"];
  [left, right].forEach((items, i) => {
    const x = i === 0 ? 0.62 : 6.88;
    const color = i === 0 ? theme.primary : theme.secondary;
    addCard(slide, x, 1.66, 5.83, 4.9, theme);
    shape(slide, "roundRect", { x: x + 0.28, y: 1.95, w: 1.45, h: 0.42, rectRadius: 0.21, fill: { color }, line: { color, transparency: 100 } });
    text(slide, labels[i], { x: x + 0.28, y: 2.03, w: 1.45, h: 0.22, fontSize: 8.5, bold: true, align: "center", color: "FFFFFF", fontFace: fonts.body }, fonts);
    addBullets(slide, items, theme, fonts, { x: x + 0.4, y: 2.7, w: 5.0, h: 3.2 }, { fontSize: 14, max: 4 });
  });
  shape(slide, "ellipse", { x: 6.27, y: 3.0, w: 0.8, h: 0.8, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  text(slide, "VS", { x: 6.27, y: 3.25, w: 0.8, h: 0.25, fontSize: 10, bold: true, align: "center", color: "FFFFFF", fontFace: fonts.body }, fonts);
}

function renderTimeline(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Timeline" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 5);
  shape(slide, "line", { x: 1.0, y: 3.55, w: 11.0, h: 0, line: { color: theme.accent, width: 2.2 } });
  const step = items.length > 1 ? 11 / (items.length - 1) : 11;
  items.forEach((item, i) => {
    const x = 1 + i * step;
    shape(slide, "ellipse", { x: x - 0.12, y: 3.43, w: 0.24, h: 0.24, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
    text(slide, String(i + 1).padStart(2, "0"), { x: x - 0.35, y: 2.05, w: 0.7, h: 0.35, fontSize: 14, bold: true, align: "center", color: theme.primary, fontFace: fonts.heading }, fonts);
    text(slide, shorten(item, 70), { x: x - 0.8, y: i % 2 ? 3.95 : 4.02, w: 1.6, h: 1.25, fontSize: 11.5, align: "center", color: theme.textColor, fontFace: fonts.body, fit: "shrink", valign: "mid" }, fonts);
  });
}

function renderProcess(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Process" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 5);
  const width = 2.2;
  items.forEach((item, i) => {
    const x = 0.62 + i * 2.48;
    addCard(slide, x, 2.0, width, 3.35, theme);
    addNumberBadge(slide, i + 1, x + 0.22, 2.28, theme, fonts, 0.48);
    text(slide, shorten(item, 90), { x: x + 0.22, y: 3.05, w: width - 0.44, h: 1.5, fontSize: 13, bold: true, color: theme.textColor, fontFace: fonts.body, fit: "shrink", valign: "mid", align: "center" }, fonts);
    if (i < items.length - 1) {
      text(slide, "→", { x: x + width + 0.12, y: 3.1, w: 0.45, h: 0.4, fontSize: 20, bold: true, color: theme.accent, align: "center", fontFace: fonts.body }, fonts);
    }
  });
}

function renderStats(slide, data, theme, fonts, cfg) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Key metrics" });
  addAccentLine(slide, theme);
  const chart = extractChartData(data);
  if (!chart) {
    renderCards(slide, data, theme, fonts, Math.min(4, Math.max(3, data.content.length)));
    return;
  }
  const max = Math.max(...chart.map((x) => x.value), 1);
  const cardCount = Math.min(chart.length, 4);
  chart.slice(0, cardCount).forEach((item, i) => {
    const x = 0.62 + i * 3.02;
    addCard(slide, x, 1.65, 2.75, 1.65, theme, { fill: theme.panel2 || theme.panel });
    text(slide, String(item.value), { x: x + 0.2, y: 1.93, w: 2.35, h: 0.58, fontSize: 26, bold: true, color: theme.primary, fontFace: fonts.heading, fit: "shrink" }, fonts);
    text(slide, item.label, { x: x + 0.2, y: 2.62, w: 2.35, h: 0.34, fontSize: 10, color: theme.mutedColor, fontFace: fonts.body, fit: "shrink" }, fonts);
  });
  const startY = 3.85;
  chart.slice(0, 6).forEach((item, i) => {
    const y = startY + i * 0.42;
    text(slide, item.label, { x: 0.7, y: y - 0.02, w: 2.3, h: 0.24, fontSize: 9.5, color: theme.textColor, fontFace: fonts.body, fit: "shrink" }, fonts);
    shape(slide, "roundRect", { x: 3.1, y, w: 7.65, h: 0.18, rectRadius: 0.09, fill: { color: theme.panelBorder }, line: { color: theme.panelBorder, transparency: 100 } });
    shape(slide, "roundRect", { x: 3.1, y, w: Math.max(0.15, 7.65 * (item.value / max)), h: 0.18, rectRadius: 0.09, fill: { color: i % 2 ? theme.secondary : theme.accent }, line: { color: i % 2 ? theme.secondary : theme.accent, transparency: 100 } });
    text(slide, String(item.value), { x: 10.95, y: y - 0.06, w: 0.9, h: 0.28, fontSize: 9.5, bold: true, align: "right", color: theme.titleColor, fontFace: fonts.body }, fonts);
  });
  text(slide, "Use as directional insight unless the source data is explicitly provided.", { x: 0.7, y: 6.45, w: 6.5, h: 0.24, fontSize: 7.5, italic: true, color: theme.mutedColor, fontFace: fonts.body }, fonts);
}

function renderQuote(slide, data, theme, fonts) {
  shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: theme.panel2 || theme.bg }, line: { color: theme.panel2 || theme.bg, transparency: 100 } });
  text(slide, "“", { x: 0.85, y: 1.0, w: 1.1, h: 1.1, fontSize: 68, bold: true, color: theme.accent, fontFace: "Georgia" }, fonts);
  text(slide, data.content[0] || data.title, { x: 1.45, y: 1.75, w: 10.25, h: 2.45, fontSize: 27, bold: true, italic: true, color: theme.titleColor, fontFace: fonts.heading, fit: "shrink", valign: "mid" }, fonts);
  shape(slide, "rect", { x: 1.48, y: 4.55, w: 1.0, h: 0.06, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  text(slide, data.content[1] || data.title, { x: 1.48, y: 4.82, w: 6.6, h: 0.45, fontSize: 13, bold: true, color: theme.mutedColor, fontFace: fonts.body, fit: "shrink" }, fonts);
}

function renderImageText(slide, data, theme, fonts, buffer, reverse = false) {
  addTitle(slide, data.title, theme, fonts);
  addAccentLine(slide, theme);
  const imageBox = reverse ? { x: 7.05, y: 1.62, w: 5.65, h: 4.9 } : { x: 0.62, y: 1.62, w: 5.65, h: 4.9 };
  const textX = reverse ? 0.62 : 6.68;
  const imageOK = addImageFrame(slide, buffer, imageBox, theme);
  if (!imageOK) {
    // Never leave the image area blank; use a designed visual card.
    addCard(slide, imageBox.x, imageBox.y, imageBox.w, imageBox.h, theme, { fill: theme.panel2 || theme.panel });
    shape(slide, "ellipse", { x: imageBox.x + 1.7, y: imageBox.y + 1.1, w: 2.2, h: 2.2, fill: { color: theme.accent, transparency: 28 }, line: { color: theme.accent, transparency: 100 } });
    text(slide, "VISUAL\nSTORY", { x: imageBox.x + 1.2, y: imageBox.y + 1.95, w: 3.2, h: 0.9, fontSize: 19, bold: true, align: "center", color: theme.primary, fontFace: fonts.heading, fit: "shrink" }, fonts);
  }
  addBullets(slide, data.content, theme, fonts, { x: textX, y: 1.85, w: 5.45, h: 4.35 }, { fontSize: 14, max: 5 });
}

function renderFullImage(slide, data, theme, fonts, buffer) {
  const imageOK = buffer && addImage(slide, buffer, { x: 0, y: 0, w: 13.333, h: 7.5 });
  if (!imageOK) {
    // Designed fallback rather than blank slide.
    shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
    shape(slide, "ellipse", { x: 8.7, y: -0.4, w: 5.4, h: 5.4, fill: { color: theme.secondary, transparency: 25 }, line: { color: theme.secondary, transparency: 100 } });
    shape(slide, "ellipse", { x: 9.8, y: 3.6, w: 3.3, h: 3.3, fill: { color: theme.accent, transparency: 48 }, line: { color: theme.accent, transparency: 100 } });
  } else {
    shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: "000000", transparency: 45 }, line: { color: "000000", transparency: 100 } });
  }
  addPill(slide, "INSIGHT", 0.72, 0.7, theme, fonts, { color: theme.accent });
  text(slide, data.title, { x: 0.72, y: 1.65, w: 8.7, h: 1.35, fontSize: 34, bold: true, color: "FFFFFF", fontFace: fonts.heading, fit: "shrink" }, fonts);
  text(slide, data.content[0] || "", { x: 0.75, y: 3.25, w: 7.3, h: 0.9, fontSize: 16, color: "F8FAFC", fontFace: fonts.body, fit: "shrink" }, fonts);
}

function renderFlow(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Flow" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 5);
  items.forEach((item, i) => {
    const x = 0.65 + i * 2.48;
    addCard(slide, x, 2.1, 1.95, 1.7, theme);
    addNumberBadge(slide, i + 1, x + 0.16, 2.27, theme, fonts, 0.38);
    text(slide, shorten(item, 60), { x: x + 0.18, y: 2.82, w: 1.58, h: 0.62, fontSize: 11.5, bold: true, align: "center", color: theme.textColor, fontFace: fonts.body, fit: "shrink" }, fonts);
    if (i < items.length - 1) text(slide, "→", { x: x + 2.0, y: 2.67, w: 0.45, h: 0.4, fontSize: 20, bold: true, color: theme.accent, align: "center", fontFace: fonts.body }, fonts);
  });
  text(slide, "A connected visual sequence makes the logic easier to scan.", { x: 0.7, y: 5.15, w: 7.5, h: 0.35, fontSize: 10, color: theme.mutedColor, fontFace: fonts.body }, fonts);
}

function renderGrid(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Framework" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 6);
  const cols = items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / cols);
  const w = cols === 2 ? 5.83 : 3.75;
  const h = rows === 2 ? 2.25 : 1.8;
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.62 + col * (w + 0.42);
    const y = 1.68 + row * (h + 0.35);
    addCard(slide, x, y, w, h, theme);
    addNumberBadge(slide, i + 1, x + 0.22, y + 0.24, theme, fonts, 0.4);
    text(slide, shorten(item, 95), { x: x + 0.82, y: y + 0.28, w: w - 1.08, h: h - 0.5, fontSize: 12.5, color: theme.textColor, fontFace: fonts.body, fit: "shrink", valign: "mid" }, fonts);
  });
}

function renderProblemSolution(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Problem → Solution" });
  addAccentLine(slide, theme);
  addCard(slide, 0.62, 1.72, 5.7, 4.65, theme, { fill: theme.panel2 || theme.panel });
  addCard(slide, 7.0, 1.72, 5.7, 4.65, theme);
  addPill(slide, "PROBLEM", 0.95, 2.05, theme, fonts, { color: theme.secondary });
  addPill(slide, "SOLUTION", 7.33, 2.05, theme, fonts, { color: theme.primary });
  const problem = data.content.filter((x) => /problem|challenge|issue|समस्या|चुनौती/i.test(x));
  const solution = data.content.filter((x) => /solution|answer|approach|समाधान|तरीका/i.test(x));
  addBullets(slide, problem.length ? problem : data.content.slice(0, Math.ceil(data.content.length / 2)), theme, fonts, { x: 1.0, y: 2.65, w: 4.85, h: 2.9 }, { fontSize: 14, max: 3 });
  addBullets(slide, solution.length ? solution : data.content.slice(Math.ceil(data.content.length / 2)), theme, fonts, { x: 7.38, y: 2.65, w: 4.85, h: 2.9 }, { fontSize: 14, max: 3 });
  text(slide, "→", { x: 6.35, y: 3.65, w: 0.55, h: 0.45, fontSize: 24, bold: true, color: theme.accent, align: "center", fontFace: fonts.body }, fonts);
}

function renderBeforeAfter(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Transformation" });
  addAccentLine(slide, theme);
  [0, 1].forEach((i) => {
    const x = i === 0 ? 0.62 : 6.88;
    addCard(slide, x, 1.72, 5.83, 4.65, theme);
    addPill(slide, i === 0 ? "BEFORE" : "AFTER", x + 0.3, 2.04, theme, fonts, { color: i === 0 ? theme.secondary : theme.accent });
    const half = Math.ceil(data.content.length / 2);
    addBullets(slide, i === 0 ? data.content.slice(0, half) : data.content.slice(half), theme, fonts, { x: x + 0.4, y: 2.65, w: 5.0, h: 3.1 }, { fontSize: 14, max: 4 });
  });
  text(slide, "→", { x: 6.28, y: 3.65, w: 0.65, h: 0.45, fontSize: 25, bold: true, color: theme.accent, align: "center", fontFace: fonts.body }, fonts);
}

function renderProsCons(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "Balanced view" });
  addAccentLine(slide, theme);
  const half = Math.ceil(data.content.length / 2);
  [["PROS", data.content.slice(0, half), theme.accent], ["CONS", data.content.slice(half), theme.secondary]].forEach(([label, items, color], i) => {
    const x = i === 0 ? 0.62 : 6.88;
    addCard(slide, x, 1.72, 5.83, 4.65, theme);
    addPill(slide, label, x + 0.3, 2.04, theme, fonts, { color });
    addBullets(slide, items, theme, fonts, { x: x + 0.4, y: 2.65, w: 5.0, h: 3.1 }, { fontSize: 14, max: 4, bulletColor: color });
  });
}

function renderDiagram(slide, data, theme, fonts) {
  addTitle(slide, data.title, theme, fonts, { kicker: "System view" });
  addAccentLine(slide, theme);
  const items = data.content.slice(0, 5);
  const centerX = 5.33;
  addCard(slide, centerX, 2.62, 2.7, 1.35, theme, { fill: theme.panel2 || theme.panel });
  text(slide, data.title, { x: centerX + 0.2, y: 3.02, w: 2.3, h: 0.42, fontSize: 14, bold: true, align: "center", color: theme.primary, fontFace: fonts.heading, fit: "shrink" }, fonts);
  const positions = [[0.8,1.8],[8.9,1.8],[0.8,4.65],[8.9,4.65]];
  items.slice(0, 4).forEach((item, i) => {
    const [x, y] = positions[i];
    addCard(slide, x, y, 3.2, 1.15, theme);
    text(slide, shorten(item, 80), { x: x + 0.2, y: y + 0.25, w: 2.8, h: 0.62, fontSize: 11.5, bold: true, align: "center", color: theme.textColor, fontFace: fonts.body, fit: "shrink" }, fonts);
    shape(slide, "line", { x: x < 5 ? x + 3.2 : centerX + 2.7, y: y + 0.57, w: x < 5 ? centerX - (x + 3.2) : x - (centerX + 2.7), h: (3.3 - (y + 0.57)) * 0.12, line: { color: theme.accent, width: 1.1, beginArrowType: "none", endArrowType: "triangle" } });
  });
}

function renderSummary(slide, data, theme, fonts) {
  shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: theme.panel2 || theme.bg }, line: { color: theme.panel2 || theme.bg, transparency: 100 } });
  addPill(slide, "TAKEAWAYS", 0.72, 0.72, theme, fonts, { color: theme.accent });
  text(slide, data.title, { x: 0.72, y: 1.4, w: 10.6, h: 0.95, fontSize: 31, bold: true, color: theme.titleColor, fontFace: fonts.heading, fit: "shrink" }, fonts);
  const items = data.content.slice(0, 4);
  items.forEach((item, i) => {
    const x = 0.72 + (i % 2) * 6.05;
    const y = 2.65 + Math.floor(i / 2) * 1.6;
    addCard(slide, x, y, 5.55, 1.25, theme);
    addNumberBadge(slide, i + 1, x + 0.24, y + 0.36, theme, fonts, 0.45);
    text(slide, shorten(item, 105), { x: x + 0.9, y: y + 0.3, w: 4.25, h: 0.62, fontSize: 13, bold: true, color: theme.textColor, fontFace: fonts.body, fit: "shrink", valign: "mid" }, fonts);
  });
}

function renderThanks(slide, data, theme, fonts) {
  shape(slide, "rect", { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
  shape(slide, "ellipse", { x: 8.4, y: -0.8, w: 5.5, h: 5.5, fill: { color: theme.secondary, transparency: 20 }, line: { color: theme.secondary, transparency: 100 } });
  shape(slide, "ellipse", { x: 10.5, y: 4.5, w: 2.2, h: 2.2, fill: { color: theme.accent, transparency: 25 }, line: { color: theme.accent, transparency: 100 } });
  text(slide, data.title || "Thank You", { x: 0.8, y: 2.0, w: 8.6, h: 1.2, fontSize: 42, bold: true, color: "FFFFFF", fontFace: fonts.heading, fit: "shrink" }, fonts);
  shape(slide, "roundRect", { x: 0.82, y: 3.55, w: 1.2, h: 0.06, rectRadius: 0.03, fill: { color: theme.accent }, line: { color: theme.accent, transparency: 100 } });
  text(slide, data.content[0] || "Key takeaways", { x: 0.82, y: 3.9, w: 6.7, h: 0.55, fontSize: 15, color: "E2E8F0", fontFace: fonts.body, fit: "shrink" }, fonts);
  text(slide, "AI Interview", { x: 0.82, y: 6.75, w: 2.2, h: 0.25, fontSize: 9, bold: true, charSpacing: 1, color: "FFFFFF", fontFace: fonts.body }, fonts);
}

const RENDERERS = {
  title: renderTitle,
  section: renderSection,
  bullets: renderBullets,
  twoColumn: renderTwoColumn,
  threeCards: (s,d,t,f,c) => renderCards(s,d,t,f,3),
  fourCards: (s,d,t,f,c) => renderCards(s,d,t,f,4),
  fiveCards: (s,d,t,f,c) => renderCards(s,d,t,f,5),
  comparison: renderComparison,
  timeline: renderTimeline,
  process: renderProcess,
  stats: renderStats,
  quote: renderQuote,
  imageText: (s,d,t,f,c,b) => renderImageText(s,d,t,f,b,false),
  textImage: (s,d,t,f,c,b) => renderImageText(s,d,t,f,b,true),
  fullImage: renderFullImage,
  flow: renderFlow,
  grid: renderGrid,
  problemSolution: renderProblemSolution,
  beforeAfter: renderBeforeAfter,
  prosCons: renderProsCons,
  diagram: renderDiagram,
  summary: renderSummary,
  thanks: renderThanks,
};

// ============================================================
// PPT BUILD
// ============================================================

async function buildPPTX(content, cfg) {
  const theme = getTheme(cfg.theme);
  const fonts = fontConfig(cfg, theme);
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "AI Interview";
  pres.company = "AI Interview";
  pres.subject = content.title;
  pres.title = content.title;
  pres.lang = cfg.language === "Hindi" ? "hi-IN" : "en-US";
  pres.theme = { headFontFace: fonts.heading, bodyFontFace: fonts.body, lang: pres.lang };
  if (typeof pres.defineSlideMaster === "function") {
    // No master is required; intentional per-slide design avoids accidental theme overrides.
  }

  const imageMap = await prepareImages(content, cfg);
  const total = content.slides.length;

  for (let i = 0; i < content.slides.length; i++) {
    const data = content.slides[i];
    const slide = pres.addSlide();
    addBackground(slide, theme, i, total);

    const buffer = imageMap.get(i) || null;
    let layout = data.layout;
    if (cfg.addImages && ["imageText", "textImage", "fullImage"].includes(layout) && !buffer) layout = safeLayoutForImageFailure(data);

    const renderer = RENDERERS[layout] || RENDERERS.bullets;
    try {
      await Promise.resolve(renderer(slide, { ...data, layout }, theme, fonts, cfg, buffer));
    } catch (error) {
      console.warn(`[PPT] renderer ${layout} failed on slide ${data.slideNumber}:`, error.message);
      try {
        renderBullets(slide, { ...data, layout: "bullets" }, theme, fonts, cfg);
      } catch (fallbackError) {
        console.warn(`[PPT] hard fallback failed on slide ${data.slideNumber}:`, fallbackError.message);
        text(slide, data.title || `Slide ${data.slideNumber}`, { x: 0.7, y: 2.7, w: 11.8, h: 0.8, fontSize: 28, bold: true, align: "center", color: theme.titleColor, fontFace: fonts.heading, fit: "shrink" }, fonts);
      }
    }

    if (!["title", "section", "quote", "fullImage", "thanks"].includes(layout)) addFooter(slide, theme, data.slideNumber, total, fonts);
    if (cfg.speakerNotes !== false) {
      const notes = [cfg.narration && data.narrationScript ? `NARRATION: ${data.narrationScript}` : "", data.speakerNotes || data.content.join("\n")].filter(Boolean).join("\n\n");
      if (notes && typeof slide.addNotes === "function") slide.addNotes(notes);
    }
  }
  return pres;
}

// ============================================================
// OOXML TRANSITIONS / OPTIONAL ANIMATION
// ============================================================

function transitionXML(mode, index) {
  if (mode === "Off") return "";
  if (mode === "Dynamic" && index % 2 === 0) return '<p:transition spd="med"><p:push dir="l"/></p:transition>';
  return '<p:transition spd="med"><p:fade/></p:transition>';
}

function isSlideXmlSane(xml) {
  return typeof xml === "string" && xml.includes("<p:sld") && xml.includes("</p:sld>");
}

async function postProcessPPTX(filePath, options) {
  const needTransitions = options.transitions !== "Off";
  if (!needTransitions) return;
  const original = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(original);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  for (let i = 0; i < slideFiles.length; i++) {
    const name = slideFiles[i];
    let xml = await zip.file(name).async("string");
    if (xml.includes("<p:transition")) continue;
    const transition = transitionXML(options.transitions, i);
    const clr = "</p:clrMapOvr>";
    const end = "</p:sld>";
    let candidate = xml;
    const pos = xml.indexOf(clr);
    if (pos >= 0) {
      const at = pos + clr.length;
      candidate = xml.slice(0, at) + transition + xml.slice(at);
    } else {
      const at = xml.lastIndexOf(end);
      if (at >= 0) candidate = xml.slice(0, at) + transition + xml.slice(at);
    }
    if (isSlideXmlSane(candidate)) xml = candidate;
    zip.file(name, xml);
  }
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(filePath, output);
}

// ============================================================
// QUALITY CONTROL
// ============================================================

async function validateOutput(filePath, content) {
  const issues = [];
  if (!fs.existsSync(filePath)) return ["file-missing"];
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 10 * 1024) issues.push("file-too-small");
  } catch { issues.push("file-stat-failed"); }

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (slideFiles.length !== content.slides.length) issues.push("slide-count-mismatch");

    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.file(slideFiles[i]).async("string");
      if (!isSlideXmlSane(xml)) issues.push(`slide-xml-invalid-${i + 1}`);
      const hasVisibleShape = /<p:(sp|pic|graphicFrame)\b/.test(xml);
      if (!hasVisibleShape) issues.push(`blank-slide-${i + 1}`);
      const hasTextOrVisual = /<a:(t|blip|graphic)/.test(xml);
      if (!hasTextOrVisual) issues.push(`content-missing-${i + 1}`);
    }
  } catch (error) {
    issues.push(`zip-invalid:${String(error.message || "").slice(0, 100)}`);
  }

  for (const slide of content.slides) {
    if (!slide.title || !Array.isArray(slide.content) || !slide.content.length) issues.push(`empty-slide-${slide.slideNumber}`);
    if (String(slide.title).length > 120) issues.push(`long-title-${slide.slideNumber}`);
    for (const item of slide.content || []) if (String(item).length > 160) issues.push(`long-content-${slide.slideNumber}`);
  }
  if (issues.length) console.warn("[PPT] QC:", issues.join(", "));
  return issues;
}

function makeFileName(userId) {
  const safeUser = String(userId || "user").replace(/[^A-Za-z0-9-]/g, "").slice(0, 80) || "user";
  return `ppt_${safeUser}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.pptx`;
}

function isSafeFileName(name) {
  return typeof name === "string" && /^ppt_[A-Za-z0-9-]+_\d+_[a-f0-9]{8}\.pptx$/.test(name);
}

async function cleanOldPPTFiles() {
  try {
    if (!fs.existsSync(PPT_DIR)) return;
    const cutoff = Date.now() - TTL_HOURS * 3600 * 1000;
    const files = await fs.promises.readdir(PPT_DIR);
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".pptx")) continue;
      const full = path.join(PPT_DIR, file);
      try {
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < cutoff) await fs.promises.unlink(full);
      } catch {}
    }
  } catch (error) { console.warn("[PPT] cleanup failed:", error.message); }
}

// ============================================================
// MAIN API
// ============================================================

async function generatePPT(opts, userId) {
  const { errors, clean } = validatePPTOptions(opts);
  if (errors.length) { const error = new Error(errors.join(", ")); error.statusCode = 400; throw error; }

  await cleanOldPPTFiles();
  const content = await generatePPTContent(clean);
  if (!content?.slides?.length) throw new Error("AI se presentation content nahi ban paya.");

  if (!fs.existsSync(PPT_DIR)) await fs.promises.mkdir(PPT_DIR, { recursive: true });
  const fileName = makeFileName(userId);
  const filePath = path.join(PPT_DIR, fileName);

  const presentation = await buildPPTX(content, clean);
  await presentation.writeFile({ fileName: filePath });

  // Transitions are optional and isolated. A failure never destroys a valid PPT.
  try { await postProcessPPTX(filePath, clean); } catch (error) { console.warn("[PPT] transition post-process skipped:", error.message); }

  let issues = await validateOutput(filePath, content);
  const fatal = issues.some((x) => x === "file-missing" || x.startsWith("zip-invalid") || x.startsWith("blank-slide") || x.startsWith("content-missing") || x.startsWith("slide-xml-invalid"));

  if (fatal) {
    console.warn("[PPT] QC found a fatal issue; rebuilding clean PPTX without post-processing.");
    const cleanPresentation = await buildPPTX(content, { ...clean, transitions: "Off" });
    await cleanPresentation.writeFile({ fileName: filePath });
    issues = await validateOutput(filePath, content);
  }

  if (issues.some((x) => x === "file-missing" || x.startsWith("zip-invalid") || x.startsWith("blank-slide") || x.startsWith("content-missing") || x.startsWith("slide-xml-invalid"))) {
    throw new Error("PPT file valid nahi bani. Thodi der baad try karo.");
  }

  const preview = {
    title: content.title,
    subtitle: content.subtitle,
    slides: content.slides.map((slide) => ({
      slideNumber: slide.slideNumber,
      title: slide.title,
      layout: slide.layout,
      content: slide.content,
      imagePrompt: clean.addImages ? slide.imagePrompt : "",
      hasChart: clean.charts === "Auto" && !!extractChartData(slide),
      narrationScript: clean.narration ? slide.narrationScript : "",
    })),
  };

  const stat = fs.statSync(filePath);
  console.log(`[PPT] Premium generated ${fileName} | ${content.slides.length} slides | ${Math.round(stat.size / 1024)} KB | theme=${clean.theme} | images=${clean.addImages}`);

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
  THEME_NAMES,
  LAYOUT_STYLES,
  TRANSITION_MODES,
  ANIMATION_MODES,
  CHART_MODES,
  NARRATION_MODES,
  KNOWN_LAYOUTS,
};
