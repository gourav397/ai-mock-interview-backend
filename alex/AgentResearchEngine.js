// ============================================================
// ALEX RESEARCH ENGINE
// File: backend/alex/AgentResearchEngine.js
//
// Purpose:
//   Give ALEX a reusable research workflow:
//
//   QUESTION
//      ↓
//   URL / SOURCE DISCOVERY
//      ↓
//   PUBLIC WEB FETCH
//      ↓
//   TEXT EXTRACTION
//      ↓
//   SOURCE NORMALIZATION
//      ↓
//   GEMINI SYNTHESIS
//      ↓
//   STRUCTURED RESEARCH REPORT
//
// Design:
//   - Uses AgentWebBrowserBridge for public web access.
//   - Uses existing ALEX Gemini utility.
//   - Does not pretend unavailable browser/search APIs exist.
//   - Keeps source URLs with every research item.
//   - Limits pages, text and prompt size.
//   - Failures from one source do not destroy the whole job.
// ============================================================

const {
  AgentWebBrowserBridge,
  getAgentWebBrowserBridge,
} = require("./AgentWebBrowserBridge");

const {
  callGemini,
} = require("./utils/gemini");


// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "1.0.0";

const DEFAULT_MAX_SOURCES = 5;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_TIMEOUT_MS = 12000;

const MAX_SOURCES = 10;

const DEFAULT_MAX_TEXT_PER_SOURCE = 12000;

const MAX_TEXT_PER_SOURCE = 30000;

const MAX_PROMPT_LENGTH = 45000;

const MAX_QUESTION_LENGTH = 10000;


// ============================================================
// HELPERS
// ============================================================

function safeString(
  value,
  fallback = ""
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim();
}


function clamp(
  value,
  min,
  max,
  fallback
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      Math.floor(number)
    )
  );
}


function truncate(
  value,
  max
) {
  const text =
    safeString(value);

  if (
    text.length <= max
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      max
    ) +
    "\n...[truncated]"
  );
}


function uniqueStrings(
  values
) {
  if (
    !Array.isArray(values)
  ) {
    return [];
  }

  return [
    ...new Set(
      values
        .map(
          (value) =>
            safeString(value)
        )
        .filter(Boolean)
    ),
  ];
}


function normalizeUrl(
  value
) {
  try {
    const url =
      new URL(
        safeString(value)
      );

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}


// ============================================================
// SOURCE NORMALIZER
// ============================================================

function normalizeSource(
  page,
  index,
  maxText
) {
  if (
    !page ||
    page.success !== true
  ) {
    return null;
  }

  const url =
    normalizeUrl(
      page.finalUrl ||
      page.url
    );

  if (!url) {
    return null;
  }

  return {
    id:
      `source-${index + 1}`,

    title:
      safeString(
        page.title,
        url
      ),

    url,

    content:
      truncate(
        page.text,
        maxText
      ),

    contentLength:
      safeString(
        page.text
      ).length,

    contentType:
      safeString(
        page.contentType
      ),

    fetchedAt:
      page.fetchedAt ||
      new Date().toISOString(),
  };
}


// ============================================================
// PROMPT SOURCE FORMATTER
// ============================================================

function formatSources(
  sources
) {
  return sources
    .map(
      (source) =>
        [
          `SOURCE ${source.id}`,
          `TITLE: ${source.title}`,
          `URL: ${source.url}`,
          `FETCHED: ${source.fetchedAt}`,
          `CONTENT:`,
          source.content,
        ].join("\n")
    )
    .join(
      "\n\n------------------------------\n\n"
    );
}


// ============================================================
// JSON PARSER
// ============================================================

function parseJson(
  text
) {
  const value =
    safeString(text);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(
      value
    );
  } catch {
    // Continue below.
  }

  const cleaned =
    value
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  try {
    return JSON.parse(
      cleaned
    );
  } catch {
    const start =
      cleaned.indexOf("{");

    const end =
      cleaned.lastIndexOf("}");

    if (
      start >= 0 &&
      end > start
    ) {
      try {
        return JSON.parse(
          cleaned.slice(
            start,
            end + 1
          )
        );
      } catch {
        return null;
      }
    }

    return null;
  }
}


// ============================================================
// REPORT NORMALIZER
// ============================================================

function normalizeReport(
  raw,
  sources
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return {
      answer: "",
      keyPoints: [],
      limitations: [],
      sourceIds:
        sources.map(
          (source) =>
            source.id
        ),
    };
  }

  const keyPoints =
    Array.isArray(
      raw.keyPoints
    )
      ? raw.keyPoints
          .map(
            (item) =>
              safeString(item)
          )
          .filter(Boolean)
          .slice(
            0,
            20
          )
      : [];

  const limitations =
    Array.isArray(
      raw.limitations
    )
      ? raw.limitations
          .map(
            (item) =>
              safeString(item)
          )
          .filter(Boolean)
          .slice(
            0,
            20
          )
      : [];

  const sourceIds =
    Array.isArray(
      raw.sourceIds
    )
      ? uniqueStrings(
          raw.sourceIds
        )
      : sources.map(
          (source) =>
            source.id
        );

  return {
    answer:
      safeString(
        raw.answer ||
        raw.summary ||
        ""
      ),

    keyPoints,

    limitations,

    sourceIds,
  };
}


// ============================================================
// RESEARCH ENGINE
// ============================================================

class AgentResearchEngine {
  constructor(options = {}) {
    this.version =
      VERSION;

    this.browser =
      options.browser ||
      getAgentWebBrowserBridge();

    this.gemini =
      options.gemini ||
      callGemini;

    this.maxSources =
      clamp(
        options.maxSources,
        1,
        MAX_SOURCES,
        DEFAULT_MAX_SOURCES
      );

    this.maxTextPerSource =
      clamp(
        options.maxTextPerSource,
        1000,
        MAX_TEXT_PER_SOURCE,
        DEFAULT_MAX_TEXT_PER_SOURCE
      );
  }


  // ==========================================================
  // SOURCE FETCH
  // ==========================================================

  async fetchSources(
    urls,
    options = {}
  ) {
    const cleanUrls =
      uniqueStrings(
        urls
      )
        .map(
          (url) =>
            normalizeUrl(
              url
            )
        )
        .filter(Boolean)
        .slice(
          0,
          clamp(
            options.maxSources,
            1,
            MAX_SOURCES,
            this.maxSources
          )
        );

    if (
      cleanUrls.length === 0
    ) {
      return {
        success: false,

        sources: [],

        failed: [],

        reason:
          "No valid public URLs were supplied.",
      };
    }

    let results;

    try {
      const response =
        await this.browser.openMany(
          cleanUrls,
          {
            maxLinks:
              options.maxLinks,

            timeoutMs:
              options.timeoutMs,

            maxBytes:
              options.maxBytes,
          }
        );

      results =
        Array.isArray(
          response?.results
        )
          ? response.results
          : [];
    } catch (error) {
      return {
        success: false,

        sources: [],

        failed: cleanUrls.map(
          (url) => ({
            url,

            error:
              error?.message ||
              String(error),
          })
        ),
      };
    }

    const sources =
      [];

    const failed =
      [];

    for (
      let index = 0;
      index < results.length;
      index++
    ) {
      const result =
        results[index];

      const source =
        normalizeSource(
          result,
          index,
          this.maxTextPerSource
        );

      if (source) {
        sources.push(
          source
        );
      } else {
        failed.push({
          url:
            result?.url ||
            cleanUrls[index],

          error:
            result?.error ||
            "Source could not be read.",
        });
      }
    }

    return {
      success:
        sources.length > 0,

      sources,

      failed,

      succeeded:
        sources.length,

      requested:
        cleanUrls.length,
    };
  }


  // ==========================================================
  // FOLLOW RELEVANT LINKS
  // ==========================================================

  async discoverFromPage(
    url,
    options = {}
  ) {
    const page =
      await this.browser.open(
        url,
        options
      );

    if (
      !page?.success
    ) {
      return {
        success: false,

        sources: [],

        failed: [
          {
            url,

            error:
              page?.error ||
              "Page could not be opened.",
          },
        ],
      };
    }

    const links =
      Array.isArray(
        page.links
      )
        ? page.links
        : [];

    const limit =
      clamp(
        options.maxSources,
        1,
        MAX_SOURCES,
        this.maxSources
      );

    const selected =
      links.slice(
        0,
        Math.max(
          0,
          limit - 1
        )
      );

    const urls = [
      url,
      ...selected,
    ];

    return this.fetchSources(
      urls,
      {
        ...options,

        maxSources:
          limit,
      }
    );
  }


  // ==========================================================
  // SYNTHESIZE
  // ==========================================================

  async synthesize(
    question,
    sources,
    options = {}
  ) {
    const cleanQuestion =
      safeString(
        question
      );

    if (!cleanQuestion) {
      return {
        success: false,

        reason:
          "Research question is required.",
      };
    }

    if (
      cleanQuestion.length >
      MAX_QUESTION_LENGTH
    ) {
      return {
        success: false,

        reason:
          "Research question is too long.",
      };
    }

    if (
      !Array.isArray(
        sources
      ) ||
      sources.length === 0
    ) {
      return {
        success: false,

        reason:
          "No readable research sources are available.",
      };
    }

    const sourceText =
      formatSources(
        sources
      );

    const systemPrompt = `
You are ALEX's research synthesis engine.

Answer the user's research question using ONLY the
provided source material.

Rules:

1. Do not invent facts.
2. Do not pretend a source says something it does not say.
3. Clearly separate source-supported facts from uncertainty.
4. Keep the answer useful and direct.
5. Include source IDs whenever a claim depends on a source.
6. If sources conflict, explicitly mention the conflict.
7. If the sources do not contain enough information, say so.
8. Do not fabricate URLs.
9. Do not fabricate citations.
10. Return JSON only.

Required JSON:

{
  "answer": "direct answer",
  "keyPoints": [
    "important point"
  ],
  "limitations": [
    "uncertainty or missing information"
  ],
  "sourceIds": [
    "source-1"
  ]
}
`.trim();

    const prompt =
      [
        `RESEARCH QUESTION:`,
        cleanQuestion,
        "",
        `SOURCE MATERIAL:`,
        sourceText,
      ].join("\n");

    const finalPrompt =
      truncate(
        prompt,
        MAX_PROMPT_LENGTH
      );

    try {
      const response =
        await this.gemini(
          finalPrompt,
          {
            temperature:
              options.temperature ??
              0.2,

            maxOutputTokens:
              options.maxOutputTokens ??
              4096,

            timeoutMs:
              options.timeoutMs ??
              30000,

            retries:
              options.retries ??
              3,

            responseMimeType:
              "application/json",
          }
        );

      if (
        !response ||
        response.error
      ) {
        return {
          success: false,

          reason:
            response?.message ||
            "Gemini research synthesis failed.",
        };
      }

      const rawText =
        response.text ||
        response.raw ||
        "";

      const parsed =
        parseJson(
          rawText
        );

      const report =
        normalizeReport(
          parsed,
          sources
        );

      return {
        success: true,

        report,

        raw:
          rawText,
      };
    } catch (error) {
      return {
        success: false,

        reason:
          error?.message ||
          String(error),
      };
    }
  }


    // ==========================================================
  // PUBLIC WEB SOURCE DISCOVERY
  // ==========================================================

  async discoverSources(
    question,
    options = {}
  ) {
    const cleanQuestion =
      safeString(question);

    if (!cleanQuestion) {
      return {
        success: false,
        urls: [],
        failed: [],
        reason:
          "Research question is required.",
      };
    }

    const limit =
      clamp(
        options.maxSources,
        1,
        SEARCH_RESULT_LIMIT,
        this.maxSources
      );

    const searchUrl =
      "https://www.bing.com/search?q=" +
      encodeURIComponent(
        cleanQuestion
      ) +
      `&count=${Math.min(
        limit * 2,
        20
      )}`;

    try {
      const page =
        await this.browser.open(
          searchUrl,
          {
            timeoutMs:
              options.searchTimeoutMs ||
              SEARCH_TIMEOUT_MS,
            maxBytes:
              2 * 1024 * 1024,
          }
        );

      if (
        !page?.success
      ) {
        return {
          success: false,
          urls: [],
          failed: [
            {
              url: searchUrl,
              error:
                page?.error ||
                "Search page could not be opened.",
            },
          ],
        };
      }

      const searchHost =
        new URL(
          searchUrl
        ).hostname;

      const urls = [];

      const seen =
        new Set();

      for (
        const link of
        Array.isArray(
          page.links
        )
          ? page.links
          : []
      ) {
        try {
          const candidate =
            new URL(
              link,
              searchUrl
            );

          if (
            !/^https?:$/.test(
              candidate.protocol
            )
          ) {
            continue;
          }

          if (
            candidate.hostname ===
            searchHost
          ) {
            continue;
          }

          const normalized =
            candidate.toString();

          if (
            seen.has(
              normalized
            )
          ) {
            continue;
          }

          seen.add(
            normalized
          );

          urls.push(
            normalized
          );

          if (
            urls.length >=
            limit
          ) {
            break;
          }
        } catch {
          continue;
        }
      }

      return {
        success:
          urls.length > 0,
        urls,
        failed: [],
        searchUrl,
      };
    } catch (error) {
      return {
        success: false,
        urls: [],
        failed: [
          {
            url: searchUrl,
            error:
              error?.message ||
              String(error),
          },
        ],
      };
    }
  }


  // ==========================================================
  // FULL RESEARCH
  // ==========================================================

  async research({
    question,
    urls = [],
    discover = false,
    options = {},
  } = {}) {
    const cleanQuestion =
      safeString(
        question
      );

    if (!cleanQuestion) {
      return {
        success: false,

        status:
          "invalid_question",

        reason:
          "Research question is required.",
      };
    }

    if (
      cleanQuestion.length >
      MAX_QUESTION_LENGTH
    ) {
      return {
        success: false,

        status:
          "invalid_question",

        reason:
          "Research question is too long.",
      };
    }

      let fetched;

    let researchUrls =
      Array.isArray(urls)
        ? urls.filter(Boolean)
        : [];

    // Agar user ne direct URLs nahi diye,
    // pehle public web se sources discover karo.
    if (
      researchUrls.length === 0
    ) {
      const discovered =
        await this.discoverSources(
          cleanQuestion,
          options
        );

      if (
        !discovered.success ||
        discovered.urls.length === 0
      ) {
        return {
          success: false,
          status: "no_sources",
          question:
            cleanQuestion,
          sources: [],
          failed:
            discovered.failed || [],
          reason:
            discovered.reason ||
            "Public web se research sources discover nahi ho paaye.",
        };
      }

      researchUrls =
        discovered.urls;
    }

    if (
      discover &&
      researchUrls.length > 0
    ) {
      fetched =
        await this.discoverFromPage(
          researchUrls[0],
          options
        );
    } else {
      fetched =
        await this.fetchSources(
          researchUrls,
          options
        );
    }

    if (
      !fetched.success ||
      fetched.sources.length === 0
    ) {
      return {
        success: false,

        status:
          "no_sources",

        question:
          cleanQuestion,

        sources: [],

        failed:
          fetched.failed || [],

        reason:
          "No readable public research sources were available.",
      };
    }

    const synthesis =
      await this.synthesize(
        cleanQuestion,
        fetched.sources,
        options
      );

    if (
      !synthesis.success
    ) {
      return {
        success: false,

        status:
          "synthesis_failed",

        question:
          cleanQuestion,

        sources:
          fetched.sources,

        failed:
          fetched.failed || [],

        reason:
          synthesis.reason,
      };
    }

    return {
      success: true,

      status:
        "completed",

      question:
        cleanQuestion,

      report:
        synthesis.report,

      sources:
        fetched.sources.map(
          (source) => ({
            id:
              source.id,

            title:
              source.title,

            url:
              source.url,

            fetchedAt:
              source.fetchedAt,
          })
        ),

      failed:
        fetched.failed || [],

      sourceCount:
        fetched.sources.length,

      timestamp:
        new Date().toISOString(),
    };
  }


  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      name:
        "ALEX Research Engine",

      version:
        this.version,

      capabilities: [
        "public_web_research",
        "multi_source_fetch",
        "link_discovery",
        "source_normalization",
        "gemini_synthesis",
        "source_tracking",
      ],

      limits: {
        maxSources:
          this.maxSources,

        maxTextPerSource:
          this.maxTextPerSource,

        maxQuestionLength:
          MAX_QUESTION_LENGTH,

        maxPromptLength:
          MAX_PROMPT_LENGTH,
      },

      timestamp:
        new Date().toISOString(),
    };
  }
}


// ============================================================
// SINGLETON
// ============================================================

let singletonResearch =
  null;


function getAgentResearchEngine(
  options = {}
) {
  if (
    !singletonResearch
  ) {
    singletonResearch =
      new AgentResearchEngine(
        options
      );
  }

  return singletonResearch;
}


function resetAgentResearchEngine() {
  singletonResearch =
    null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  AgentResearchEngine,

  getAgentResearchEngine,

  resetAgentResearchEngine,
};