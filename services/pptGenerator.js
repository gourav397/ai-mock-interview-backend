// ============================================================
// services/pptGenerator.js — PREMIUM CONTENT-AWARE PPT ENGINE
// Cinematic covers/sections, glass cards, KPI cards, process
// flows, native charts, base64 images, OOXML transitions +
// entrance animations, auto-advance 4.5–11s, blank-slide QC.
// Existing API contract + exports preserved.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const JSZip = require("jszip");
const PptxGenJS = require("pptxgenjs");
const { geminiGenerate, extractJSON } = require("../config/geminiClient");
const { keyManager } = require("../config/geminiKeys");
const { THEMES, GRID, getTheme } = require("./pptThemes");

const PPT_DIR = path.join(process.cwd(), "uploads", "ppt");
const MIN_SLIDES = 4;
const MAX_SLIDES = 20;
const TTL_HOURS = Number(process.env.PPT_FILE_TTL_HOURS || 72);
const AUTO_ADVANCE_MIN_MS = 4500;
const AUTO_ADVANCE_MAX_MS = 11000;

const LANGUAGES = ["English", "Hindi", "Bilingual"];
const TYPES = ["Student", "Professional", "Educational", "Interview", "General"];
const THEME_NAMES = Object.keys(THEMES);
const LAYOUT_STYLES = ["AI Auto", "Professional", "Visual", "Academic"];
const TRANSITION_MODES = ["Off", "Subtle", "Dynamic"];
const ANIMATION_MODES = ["Off", "Subtle", "Professional"];
const CHART_MODES = ["Auto", "Off"];
const NARRATION_MODES = ["Off", "On"];
const KNOWN_LAYOUTS = [
  "title", "section", "agenda", "bullets", "panelBullets", "kpi",
  "process", "quote", "imageText", "textImage", "fullImage",
  "twoColumn", "comparison", "chart", "thanks",
];

// ------------------------------------------------------------
// OPTION VALIDATION (backward-compatible)
// ------------------------------------------------------------
function validatePPTOptions(opts = {}) {
  const errors = [];
  const num = (v, def, min, max) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const pick = (v, list, def) => (list.includes(v) ? v : def);

  const clean = {
    topic: String(opts.topic || "").trim().slice(0, 300),
    slideCount: num(opts.slides ?? opts.slideCount, 8, MIN_SLIDES, MAX_SLIDES),
    language: pick(opts.language, LANGUAGES, "English"),
    type: pick(opts.type, TYPES, "General"),
    theme: pick(opts.theme, THEME_NAMES, "Modern"),
    layoutStyle: pick(opts.layoutStyle, LAYOUT_STYLES, "AI Auto"),
    addImages: opts.addImages === true || opts.addImages === "true" || opts.addImages === 1,
    speakerNotes: opts.speakerNotes !== false,
    transitions: pick(opts.transitions, TRANSITION_MODES, "Subtle"),
    animations: pick(opts.animations, ANIMATION_MODES, "Off"),
    charts: pick(opts.charts, CHART_MODES, "Auto"),
    narration: pick(opts.narration, NARRATION_MODES, "Off") === "On",
  };

  if (!clean.topic) errors.push("Topic required hai");
  if (clean.topic.length < 3) errors.push("Topic kam se kam 3 characters ka hona chahiye");
  return { errors, clean };
}

// ------------------------------------------------------------
// AI CONTENT GENERATION
// ------------------------------------------------------------
function buildPrompt(cfg) {
  const langLine = {
    English: "Write everything in English.",
    Hindi: "Sab kuch Hindi (Devanagari) me likho. English words sirf zaroorat par.",
    Bilingual: "Har line bilingual likho: English sentence then Hindi translation separated by ' / '.",
  }[cfg.language];

  const audience = {
    Student: "College students (clear, exam-oriented)",
    Professional: "Working professionals (business tone, ROI, metrics)",
    Educational: "Teachers/trainers (definitions, examples, mnemonics)",
    Interview: "Interview prep (frequent questions, model answers)",
    General: "General audience (simple, engaging)",
  }[cfg.type];

  return `You are a world-class presentation designer + content writer.
Create premium presentation content for topic: "${cfg.topic}"
Slides: exactly ${cfg.slideCount}. Audience: ${audience}. ${langLine}

For EACH slide return:
- slideNumber (1..N)
- layout: one of ${KNOWN_LAYOUTS.join(", ")}
- title (<=60 chars)
- content: array of 2-6 SHORT lines (each <=110 chars)
- kpis: ONLY for kpi layout — array of {label, value} (3-4 items)
- steps: ONLY for process layout — array of {step, desc} (3-5 items)
- quote: ONLY for quote layout (a strong quote line)
- quoteBy: ONLY for quote layout (attribution)
- left/right: ONLY for twoColumn/comparison — arrays of SHORT lines
- leftTitle/rightTitle: headers for twoColumn/comparison
- chartSpec: ONLY if layout chart or data is numeric — {type: "bar"|"line"|"pie"|"doughnut", labels:[...], values:[numbers], title}
- imagePrompt: short English image-search style prompt (only for imageText/textImage/fullImage)
- speakerNotes: 1-2 sentence notes
- narrationScript: 2-3 spoken sentences

Structure rules:
Slide 1 layout MUST be "title", last slide "thanks". Insert "section" divider before each major part. Use variety: at most 2 "bullets"; include at least one of agenda/kpi/process/comparison/chart when slideCount >= 6.
Return ONLY valid JSON:
{"title":"...","subtitle":"...","slides":[ ... ]}`;
}

function isQuotaError(error) {
  const m = String(error?.message || "").toLowerCase();
  return m.includes("quota") || m.includes("429") || m.includes("resource_exhausted");
}

async function generatePPTContent(cfg) {
  const prompt = buildPrompt(cfg);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const key = keyManager?.pickKey?.() || undefined;
      const raw = await geminiGenerate(prompt, key);
      const parsed = extractJSON(raw);
      const slides = (parsed?.slides || []).filter((s) => s && s.title);
      if (slides.length >= MIN_SLIDES) return normalizeContent(parsed, cfg);
      console.warn(`[PPT] attempt ${attempt}: slides=${slides.length} — retry`);
    } catch (error) {
      console.warn(`[PPT] attempt ${attempt} fail:`, error.message);
      if (isQuotaError(error)) throw error;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  return fallbackContent(cfg);
}

function normalizeContent(parsed, cfg) {
  const slides = (parsed.slides || []).map((s, i) => ({
    slideNumber: i + 1,
    layout: KNOWN_LAYOUTS.includes(s.layout) ? s.layout : "bullets",
    title: String(s.title || "").slice(0, 110),
    content: (Array.isArray(s.content) ? s.content : [String(s.content || "")])
      .map((c) => String(c).slice(0, 150)).filter(Boolean).slice(0, 6),
    kpis: Array.isArray(s.kpis) ? s.kpis.slice(0, 4) : null,
    steps: Array.isArray(s.steps) ? s.steps.slice(0, 5) : null,
    quote: s.quote ? String(s.quote).slice(0, 180) : "",
    quoteBy: s.quoteBy ? String(s.quoteBy).slice(0, 60) : "",
    left: Array.isArray(s.left) ? s.left.slice(0, 5) : null,
    right: Array.isArray(s.right) ? s.right.slice(0, 5) : null,
    leftTitle: s.leftTitle ? String(s.leftTitle).slice(0, 40) : "",
    rightTitle: s.rightTitle ? String(s.rightTitle).slice(0, 40) : "",
    chartSpec: s.chartSpec && Array.isArray(s.chartSpec.labels) && s.chartSpec.labels.length ? s.chartSpec : null,
    imagePrompt: s.imagePrompt ? String(s.imagePrompt).slice(0, 140) : "",
    speakerNotes: s.speakerNotes ? String(s.speakerNotes).slice(0, 400) : "",
    narrationScript: s.narrationScript ? String(s.narrationScript).slice(0, 600) : "",
  }));
  // enforce bookends
  if (slides.length) {
    slides[0].layout = "title";
    slides[slides.length - 1].layout = "thanks";
  }
  return {
    title: String(parsed.title || cfg.topic).slice(0, 120),
    subtitle: String(parsed.subtitle || `A premium presentation on ${cfg.topic}`).slice(0, 160),
    slides,
  };
}

function fallbackContent(cfg) {
  const n = cfg.slideCount;
  const empty = { kpis: null, steps: null, quote: "", quoteBy: "", left: null, right: null, leftTitle: "", rightTitle: "", chartSpec: null, imagePrompt: "", speakerNotes: "", narrationScript: "" };
  const slides = [{ slideNumber: 1, layout: "title", title: cfg.topic, content: ["Premium AI Presentation", "AI Interview"], ...empty }];
  for (let i = 2; i <= n - 1; i++) {
    slides.push({
      slideNumber: i,
      layout: i === 2 ? "agenda" : i % 3 === 0 ? "panelBullets" : "bullets",
      title: `${cfg.topic} — Part ${i - 1}`,
      content: [`${cfg.topic} ka key point ${i - 1}`, "Important insight", "Practical example"],
      ...empty,
    });
  }
  slides.push({ slideNumber: n, layout: "thanks", title: "Thank You", content: ["Questions & Discussion"], ...empty });
  return { title: cfg.topic, subtitle: "AI Interview Premium Deck", slides };
}

// ------------------------------------------------------------
// CHART DATA EXTRACT
// ------------------------------------------------------------
function extractChartData(slide) {
  if (!slide) return null;
  if (slide.chartSpec?.labels?.length && slide.chartSpec?.values?.length) {
    const labels = slide.chartSpec.labels.map(String).slice(0, 8);
    const values = slide.chartSpec.values.map((v) => Number(v) || 0).slice(0, 8);
    const type = ["bar", "line", "pie", "doughnut"].includes(slide.chartSpec.type) ? slide.chartSpec.type : "bar";
    return { labels, values, type, title: slide.chartSpec.title || slide.title };
  }
  const rows = [];
  for (const line of slide.content || []) {
    const m = String(line).match(/^(.+?)[::-–]\s*([\d.]+)\s*%?$/);
    if (m && rows.length < 8) rows.push([m[1].trim().slice(0, 24), Number(m[2])]);
  }
  if (rows.length >= 3) return { labels: rows.map((r) => r[0]), values: rows.map((r) => r[1]), type: "bar", title: slide.title };
  return null;
}

// ------------------------------------------------------------
// IMAGES (keyless Pollinations → base64 data)
// ------------------------------------------------------------
function fetchImage(url) {
  return new Promise((resolve) => {
    try {
      https.get(url, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => { size += c.length; if (size <= 4 * 1024 * 1024) chunks.push(c); else res.destroy(); });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(null));
      }).on("error", () => resolve(null)).setTimeout(9000, function () { this.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function prepareImages(content, cfg) {
  const map = new Map();
  if (!cfg.addImages) return map;
  const wanted = content.slides.filter((s) => ["imageText", "textImage", "fullImage"].includes(s.layout) && s.imagePrompt);
  await Promise.all(wanted.slice(0, 6).map(async (s) => {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(s.imagePrompt.slice(0, 120))}?width=1024&height=768&nologo=true&seed=${s.slideNumber}`;
    const buf = await fetchImage(url);
    if (buf && buf.length > 10 * 1024) {
      map.set(s.slideNumber - 1, `data:image/jpeg;base64,${buf.toString("base64")}`);
    } else {
      console.warn(`[PPT] image fallback on slide ${s.slideNumber}`);
    }
  }));
  return map;
}

// ------------------------------------------------------------
// PREMIUM VISUAL PRIMITIVES
// ------------------------------------------------------------
function addBackground(slide, theme, index, kind = "content") {
  slide.background = { color: theme.bg };
  const d = theme.depth || [];
  if (d[0]) slide.addShape("roundRect", { x: -1.2, y: -1.0, w: GRID.W * 0.62, h: GRID.H * 0.5, rectRadius: 0.6, fill: { color: d[0].color, transparency: d[0].transparency }, line: { type: "none" } });
  if (d[1]) slide.addShape("roundRect", { x: GRID.W * 0.5, y: GRID.H * 0.62, w: GRID.W * 0.62, h: GRID.H * 0.5, rectRadius: 0.6, fill: { color: d[1].color, transparency: d[1].transparency }, line: { type: "none" } });

  const orbs = theme.orbColors || [theme.primary, theme.accent, theme.secondary];
  slide.addShape("ellipse", { x: GRID.W - 2.2, y: -0.9, w: 1.9, h: 1.9, fill: { color: orbs[index % orbs.length], transparency: kind === "cinematic" ? 55 : 82 }, line: { type: "none" } });
  slide.addShape("ellipse", { x: -0.8, y: GRID.H - 1.6, w: 1.4, h: 1.4, fill: { color: orbs[(index + 1) % orbs.length], transparency: kind === "cinematic" ? 60 : 86 }, line: { type: "none" } });
  slide.addShape("rect", { x: 0, y: 0, w: GRID.W, h: 0.07, fill: { color: theme.primary, transparency: kind === "cinematic" ? 0 : 30 }, line: { type: "none" } });
}

function glassCard(slide, theme, { x, y, w, h }) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.12,
    fill: { color: theme.panel, transparency: theme.dark ? 12 : 0 },
    line: { color: theme.panelBorder, width: 1 },
    shadow: { type: "outer", color: theme.dark ? "000000" : "94A3B8", blur: 12, offset: 3, angle: 90, opacity: theme.dark ? 0.55 : 0.28 },
  });
}

function text(slide, txt, opts, fonts) {
  slide.addText(String(txt || ""), { fontFace: (fonts && fonts.body) || "Aptos", fit: "shrink", ...opts });
}

function kicker(slide, theme, label, x, y, fonts) {
  slide.addShape("roundRect", { x, y, w: 0.5, h: 0.28, rectRadius: 0.14, fill: { color: theme.accent, transparency: 20 }, line: { type: "none" } });
  text(slide, label || "PREMIUM", { x: x + 0.6, y: y - 0.03, w: 6, h: 0.34, fontSize: 11, bold: true, color: theme.mutedColor, charSpacing: 2 }, fonts);
}

function header(slide, theme, title, fonts, opts = {}) {
  kicker(slide, theme, opts.kicker || "PREMIUM", GRID.MX, GRID.MY, fonts);
  text(slide, title, {
    x: GRID.MX, y: GRID.MY + 0.36, w: GRID.contentW, h: 0.85,
    fontSize: theme.headingSize, bold: true, color: theme.titleColor,
    fontFace: fonts.heading, align: "left", valign: "top",
  }, fonts);
  slide.addShape("rect", { x: GRID.MX, y: GRID.MY + 1.28, w: 1.6, h: 0.06, fill: { color: theme.accent }, line: { type: "none" } });
}

function addFooter(slide, theme, num, total, fonts) {
  text(slide, "AI Interview", { x: GRID.MX, y: GRID.H - 0.42, w: 3, h: 0.3, fontSize: 9, color: theme.mutedColor }, fonts);
  text(slide, `${num} / ${total}`, { x: GRID.W - 1.6, y: GRID.H - 0.42, w: 0.9, h: 0.3, fontSize: 9, align: "right", color: theme.mutedColor }, fonts);
  slide.addShape("rect", { x: GRID.W - 0.55, y: GRID.H - 0.36, w: Math.max(0.05, (num / total) * 0.5), h: 0.05, fill: { color: theme.accent }, line: { type: "none" } });
}

function bulletsInto(slide, theme, items, box, fonts, opts = {}) {
  const list = (items || []).slice(0, 6);
  const per = Math.min(0.72, box.h / Math.max(1, list.length));
  list.forEach((item, i) => {
    const cy = box.y + i * per;
    slide.addShape("ellipse", { x: box.x, y: cy + 0.1, w: 0.14, h: 0.14, fill: { color: i % 2 ? theme.accent : theme.primary }, line: { type: "none" } });
    text(slide, item, { x: box.x + 0.3, y: cy, w: box.w - 0.3, h: per - 0.05, fontSize: opts.fontSize || theme.bodySize, color: theme.textColor, valign: "top" }, fonts);
  });
}

// ------------------------------------------------------------
// CONTENT-AWARE LAYOUT AUTO-SELECTION
// ------------------------------------------------------------
function autoLayout(data, index, total, cfg) {
  if (data.layout && data.layout !== "bullets" && KNOWN_LAYOUTS.includes(data.layout)) return data.layout;
  if (cfg.charts !== "Off" && extractChartData(data)) return "chart";
  if (index === 0) return "title";
  if (index === total - 1) return "thanks";
  if (data.quote) return "quote";
  if (Array.isArray(data.steps) && data.steps.length >= 3) return "process";
  if (Array.isArray(data.kpis) && data.kpis.length >= 3) return "kpi";
  if (data.left && data.right) return "comparison";
  const bodyLen = (data.content || []).join(" ").length;
  if ((data.content || []).length >= 4 && bodyLen < 400) return "panelBullets";
  if (index === 1) return "agenda";
  if (index % 4 === 2) return "section";
  return "panelBullets";
}

// ------------------------------------------------------------
// PREMIUM RENDERERS
// (slide, data, theme, fonts, cfg, buf, pres)
// ------------------------------------------------------------
const RENDERERS = {
  // 🎬 CINEMATIC COVER
  title(slide, data, theme, fonts, cfg) {
    slide.addShape("roundRect", { x: -0.5, y: 4.2, w: GRID.W + 1, h: 3.6, rectRadius: 0.3, fill: { color: theme.panel, transparency: theme.dark ? 25 : 8 }, line: { type: "none" }, shadow: { type: "outer", color: "000000", blur: 18, offset: 4, angle: 90, opacity: 0.3 } });
    slide.addShape("roundRect", { x: GRID.MX, y: 1.05, w: 1.4, h: 0.16, rectRadius: 0.08, fill: { color: theme.primary }, line: { type: "none" } });
    text(slide, data.title, { x: GRID.MX, y: 1.5, w: GRID.contentW - 0.5, h: 1.9, fontSize: 44, bold: true, color: theme.titleColor, fontFace: fonts.heading }, fonts);
    text(slide, data.content?.[0] || "", { x: GRID.MX, y: 3.4, w: GRID.contentW - 0.5, h: 0.7, fontSize: 18, color: theme.textColor }, fonts);
    const badges = [cfg.language, cfg.type, "AI Premium"];
    let bx = GRID.MX;
    badges.forEach((b, i) => {
      const bw = 0.35 + b.length * 0.11;
      slide.addShape("roundRect", { x: bx, y: 4.55, w: bw, h: 0.38, rectRadius: 0.19, fill: { color: i === 0 ? theme.primary : theme.panel2 }, line: { color: theme.panelBorder, width: 0.75 } });
      text(slide, b, { x: bx, y: 4.55, w: bw, h: 0.38, fontSize: 11, bold: true, color: i === 0 ? "FFFFFF" : theme.primary, align: "center", valign: "middle" }, fonts);
      bx += bw + 0.2;
    });
    slide.addShape("rect", { x: GRID.MX, y: 5.35, w: 2.2, h: 0.07, fill: { color: theme.accent }, line: { type: "none" } });
    text(slide, "AI Interview • Premium Deck", { x: GRID.MX, y: 5.55, w: 6, h: 0.4, fontSize: 13, color: theme.mutedColor }, fonts);
  },

  // 🎬 CINEMATIC SECTION DIVIDER
  section(slide, data, theme, fonts) {
    slide.addShape("roundRect", { x: 2.4, y: 2.2, w: GRID.W - 4.8, h: 2.6, rectRadius: 0.18, fill: { color: theme.primary, transparency: theme.dark ? 15 : 0 }, line: { type: "none" }, shadow: { type: "outer", color: theme.primary, blur: 22, offset: 5, angle: 90, opacity: 0.4 } });
    slide.addShape("roundRect", { x: 2.62, y: 2.42, w: GRID.W - 5.24, h: 2.16, rectRadius: 0.15, fill: { color: theme.dark ? theme.panel : "FFFFFF", transparency: 8 }, line: { color: theme.accent, width: 1.5 } });
    text(slide, "SECTION", { x: 2.9, y: 2.75, w: 3, h: 0.35, fontSize: 12, bold: true, charSpacing: 4, color: theme.accent }, fonts);
    text(slide, data.title, { x: 2.9, y: 3.15, w: GRID.W - 5.8, h: 1.2, fontSize: 30, bold: true, color: theme.titleColor, fontFace: fonts.heading }, fonts);
  },

  agenda(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts, { kicker: "AGENDA" });
    const items = (data.content || []).slice(0, 6);
    const colW = (GRID.contentW - 0.3) / 2;
    items.forEach((item, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = GRID.MX + col * (colW + 0.3);
      const y = 2.15 + row * 1.35;
      glassCard(slide, theme, { x, y, w: colW, h: 1.15 });
      slide.addShape("ellipse", { x: x + 0.22, y: y + 0.32, w: 0.52, h: 0.52, fill: { color: i % 2 ? theme.secondary : theme.primary }, line: { type: "none" } });
      text(slide, String(i + 1), { x: x + 0.22, y: y + 0.32, w: 0.52, h: 0.52, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle" }, fonts);
      text(slide, item, { x: x + 0.95, y: y + 0.15, w: colW - 1.15, h: 0.85, fontSize: theme.bodySize, color: theme.textColor, valign: "middle" }, fonts);
    });
  },

  bullets(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts);
    bulletsInto(slide, theme, data.content, { x: GRID.MX + 0.15, y: 2.3, w: GRID.contentW - 0.6, h: 3.9 }, fonts, { fontSize: theme.bodySize + 1 });
  },

  // ✨ GLASS PANEL CARDS
  panelBullets(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts);
    const items = (data.content || []).slice(0, 4);
    const n = items.length;
    const gap = 0.25;
    const cw = (GRID.contentW - gap * (n - 1)) / n;
    items.forEach((item, i) => {
      const x = GRID.MX + i * (cw + gap);
      glassCard(slide, theme, { x, y: 2.25, w: cw, h: 3.6 });
      slide.addShape("rect", { x: x + 0.25, y: 2.6, w: 0.7, h: 0.09, fill: { color: [theme.primary, theme.secondary, theme.accent, theme.accent2][i % 4] }, line: { type: "none" } });
      text(slide, item, { x: x + 0.25, y: 2.9, w: cw - 0.5, h: 2.7, fontSize: theme.bodySize, color: theme.textColor, valign: "top" }, fonts);
      text(slide, `0${i + 1}`, { x: x + cw - 0.85, y: 2.35, w: 0.6, h: 0.5, fontSize: 18, bold: true, color: theme.panelBorder, align: "right" }, fonts);
    });
  },

  // 📊 KPI STAT CARDS
  kpi(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts, { kicker: "KEY METRICS" });
    const kpis = (data.kpis || (data.content || []).map((c) => {
      const m = String(c).match(/^(.+?)[::-–]\s*(.+)$/);
      return m ? { label: m[1], value: m[2] } : { label: c, value: "" };
    })).slice(0, 4);
    const n = kpis.length || 1;
    const gap = 0.3;
    const cw = (GRID.contentW - gap * (n - 1)) / n;
    kpis.forEach((k, i) => {
      const x = GRID.MX + i * (cw + gap);
      glassCard(slide, theme, { x, y: 2.35, w: cw, h: 2.6 });
      slide.addShape("roundRect", { x: x + cw / 2 - 0.3, y: 2.6, w: 0.6, h: 0.1, rectRadius: 0.05, fill: { color: [theme.primary, theme.accent, theme.secondary, theme.accent2][i % 4] }, line: { type: "none" } });
      text(slide, String(k.value || "—"), { x: x + 0.15, y: 2.95, w: cw - 0.3, h: 1.0, fontSize: 30, bold: true, color: theme.primary, align: "center", valign: "middle", fontFace: fonts.heading }, fonts);
      text(slide, String(k.label || ""), { x: x + 0.15, y: 4.05, w: cw - 0.3, h: 0.75, fontSize: theme.bodySize - 1, color: theme.mutedColor, align: "center", valign: "top" }, fonts);
    });
    const extra = (data.content || []).slice(kpis.length);
    if (extra.length) bulletsInto(slide, theme, extra, { x: GRID.MX + 0.15, y: 5.3, w: GRID.contentW - 0.6, h: 1.1 }, fonts, { fontSize: theme.bodySize - 1 });
  },

  // 🌐 PROCESS / DIAGRAM FLOW
  process(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts, { kicker: "PROCESS FLOW" });
    const steps = (data.steps || (data.content || []).map((c) => ({ step: c, desc: "" }))).slice(0, 5);
    const n = steps.length || 1;
    const arrowW = 0.45;
    const cw = (GRID.contentW - arrowW * (n - 1) - 0.2) / n;
    steps.forEach((st, i) => {
      const x = GRID.MX + 0.1 + i * (cw + arrowW);
      const y = 2.5;
      slide.addShape("roundRect", { x, y, w: cw, h: 2.3, rectRadius: 0.12, fill: { color: theme.panel }, line: { color: theme.panelBorder, width: 1 }, shadow: { type: "outer", color: "64748B", blur: 10, offset: 3, angle: 90, opacity: 0.22 } });
      slide.addShape("ellipse", { x: x + cw / 2 - 0.3, y: y - 0.35, w: 0.6, h: 0.6, fill: { color: [theme.primary, theme.secondary, theme.accent, theme.accent2, theme.primary][i % 5] }, line: { color: theme.bg, width: 2.5 } });
      text(slide, String(i + 1), { x: x + cw / 2 - 0.3, y: y - 0.35, w: 0.6, h: 0.6, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle" }, fonts);
      text(slide, String(st.step || ""), { x: x + 0.15, y: y + 0.4, w: cw - 0.3, h: 0.75, fontSize: theme.bodySize, bold: true, color: theme.titleColor, align: "center" }, fonts);
      if (st.desc) text(slide, String(st.desc), { x: x + 0.15, y: y + 1.2, w: cw - 0.3, h: 0.95, fontSize: theme.bodySize - 3, color: theme.mutedColor, align: "center" }, fonts);
      if (i < n - 1) slide.addShape("rightArrow", { x: x + cw + 0.05, y: y + 0.9, w: arrowW - 0.1, h: 0.42, fill: { color: theme.accent, transparency: 25 }, line: { type: "none" } });
    });
    const extra = (data.content || []).slice(steps.length);
    if (extra.length) bulletsInto(slide, theme, extra, { x: GRID.MX + 0.15, y: 5.35, w: GRID.contentW - 0.6, h: 1.05 }, fonts, { fontSize: theme.bodySize - 1 });
  },

  // 💬 QUOTE
  quote(slide, data, theme, fonts) {
    slide.addShape("roundRect", { x: 1.4, y: 1.9, w: GRID.W - 2.8, h: 3.4, rectRadius: 0.2, fill: { color: theme.panel }, line: { color: theme.accent, width: 1.5 }, shadow: { type: "outer", color: theme.primary, blur: 20, offset: 4, angle: 90, opacity: 0.28 } });
    text(slide, "\u201C", { x: 1.7, y: 1.8, w: 1.2, h: 1.2, fontSize: 80, bold: true, color: theme.accent, fontFace: fonts.heading }, fonts);
    text(slide, data.quote || data.content?.[0] || data.title, { x: 2.5, y: 2.5, w: GRID.W - 5.0, h: 1.9, fontSize: 22, italic: true, color: theme.titleColor, fontFace: fonts.heading, valign: "middle" }, fonts);
    if (data.quoteBy) text(slide, `— ${data.quoteBy}`, { x: 2.5, y: 4.45, w: GRID.W - 5.0, h: 0.5, fontSize: 14, bold: true, color: theme.primary }, fonts);
  },

  // 🖼️ IMAGE + TEXT BALANCE
  imageText(slide, data, theme, fonts, cfg, buf) {
    header(slide, theme, data.title, fonts);
    const imgW = 5.6;
    if (buf) {
      slide.addShape("roundRect", { x: GRID.W - GRID.MX - imgW - 0.15, y: 2.2, w: imgW + 0.3, h: 4.0, rectRadius: 0.15, fill: { color: theme.panel2 }, line: { color: theme.panelBorder, width: 1 }, shadow: { type: "outer", color: "64748B", blur: 12, offset: 4, angle: 90, opacity: 0.3 } });
      slide.addImage({ data: buf, x: GRID.W - GRID.MX - imgW, y: 2.35, w: imgW, h: 3.7, sizing: { type: "cover", w: imgW, h: 3.7 } });
    }
    const tw = buf ? GRID.contentW - imgW - 0.6 : GRID.contentW - 0.4;
    bulletsInto(slide, theme, data.content, { x: GRID.MX + 0.15, y: 2.4, w: tw - 0.2, h: 3.7 }, fonts, { fontSize: theme.bodySize });
  },

  textImage(slide, data, theme, fonts, cfg, buf) {
    header(slide, theme, data.title, fonts);
    const imgW = 5.6;
    if (buf) {
      slide.addShape("roundRect", { x: GRID.MX - 0.15, y: 2.2, w: imgW + 0.3, h: 4.0, rectRadius: 0.15, fill: { color: theme.panel2 }, line: { color: theme.panelBorder, width: 1 }, shadow: { type: "outer", color: "64748B", blur: 12, offset: 4, angle: 90, opacity: 0.3 } });
      slide.addImage({ data: buf, x: GRID.MX, y: 2.35, w: imgW, h: 3.7, sizing: { type: "cover", w: imgW, h: 3.7 } });
    }
    const tx = buf ? GRID.MX + imgW + 0.55 : GRID.MX + 0.2;
    const tw = buf ? GRID.contentW - imgW - 0.7 : GRID.contentW - 0.4;
    bulletsInto(slide, theme, data.content, { x: tx, y: 2.4, w: tw, h: 3.7 }, fonts, { fontSize: theme.bodySize });
  },

  fullImage(slide, data, theme, fonts, cfg, buf) {
    if (buf) {
      slide.addImage({ data: buf, x: 0, y: 0, w: GRID.W, h: GRID.H, sizing: { type: "cover", w: GRID.W, h: GRID.H } });
      slide.addShape("rect", { x: 0, y: 3.6, w: GRID.W, h: 3.9, fill: { color: "000000", transparency: 45 }, line: { type: "none" } });
      text(slide, data.title, { x: GRID.MX, y: 5.4, w: GRID.contentW, h: 0.9, fontSize: 30, bold: true, color: "FFFFFF", fontFace: fonts.heading }, fonts);
      const list = (data.content || []).slice(0, 2);
      list.forEach((item, i) => {
        text(slide, item, { x: GRID.MX + 0.1, y: 6.35 + i * 0.4, w: GRID.contentW - 0.6, h: 0.38, fontSize: 12, color: "E2E8F0" }, fonts);
      });
      return;
    }
    // image fail → designed text fallback (never blank)
    RENDERERS.section(slide, data, theme, fonts);
  },

  twoColumn(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts);
    const colW = (GRID.contentW - 0.35) / 2;
    glassCard(slide, theme, { x: GRID.MX, y: 2.2, w: colW, h: 4.0 });
    glassCard(slide, theme, { x: GRID.MX + colW + 0.35, y: 2.2, w: colW, h: 4.0 });
    slide.addShape("rect", { x: GRID.MX, y: 2.2, w: colW, h: 0.09, fill: { color: theme.primary }, line: { type: "none" } });
    slide.addShape("rect", { x: GRID.MX + colW + 0.35, y: 2.2, w: colW, h: 0.09, fill: { color: theme.secondary }, line: { type: "none" } });
    text(slide, data.leftTitle || "Overview", { x: GRID.MX + 0.25, y: 2.42, w: colW - 0.5, h: 0.5, fontSize: theme.bodySize + 1, bold: true, color: theme.primary }, fonts);
    text(slide, data.rightTitle || "Details", { x: GRID.MX + colW + 0.6, y: 2.42, w: colW - 0.5, h: 0.5, fontSize: theme.bodySize + 1, bold: true, color: theme.secondary }, fonts);
    bulletsInto(slide, theme, data.left || data.content, { x: GRID.MX + 0.3, y: 3.05, w: colW - 0.55, h: 2.9 }, fonts, { fontSize: theme.bodySize - 1 });
    bulletsInto(slide, theme, data.right || [], { x: GRID.MX + colW + 0.65, y: 3.05, w: colW - 0.55, h: 2.9 }, fonts, { fontSize: theme.bodySize - 1 });
  },

  // 🆚 COMPARISON CARDS
  comparison(slide, data, theme, fonts) {
    header(slide, theme, data.title, fonts, { kicker: "COMPARISON" });
    const colW = (GRID.contentW - 0.35) / 2;
    const panels = [
      { x: GRID.MX, color: theme.primary, title: data.leftTitle || "Option A", items: data.left || data.content },
      { x: GRID.MX + colW + 0.35, color: theme.secondary, title: data.rightTitle || "Option B", items: data.right || [] },
    ];
    panels.forEach((p) => {
      slide.addShape("roundRect", { x: p.x, y: 2.2, w: colW, h: 4.1, rectRadius: 0.14, fill: { color: theme.panel }, line: { color: p.color, width: 1.5 }, shadow: { type: "outer", color: p.color, blur: 14, offset: 3, angle: 90, opacity: 0.25 } });
      slide.addShape("roundRect", { x: p.x + 0.25, y: 2.42, w: colW - 0.5, h: 0.5, rectRadius: 0.1, fill: { color: p.color }, line: { type: "none" } });
      text(slide, p.title, { x: p.x + 0.35, y: 2.42, w: colW - 0.7, h: 0.5, fontSize: 13, bold: true, color: "FFFFFF", valign: "middle" }, fonts);
      bulletsInto(slide, theme, p.items, { x: p.x + 0.3, y: 3.15, w: colW - 0.6, h: 2.9 }, fonts, { fontSize: theme.bodySize - 1 });
    });
  },

  // 📊 NATIVE EDITABLE CHART
  chart(slide, data, theme, fonts, cfg, buf, pres) {
    header(slide, theme, data.title, fonts, { kicker: "DATA INSIGHT" });
    const chartData = extractChartData(data);
    if (!chartData) return RENDERERS.panelBullets(slide, data, theme, fonts, cfg, null);
    const cd = [{ name: chartData.title || "Data", labels: chartData.labels, values: chartData.values }];
    const opts = {
      x: GRID.MX + 0.2, y: 2.25, w: GRID.contentW - 2.6, h: 4.0,
      chartColors: [theme.primary, theme.accent, theme.secondary, theme.accent2],
      showLegend: false, showValue: true, dataBorder: { pt: 0, color: theme.panel },
      catAxisLabelColor: theme.mutedColor, valAxisLabelColor: theme.mutedColor,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      dataLabelColor: theme.textColor, dataLabelFontSize: 9,
    };
    try {
      if (chartData.type === "line") slide.addChart(pres.charts.LINE, cd, opts);
      else if (chartData.type === "pie") slide.addChart(pres.charts.PIE, cd, { ...opts, showLegend: true, legendPos: "r", legendColor: theme.textColor });
      else if (chartData.type === "doughnut") slide.addChart(pres.charts.DOUGHNUT, cd, { ...opts, showLegend: true, legendPos: "r", legendColor: theme.textColor, holeSize: 60 });
      else slide.addChart(pres.charts.BAR, cd, opts);
    } catch (error) {
      console.warn("[PPT] chart failed:", error.message);
      return RENDERERS.panelBullets(slide, data, theme, fonts, cfg, null);
    }
    glassCard(slide, theme, { x: GRID.W - GRID.MX - 2.1, y: 2.25, w: 2.1, h: 4.0 });
    text(slide, "Insight", { x: GRID.W - GRID.MX - 1.95, y: 2.45, w: 1.8, h: 0.4, fontSize: 12, bold: true, color: theme.primary }, fonts);
    bulletsInto(slide, theme, (data.content || []).slice(0, 3), { x: GRID.W - GRID.MX - 1.95, y: 2.9, w: 1.85, h: 3.2 }, fonts, { fontSize: 10 });
  },

  thanks(slide, data, theme, fonts) {
    slide.addShape("roundRect", { x: 2.2, y: 2.3, w: GRID.W - 4.4, h: 2.5, rectRadius: 0.2, fill: { color: theme.primary, transparency: theme.dark ? 12 : 0 }, line: { type: "none" }, shadow: { type: "outer", color: theme.primary, blur: 24, offset: 5, angle: 90, opacity: 0.4 } });
    text(slide, data.title || "Thank You", { x: 2.5, y: 2.7, w: GRID.W - 5.0, h: 1.1, fontSize: 36, bold: true, color: "FFFFFF", align: "center", fontFace: fonts.heading }, fonts);
    text(slide, (data.content || []).join(" • ") || "Questions & Discussion", { x: 2.5, y: 3.9, w: GRID.W - 5.0, h: 0.6, fontSize: 15, color: theme.dark ? theme.accent : "E8EDFB", align: "center" }, fonts);
  },
};

// ------------------------------------------------------------
// BUILD PPTX
// ------------------------------------------------------------
async function buildPPTX(content, cfg) {
  const pres = new PptxGenJS();
  const theme = getTheme(cfg.theme);
  const fonts = theme.fontPair;

  pres.defineLayout({ name: "WIDE", width: GRID.W, height: GRID.H });
  pres.layout = "WIDE";
  pres.author = "AI Interview";
  pres.company = "AI Interview";
  pres.subject = content.title;
  pres.title = content.title;
  pres.lang = cfg.language === "Hindi" ? "hi-IN" : "en-US";
  pres.theme = { headFontFace: fonts.heading, bodyFontFace: fonts.body, lang: pres.lang };

  const imageMap = await prepareImages(content, cfg);
  const total = content.slides.length;

  for (let i = 0; i < content.slides.length; i++) {
    const data = content.slides[i];
    const slide = pres.addSlide();
    const layout = autoLayout(data, i, total, cfg);
    addBackground(slide, theme, i, ["title", "section", "thanks", "fullImage"].includes(layout) ? "cinematic" : "content");

    const buffer = imageMap.get(i) || null;
    const renderData = { ...data, layout, content: data.content || [] };

    const renderer = RENDERERS[layout] || RENDERERS.bullets;
    try {
      await Promise.resolve(renderer(slide, renderData, theme, fonts, cfg, buffer, pres));
    } catch (error) {
      console.warn(`[PPT] renderer ${layout} failed on slide ${data.slideNumber}:`, error.message);
      try {
        RENDERERS.bullets(slide, renderData, theme, fonts, cfg, null, pres);
      } catch (fallbackError) {
        console.warn(`[PPT] hard fallback failed on slide ${data.slideNumber}:`, fallbackError.message);
        text(slide, data.title || `Slide ${data.slideNumber}`, { x: 0.7, y: 2.7, w: 11.8, h: 0.8, fontSize: 28, bold: true, align: "center", color: theme.titleColor, fontFace: fonts.heading }, fonts);
      }
    }

    if (!["title", "section", "quote", "fullImage", "thanks"].includes(layout)) addFooter(slide, theme, data.slideNumber, total, fonts);

    if (cfg.speakerNotes !== false) {
      const notes = [cfg.narration && data.narrationScript ? `\u{1F50A} NARRATION: ${data.narrationScript}` : "", data.speakerNotes || (data.content || []).join("\n")].filter(Boolean).join("\n\n");
      if (notes && typeof slide.addNotes === "function") slide.addNotes(notes);
    }
  }
  return pres;
}

// ------------------------------------------------------------
// MOTION / AUTO-ADVANCE (4.5–11s)
// ------------------------------------------------------------
function getSlideAdvanceMs(data, cfg, index, total) {
  if (!cfg || cfg.transitions === "Off") return 0;
  if (index === 0) return cfg.animations === "Professional" ? 6500 : 5500;
  if (index === total - 1) return cfg.animations === "Professional" ? 9000 : 7000;

  const textLength = [data?.title, ...(data?.content || [])].join(" ").length;
  const hasChart = !!extractChartData(data);
  const hasImage = !!data?.imagePrompt;
  let ms = 5000 + Math.min(3200, Math.round(textLength * 18));
  if (hasChart) ms += 1800;
  if (hasImage) ms += 900;
  if (cfg.animations === "Professional") ms += 800;
  return Math.max(AUTO_ADVANCE_MIN_MS, Math.min(AUTO_ADVANCE_MAX_MS, ms));
}

// ------------------------------------------------------------
// OOXML TRANSITIONS + ENTRANCE ANIMATIONS (fail-safe rollback)
// ------------------------------------------------------------
function transitionXML(mode, index, advanceMs = 0) {
  if (mode === "Off") return "";
  const advance = Number.isFinite(advanceMs) && advanceMs > 0 ? ` advClick="0" advTm="${Math.round(advanceMs)}"` : "";
  if (mode === "Dynamic") {
    const effects = [
      `<p:zoom dir="in"/>`,
      `<p:push dir="l"/>`,
      `<p:wipe dir="r"/>`,
      `<p:split orient="vert" dir="out"/>`,
      `<p:fade/>`,
    ];
    return `<p:transition spd="med"${advance}>${effects[index % effects.length]}</p:transition>`;
  }
  const subtle = [`<p:fade/>`, `<p:wipe dir="r"/>`];
  return `<p:transition spd="med"${advance}>${subtle[index % subtle.length]}</p:transition>`;
}

function collectAnimatableShapeIds(xml) {
  const ids = [];
  const re = /<p:(?:sp|pic|graphicFrame)\b[\s\S]*?<p:cNvPr\s+id="(\d+)"/g;
  let match;
  while ((match = re.exec(xml))) {
    const id = Number(match[1]);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 6);
}

function buildEntranceAnimationXML(shapeIds, effect = "fade", duration = 420) {
  if (!Array.isArray(shapeIds) || !shapeIds.length) return "";
  const safeEffect = ["fade", "wipe(right)", "blinds(horizontal)"].includes(effect) ? effect : "fade";

  let nextId = 3;
  const rows = shapeIds.map((spid, index) => {
    const outer = nextId, inner = nextId + 1, behavior = nextId + 2;
    const delay = index === 0 ? 0 : Math.min(900, index * 120);
    nextId += 4;
    return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:childTnLst><p:animEffect transition="in" filter="${safeEffect}"><p:cBhvr><p:cTn id="${behavior}" dur="${duration}" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  }).join("");

  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${rows}</p:childTnLst><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst/></p:timing>`;
}

function isSlideXmlSane(xml) {
  return typeof xml === "string" &&
    xml.includes("<p:sld") &&
    xml.includes("</p:sld>") &&
    !xml.includes("<p:transition><p:transition>") &&
    !xml.includes("<p:timing><p:timing>");
}

async function postProcessPPTX(filePath, options) {
  const needTransitions = options.transitions !== "Off";
  const needAnimations = options.animations !== "Off";
  if (!needTransitions && !needAnimations) return;

  const original = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(original);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  for (let i = 0; i < slideFiles.length; i++) {
    const name = slideFiles[i];
    const originalXml = await zip.file(name).async("string");
    let xml = originalXml;
    const slideData = options.content?.slides?.[i];
    const advanceMs = getSlideAdvanceMs(slideData, options, i, slideFiles.length);

    // idempotent: strip old motion first
    xml = xml.replace(/<p:transition\b[\s\S]*?<\/p:transition>/g, "");
    xml = xml.replace(/<p:timing>[\s\S]*?<\/p:timing>/g, "");

    const transition = needTransitions ? transitionXML(options.transitions, i, advanceMs) : "";
    let candidate = xml;
    const clr = "</p:clrMapOvr>";
    const end = "</p:sld>";

    if (transition) {
      const clrPos = candidate.indexOf(clr);
      if (clrPos >= 0) {
        const at = clrPos + clr.length;
        candidate = candidate.slice(0, at) + transition + candidate.slice(at);
      } else {
        const at = candidate.lastIndexOf(end);
        if (at >= 0) candidate = candidate.slice(0, at) + transition + candidate.slice(at);
      }
    }

    if (needAnimations) {
      const ids = collectAnimatableShapeIds(candidate);
      if (ids.length) {
        const effect = options.animations === "Professional"
          ? ["fade", "wipe(right)", "blinds(horizontal)"][i % 3]
          : "fade";
        const timing = buildEntranceAnimationXML(ids, effect, options.animations === "Professional" ? 500 : 380);
        const at = candidate.lastIndexOf(end);
        if (at >= 0) candidate = candidate.slice(0, at) + timing + candidate.slice(at);
      }
    }

    if (isSlideXmlSane(candidate)) {
      xml = candidate;
    } else {
      console.warn(`[PPT] Motion XML rejected for ${name}; rollback to original.`);
      xml = originalXml;
    }
    zip.file(name, xml);
  }

  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(filePath, output);
}

// ------------------------------------------------------------
// QUALITY CONTROL (blank-slide QC + rebuild guarantee)
// ------------------------------------------------------------
async function validateOutput(filePath, content) {
  const issues = [];
  if (!fs.existsSync(filePath)) return ["file-missing"];
  try {
    if (fs.statSync(filePath).size < 10 * 1024) issues.push("file-too-small");
  } catch { issues.push("file-stat-failed"); }

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    if (slideFiles.length !== content.slides.length) issues.push("slide-count-mismatch");
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.file(slideFiles[i]).async("string");
      if (!isSlideXmlSane(xml)) issues.push(`slide-xml-invalid-${i + 1}`);
      if (!/<p:(sp|pic|graphicFrame)\b/.test(xml)) issues.push(`blank-slide-${i + 1}`);
    }
  } catch (error) {
    issues.push(`zip-invalid:${String(error.message || "").slice(0, 100)}`);
  }
  if (issues.length) console.warn("[PPT] QC:", issues.join(", "));
  return issues;
}

// ------------------------------------------------------------
// FILE UTILS
// ------------------------------------------------------------
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
    for (const file of await fs.promises.readdir(PPT_DIR)) {
      if (!file.toLowerCase().endsWith(".pptx")) continue;
      const full = path.join(PPT_DIR, file);
      try {
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < cutoff) await fs.promises.unlink(full);
      } catch {}
    }
  } catch (error) { console.warn("[PPT] cleanup failed:", error.message); }
}

// ------------------------------------------------------------
// MAIN API
// ------------------------------------------------------------
async function generatePPT(opts, userId) {
  const { errors, clean } = validatePPTOptions(opts);
  if (errors.length) { const e = new Error(errors.join(", ")); e.statusCode = 400; throw e; }

  await cleanOldPPTFiles();
  const content = await generatePPTContent(clean);
  if (!content?.slides?.length) throw new Error("AI se presentation content nahi ban paya.");

  if (!fs.existsSync(PPT_DIR)) await fs.promises.mkdir(PPT_DIR, { recursive: true });
  const fileName = makeFileName(userId);
  const filePath = path.join(PPT_DIR, fileName);

  const presentation = await buildPPTX(content, clean);
  await presentation.writeFile({ fileName: filePath });

  try { await postProcessPPTX(filePath, { ...clean, content }); }
  catch (error) { console.warn("[PPT] motion post-process skipped:", error.message); }

  let issues = await validateOutput(filePath, content);
  const fatal = issues.some((x) => x === "file-missing" || x.startsWith("zip-invalid") || x.startsWith("blank-slide") || x.startsWith("slide-xml-invalid") || x.startsWith("slide-count-mismatch"));

  if (fatal) {
    console.warn("[PPT] QC fatal; rebuilding clean PPTX without post-processing.");
    const cleanPres = await buildPPTX(content, { ...clean, transitions: "Off", animations: "Off" });
    await cleanPres.writeFile({ fileName: filePath });
    issues = await validateOutput(filePath, content);
  }

  if (issues.some((x) => x === "file-missing" || x.startsWith("zip-invalid") || x.startsWith("blank-slide") || x.startsWith("slide-xml-invalid"))) {
    throw new Error("PPT file valid nahi bani. Thodi der baad try karo.");
  }

  const preview = {
    title: content.title,
    subtitle: content.subtitle,
    slides: content.slides.map((s) => ({
      slideNumber: s.slideNumber,
      title: s.title,
      layout: s.layout,
      content: s.content,
      hasChart: clean.charts === "Auto" && !!extractChartData(s),
      narrationScript: clean.narration ? s.narrationScript : "",
      autoAdvanceMs: getSlideAdvanceMs(s, clean, s.slideNumber - 1, content.slides.length),
    })),
  };

  const stat = fs.statSync(filePath);
  console.log(`[PPT] Premium generated ${fileName} | ${content.slides.length} slides | ${Math.round(stat.size / 1024)} KB | theme=${clean.theme}`);

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