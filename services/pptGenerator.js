// ============================================================
// services/pptGenerator.js
// PRO AI PPT GENERATOR — STABLE / CORRECTED VERSION
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");

const {
  geminiGenerate,
  extractJSON,
} = require("../config/geminiClient");

const {
  keyManager,
} = require("../config/geminiKeys");

const {
  getTheme,
  THEMES,
  GRID,
} = require("./pptThemes");

// ============================================================
// CONFIG
// ============================================================

const PPT_DIR = path.join(
  __dirname,
  "..",
  "uploads",
  "ppt"
);

const TTL_HOURS = (() => {
  const value = parseInt(
    process.env.PPT_FILE_TTL_HOURS || "72",
    10
  );

  return Number.isFinite(value) && value > 0
    ? value
    : 72;
})();

const MIN_SLIDES = 5;
const MAX_SLIDES = 20;

const MAX_TOPIC_LEN = 300;

const DEVANAGARI_FONT = "Nirmala UI";

const LANGUAGES = [
  "English",
  "Hindi",
  "Bilingual",
];

const TYPES = [
  "Student",
  "Professional",
  "Educational",
  "Interview",
  "General",
];

const THEME_NAMES = Object.keys(THEMES || {});

const LAYOUT_STYLES = [
  "AI Auto",
  "Professional",
  "Visual",
  "Academic",
];

const TRANSITION_MODES = [
  "Off",
  "Subtle",
  "Dynamic",
];

const ANIMATION_MODES = [
  "Off",
  "Subtle",
  "Professional",
];

const CHART_MODES = [
  "Auto",
  "Off",
];

const NARRATION_MODES = [
  "Off",
  "On",
];

const KNOWN_LAYOUTS = [
  "title",
  "bullets",
  "twoColumn",
  "threeCards",
  "comparison",
  "timeline",
  "process",
  "stats",
  "quote",
  "imageText",
  "fullImage",
  "flow",
  "summary",
  "thanks",
];

const CHUNK_SIZE = 8;

const CONTENT_MAX_BULLETS = 6;

const BULLET_MAX_LEN = 160;

// ============================================================
// JSON REPAIR
// ============================================================

function repairTruncatedJson(text) {
  try {
    let inString = false;
    let escaped = false;

    const stack = [];

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (
          stack.length &&
          stack[stack.length - 1] === char
        ) {
          stack.pop();
        } else {
          return null;
        }
      }
    }

    let output = text;

    if (inString) {
      output += '"';
    }

    // Remove trailing comma before closing object/array.
    output = output.replace(
      /,\s*$/,
      ""
    );

    while (stack.length) {
      output += stack.pop();
    }

    return output;
  } catch {
    return null;
  }
}

function parseAIJson(text) {
  if (!text) {
    return null;
  }

  // First try project helper.
  try {
    const direct = extractJSON(text);

    if (
      direct &&
      typeof direct === "object"
    ) {
      return direct;
    }
  } catch {
    // Continue with fallback parser.
  }

  let value = String(text);

  const start = value.indexOf("{");

  if (start === -1) {
    return null;
  }

  value = value.slice(start);

  try {
    return JSON.parse(value);
  } catch {
    // Continue.
  }

  const repaired = repairTruncatedJson(value);

  if (!repaired) {
    return null;
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

// ============================================================
// VALIDATION
// ============================================================

function pick(value, allowed, fallback) {
  const normalized = String(value || "");

  return allowed.includes(normalized)
    ? normalized
    : fallback;
}

function validatePPTOptions(opts = {}) {
  const errors = [];

  const topic = String(
    opts.topic || ""
  ).trim();

  if (!topic) {
    errors.push("Topic required hai");
  }

  if (topic.length > MAX_TOPIC_LEN) {
    errors.push(
      `Topic max ${MAX_TOPIC_LEN} characters`
    );
  }

  const slides = parseInt(
    opts.slides,
    10
  );

  if (
    !Number.isFinite(slides) ||
    slides < MIN_SLIDES ||
    slides > MAX_SLIDES
  ) {
    errors.push(
      `Slides ${MIN_SLIDES}-${MAX_SLIDES} ke beech hone chahiye`
    );
  }

  const language = String(
    opts.language || "English"
  );

  if (!LANGUAGES.includes(language)) {
    errors.push("Invalid language");
  }

  const type = String(
    opts.type || "General"
  );

  if (!TYPES.includes(type)) {
    errors.push("Invalid presentation type");
  }

  const theme = String(
    opts.theme || "Modern"
  );

  if (!THEMES || !THEMES[theme]) {
    errors.push("Invalid theme");
  }

  return {
    errors,

    clean: {
      topic,

      slides: Number.isFinite(slides)
        ? Math.min(
            Math.max(
              slides,
              MIN_SLIDES
            ),
            MAX_SLIDES
          )
        : 10,

      language,
      type,
      theme,

      addImages: !!opts.addImages,

      speakerNotes:
        opts.speakerNotes !== false,

      layoutStyle: pick(
        opts.layoutStyle,
        LAYOUT_STYLES,
        "AI Auto"
      ),

      transitions: pick(
        opts.transitions,
        TRANSITION_MODES,
        "Subtle"
      ),

      animations: pick(
        opts.animations,
        ANIMATION_MODES,
        "Subtle"
      ),

      charts: pick(
        opts.charts,
        CHART_MODES,
        "Auto"
      ),

      narration:
        opts.narration === "On" ||
        opts.narration === true,
    },
  };
}

// ============================================================
// LAYOUT BIAS
// ============================================================

function layoutBiasHint(layoutStyle) {
  switch (layoutStyle) {
    case "Professional":
      return (
        "Prefer bullets, twoColumn, threeCards and stats. " +
        "Use clean corporate layouts. Avoid fullImage."
      );

    case "Visual":
      return (
        "Prefer imageText, fullImage, flow, timeline, " +
        "stats and threeCards. Minimize plain bullet slides."
      );

    case "Academic":
      return (
        "Prefer bullets, twoColumn, quote, timeline and summary."
      );

    default:
      return (
        "Choose the best layout for every slide. " +
        "Never use the same layout twice in a row."
      );
  }
}

// ============================================================
// AI PROMPT
// ============================================================

function buildChunkPrompt(
  cfg,
  chunkNo,
  totalChunks,
  startNo,
  count,
  mainTitle
) {
  let languageRule;

  if (cfg.language === "English") {
    languageRule =
      "ALL text must be in English.";
  } else if (cfg.language === "Hindi") {
    languageRule =
      "ALL text must be in proper Hindi using Devanagari script. Do NOT use Roman Hindi.";
  } else {
    languageRule =
      'Bilingual: each bullet should be "English | Hindi". Titles should also use "English | Hindi".';
  }

  const firstSlideRule =
    chunkNo === 1
      ? 'The first slide MUST use layout "title".'
      : "";

  return `
You are an expert presentation designer.

Create a ${cfg.type} presentation.

Topic:
"${cfg.topic}"

${languageRule}

${
  mainTitle
    ? `Main presentation title: "${mainTitle}"`
    : ""
}

${layoutBiasHint(cfg.layoutStyle)}

${firstSlideRule}

This is content chunk ${chunkNo} of ${totalChunks}.
Slides ${startNo} to ${startNo + count - 1}.

Structure the topic progressively:
introduction -> main concepts -> examples -> explanation -> summary.

Avoid repeated information.

Available layouts:

title
bullets
twoColumn
threeCards
comparison
timeline
process
stats
quote
imageText
fullImage
flow
summary
thanks

Layout rules:

- stats = only when real numeric data exists.
- timeline = chronological information.
- process = step-by-step process.
- flow = workflow / logical flow.
- comparison = comparing two things.
- quote = one memorable quote + attribution.
- imageText = meaningful visual + text.
- fullImage = highly visual slide.
- summary = conclusion.
- thanks = final thank-you slide.

Content rules:

1. Each slide must have 3-${CONTENT_MAX_BULLETS} short bullets.
2. Each bullet should ideally be under 14 words.
3. Never write long paragraphs.
4. slideNumber starts at ${startNo}.
5. slideNumber increments sequentially.
6. imagePrompt must be short English visual description.
7. imagePrompt should be empty when visual image is unnecessary.
8. speakerNotes = 1-2 sentences describing what the presenter should say.
9. narrationScript = 2-3 natural spoken sentences.
10. ${
    cfg.narration
      ? "Narration is enabled."
      : 'Narration is disabled, so narrationScript should be "".'
  }
11. ${
    cfg.addImages
      ? "Use imagePrompt where useful."
      : 'Every imagePrompt must be "".'
  }

Return ONLY valid JSON.

JSON:

{
  "title": "Presentation Title",
  "subtitle": "Short subtitle",
  "slides": [
    {
      "slideNumber": ${startNo},
      "title": "Slide Title",
      "layout": "bullets",
      "content": [
        "Bullet 1",
        "Bullet 2",
        "Bullet 3"
      ],
      "imagePrompt": "",
      "speakerNotes": "",
      "narrationScript": ""
    }
  ]
}
`;
}

// ============================================================
// CHART DATA
// ============================================================

function extractChartData(slide) {
  const items = [];

  for (const item of slide.content || []) {
    const text = String(item).trim();

    const match = text.match(
      /^(.{1,40}?)\s*(?::|-|–)\s*(\d+(?:\.\d+)?)\s*%?\s*$/
    );

    if (!match) {
      continue;
    }

    items.push({
      label: match[1].trim(),
      value: parseFloat(match[2]),
    });
  }

  if (
    items.length >= 2 &&
    items.length <= 6
  ) {
    return items;
  }

  return null;
}

// ============================================================
// HEURISTIC LAYOUT
// ============================================================

function heuristicLayout(slide, cfg) {
  const title = String(
    slide.title || ""
  );

  const content = slide.content || [];

  const text =
    `${title} ${content.join(" ")}`;

  if (
    extractChartData(slide) &&
    cfg.charts === "Auto"
  ) {
    return "stats";
  }

  if (
    /thank|धन्यवाद/i.test(title)
  ) {
    return "thanks";
  }

  if (
    /summary|निष्कर्ष|conclusion/i.test(
      title
    )
  ) {
    return "summary";
  }

  if (
    /\bvs\.?\b|versus|तुलना/i.test(
      title
    ) &&
    content.length >= 4
  ) {
    return "comparison";
  }

  if (
    /timeline|history|historical|chronolog|इतिहास|क्रम/i.test(
      text
    )
  ) {
    return "timeline";
  }

  if (
    /step|process|how to|कैसे|प्रक्रिया/i.test(
      text
    )
  ) {
    return "process";
  }

  if (
    /^(["“'])/.test(
      content[0] || ""
    )
  ) {
    return "quote";
  }

  if (content.length >= 5) {
    return "twoColumn";
  }

  return "bullets";
}

function normalizeLayout(
  layout,
  slide,
  cfg
) {
  const value = String(
    layout || ""
  ).trim();

  if (
    KNOWN_LAYOUTS.includes(value)
  ) {
    return value;
  }

  return heuristicLayout(
    slide,
    cfg
  );
}

// ============================================================
// NORMALIZE SLIDE
// ============================================================

function normalizeSlide(
  raw,
  expectedNo,
  cfg
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const title = String(
    raw.title || ""
  ).trim();

  if (!title) {
    return null;
  }

  let content = Array.isArray(
    raw.content
  )
    ? raw.content
    : [];

  content = content
    .map((item) =>
      String(item || "").trim()
    )
    .filter(Boolean)
    .map((item) =>
      item.length > BULLET_MAX_LEN
        ? item.slice(
            0,
            BULLET_MAX_LEN - 1
          ) + "…"
        : item
    )
    .slice(
      0,
      CONTENT_MAX_BULLETS
    );

  if (!content.length) {
    return null;
  }

  const slide = {
    slideNumber:
      Number.isInteger(
        raw.slideNumber
      )
        ? raw.slideNumber
        : expectedNo,

    title: title.slice(0, 120),

    content,

    imagePrompt: String(
      raw.imagePrompt || ""
    )
      .trim()
      .slice(0, 200),

    speakerNotes: String(
      raw.speakerNotes || ""
    )
      .trim()
      .slice(0, 300),

    narrationScript: String(
      raw.narrationScript || ""
    )
      .trim()
      .slice(0, 500),
  };

  slide.layout = normalizeLayout(
    raw.layout,
    slide,
    cfg
  );

  return slide;
}

// ============================================================
// AI CHUNK CALL
// ============================================================

async function callAIChunk(
  cfg,
  chunkNo,
  totalChunks,
  startNo,
  count,
  mainTitle,
  tryNo = 1
) {
  const prompt = buildChunkPrompt(
    cfg,
    chunkNo,
    totalChunks,
    startNo,
    count,
    mainTitle
  );

  const extraHint =
    tryNo > 1
      ? `
Previous response was invalid.
Return ONLY a valid non-empty JSON object.
`
      : "";

  const text = await geminiGenerate(
    prompt + extraHint,
    45000
  );

  const parsed = parseAIJson(
    text
  );

  if (!parsed) {
    if (
      tryNo < 2 &&
      !keyManager.isQuotaExhausted()
    ) {
      console.log(
        `📊 [PPT] Chunk ${chunkNo} invalid JSON - retry`
      );

      return callAIChunk(
        cfg,
        chunkNo,
        totalChunks,
        startNo,
        count,
        mainTitle,
        tryNo + 1
      );
    }

    return null;
  }

  const rawSlides =
    Array.isArray(parsed.slides)
      ? parsed.slides
      : [];

  const slides = rawSlides
    .map((slide, index) =>
      normalizeSlide(
        slide,
        startNo + index,
        cfg
      )
    )
    .filter(Boolean);

  return {
    title: String(
      parsed.title || ""
    )
      .trim()
      .slice(0, 120),

    subtitle: String(
      parsed.subtitle || ""
    )
      .trim()
      .slice(0, 160),

    slides,
  };
}

// ============================================================
// PAD SLIDES
// ============================================================

function padSlides(
  slides,
  cfg,
  title
) {
  let number = slides.length
    ? slides[
        slides.length - 1
      ].slideNumber
    : 0;

  while (
    slides.length < cfg.slides
  ) {
    number++;

    const isLast =
      slides.length + 1 ===
      cfg.slides;

    let slideTitle;
    let slideContent;

    if (cfg.language === "Hindi") {
      slideTitle = isLast
        ? "निष्कर्ष"
        : `${title} (जारी)`;

      slideContent = [
        "मुख्य बिंदु",
        "महत्वपूर्ण उदाहरण",
        "निष्कर्ष",
      ];
    } else if (
      cfg.language === "Bilingual"
    ) {
      slideTitle = isLast
        ? "Summary | निष्कर्ष"
        : `${title} | जारी`;

      slideContent = [
        "Key point | मुख्य बिंदु",
        "Important example | महत्वपूर्ण उदाहरण",
        "Conclusion | निष्कर्ष",
      ];
    } else {
      slideTitle = isLast
        ? "Summary"
        : `${title} (continued)`;

      slideContent = [
        "Key point",
        "Important example",
        "Conclusion",
      ];
    }

    slides.push({
      slideNumber: number,

      title: slideTitle,

      layout: isLast
        ? "summary"
        : "bullets",

      content: slideContent,

      imagePrompt: "",

      speakerNotes: "",

      narrationScript: "",
    });
  }

  return slides;
}

// ============================================================
// LAYOUT VARIETY
// ============================================================

function enforceVariety(
  slides,
  cfg
) {
  if (
    cfg.layoutStyle !== "AI Auto"
  ) {
    return slides;
  }

  for (
    let i = 1;
    i < slides.length - 1;
    i++
  ) {
    if (
      slides[i].layout ===
        slides[i - 1].layout &&
      slides[i].layout ===
        slides[i + 1].layout
    ) {
      if (
        slides[i].layout ===
        "bullets"
      ) {
        slides[i].layout =
          "threeCards";
      } else if (
        slides[i].layout ===
        "twoColumn"
      ) {
        slides[i].layout =
          "bullets";
      } else {
        slides[i].layout =
          "bullets";
      }
    }
  }

  return slides;
}

// ============================================================
// GENERATE CONTENT
// ============================================================

async function generatePPTContent(
  cfg
) {
  const chunks = [];

  let made = 0;

  while (
    made < cfg.slides
  ) {
    const count = Math.min(
      CHUNK_SIZE,
      cfg.slides - made
    );

    chunks.push(count);

    made += count;
  }

  let mainTitle = "";
  let subtitle = "";

  const slides = [];

  for (
    let index = 0;
    index < chunks.length;
    index++
  ) {
    if (
      keyManager.isQuotaExhausted()
    ) {
      break;
    }

    const startNo =
      slides.length + 1;

    const result =
      await callAIChunk(
        cfg,
        index + 1,
        chunks.length,
        startNo,
        chunks[index],
        mainTitle
      );

    if (result) {
      if (
        !mainTitle &&
        result.title
      ) {
        mainTitle =
          result.title;
      }

      if (
        !subtitle &&
        result.subtitle
      ) {
        subtitle =
          result.subtitle;
      }

      slides.push(
        ...result.slides
      );

      console.log(
        `📊 [PPT] Chunk ${
          index + 1
        }/${chunks.length}: +${
          result.slides.length
        } -> ${slides.length}`
      );
    } else {
      console.log(
        `📊 [PPT] Chunk ${
          index + 1
        } failed - continuing`
      );
    }
  }

  if (!slides.length) {
    throw new Error(
      "AI se presentation content nahi ban paya. Quota/model issue ho sakta hai."
    );
  }

  // First slide = title
  slides[0].layout =
    "title";

  // Last slide = summary/thanks
  const last =
    slides[slides.length - 1];

  if (
    last.layout !== "thanks" &&
    last.layout !== "summary"
  ) {
    last.layout = "summary";
  }

  const finalSlides =
    enforceVariety(
      padSlides(
        slides,
        cfg,
        mainTitle || cfg.topic
      ),
      cfg
    ).slice(
      0,
      cfg.slides
    );

  finalSlides.forEach(
    (slide, index) => {
      slide.slideNumber =
        index + 1;
    }
  );

  return {
    title:
      mainTitle || cfg.topic,

    subtitle,

    slides: finalSlides,
  };
}

// ============================================================
// IMAGE FETCH
// ============================================================

function fetchSlideImage(
  prompt
) {
  return new Promise(
    (resolve) => {
      try {
        const safePrompt =
          encodeURIComponent(
            String(prompt)
              .slice(0, 300)
          );

        const url =
          `https://image.pollinations.ai/prompt/${safePrompt}` +
          `?width=832&height=512&nologo=true`;

        const request =
          https.get(
            url,
            {
              timeout: 15000,
              headers: {
                "User-Agent":
                  "AI-PPT-Generator/1.0",
              },
            },
            (response) => {
              if (
                response.statusCode !==
                200
              ) {
                response.resume();
                resolve(null);
                return;
              }

              const chunks = [];

              response.on(
                "data",
                (chunk) => {
                  chunks.push(chunk);
                }
              );

              response.on(
                "end",
                () => {
                  const buffer =
                    Buffer.concat(
                      chunks
                    );

                  resolve(
                    buffer.length > 1000
                      ? buffer
                      : null
                  );
                }
              );
            }
          );

        request.on(
          "timeout",
          () => {
            request.destroy();
            resolve(null);
          }
        );

        request.on(
          "error",
          () => {
            resolve(null);
          }
        );
      } catch {
        resolve(null);
      }
    }
  );
}

// ============================================================
// FILE NAME
// ============================================================

function makeFileName(
  userId,
  title
) {
  const safeUserId =
    String(userId || "user")
      .replace(
        /[^A-Za-z0-9]/g,
        ""
      );

  const random =
    crypto
      .randomBytes(3)
      .toString("hex");

  return (
    `ppt-${safeUserId}-` +
    `${Date.now()}-` +
    `${random}.pptx`
  );
}

function isSafeFileName(
  fileName
) {
  if (
    typeof fileName !==
    "string"
  ) {
    return false;
  }

  if (
    !/^ppt-[A-Za-z0-9]+-\d{13}-[a-f0-9]{6}\.pptx$/.test(
      fileName
    )
  ) {
    return false;
  }

  const resolved =
    path.resolve(
      PPT_DIR,
      fileName
    );

  return resolved.startsWith(
    PPT_DIR + path.sep
  );
}

// ============================================================
// CLEAN OLD FILES
// ============================================================

async function cleanOldPPTFiles() {
  try {
    if (
      !fs.existsSync(PPT_DIR)
    ) {
      return;
    }

    const cutoff =
      Date.now() -
      TTL_HOURS *
        60 *
        60 *
        1000;

    const files =
      await fs.promises.readdir(
        PPT_DIR
      );

    let removed = 0;

    for (const file of files) {
      if (
        !file.toLowerCase().endsWith(
          ".pptx"
        )
      ) {
        continue;
      }

      const fullPath =
        path.join(
          PPT_DIR,
          file
        );

      try {
        const stat =
          await fs.promises.stat(
            fullPath
          );

        if (
          stat.mtimeMs <
          cutoff
        ) {
          await fs.promises.unlink(
            fullPath
          );

          removed++;
        }
      } catch {
        // Ignore individual file errors.
      }
    }

    if (removed) {
      console.log(
        `🧹 [PPT] ${removed} old files removed`
      );
    }
  } catch (error) {
    console.log(
      "🧹 [PPT] cleanup failed:",
      error.message
    );
  }
}

// ============================================================
// XML HELPERS
// ============================================================

function transitionXML(
  mode,
  slideIndex
) {
  if (mode === "Off") {
    return "";
  }

  if (mode === "Dynamic") {
    if (slideIndex % 2 === 0) {
      return (
        '<p:transition spd="med">' +
        '<p:push dir="l"/>' +
        "</p:transition>"
      );
    }

    return (
      '<p:transition spd="med">' +
      "<p:fade/>" +
      "</p:transition>"
    );
  }

  return (
    '<p:transition spd="med">' +
    "<p:fade/>" +
    "</p:transition>"
  );
}

function escapeXml(value) {
  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&apos;"
    );
}

// ============================================================
// SAFE SIMPLE ANIMATION XML
// ============================================================

function buildTimingXML(
  shapeIds
) {
  if (
    !Array.isArray(shapeIds) ||
    !shapeIds.length
  ) {
    return "";
  }

  const animations =
    shapeIds
      .slice(0, 6)
      .map(
        (shapeId, index) => {
          const base =
            10 +
            index * 5;

          const cTn1 = base;
          const cTn2 = base + 1;
          const cTn3 = base + 2;
          const cTn4 = base + 3;
          const cTn5 = base + 4;

          const delay =
            index === 0
              ? "indefinite"
              : "300";

          const nodeType =
            index === 0
              ? "clickEffect"
              : "afterEffect";

          return `
<p:par>
  <p:cTn
    id="${cTn1}"
    fill="hold"
  >
    <p:stCondLst>
      <p:cond delay="${delay}"/>
    </p:stCondLst>

    <p:childTnLst>
      <p:par>
        <p:cTn
          id="${cTn2}"
          fill="hold"
        >
          <p:stCondLst>
            <p:cond delay="0"/>
          </p:stCondLst>

          <p:childTnLst>
            <p:par>
              <p:cTn
                id="${cTn3}"
                presetID="10"
                presetClass="entr"
                presetSubtype="0"
                fill="hold"
                nodeType="${nodeType}"
              >
                <p:stCondLst>
                  <p:cond delay="0"/>
                </p:stCondLst>

                <p:childTnLst>
                  <p:set>
                    <p:cBhvr>
                      <p:cTn
                        id="${cTn4}"
                        dur="1"
                        fill="hold"
                      >
                        <p:stCondLst>
                          <p:cond delay="0"/>
                        </p:stCondLst>
                      </p:cTn>

                      <p:tgtEl>
                        <p:spTgt
                          spid="${escapeXml(
                            shapeId
                          )}"
                        />
                      </p:tgtEl>

                      <p:attrNameLst>
                        <p:attrName>
                          style.visibility
                        </p:attrName>
                      </p:attrNameLst>
                    </p:cBhvr>

                    <p:to>
                      <p:strVal val="visible"/>
                    </p:to>
                  </p:set>

                  <p:animEffect
                    transition="in"
                    filter="fade"
                  >
                    <p:cBhvr>
                      <p:cTn
                        id="${cTn5}"
                        dur="500"
                      />

                      <p:tgtEl>
                        <p:spTgt
                          spid="${escapeXml(
                            shapeId
                          )}"
                        />
                      </p:tgtEl>
                    </p:cBhvr>
                  </p:animEffect>
                </p:childTnLst>
              </p:cTn>
            </p:par>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:childTnLst>
  </p:cTn>
</p:par>
`;
        }
      )
      .join("");

  return `
<p:timing>
  <p:tnLst>
    <p:par>
      <p:cTn
        id="1"
        dur="indefinite"
        restart="never"
        nodeType="tmRoot"
      >
        <p:childTnLst>
          <p:seq
            concurrent="1"
            nextAc="seek"
          >
            <p:cTn
              id="2"
              dur="indefinite"
              nodeType="mainSeq"
            >
              <p:childTnLst>
                ${animations}
              </p:childTnLst>
            </p:cTn>

            <p:prevCondLst>
              <p:cond
                evt="onPrev"
                delay="0"
              >
                <p:tgtEl>
                  <p:sldTgt/>
                </p:tgtEl>
              </p:cond>
            </p:prevCondLst>

            <p:nextCondLst>
              <p:cond
                evt="onNext"
                delay="0"
              >
                <p:tgtEl>
                  <p:sldTgt/>
                </p:tgtEl>
              </p:cond>
            </p:nextCondLst>
          </p:seq>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
</p:timing>
`;
}

// ============================================================
// POST PROCESS PPTX
// ============================================================

async function postProcessPPTX(
  filePath,
  options
) {
  const {
    transitions,
    animations,
  } = options;

  const needTransitions =
    transitions !== "Off";

  const needAnimations =
    animations !== "Off";

  if (
    !needTransitions &&
    !needAnimations
  ) {
    return;
  }

  const original =
    fs.readFileSync(
      filePath
    );

  const zip =
    await JSZip.loadAsync(
      original
    );

  const slideFiles =
    Object.keys(zip.files)
      .filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(
          name
        )
      )
      .sort(
        (a, b) => {
          const aNo =
            parseInt(
              a.match(
                /(\d+)/
              )[1],
              10
            );

          const bNo =
            parseInt(
              b.match(
                /(\d+)/
              )[1],
              10
            );

          return aNo - bNo;
        }
      );

  for (
    let index = 0;
    index < slideFiles.length;
    index++
  ) {
    const fileName =
      slideFiles[index];

    let xml =
      await zip
        .file(fileName)
        .async("string");

    // -----------------------------
    // Transition
    // -----------------------------

    if (
      needTransitions &&
      !xml.includes(
        "<p:transition"
      )
    ) {
      const transition =
        transitionXML(
          transitions,
          index
        );

      if (transition) {
        const closingTag =
          "</p:sld>";

        const position =
          xml.lastIndexOf(
            closingTag
          );

        if (position !== -1) {
          xml =
            xml.slice(
              0,
              position
            ) +
            transition +
            xml.slice(position);
        }
      }
    }

    // -----------------------------
    // Animation
    // -----------------------------

    if (
      needAnimations &&
      !xml.includes(
        "<p:timing"
      )
    ) {
      const shapeIds = [];

      const regex =
        /<p:cNvPr\s+id="(\d+)"\s+name="[^"]*"/g;

      let match;

      while (
        (match =
          regex.exec(xml)) !==
        null
      ) {
        const id =
          parseInt(
            match[1],
            10
          );

        if (
          Number.isFinite(id) &&
          id > 1
        ) {
          shapeIds.push(id);
        }

        if (
          shapeIds.length >= 6
        ) {
          break;
        }
      }

      if (shapeIds.length) {
        const timing =
          buildTimingXML(
            shapeIds
          );

        const closingTag =
          "</p:sld>";

        const position =
          xml.lastIndexOf(
            closingTag
          );

        if (position !== -1) {
          xml =
            xml.slice(
              0,
              position
            ) +
            timing +
            xml.slice(position);
        }
      }
    }

    zip.file(
      fileName,
      xml
    );
  }

  const output =
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

  fs.writeFileSync(
    filePath,
    output
  );
}

// ============================================================
// QUALITY CONTROL
// ============================================================

async function validateOutput(
  filePath,
  content,
  cfg
) {
  const issues = [];

  if (
    !fs.existsSync(filePath)
  ) {
    issues.push(
      "file-missing"
    );

    return issues;
  }

  let stat;

  try {
    stat =
      fs.statSync(
        filePath
      );
  } catch {
    issues.push(
      "file-stat-failed"
    );

    return issues;
  }

  if (
    stat.size <
    10 * 1024
  ) {
    issues.push(
      "file-too-small"
    );
  }

  try {
    const buffer =
      fs.readFileSync(
        filePath
      );

    const zip =
      await JSZip.loadAsync(
        buffer
      );

    const slideFiles =
      Object.keys(zip.files)
        .filter((name) =>
          /^ppt\/slides\/slide\d+\.xml$/.test(
            name
          )
        );

    if (
      slideFiles.length !==
      content.slides.length
    ) {
      issues.push(
        "slide-count-mismatch"
      );
    }

    const emptySlides =
      content.slides.filter(
        (slide) =>
          !slide.title ||
          !Array.isArray(
            slide.content
          ) ||
          !slide.content.length
      ).length;

    if (emptySlides) {
      issues.push(
        `${emptySlides}-empty-slides`
      );
    }
  } catch (error) {
    issues.push(
      "zip-invalid: " +
        String(
          error.message || ""
        ).slice(0, 100)
    );
  }

  if (issues.length) {
    console.warn(
      `📊 [PPT] QC warnings: ${issues.join(
        ", "
      )}`
    );
  }

  return issues;
}

// ============================================================
// PPT CREATION
// ============================================================

function buildPPTX(
  content,
  cfg
) {
  const theme =
    getTheme(cfg.theme);

  const isHindiText =
    cfg.language !== "English";

  const HFONT =
    isHindiText
      ? DEVANAGARI_FONT
      : theme.fontPair.heading;

  const BFONT =
    isHindiText
      ? DEVANAGARI_FONT
      : theme.fontPair.body;

  const M = GRID;

  const pres =
    new PptxGenJS();

  pres.layout =
    "LAYOUT_16x9";

  pres.author =
    "AI PPT Generator";

  pres.title =
    content.title;

  pres.subject =
    content.title;

  pres.company =
    "AI Interview";

  pres.lang =
    cfg.language === "Hindi"
      ? "hi-IN"
      : "en-US";

  const imageQueue = [];

  // ==========================================================
  // NEW SLIDE
  // ==========================================================

  function newSlide() {
    const slide =
      pres.addSlide();

    slide.background = {
      color: theme.bg,
    };

    return slide;
  }

  // ==========================================================
  // HEADER
  // ==========================================================

  function headerBar(
    slide,
    title
  ) {
    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: 0,
        w: 10,
        h: M.headerH,

        fill: {
          color:
            theme.headerBg,
        },

        line: {
          color:
            theme.headerBg,
          transparency: 100,
        },
      }
    );

    slide.addText(
      title,
      {
        x: M.marginX,
        y: 0.04,
        w: 9.5,
        h:
          M.headerH -
          0.08,

        fontSize:
          theme.headingSize *
          0.8,

        bold: true,

        color:
          theme.headerText,

        fontFace:
          HFONT,

        valign:
          "mid",
      }
    );
  }

  // ==========================================================
  // FOOTER
  // ==========================================================

  function footer(
    slide,
    number
  ) {
    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: M.footerY,
        w: 10,
        h: 0.05,

        fill: {
          color:
            theme.accent,
        },

        line: {
          color:
            theme.accent,
          transparency: 100,
        },
      }
    );

    if (number) {
      slide.addText(
        String(number),
        {
          x: 9.3,
          y:
            M.footerY -
            0.32,

          w: 0.5,
          h: 0.3,

          fontSize: 10,

          color:
            theme.accent,

          fontFace:
            BFONT,

          align: "right",
        }
      );
    }
  }

  // ==========================================================
  // BULLETS
  // ==========================================================

  function bulletOptions(
    items
  ) {
    return items.map(
      (text) => ({
        text,

        options: {
          bullet: {
            code: "2022",
          },

          breakLine: true,
        },
      })
    );
  }

  function addBullets(
    slide,
    items,
    options = {}
  ) {
    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      return;
    }

    const maxLength =
      Math.max(
        ...items.map(
          (item) =>
            String(item)
              .length
        )
      );

    let fontSize =
      options.fontSize ||
      theme.bodySize;

    if (
      items.length > 5 ||
      maxLength > 110
    ) {
      fontSize =
        Math.max(
          fontSize - 3,
          12
        );
    }

    if (
      maxLength > 140
    ) {
      fontSize =
        Math.max(
          fontSize - 2,
          11
        );
    }

    slide.addText(
      bulletOptions(items),
      {
        x:
          options.x ??
          M.marginX + 0.15,

        y:
          options.y ??
          M.contentTop +
            0.15,

        w:
          options.w ??
          8.8,

        h:
          options.h ??
          M.contentH,

        fontSize,

        color:
          theme.bodyColor,

        fontFace:
          BFONT,

        valign: "top",

        breakLine: false,

        margin: 0.05,
      }
    );
  }

  // ==========================================================
  // CARD
  // ==========================================================

  function addCard(
    slide,
    x,
    y,
    w,
    h,
    text,
    options = {}
  ) {
    slide.addShape(
      pres.ShapeType.roundRect,
      {
        x,
        y,
        w,
        h,

        fill: {
          color:
            options.fill ||
            theme.panel,
        },

        line: {
          color:
            options.border ||
            theme.panelBorder,

          width: 1,
        },
      }
    );

    slide.addText(
      text,
      {
        x: x + 0.1,
        y: y + 0.08,

        w: w - 0.2,
        h: h - 0.16,

        fontSize:
          options.fontSize ||
          14,

        bold:
          !!options.bold,

        color:
          options.color ||
          theme.titleColor,

        fontFace:
          BFONT,

        align:
          options.align ||
          "left",

        valign:
          options.valign ||
          "mid",

        margin: 0.05,
      }
    );
  }

  // ==========================================================
  // NOTES
  // ==========================================================

  function addNotes(
    slide,
    slideData
  ) {
    let notes = "";

    if (
      cfg.speakerNotes &&
      slideData.speakerNotes
    ) {
      notes =
        slideData.speakerNotes;
    }

    if (
      cfg.narration &&
      slideData.narrationScript
    ) {
      notes +=
        `${notes ? "\n\n" : ""}` +
        `NARRATION: ${slideData.narrationScript}`;
    }

    if (notes) {
      try {
        slide.addNotes(
          notes
        );
      } catch {
        // Notes support can vary by pptxgenjs version.
      }
    }
  }

  // ==========================================================
  // IMAGE QUEUE
  // ==========================================================

  function queueImage(
    slide,
    slideData,
    place
  ) {
    if (
      !cfg.addImages ||
      !slideData.imagePrompt
    ) {
      return;
    }

    imageQueue.push({
      slide,
      prompt:
        slideData.imagePrompt,
      place,
    });
  }

  // ==========================================================
  // TITLE
  // ==========================================================

  function renderTitle(
    slide,
    slideData
  ) {
    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: 3.05,
        w: 10,
        h: 0.07,

        fill: {
          color:
            theme.accent,
        },

        line: {
          color:
            theme.accent,
          transparency: 100,
        },
      }
    );

    slide.addText(
      content.title,
      {
        x: M.marginX,
        y: 1.25,
        w: 8.8,
        h: 1.5,

        fontSize: 38,

        bold: true,

        color:
          theme.titleColor,

        fontFace:
          HFONT,

        valign: "mid",
      }
    );

    if (content.subtitle) {
      slide.addText(
        content.subtitle,
        {
          x: M.marginX,
          y: 3.6,
          w: 8.8,
          h: 0.7,

          fontSize: 19,

          color:
            theme.accent,

          fontFace:
            BFONT,
        }
      );
    }

    slide.addText(
      `${cfg.type} Presentation`,
      {
        x: M.marginX,
        y: 6.05,
        w: 5.5,
        h: 0.4,

        fontSize: 13,

        color:
          theme.bodyColor,

        fontFace:
          BFONT,
      }
    );

    queueImage(
      slide,
      slideData,
      {
        x: 6.6,
        y: 1.0,
        w: 3.0,
        h: 4.4,
      }
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // BULLETS
  // ==========================================================

  function renderBullets(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    addBullets(
      slide,
      slideData.content
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // TWO COLUMN
  // ==========================================================

  function renderTwoColumn(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const half =
      Math.ceil(
        slideData.content.length /
          2
      );

    addBullets(
      slide,
      slideData.content.slice(
        0,
        half
      ),
      {
        x: M.marginX,
        w: 4.4,
      }
    );

    addBullets(
      slide,
      slideData.content.slice(
        half
      ),
      {
        x: 5.1,
        w: 4.3,
      }
    );

    slide.addShape(
      pres.ShapeType.line,
      {
        x: 4.95,
        y: M.contentTop,
        w: 0,
        h: M.contentH,

        line: {
          color:
            theme.accent2,
          width: 1,
        },
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // THREE CARDS
  // ==========================================================

  function renderThreeCards(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const items =
      slideData.content.slice(
        0,
        3
      );

    const width = 2.9;

    const gap = 0.25;

    const startX =
      M.marginX + 0.05;

    items.forEach(
      (text, index) => {
        addCard(
          slide,

          startX +
            index *
              (width + gap),

          1.6,

          width,

          3.1,

          text,

          {
            fontSize: 15,

            valign:
              "top",
          }
        );
      }
    );

    if (
      slideData.content.length >
      3
    ) {
      slide.addText(
        bulletOptions(
          slideData.content.slice(
            3
          )
        ),
        {
          x: M.marginX,
          y: 4.85,
          w: 9,
          h: 0.8,

          fontSize: 12,

          color:
            theme.bodyColor,

          fontFace:
            BFONT,

          valign: "top",
        }
      );
    }

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // COMPARISON
  // ==========================================================

  function renderComparison(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const half =
      Math.ceil(
        slideData.content.length /
          2
      );

    const left =
      slideData.content.slice(
        0,
        half
      );

    const right =
      slideData.content.slice(
        half
      );

    slide.addShape(
      pres.ShapeType.roundRect,
      {
        x: 0.4,
        y: 1.3,
        w: 4.4,
        h: 3.9,

        fill: {
          color:
            theme.panel,
        },

        line: {
          color:
            theme.accent,
          width: 1,
        },
      }
    );

    slide.addShape(
      pres.ShapeType.roundRect,
      {
        x: 5.2,
        y: 1.3,
        w: 4.4,
        h: 3.9,

        fill: {
          color:
            theme.bg,
        },

        line: {
          color:
            theme.accent2,
          width: 1,
        },
      }
    );

    addBullets(
      slide,
      left,
      {
        x: 0.6,
        y: 1.5,
        w: 4.0,
        h: 3.5,
        fontSize: 14,
      }
    );

    addBullets(
      slide,
      right,
      {
        x: 5.4,
        y: 1.5,
        w: 4.0,
        h: 3.5,
        fontSize: 14,
      }
    );

    slide.addText(
      "A",
      {
        x: 0.55,
        y: 5.25,
        w: 0.4,
        h: 0.3,

        fontSize: 14,

        bold: true,

        color:
          theme.accent,

        fontFace:
          HFONT,
      }
    );

    slide.addText(
      "B",
      {
        x: 5.35,
        y: 5.25,
        w: 0.4,
        h: 0.3,

        fontSize: 14,

        bold: true,

        color:
          theme.accent2,

        fontFace:
          HFONT,
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // TIMELINE
  // ==========================================================

  function renderTimeline(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const items =
      slideData.content.slice(
        0,
        5
      );

    const y = 3.1;

    slide.addShape(
      pres.ShapeType.line,
      {
        x: 0.7,
        y,
        w: 8.6,
        h: 0,

        line: {
          color:
            theme.accent,
          width: 2,
        },
      }
    );

    items.forEach(
      (text, index) => {
        const x =
          items.length === 1
            ? 5
            : 0.9 +
              index *
                (8.2 /
                  (items.length -
                    1));

        slide.addShape(
          pres.ShapeType.ellipse,
          {
            x: x - 0.12,
            y: y - 0.12,
            w: 0.24,
            h: 0.24,

            fill: {
              color:
                index % 2
                  ? theme.accent2
                  : theme.accent,
            },

            line: {
              color:
                theme.bg,
              transparency: 100,
            },
          }
        );

        const above =
          index % 2 === 0;

        slide.addText(
          text,
          {
            x: Math.max(
              0.1,
              Math.min(
                x - 0.85,
                8.3
              )
            ),

            y: above
              ? y - 1.55
              : y + 0.25,

            w: 1.7,
            h: 1.3,

            fontSize: 11.5,

            color:
              theme.bodyColor,

            fontFace:
              BFONT,

            align: "center",

            valign: above
              ? "bottom"
              : "top",
          }
        );
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // PROCESS
  // ==========================================================

  function renderProcess(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const items =
      slideData.content.slice(
        0,
        4
      );

    const width = 2.05;
    const gap = 0.35;
    const y = 2.2;
    const height = 1.9;

    items.forEach(
      (text, index) => {
        const x =
          0.45 +
          index *
            (width + gap);

        slide.addShape(
          pres.ShapeType.chevron,
          {
            x,
            y,
            w: width,
            h: height,

            fill: {
              color:
                index % 2
                  ? theme.accent2
                  : theme.accent,
            },

            line: {
              color:
                index % 2
                  ? theme.accent2
                  : theme.accent,
              transparency: 100,
            },
          }
        );

        slide.addText(
          `Step ${index + 1}`,
          {
            x: x + 0.15,
            y: y + 0.12,
            w: width - 0.3,
            h: 0.35,

            fontSize: 12,

            bold: true,

            color: "FFFFFF",

            fontFace:
              HFONT,
          }
        );

        slide.addText(
          text,
          {
            x: x + 0.15,
            y: y + 0.5,
            w:
              width - 0.35,
            h:
              height - 0.65,

            fontSize: 11,

            color: "FFFFFF",

            fontFace:
              BFONT,

            valign: "top",
          }
        );
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // STATS / CHART
  // ==========================================================

  function renderStats(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const data =
      extractChartData(
        slideData
      );

    if (
      data &&
      cfg.charts === "Auto"
    ) {
      const chartType =
        data.length >= 4
          ? "bar"
          : "doughnut";

      try {
        // IMPORTANT:
        // Chart belongs to slide, not presentation.
        slide.addChart(
          chartType,
          [
            {
              name:
                slideData.title,

              labels:
                data.map(
                  (item) =>
                    item.label
                ),

              values:
                data.map(
                  (item) =>
                    item.value
                ),
            },
          ],
          {
            x: 0.5,
            y: 1.2,
            w: 5.4,
            h: 4.0,

            chartColors: [
              theme.accent,
              theme.accent2,
              "10B981",
              "F59E0B",
              "EF4444",
              "6366F1",
            ],

            showLegend:
              chartType ===
              "doughnut",

            legendPos: "b",

            showValue: true,

            showTitle: false,

            showCatName:
              false,

            showSerName:
              false,

            showPercent:
              chartType ===
              "doughnut",
          }
        );
      } catch (error) {
        console.warn(
          "📊 [PPT] Chart creation failed:",
          error.message
        );

        // If chart fails, use KPI cards.
        data
          .slice(0, 4)
          .forEach(
            (item, index) => {
              addCard(
                slide,

                0.5 +
                  index *
                    2.35,

                1.9,

                2.2,

                2.5,

                `${item.label}: ${item.value}`,

                {
                  fontSize: 14,
                  bold: true,
                  color:
                    theme.accent,
                  align:
                    "center",
                }
              );
            }
          );
      }

      data
        .slice(0, 3)
        .forEach(
          (item, index) => {
            addCard(
              slide,

              6.2,

              1.4 +
                index *
                  1.25,

              3.3,

              1.05,

              `${item.label}: ${item.value}`,

              {
                fontSize: 13,
                bold: true,
                color:
                  theme.accent,
                align:
                  "center",
              }
            );
          }
        );
    } else {
      const items =
        slideData.content.slice(
          0,
          4
        );

      items.forEach(
        (text, index) => {
          addCard(
            slide,

            0.5 +
              index *
                2.35,

            1.9,

            2.2,

            2.5,

            text,

            {
              fontSize: 14,
              bold: true,
              color:
                theme.accent,
              align:
                "center",
            }
          );
        }
      );
    }

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // QUOTE
  // ==========================================================

  function renderQuote(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const quote =
      slideData.content[0] ||
      "";

    const attribution =
      slideData.content[1] ||
      "";

    slide.addText(
      "“",
      {
        x: 0.4,
        y: 0.9,
        w: 1.2,
        h: 1.4,

        fontSize: 90,

        bold: true,

        color:
          theme.accent,

        fontFace:
          HFONT,
      }
    );

    slide.addText(
      quote,
      {
        x: 1.3,
        y: 1.7,
        w: 7.4,
        h: 2.2,

        fontSize: 22,

        italic: true,

        color:
          theme.titleColor,

        fontFace:
          HFONT,

        valign:
          "mid",

        align:
          "center",
      }
    );

    if (attribution) {
      slide.addText(
        `— ${attribution}`,
        {
          x: 1.3,
          y: 4.1,
          w: 7.4,
          h: 0.5,

          fontSize: 14,

          color:
            theme.accent,

          fontFace:
            BFONT,

          align:
            "center",
        }
      );
    }

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // IMAGE + TEXT
  // ==========================================================

  function renderImageText(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    slide.addShape(
      pres.ShapeType.roundRect,
      {
        x: 0.4,
        y: 1.3,
        w: 4.3,
        h: 3.6,

        fill: {
          color:
            theme.panel,
        },

        line: {
          color:
            theme.panelBorder,
          width: 1,
        },
      }
    );

    slide.addText(
      "IMAGE",
      {
        x: 1.4,
        y: 2.7,
        w: 2.3,
        h: 0.5,

        fontSize: 18,

        bold: true,

        color:
          theme.panelBorder,

        fontFace:
          HFONT,

        align:
          "center",
      }
    );

    queueImage(
      slide,
      slideData,
      {
        x: 0.4,
        y: 1.3,
        w: 4.3,
        h: 3.6,
      }
    );

    addBullets(
      slide,
      slideData.content,
      {
        x: 5.0,
        w: 4.4,
        fontSize: 14,
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // FULL IMAGE
  // ==========================================================

  function renderFullImage(
    slide,
    slideData
  ) {
    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: 0,
        w: 10,
        h: 5.625,

        fill: {
          color:
            theme.panel,
        },

        line: {
          color:
            theme.panel,
          transparency: 100,
        },
      }
    );

    queueImage(
      slide,
      slideData,
      {
        x: 0,
        y: 0,
        w: 10,
        h: 5.625,
        full: true,
      }
    );

    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: 4.4,
        w: 10,
        h: 1.225,

        fill: {
          color:
            "000000",
          transparency: 35,
        },

        line: {
          color:
            "000000",
          transparency: 100,
        },
      }
    );

    slide.addText(
      slideData.title,
      {
        x: M.marginX,
        y: 4.45,
        w: 9.4,
        h: 1.0,

        fontSize: 24,

        bold: true,

        color: "FFFFFF",

        fontFace:
          HFONT,

        valign:
          "mid",
      }
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // FLOW
  // ==========================================================

  function renderFlow(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    const items =
      slideData.content.slice(
        0,
        4
      );

    const boxW = 3.1;
    const boxH = 1.2;

    items.forEach(
      (text, index) => {
        const row =
          Math.floor(
            index / 2
          );

        const col =
          index % 2;

        const x =
          0.7 +
          col * 4.5;

        const y =
          1.5 +
          row * 1.9;

        addCard(
          slide,
          x,
          y,
          boxW,
          boxH,
          text,
          {
            fontSize: 12.5,
            align:
              "center",
          }
        );

        if (col === 0) {
          slide.addShape(
            pres.ShapeType.rightArrow,
            {
              x:
                x +
                boxW +
                0.15,

              y:
                y +
                boxH /
                  2 -
                0.18,

              w: 0.55,
              h: 0.36,

              fill: {
                color:
                  theme.accent2,
              },

              line: {
                color:
                  theme.accent2,
                transparency: 100,
              },
            }
          );
        }
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  function renderSummary(
    slide,
    slideData
  ) {
    headerBar(
      slide,
      slideData.title
    );

    addBullets(
      slide,
      slideData.content,
      {
        fontSize: 15,
      }
    );

    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y:
          M.contentTop -
          0.1,

        w: 0.12,

        h: M.contentH,

        fill: {
          color:
            theme.accent,
        },

        line: {
          color:
            theme.accent,
          transparency: 100,
        },
      }
    );

    footer(
      slide,
      slideData.slideNumber
    );

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // THANK YOU
  // ==========================================================

  function renderThanks(
    slide,
    slideData
  ) {
    let text;

    if (
      cfg.language === "Hindi"
    ) {
      text = "धन्यवाद!";
    } else if (
      cfg.language === "Bilingual"
    ) {
      text =
        "Thank You | धन्यवाद!";
    } else {
      text = "Thank You!";
    }

    slide.addText(
      text,
      {
        x: 1,
        y: 1.7,
        w: 8,
        h: 1.5,

        fontSize: 44,

        bold: true,

        color:
          theme.titleColor,

        fontFace:
          HFONT,

        align:
          "center",
      }
    );

    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 4,
        y: 3.3,
        w: 2,
        h: 0.07,

        fill: {
          color:
            theme.accent,
        },

        line: {
          color:
            theme.accent,
          transparency: 100,
        },
      }
    );

    if (
      slideData.content.length
    ) {
      slide.addText(
        slideData.content[0],
        {
          x: 1.5,
          y: 3.8,
          w: 7,
          h: 0.6,

          fontSize: 14,

          color:
            theme.bodyColor,

          fontFace:
            BFONT,

          align:
            "center",
        }
      );
    }

    addNotes(
      slide,
      slideData
    );
  }

  // ==========================================================
  // RENDERER MAP
  // ==========================================================

  const RENDERERS = {
    title: renderTitle,
    bullets: renderBullets,
    twoColumn: renderTwoColumn,
    threeCards: renderThreeCards,
    comparison: renderComparison,
    timeline: renderTimeline,
    process: renderProcess,
    stats: renderStats,
    quote: renderQuote,
    imageText: renderImageText,
    fullImage: renderFullImage,
    flow: renderFlow,
    summary: renderSummary,
    thanks: renderThanks,
  };

  // ==========================================================
  // CREATE SLIDES
  // ==========================================================

  content.slides.forEach(
    (slideData) => {
      const slide =
        newSlide();

      const renderer =
        RENDERERS[
          slideData.layout
        ] ||
        RENDERERS.bullets;

      renderer(
        slide,
        slideData
      );
    }
  );

  // ==========================================================
  // ASYNC IMAGES
  // ==========================================================

  return (async () => {
    await Promise.allSettled(
      imageQueue.map(
        async ({
          slide,
          prompt,
          place,
        }) => {
          try {
            const buffer =
              await fetchSlideImage(
                prompt
              );

            if (!buffer) {
              return;
            }

            const base64 =
              buffer.toString(
                "base64"
              );

            if (place.full) {
              slide.addImage({
                data:
                  `data:image/jpeg;base64,${base64}`,

                x: 0,
                y: 0,
                w: 10,
                h: 5.625,

                transparency: 0,
              });
            } else {
              slide.addImage({
                data:
                  `data:image/jpeg;base64,${base64}`,

                x: place.x,
                y: place.y,
                w: place.w,
                h: place.h,
              });
            }
          } catch (error) {
            console.warn(
              "📊 [PPT] Image failed:",
              error.message
            );
          }
        }
      )
    );

    return pres;
  })();
}

// ============================================================
// MAIN GENERATOR
// ============================================================

async function generatePPT(
  opts,
  userId
) {
  const {
    errors,
    clean,
  } = validatePPTOptions(
    opts
  );

  if (errors.length) {
    const error =
      new Error(
        errors.join(", ")
      );

    error.statusCode = 400;

    throw error;
  }

  await cleanOldPPTFiles();

  const content =
    await generatePPTContent(
      clean
    );

  const fileName =
    makeFileName(
      userId,
      content.title
    );

  const filePath =
    path.join(
      PPT_DIR,
      fileName
    );

  if (
    !fs.existsSync(
      PPT_DIR
    )
  ) {
    await fs.promises.mkdir(
      PPT_DIR,
      {
        recursive: true,
      }
    );
  }

  const presentation =
    await buildPPTX(
      content,
      clean
    );

  await presentation.writeFile({
    fileName: filePath,
  });

  // ==========================================================
  // OOXML EFFECTS
  // ==========================================================

  try {
    await postProcessPPTX(
      filePath,
      clean
    );
  } catch (error) {
    console.warn(
      "📊 [PPT] OOXML post-process failed. Original PPTX preserved:",
      error.message
    );
  }

  // ==========================================================
  // QC
  // ==========================================================

  const qcIssues =
    await validateOutput(
      filePath,
      content,
      clean
    );

  if (
    qcIssues.includes(
      "file-missing"
    ) ||
    qcIssues.some(
      (item) =>
        item.startsWith(
          "zip-invalid"
        )
    )
  ) {
    throw new Error(
      "PPT file valid nahi bani. Thodi der baad try karo."
    );
  }

  const stat =
    fs.statSync(
      filePath
    );

  console.log(
    `📊 [PPT] Generated: ${fileName} ` +
      `(${(
        stat.size / 1024
      ).toFixed(0)} KB, ` +
      `${content.slides.length} slides, ` +
      `transitions=${clean.transitions}, ` +
      `animations=${clean.animations}, ` +
      `narration=${clean.narration})`
  );

  // ==========================================================
  // PREVIEW
  // ==========================================================

  const preview = {
    title:
      content.title,

    subtitle:
      content.subtitle,

    slides:
      content.slides.map(
        (slide) => ({
          slideNumber:
            slide.slideNumber,

          title:
            slide.title,

          layout:
            slide.layout,

          content:
            slide.content,

          imagePrompt:
            clean.addImages
              ? slide.imagePrompt
              : "",

          hasChart:
            clean.charts ===
              "Auto" &&
            !!extractChartData(
              slide
            ),

          narrationScript:
            clean.narration
              ? slide.narrationScript
              : "",
        })
      ),
  };

  return {
    fileName,

    filePath,

    slideCount:
      content.slides.length,

    content,

    preview,

    cfg: clean,
  };
}

// ============================================================
// EXPORTS
// ============================================================

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
};