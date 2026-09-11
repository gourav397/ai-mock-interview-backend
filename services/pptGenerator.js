// ============================================================
// services/pptGenerator.js
// AI PPT GENERATOR — IMAGE SAFE / BLANK SLIDE FIXED
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
  const n = parseInt(
    process.env.PPT_FILE_TTL_HOURS || "72",
    10
  );

  return Number.isFinite(n) && n > 0 ? n : 72;
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
// JSON HELPERS
// ============================================================

function repairTruncatedJson(text) {
  try {
    let inString = false;
    let escaped = false;
    const stack = [];

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }

        continue;
      }

      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        stack.push("}");
      } else if (c === "[") {
        stack.push("]");
      } else if (c === "}" || c === "]") {
        if (stack[stack.length - 1] === c) {
          stack.pop();
        } else {
          return null;
        }
      }
    }

    let result = text;

    if (inString) {
      result += '"';
    }

    result = result.replace(/,\s*$/, "");

    while (stack.length) {
      result += stack.pop();
    }

    return result;
  } catch {
    return null;
  }
}

function parseAIJson(text) {
  if (!text) return null;

  try {
    const parsed = extractJSON(text);

    if (
      parsed &&
      typeof parsed === "object"
    ) {
      return parsed;
    }
  } catch {}

  let value = String(text);

  const firstObject = value.indexOf("{");

  if (firstObject === -1) {
    return null;
  }

  value = value.slice(firstObject);

  try {
    return JSON.parse(value);
  } catch {}

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
  const v = String(value || "");
  return allowed.includes(v) ? v : fallback;
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
    opts.theme ||
      THEME_NAMES[0] ||
      "Modern"
  );

  if (
    !THEMES ||
    !THEMES[theme]
  ) {
    errors.push("Invalid theme");
  }

  return {
    errors,

    clean: {
      topic,

      slides: Number.isFinite(slides)
        ? Math.min(
            MAX_SLIDES,
            Math.max(
              MIN_SLIDES,
              slides
            )
          )
        : 10,

      language,
      type,
      theme,

      addImages:
        opts.addImages === true ||
        opts.addImages === "true" ||
        opts.addImages === 1,

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
        opts.narration === true ||
        opts.narration === "On",
    },
  };
}

// ============================================================
// PROMPT
// ============================================================

function layoutHint(style) {
  if (style === "Professional") {
    return `
Prefer bullets, twoColumn, threeCards and stats.
Avoid fullImage unless absolutely necessary.
`;
  }

  if (style === "Visual") {
    return `
Prefer imageText, fullImage, timeline, process,
flow, stats and threeCards.
`;
  }

  if (style === "Academic") {
    return `
Prefer bullets, twoColumn, timeline,
quote and summary.
`;
  }

  return `
Use different layouts where appropriate.
Do not use the same layout repeatedly.
`;
}

function buildChunkPrompt(
  cfg,
  chunkNo,
  totalChunks,
  startNo,
  count,
  mainTitle
) {
  let languageRule =
    "ALL text must be in English.";

  if (cfg.language === "Hindi") {
    languageRule =
      "ALL text must be proper Hindi in Devanagari. Do NOT use Roman Hindi.";
  }

  if (cfg.language === "Bilingual") {
    languageRule =
      'Use bilingual text. Titles and bullets should use "English | Hindi".';
  }

  return `
You are an expert PowerPoint presentation designer.

Create a ${cfg.type} presentation.

TOPIC:
"${cfg.topic}"

${languageRule}

${mainTitle
  ? `Main presentation title: "${mainTitle}"`
  : ""}

${layoutHint(cfg.layoutStyle)}

This is chunk ${chunkNo} of ${totalChunks}.

Generate exactly ${count} slides.

Slides must start from ${startNo}.

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

Rules:

- First slide of complete presentation must be title.
- Final slide should be summary or thanks.
- Every slide needs useful content.
- 3 to 6 short bullets per slide.
- Avoid paragraphs.
- Avoid repeating information.
- Keep bullets concise.
- slideNumber must be sequential.
- imagePrompt must be a short English visual description.
- If images are disabled, imagePrompt must be empty.
- speakerNotes should be 1-2 sentences.
- ${
    cfg.narration
      ? "narrationScript should contain 2-3 spoken sentences."
      : 'narrationScript must be empty.'
  }

Return ONLY JSON.

{
  "title": "Presentation title",
  "subtitle": "Short subtitle",
  "slides": [
    {
      "slideNumber": ${startNo},
      "title": "Slide title",
      "layout": "bullets",
      "content": [
        "Point one",
        "Point two",
        "Point three"
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
  const result = [];

  for (
    const item of slide.content || []
  ) {
    const text = String(item).trim();

    const match = text.match(
      /^(.{1,50}?)\s*(?::|-|–)\s*(\d+(?:\.\d+)?)\s*%?\s*$/
    );

    if (!match) continue;

    result.push({
      label: match[1].trim(),
      value: Number(match[2]),
    });
  }

  return result.length >= 2 &&
    result.length <= 6
    ? result
    : null;
}

// ============================================================
// SLIDE NORMALIZATION
// ============================================================

function heuristicLayout(
  slide,
  cfg
) {
  const title = String(
    slide.title || ""
  );

  const text =
    title +
    " " +
    (slide.content || []).join(" ");

  if (
    cfg.charts === "Auto" &&
    extractChartData(slide)
  ) {
    return "stats";
  }

  if (
    /thank|धन्यवाद/i.test(title)
  ) {
    return "thanks";
  }

  if (
    /summary|conclusion|निष्कर्ष/i.test(
      title
    )
  ) {
    return "summary";
  }

  if (
    /timeline|history|historical|chronolog|इतिहास|क्रम/i.test(
      text
    )
  ) {
    return "timeline";
  }

  if (
    /step|process|how to|procedure|प्रक्रिया|कैसे/i.test(
      text
    )
  ) {
    return "process";
  }

  if (
    /\bvs\b|versus|comparison|तुलना/i.test(
      title
    )
  ) {
    return "comparison";
  }

  if (
    contentLength(slide) >= 5
  ) {
    return "twoColumn";
  }

  return "bullets";
}

function contentLength(slide) {
  return Array.isArray(slide.content)
    ? slide.content.length
    : 0;
}

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
    .map((x) =>
      String(x || "").trim()
    )
    .filter(Boolean)
    .map((x) =>
      x.length > BULLET_MAX_LEN
        ? x.slice(
            0,
            BULLET_MAX_LEN - 1
          ) + "…"
        : x
    )
    .slice(
      0,
      CONTENT_MAX_BULLETS
    );

  if (!content.length) {
    content = [
      cfg.language === "Hindi"
        ? "मुख्य जानकारी"
        : "Key information",
      cfg.language === "Hindi"
        ? "महत्वपूर्ण उदाहरण"
        : "Important example",
      cfg.language === "Hindi"
        ? "मुख्य निष्कर्ष"
        : "Key takeaway",
    ];
  }

  let layout = String(
    raw.layout || ""
  ).trim();

  if (
    !KNOWN_LAYOUTS.includes(layout)
  ) {
    layout = heuristicLayout(
      {
        title,
        content,
      },
      cfg
    );
  }

  return {
    slideNumber:
      Number.isInteger(
        raw.slideNumber
      )
        ? raw.slideNumber
        : expectedNo,

    title: title.slice(0, 120),

    layout,

    content,

    imagePrompt:
      cfg.addImages
        ? String(
            raw.imagePrompt || ""
          )
            .trim()
            .slice(0, 250)
        : "",

    speakerNotes: String(
      raw.speakerNotes || ""
    )
      .trim()
      .slice(0, 500),

    narrationScript: String(
      raw.narrationScript || ""
    )
      .trim()
      .slice(0, 800),
  };
}

// ============================================================
// AI CHUNK
// ============================================================

async function callAIChunk(
  cfg,
  chunkNo,
  totalChunks,
  startNo,
  count,
  mainTitle,
  retry = 0
) {
  const prompt =
    buildChunkPrompt(
      cfg,
      chunkNo,
      totalChunks,
      startNo,
      count,
      mainTitle
    );

  const response =
    await geminiGenerate(
      prompt,
      45000
    );

  const parsed =
    parseAIJson(response);

  if (!parsed) {
    if (
      retry < 1 &&
      !keyManager.isQuotaExhausted()
    ) {
      return callAIChunk(
        cfg,
        chunkNo,
        totalChunks,
        startNo,
        count,
        mainTitle,
        retry + 1
      );
    }

    return null;
  }

  const rawSlides =
    Array.isArray(parsed.slides)
      ? parsed.slides
      : [];

  const slides =
    rawSlides
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
// CONTENT GENERATION
// ============================================================

function padSlides(
  slides,
  cfg,
  title
) {
  let number = slides.length;

  while (
    slides.length < cfg.slides
  ) {
    number++;

    const final =
      number === cfg.slides;

    let slideTitle;
    let content;

    if (cfg.language === "Hindi") {
      slideTitle = final
        ? "निष्कर्ष"
        : `${title} — जारी`;

      content = [
        "मुख्य बिंदु",
        "महत्वपूर्ण जानकारी",
        "मुख्य निष्कर्ष",
      ];
    } else if (
      cfg.language === "Bilingual"
    ) {
      slideTitle = final
        ? "Summary | निष्कर्ष"
        : `${title} | जारी`;

      content = [
        "Key point | मुख्य बिंदु",
        "Important information | महत्वपूर्ण जानकारी",
        "Key takeaway | मुख्य निष्कर्ष",
      ];
    } else {
      slideTitle = final
        ? "Summary"
        : `${title} — Continued`;

      content = [
        "Key point",
        "Important information",
        "Key takeaway",
      ];
    }

    slides.push({
      slideNumber: number,
      title: slideTitle,
      layout: final
        ? "summary"
        : "bullets",
      content,
      imagePrompt: "",
      speakerNotes: "",
      narrationScript: "",
    });
  }

  return slides;
}

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
    i < slides.length;
    i++
  ) {
    if (
      slides[i].layout ===
      slides[i - 1].layout
    ) {
      const alternatives = [
        "bullets",
        "twoColumn",
        "threeCards",
        "process",
        "timeline",
        "imageText",
      ];

      const next =
        alternatives.find(
          (x) =>
            x !== slides[i].layout
        );

      if (next) {
        slides[i].layout = next;
      }
    }
  }

  return slides;
}

async function generatePPTContent(
  cfg
) {
  const chunks = [];

  let remaining = cfg.slides;

  while (remaining > 0) {
    const count = Math.min(
      CHUNK_SIZE,
      remaining
    );

    chunks.push(count);
    remaining -= count;
  }

  const slides = [];

  let mainTitle = "";
  let subtitle = "";

  for (
    let i = 0;
    i < chunks.length;
    i++
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
        i + 1,
        chunks.length,
        startNo,
        chunks[i],
        mainTitle
      );

    if (!result) {
      continue;
    }

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
  }

  if (!slides.length) {
    throw new Error(
      "AI se presentation content nahi ban paya."
    );
  }

  slides[0].layout = "title";

  const padded =
    padSlides(
      slides,
      cfg,
      mainTitle || cfg.topic
    );

  const finalSlides =
    enforceVariety(
      padded,
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

  finalSlides[
    finalSlides.length - 1
  ].layout = "summary";

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
      const encoded =
        encodeURIComponent(
          String(prompt || "")
            .slice(0, 300)
        );

      const apiKey = String(
        process.env.POLLINATIONS_API_KEY ||
          ""
      ).trim();

      const urls = [];

      if (apiKey) {
        urls.push(
          `https://gen.pollinations.ai/image/${encoded}` +
          `?model=flux&width=832&height=512&nologo=true` +
          `&key=${encodeURIComponent(
            apiKey
          )}`
        );
      }

      urls.push(
        `https://image.pollinations.ai/prompt/${encoded}` +
        `?width=832&height=512&nologo=true`
      );

      let index = 0;

      function attempt() {
        if (
          index >= urls.length
        ) {
          resolve(null);
          return;
        }

        const url =
          urls[index++];

        let parsed;

        try {
          parsed =
            new URL(url);
        } catch {
          attempt();
          return;
        }

        const request =
          https.get(
            parsed,
            {
              timeout: 25000,

              headers: {
                "User-Agent":
                  "AI-PPT-Generator/3.0",

                Accept:
                  "image/jpeg,image/png,image/gif,image/*;q=0.8",
              },
            },
            (response) => {
              const status =
                response.statusCode || 0;

              const type =
                String(
                  response.headers[
                    "content-type"
                  ] || ""
                )
                  .split(";")[0]
                  .trim()
                  .toLowerCase();

              if (
                status >= 300 &&
                status < 400 &&
                response.headers.location
              ) {
                response.resume();
                attempt();
                return;
              }

              if (
                status !== 200 ||
                !type.startsWith(
                  "image/"
                )
              ) {
                response.resume();
                attempt();
                return;
              }

              const chunks = [];
              let size = 0;

              const MAX =
                12 * 1024 * 1024;

              response.on(
                "data",
                (chunk) => {
                  size +=
                    chunk.length;

                  if (
                    size <= MAX
                  ) {
                    chunks.push(
                      chunk
                    );
                  }
                }
              );

              response.on(
                "end",
                () => {
                  if (
                    size < 1000 ||
                    size > MAX
                  ) {
                    attempt();
                    return;
                  }

                  const mime =
                    [
                      "image/jpeg",
                      "image/png",
                      "image/gif",
                    ].includes(type)
                      ? type
                      : null;

                  if (!mime) {
                    attempt();
                    return;
                  }

                  resolve({
                    buffer:
                      Buffer.concat(
                        chunks
                      ),
                    mime,
                  });
                }
              );

              response.on(
                "error",
                attempt
              );
            }
          );

        request.on(
          "timeout",
          () => {
            request.destroy();
            attempt();
          }
        );

        request.on(
          "error",
          attempt
        );
      }

      attempt();
    }
  );
}

// ============================================================
// FILE HELPERS
// ============================================================

function makeFileName(
  userId
) {
  const id =
    String(
      userId || "user"
    ).replace(
      /[^A-Za-z0-9]/g,
      ""
    );

  const random =
    crypto
      .randomBytes(3)
      .toString("hex");

  return (
    `ppt-${id}-` +
    `${Date.now()}-` +
    `${random}.pptx`
  );
}

function isSafeFileName(
  fileName
) {
  if (
    typeof fileName !== "string"
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

    const names =
      await fs.promises.readdir(
        PPT_DIR
      );

    for (
      const name of names
    ) {
      if (
        !name.endsWith(
          ".pptx"
        )
      ) {
        continue;
      }

      const full =
        path.join(
          PPT_DIR,
          name
        );

      try {
        const stat =
          await fs.promises.stat(
            full
          );

        if (
          stat.mtimeMs <
          cutoff
        ) {
          await fs.promises.unlink(
            full
          );
        }
      } catch {}
    }
  } catch (error) {
    console.warn(
      "[PPT] Cleanup failed:",
      error.message
    );
  }
}

// ============================================================
// PPTX HELPERS
// ============================================================

function safeText(value) {
  return String(
    value == null ? "" : value
  ).trim();
}

function addNotes(
  slide,
  data,
  cfg
) {
  let notes = "";

  if (
    cfg.speakerNotes &&
    data.speakerNotes
  ) {
    notes =
      data.speakerNotes;
  }

  if (
    cfg.narration &&
    data.narrationScript
  ) {
    notes +=
      `${notes ? "\n\n" : ""}` +
      `NARRATION: ${data.narrationScript}`;
  }

  if (!notes) return;

  try {
    slide.addNotes(notes);
  } catch {}
}

// ============================================================
// BUILD PPTX
// ============================================================

async function buildPPTX(
  content,
  cfg
) {
  const theme =
    getTheme(cfg.theme);

  const hindi =
    cfg.language !== "English";

  const HFONT =
    hindi
      ? DEVANAGARI_FONT
      : theme.fontPair.heading;

  const BFONT =
    hindi
      ? DEVANAGARI_FONT
      : theme.fontPair.body;

  const M =
    GRID || {
      marginX: 0.55,
      headerH: 0.7,
      contentTop: 1.0,
      contentH: 4.3,
      footerY: 5.2,
    };

  const pres =
    new PptxGenJS();

  pres.layout =
    "LAYOUT_16x9";

  pres.author =
    "AI PPT Generator";

  pres.company =
    "AI Interview";

  pres.title =
    content.title;

  pres.subject =
    content.title;

  pres.lang =
    hindi
      ? "hi-IN"
      : "en-US";

  // ----------------------------------------------------------
  // Basic slide
  // ----------------------------------------------------------

  function newSlide() {
    const slide =
      pres.addSlide();

    slide.background = {
      color:
        theme.bg,
    };

    return slide;
  }

  // ----------------------------------------------------------
  // Header
  // ----------------------------------------------------------

  function header(
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
      safeText(title),
      {
        x: M.marginX,
        y: 0.06,
        w: 8.9,
        h:
          M.headerH -
          0.12,

        fontSize:
          (theme.headingSize ||
            26) *
          0.8,

        bold: true,

        color:
          theme.headerText,

        fontFace:
          HFONT,

        margin: 0.02,

        valign:
          "mid",
      }
    );
  }

  // ----------------------------------------------------------
  // Footer
  // ----------------------------------------------------------

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
        h: 0.045,

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
      String(number),
      {
        x: 9.35,
        y:
          M.footerY -
          0.28,

        w: 0.4,
        h: 0.25,

        fontSize: 9,

        color:
          theme.accent,

        fontFace:
          BFONT,

        align:
          "right",

        margin: 0,
      }
    );
  }

  // ----------------------------------------------------------
  // Bullets
  // ----------------------------------------------------------

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

    const maxLen =
      Math.max(
        ...items.map(
          (x) =>
            String(x).length
        )
      );

    let fontSize =
      options.fontSize ||
      theme.bodySize ||
      18;

    if (
      items.length > 5
    ) {
      fontSize -= 2;
    }

    if (
      maxLen > 100
    ) {
      fontSize -= 2;
    }

    fontSize =
      Math.max(
        11,
        fontSize
      );

    const runs =
      items.map(
        (text) => ({
          text:
            String(text),

          options: {
            bullet: {
              code: "2022",
            },

            breakLine: true,
          },
        })
      );

    slide.addText(
      runs,
      {
        x:
          options.x ??
          M.marginX + 0.15,

        y:
          options.y ??
          M.contentTop + 0.1,

        w:
          options.w ??
          8.7,

        h:
          options.h ??
          M.contentH,

        fontSize,

        color:
          options.color ||
          theme.bodyColor,

        fontFace:
          BFONT,

        valign:
          "top",

        breakLine: false,

        margin: 0.04,

        paraSpaceAfterPt:
          10,
      }
    );
  }

  // ----------------------------------------------------------
  // Simple text
  // ----------------------------------------------------------

  function addText(
    slide,
    text,
    options = {}
  ) {
    slide.addText(
      safeText(text),
      {
        fontFace:
          options.fontFace ||
          BFONT,

        color:
          options.color ||
          theme.bodyColor,

        fontSize:
          options.fontSize ||
          theme.bodySize ||
          18,

        bold:
          !!options.bold,

        margin:
          options.margin ??
          0.04,

        valign:
          options.valign ||
          "mid",

        align:
          options.align ||
          "left",

        ...options,
      }
    );
  }

  // ==========================================================
  // IMAGE PLACEHOLDER
  // ==========================================================

  function imagePlaceholder(
    slide,
    x,
    y,
    w,
    h
  ) {
    slide.addShape(
      pres.ShapeType.roundRect,
      {
        x,
        y,
        w,
        h,

        rectRadius: 0.06,

        fill: {
          color:
            theme.panel ||
            theme.bg,
        },

        line: {
          color:
            theme.panelBorder ||
            theme.accent,

          width: 1,
        },
      }
    );

    addText(
      slide,
      "IMAGE",
      {
        x,
        y:
          y +
          h / 2 -
          0.25,

        w,
        h: 0.5,

        fontSize: 15,

        bold: true,

        color:
          theme.panelBorder ||
          theme.accent,

        align:
          "center",
      }
    );
  }

  // ==========================================================
  // IMAGE SAFE ADD
  // ==========================================================

  /*
   * IMPORTANT FIX:
   *
   * Image is added BEFORE the slide's text/content.
   * Therefore an image can NEVER cover the text.
   *
   * Previous implementation queued images and inserted them
   * after all slide objects. That caused PowerPoint z-order
   * problems and blank-looking slides.
   */

  async function addImageSafely(
    slide,
    slideData,
    box,
    full = false
  ) {
    if (
      !cfg.addImages ||
      !slideData.imagePrompt
    ) {
      return false;
    }

    try {
      const result =
        await fetchSlideImage(
          slideData.imagePrompt
        );

      if (
        !result ||
        !result.buffer ||
        !result.mime
      ) {
        return false;
      }

      const dataUri =
        `data:${result.mime};base64,` +
        result.buffer.toString(
          "base64"
        );

      slide.addImage({
        data: dataUri,

        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      });

      if (full) {
        slide.addShape(
          pres.ShapeType.rect,
          {
            x: 0,
            y: 4.15,
            w: 10,
            h: 1.475,

            fill: {
              color: "000000",
              transparency: 30,
            },

            line: {
              color: "000000",
              transparency: 100,
            },
          }
        );

        addText(
          slide,
          slideData.title,
          {
            x: M.marginX,
            y: 4.35,
            w: 8.9,
            h: 0.8,

            fontSize: 25,
            bold: true,

            color: "FFFFFF",

            align: "left",

            valign: "mid",
          }
        );
      }

      return true;
    } catch (error) {
      console.warn(
        "[PPT] Image failed:",
        error.message
      );

      return false;
    }
  }

  // ==========================================================
  // TITLE
  // ==========================================================

  async function renderTitle(
    slide,
    data
  ) {
    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0,
        y: 3.05,
        w: 10,
        h: 0.06,

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

    addText(
      slide,
      content.title,
      {
        x: M.marginX,
        y: 1.25,
        w: 8.9,
        h: 1.35,

        fontSize:
          theme.titleSize ||
          34,

        bold: true,

        color:
          theme.titleColor,

        fontFace:
          HFONT,

        align:
          "center",

        valign:
          "mid",
      }
    );

    if (content.subtitle) {
      addText(
        slide,
        content.subtitle,
        {
          x: 1.3,
          y: 3.35,
          w: 7.4,
          h: 0.55,

          fontSize: 14,

          color:
            theme.bodyColor,

          align:
            "center",
        }
      );
    }

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // BULLETS
  // ==========================================================

  async function renderBullets(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    await addImageSafely(
      slide,
      data,
      {
        x: 6.55,
        y: 1.05,
        w: 3.0,
        h: 3.9,
      }
    );

    const imageEnabled =
      cfg.addImages &&
      data.imagePrompt;

    addBullets(
      slide,
      data.content,
      {
        x: M.marginX,
        y: M.contentTop + 0.05,
        w:
          imageEnabled
            ? 5.65
            : 8.7,
        h: 3.95,
        fontSize: 16,
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // TWO COLUMN
  // ==========================================================

  async function renderTwoColumn(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    await addImageSafely(
      slide,
      data,
      {
        x: 6.7,
        y: 1.15,
        w: 2.8,
        h: 3.55,
      }
    );

    const mid =
      Math.ceil(
        data.content.length / 2
      );

    addBullets(
      slide,
      data.content.slice(
        0,
        mid
      ),
      {
        x: 0.55,
        y: 1.2,
        w: 4.15,
        h: 3.8,
        fontSize: 14,
      }
    );

    addBullets(
      slide,
      data.content.slice(
        mid
      ),
      {
        x: 4.75,
        y: 1.2,
        w: 1.75,
        h: 3.8,
        fontSize: 12,
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // THREE CARDS
  // ==========================================================

  async function renderThreeCards(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const items =
      data.content.slice(
        0,
        3
      );

    const xs = [
      0.5,
      3.5,
      6.5,
    ];

    for (
      let i = 0;
      i < 3;
      i++
    ) {
      slide.addShape(
        pres.ShapeType.roundRect,
        {
          x: xs[i],
          y: 1.35,
          w: 2.65,
          h: 3.25,

          fill: {
            color:
              theme.panel ||
              theme.bg,
          },

          line: {
            color:
              theme.panelBorder ||
              theme.accent,
            width: 1,
          },
        }
      );

      addText(
        slide,
        items[i] ||
          "Key point",
        {
          x:
            xs[i] + 0.2,
          y: 1.7,
          w: 2.25,
          h: 2.5,

          fontSize: 14,

          color:
            theme.bodyColor,

          align:
            "center",

          valign:
            "mid",
        }
      );
    }

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // COMPARISON
  // ==========================================================

  async function renderComparison(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    slide.addShape(
      pres.ShapeType.line,
      {
        x: 5,
        y: 1.3,
        w: 0,
        h: 3.7,

        line: {
          color:
            theme.panelBorder ||
            theme.accent,
          width: 1,
        },
      }
    );

    addText(
      slide,
      "Option A",
      {
        x: 0.7,
        y: 1.15,
        w: 4,
        h: 0.5,

        fontSize: 20,
        bold: true,

        color:
          theme.accent,

        align:
          "center",
      }
    );

    addText(
      slide,
      "Option B",
      {
        x: 5.25,
        y: 1.15,
        w: 4,
        h: 0.5,

        fontSize: 20,
        bold: true,

        color:
          theme.accent,

        align:
          "center",
      }
    );

    const mid =
      Math.ceil(
        data.content.length / 2
      );

    addBullets(
      slide,
      data.content.slice(
        0,
        mid
      ),
      {
        x: 0.7,
        y: 1.75,
        w: 4,
        h: 3,
        fontSize: 14,
      }
    );

    addBullets(
      slide,
      data.content.slice(
        mid
      ),
      {
        x: 5.25,
        y: 1.75,
        w: 4,
        h: 3,
        fontSize: 14,
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // TIMELINE
  // ==========================================================

  async function renderTimeline(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const items =
      data.content.slice(
        0,
        5
      );

    slide.addShape(
      pres.ShapeType.line,
      {
        x: 1,
        y: 3,
        w: 8,
        h: 0,

        line: {
          color:
            theme.accent,
          width: 2,
        },
      }
    );

    const gap =
      items.length > 1
        ? 8 /
          (items.length - 1)
        : 8;

    items.forEach(
      (item, i) => {
        const x =
          1 + i * gap;

        slide.addShape(
          pres.ShapeType.ellipse,
          {
            x:
              x - 0.12,
            y: 2.88,
            w: 0.24,
            h: 0.24,

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

        addText(
          slide,
          item,
          {
            x:
              x - 0.55,
            y:
              i % 2 === 0
                ? 1.65
                : 3.45,

            w: 1.1,
            h: 1.0,

            fontSize: 10,

            align:
              "center",
          }
        );
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // PROCESS
  // ==========================================================

  async function renderProcess(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const items =
      data.content.slice(
        0,
        5
      );

    const width =
      8.8 /
      Math.max(
        items.length,
        1
      );

    items.forEach(
      (item, i) => {
        const x =
          0.55 +
          i * width;

        slide.addShape(
          pres.ShapeType.roundRect,
          {
            x,
            y: 2,
            w:
              width - 0.18,
            h: 1.5,

            fill: {
              color:
                theme.panel ||
                theme.bg,
            },

            line: {
              color:
                theme.accent,
              width: 1,
            },
          }
        );

        addText(
          slide,
          `${i + 1}. ${item}`,
          {
            x:
              x + 0.08,
            y: 2.15,
            w:
              width - 0.34,
            h: 1.15,

            fontSize: 11,

            bold: true,

            align:
              "center",
          }
        );
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // STATS
  // ==========================================================

  async function renderStats(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const chart =
      extractChartData(
        data
      );

    if (chart) {
      const max =
        Math.max(
          ...chart.map(
            (x) => x.value
          ),
          1
        );

      chart.forEach(
        (item, i) => {
          const y =
            1.25 +
            i * 0.7;

          addText(
            slide,
            item.label,
            {
              x: 0.65,
              y,
              w: 2.3,
              h: 0.35,

              fontSize: 12,
            }
          );

          slide.addShape(
            pres.ShapeType.rect,
            {
              x: 2.8,
              y:
                y + 0.05,

              w:
                5.5 *
                (item.value /
                  max),

              h: 0.25,

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

          addText(
            slide,
            String(
              item.value
            ),
            {
              x: 8.45,
              y,
              w: 0.8,
              h: 0.35,

              fontSize: 11,
              bold: true,

              align:
                "right",
            }
          );
        }
      );
    } else {
      addBullets(
        slide,
        data.content,
        {
          fontSize: 16,
        }
      );
    }

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // QUOTE
  // ==========================================================

  async function renderQuote(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const quote =
      data.content[0] ||
      "";

    addText(
      slide,
      `“${quote}”`,
      {
        x: 1,
        y: 1.55,
        w: 8,
        h: 2,

        fontSize: 25,
        bold: true,

        color:
          theme.titleColor,

        align:
          "center",

        valign:
          "mid",
      }
    );

    if (
      data.content[1]
    ) {
      addText(
        slide,
        data.content[1],
        {
          x: 2,
          y: 3.8,
          w: 6,
          h: 0.5,

          fontSize: 14,

          align:
            "center",
        }
      );
    }

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // IMAGE TEXT
  // ==========================================================

  async function renderImageText(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const imageOK =
      await addImageSafely(
        slide,
        data,
        {
          x: 0.45,
          y: 1.3,
          w: 4.25,
          h: 3.65,
        }
      );

    if (!imageOK) {
      imagePlaceholder(
        slide,
        0.45,
        1.3,
        4.25,
        3.65
      );
    }

    addBullets(
      slide,
      data.content,
      {
        x: 5,
        y: 1.3,
        w: 4.35,
        h: 3.8,
        fontSize: 14,
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // FULL IMAGE
  // ==========================================================

  async function renderFullImage(
    slide,
    data
  ) {
    const imageOK =
      await addImageSafely(
        slide,
        data,
        {
          x: 0,
          y: 0,
          w: 10,
          h: 5.625,
        },
        true
      );

    if (!imageOK) {
      slide.addShape(
        pres.ShapeType.rect,
        {
          x: 0,
          y: 0,
          w: 10,
          h: 5.625,

          fill: {
            color:
              theme.bg,
          },

          line: {
            color:
              theme.bg,
            transparency: 100,
          },
        }
      );

      addText(
        slide,
        data.title,
        {
          x: 0.7,
          y: 2,
          w: 8.6,
          h: 1,

          fontSize: 30,
          bold: true,

          align:
            "center",

          color:
            theme.titleColor,
        }
      );

      addBullets(
        slide,
        data.content,
        {
          x: 1.2,
          y: 3,
          w: 7.6,
          h: 1.5,

          fontSize: 13,
        }
      );
    }

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // FLOW
  // ==========================================================

  async function renderFlow(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    const items =
      data.content.slice(
        0,
        5
      );

    items.forEach(
      (item, i) => {
        const x =
          0.55 +
          i * 1.85;

        slide.addShape(
          pres.ShapeType.roundRect,
          {
            x,
            y: 2.15,
            w: 1.45,
            h: 1.1,

            fill: {
              color:
                theme.panel ||
                theme.bg,
            },

            line: {
              color:
                theme.accent,
            },
          }
        );

        addText(
          slide,
          item,
          {
            x:
              x + 0.08,
            y: 2.32,
            w: 1.29,
            h: 0.75,

            fontSize: 10,

            bold: true,

            align:
              "center",
          }
        );

        if (
          i <
          items.length - 1
        ) {
          addText(
            slide,
            "→",
            {
              x:
                x + 1.43,
              y: 2.43,
              w: 0.4,
              h: 0.4,

              fontSize: 20,
              bold: true,

              color:
                theme.accent,

              align:
                "center",
            }
          );
        }
      }
    );

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  async function renderSummary(
    slide,
    data
  ) {
    header(
      slide,
      data.title
    );

    addBullets(
      slide,
      data.content,
      {
        x: 0.75,
        y: 1.35,
        w: 8.3,
        h: 3.5,

        fontSize: 16,
      }
    );

    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 0.45,
        y: 1.25,
        w: 0.08,
        h: 3.9,

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
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // THANKS
  // ==========================================================

  async function renderThanks(
    slide,
    data
  ) {
    const text =
      cfg.language === "Hindi"
        ? "धन्यवाद!"
        : cfg.language ===
          "Bilingual"
        ? "Thank You | धन्यवाद!"
        : "Thank You!";

    addText(
      slide,
      text,
      {
        x: 1,
        y: 1.75,
        w: 8,
        h: 1.2,

        fontSize: 42,
        bold: true,

        color:
          theme.titleColor,

        align:
          "center",
      }
    );

    slide.addShape(
      pres.ShapeType.rect,
      {
        x: 4,
        y: 3.25,
        w: 2,
        h: 0.06,

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
      data.content[0]
    ) {
      addText(
        slide,
        data.content[0],
        {
          x: 1.5,
          y: 3.75,
          w: 7,
          h: 0.6,

          fontSize: 14,

          align:
            "center",
        }
      );
    }

    footer(
      slide,
      data.slideNumber
    );

    addNotes(
      slide,
      data,
      cfg
    );
  }

  // ==========================================================
  // RENDER MAP
  // ==========================================================

  const renderers = {
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

  /*
   * IMPORTANT:
   * Slides are built ONE BY ONE and images are awaited before
   * moving to the next slide.
   *
   * This removes the old async image queue problem completely.
   */

  for (
    const data of content.slides
  ) {
    const slide =
      newSlide();

    const renderer =
      renderers[data.layout] ||
      renderers.bullets;

    try {
      await renderer(
        slide,
        data
      );
    } catch (error) {
      console.warn(
        `[PPT] Renderer failed on slide ${data.slideNumber}:`,
        error.message
      );

      /*
       * IMPORTANT FALLBACK:
       * Even if one special layout fails, the slide is NEVER
       * left blank.
       */

      header(
        slide,
        data.title
      );

      addBullets(
        slide,
        data.content,
        {
          fontSize: 15,
        }
      );

      footer(
        slide,
        data.slideNumber
      );

      addNotes(
        slide,
        data,
        cfg
      );
    }
  }

  return pres;
}

// ============================================================
// XML HELPERS
// ============================================================

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

function transitionXML(
  mode,
  index
) {
  if (mode === "Off") {
    return "";
  }

  if (
    mode === "Dynamic" &&
    index % 2 === 0
  ) {
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

// ============================================================
// POST PROCESS
// ============================================================

async function postProcessPPTX(
  filePath,
  options
) {
  const needTransitions =
    options.transitions !== "Off";

  /*
   * IMPORTANT:
   * Animations are intentionally NOT injected here.
   *
   * The old custom timing XML could make PowerPoint treat
   * shapes/images as hidden and was one of the causes of
   * blank-looking slides.
   *
   * Transitions are safe.
   */

  if (!needTransitions) {
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
          const an =
            parseInt(
              a.match(
                /(\d+)/
              )[1],
              10
            );

          const bn =
            parseInt(
              b.match(
                /(\d+)/
              )[1],
              10
            );

          return an - bn;
        }
      );

  for (
    let i = 0;
    i < slideFiles.length;
    i++
  ) {
    const name =
      slideFiles[i];

    let xml =
      await zip
        .file(name)
        .async("string");

    if (
      !xml.includes(
        "<p:transition"
      )
    ) {
      const transition =
        transitionXML(
          options.transitions,
          i
        );

      const close =
        "</p:sld>";

      const position =
        xml.lastIndexOf(
          close
        );

      if (
        position !== -1
      ) {
        xml =
          xml.slice(
            0,
            position
          ) +
          transition +
          xml.slice(
            position
          );
      }
    }

    zip.file(
      name,
      xml
    );
  }

  const output =
    await zip.generateAsync({
      type: "nodebuffer",
      compression:
        "DEFLATE",
    });

  fs.writeFileSync(
    filePath,
    output
  );
}

// ============================================================
// QC
// ============================================================

async function validateOutput(
  filePath,
  content
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

  try {
    const stat =
      fs.statSync(
        filePath
      );

    if (
      stat.size <
      10 * 1024
    ) {
      issues.push(
        "file-too-small"
      );
    }
  } catch {
    issues.push(
      "file-stat-failed"
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

    for (
      const slide of content.slides
    ) {
      if (
        !slide.title ||
        !Array.isArray(
          slide.content
        ) ||
        !slide.content.length
      ) {
        issues.push(
          `empty-slide-${slide.slideNumber}`
        );
      }
    }
  } catch (error) {
    issues.push(
      "zip-invalid:" +
        String(
          error.message || ""
        ).slice(
          0,
          100
        )
    );
  }

  if (issues.length) {
    console.warn(
      "[PPT] QC:",
      issues.join(", ")
    );
  }

  return issues;
}

// ============================================================
// MAIN
// ============================================================

async function generatePPT(
  opts,
  userId
) {
  const {
    errors,
    clean,
  } =
    validatePPTOptions(
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

  if (
    !fs.existsSync(PPT_DIR)
  ) {
    await fs.promises.mkdir(
      PPT_DIR,
      {
        recursive: true,
      }
    );
  }

  const fileName =
    makeFileName(
      userId
    );

  const filePath =
    path.join(
      PPT_DIR,
      fileName
    );

  const presentation =
    await buildPPTX(
      content,
      clean
    );

  await presentation.writeFile({
    fileName: filePath,
  });

  try {
    await postProcessPPTX(
      filePath,
      clean
    );
  } catch (error) {
    console.warn(
      "[PPT] Transition post-process failed:",
      error.message
    );
  }

  const issues =
    await validateOutput(
      filePath,
      content
    );

  if (
    issues.includes(
      "file-missing"
    ) ||
    issues.some(
      (x) =>
        x.startsWith(
          "zip-invalid"
        )
    )
  ) {
    throw new Error(
      "PPT file valid nahi bani."
    );
  }

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

  const stat =
    fs.statSync(
      filePath
    );

  console.log(
    `[PPT] Generated ${fileName} | ` +
    `${content.slides.length} slides | ` +
    `${Math.round(
      stat.size / 1024
    )} KB | ` +
    `images=${clean.addImages}`
  );

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