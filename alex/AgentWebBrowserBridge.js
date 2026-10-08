// ============================================================
// ALEX WEB BROWSER BRIDGE
// File: backend/alex/AgentWebBrowserBridge.js
//
// Purpose:
//   Controlled web access for ALEX.
//
// Capabilities:
//   - Open public HTTP/HTTPS pages
//   - Extract readable text
//   - Extract links
//   - Follow links
//   - Crawl a small number of public pages
//   - Search-like research from supplied URLs
//   - Safe redirect handling
//
// Security:
//   - HTTP/HTTPS only
//   - Blocks localhost
//   - Blocks private IPv4 ranges
//   - Blocks loopback/link-local ranges
//   - Blocks localhost-style hostnames
//   - Limits response size
//   - Limits redirects
//   - Limits crawl depth
//   - Does not execute page JavaScript
//   - Does not submit forms
//   - Does not expose arbitrary filesystem access
//
// This is a web-research/browser foundation.
// Interactive browser actions can be added later through the
// existing WindowsAgent screen/input layer.
// ============================================================

const dns = require("dns").promises;


// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "1.0.0";

const DEFAULT_TIMEOUT_MS = 15000;

const MAX_TIMEOUT_MS = 30000;

const DEFAULT_MAX_BYTES =
  2 * 1024 * 1024;

const MAX_BYTES =
  5 * 1024 * 1024;

const DEFAULT_MAX_REDIRECTS = 5;

const MAX_REDIRECTS = 8;

const DEFAULT_MAX_LINKS = 50;

const MAX_LINKS = 100;

const DEFAULT_MAX_CRAWL_PAGES = 5;

const MAX_CRAWL_PAGES = 10;

const DEFAULT_MAX_TEXT = 50000;

const MAX_TEXT = 100000;


// ============================================================
// USER AGENT
// ============================================================

const USER_AGENT =
  "ALEX-Agent/1.0 (+authorized web research)";


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


function clampNumber(
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


function normalizeUrl(
  rawUrl
) {
  const value =
    safeString(rawUrl);

  if (!value) {
    throw new Error(
      "URL is required."
    );
  }

  let url;

  try {
    url =
      new URL(value);
  } catch {
    throw new Error(
      "Invalid URL."
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs are allowed."
    );
  }

  url.hash = "";

  return url;
}


function isIPv4(
  hostname
) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(
    hostname
  );
}


function ipv4ToNumbers(
  ip
) {
  const parts =
    ip.split(".")
      .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return null;
  }

  return parts;
}


function isPrivateIPv4(
  ip
) {
  const parts =
    ipv4ToNumbers(ip);

  if (!parts) {
    return false;
  }

  const [
    a,
    b,
  ] = parts;

  // 10.0.0.0/8
  if (a === 10) {
    return true;
  }

  // 127.0.0.0/8
  if (a === 127) {
    return true;
  }

  // 169.254.0.0/16
  if (
    a === 169 &&
    b === 254
  ) {
    return true;
  }

  // 172.16.0.0/12
  if (
    a === 172 &&
    b >= 16 &&
    b <= 31
  ) {
    return true;
  }

  // 192.168.0.0/16
  if (
    a === 192 &&
    b === 168
  ) {
    return true;
  }

  // 100.64.0.0/10
  if (
    a === 100 &&
    b >= 64 &&
    b <= 127
  ) {
    return true;
  }

  // 0.0.0.0/8
  if (a === 0) {
    return true;
  }

  return false;
}


function isBlockedHostname(
  hostname
) {
  const host =
    safeString(
      hostname
    ).toLowerCase();

  if (!host) {
    return true;
  }

  if (
    host === "localhost" ||
    host.endsWith(
      ".localhost"
    ) ||
    host === "localhost.localdomain"
  ) {
    return true;
  }

  if (
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }

  if (
    isIPv4(host) &&
    isPrivateIPv4(host)
  ) {
    return true;
  }

  return false;
}


async function assertPublicUrl(
  url
) {
  const hostname =
    url.hostname;

  if (
    isBlockedHostname(
      hostname
    )
  ) {
    throw new Error(
      "Access to local/private network hosts is blocked."
    );
  }

  // Direct IPv4 target.
  if (
    isIPv4(hostname)
  ) {
    return;
  }

  // Resolve hostname and reject private IPv4 targets.
  try {
    const addresses =
      await dns.lookup(
        hostname,
        {
          all: true,
        }
      );

    for (
      const address
      of addresses
    ) {
      if (
        address.family === 4 &&
        isPrivateIPv4(
          address.address
        )
      ) {
        throw new Error(
          "The hostname resolves to a private/local IPv4 address."
        );
      }

      if (
        address.family === 6
      ) {
        const value =
          address.address
            .toLowerCase();

        if (
          value === "::1" ||
          value.startsWith(
            "fc"
          ) ||
          value.startsWith(
            "fd"
          ) ||
          value.startsWith(
            "fe80:"
          )
        ) {
          throw new Error(
            "The hostname resolves to a private/local IPv6 address."
          );
        }
      }
    }
  } catch (error) {
    if (
      error?.message?.includes(
        "private/local"
      )
    ) {
      throw error;
    }

    // DNS failure is reported to caller.
    throw new Error(
      `DNS lookup failed for ${hostname}.`
    );
  }
}


function stripHtml(
  html
) {
  return String(html)
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function extractTitle(
  html
) {
  const match =
    String(html).match(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) {
    return "";
  }

  return stripHtml(
    match[1]
  ).slice(
    0,
    500
  );
}


function extractLinks(
  html,
  baseUrl,
  maxLinks
) {
  const links =
    [];

  const seen =
    new Set();

  const source =
    String(html);

  const regex =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match =
      regex.exec(source)) !==
      null
  ) {
    const raw =
      safeString(
        match[1]
      );

    if (!raw) {
      continue;
    }

    if (
      raw.startsWith(
        "#"
      ) ||
      raw.startsWith(
        "javascript:"
      ) ||
      raw.startsWith(
        "mailto:"
      ) ||
      raw.startsWith(
        "tel:"
      )
    ) {
      continue;
    }

    try {
      const resolved =
        new URL(
          raw,
          baseUrl
        );

      if (
        resolved.protocol !==
          "http:" &&
        resolved.protocol !==
          "https:"
      ) {
        continue;
      }

      resolved.hash = "";

      const value =
        resolved.toString();

      if (
        seen.has(value)
      ) {
        continue;
      }

      seen.add(value);

      links.push(
        value
      );

      if (
        links.length >=
        maxLinks
      ) {
        break;
      }
    } catch {
      // Ignore malformed links.
    }
  }

  return links;
}


function detectContentType(
  response
) {
  return safeString(
    response.headers.get(
      "content-type"
    ),
    ""
  ).toLowerCase();
}


async function readResponseText(
  response,
  maxBytes
) {
  const reader =
    response.body?.getReader?.();

  if (!reader) {
    const text =
      await response.text();

    if (
      Buffer.byteLength(
        text,
        "utf8"
      ) > maxBytes
    ) {
      throw new Error(
        "Response exceeds the maximum allowed size."
      );
    }

    return text;
  }

  const chunks =
    [];

  let total =
    0;

  while (true) {
    const {
      done,
      value,
    } =
      await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total +=
      value.byteLength;

    if (
      total > maxBytes
    ) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failure.
      }

      throw new Error(
        "Response exceeds the maximum allowed size."
      );
    }

    chunks.push(
      Buffer.from(value)
    );
  }

  return Buffer.concat(
    chunks
  ).toString(
    "utf8"
  );
}


// ============================================================
// MAIN CLASS
// ============================================================

class AgentWebBrowserBridge {
  constructor(options = {}) {
    this.version =
      VERSION;

    this.timeoutMs =
      clampNumber(
        options.timeoutMs,
        1000,
        MAX_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS
      );

    this.maxBytes =
      clampNumber(
        options.maxBytes,
        10000,
        MAX_BYTES,
        DEFAULT_MAX_BYTES
      );

    this.maxRedirects =
      clampNumber(
        options.maxRedirects,
        0,
        MAX_REDIRECTS,
        DEFAULT_MAX_REDIRECTS
      );

    this.maxLinks =
      clampNumber(
        options.maxLinks,
        1,
        MAX_LINKS,
        DEFAULT_MAX_LINKS
      );

    this.maxCrawlPages =
      clampNumber(
        options.maxCrawlPages,
        1,
        MAX_CRAWL_PAGES,
        DEFAULT_MAX_CRAWL_PAGES
      );

    this.maxText =
      clampNumber(
        options.maxText,
        1000,
        MAX_TEXT,
        DEFAULT_MAX_TEXT
      );
  }


  // ==========================================================
  // FETCH ONE PAGE
  // ==========================================================

  async open(
    rawUrl,
    options = {}
  ) {
    let url =
      normalizeUrl(
        rawUrl
      );

    const timeoutMs =
      clampNumber(
        options.timeoutMs,
        1000,
        MAX_TIMEOUT_MS,
        this.timeoutMs
      );

    const maxBytes =
      clampNumber(
        options.maxBytes,
        10000,
        MAX_BYTES,
        this.maxBytes
      );

    const maxRedirects =
      clampNumber(
        options.maxRedirects,
        0,
        MAX_REDIRECTS,
        this.maxRedirects
      );

    let redirects =
      0;

    while (true) {
      await assertPublicUrl(
        url
      );

      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          timeoutMs
        );

      try {
        const response =
          await fetch(
            url,
            {
              method:
                "GET",

              headers: {
                "User-Agent":
                  USER_AGENT,

                "Accept":
                  "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",

                "Accept-Language":
                  "en-US,en;q=0.8",
              },

              redirect:
                "manual",

              signal:
                controller.signal,
            }
          );

        // ------------------------------------------------------
        // REDIRECT
        // ------------------------------------------------------

        if (
          [
            301,
            302,
            303,
            307,
            308,
          ].includes(
            response.status
          )
        ) {
          const location =
            response.headers.get(
              "location"
            );

          if (!location) {
            throw new Error(
              "Redirect response has no location."
            );
          }

          redirects += 1;

          if (
            redirects >
            maxRedirects
          ) {
            throw new Error(
              "Maximum redirect limit reached."
            );
          }

          url =
            new URL(
              location,
              url
            );

          if (
            url.protocol !==
              "http:" &&
            url.protocol !==
              "https:"
          ) {
            throw new Error(
              "Redirected to an unsupported protocol."
            );
          }

          continue;
        }

        if (
          !response.ok
        ) {
          return {
            success: false,

            status:
              response.status,

            url:
              url.toString(),

            error:
              `HTTP ${response.status}`,
          };
        }

        const contentType =
          detectContentType(
            response
          );

        const body =
          await readResponseText(
            response,
            maxBytes
          );

        const isHtml =
          contentType.includes(
            "text/html"
          ) ||
          contentType.includes(
            "application/xhtml"
          );

        const isText =
          contentType.includes(
            "text/plain"
          ) ||
          contentType.includes(
            "application/json"
          ) ||
          isHtml;

        if (!isText) {
          return {
            success: false,

            status:
              response.status,

            url:
              url.toString(),

            contentType,

            error:
              "Unsupported non-text web response.",
          };
        }

        const title =
          isHtml
            ? extractTitle(
                body
              )
            : "";

        const text =
          isHtml
            ? stripHtml(
                body
              )
            : body
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

        const links =
          isHtml
            ? extractLinks(
                body,
                url,
                this.maxLinks
              )
            : [];

        return {
          success: true,

          status:
            response.status,

          url:
            url.toString(),

          finalUrl:
            url.toString(),

          contentType,

          title,

          text:
            text.slice(
              0,
              this.maxText
            ),

          textLength:
            text.length,

          links,

          linkCount:
            links.length,

          redirects,

          fetchedAt:
            new Date().toISOString(),
        };
      } catch (error) {
        const message =
          error?.name ===
          "AbortError"
            ? "Web request timed out."
            : error?.message ||
              String(error);

        return {
          success: false,

          url:
            url.toString(),

          redirects,

          error:
            message,

          fetchedAt:
            new Date().toISOString(),
        };
      } finally {
        clearTimeout(
          timer
        );
      }
    }
  }


  // ==========================================================
  // OPEN MULTIPLE URLS
  // ==========================================================

  async openMany(
    urls = [],
    options = {}
  ) {
    if (
      !Array.isArray(urls)
    ) {
      throw new Error(
        "urls must be an array."
      );
    }

    const unique =
      [
        ...new Set(
          urls
            .map(
              (url) =>
                safeString(
                  url
                )
            )
            .filter(Boolean)
        ),
      ].slice(
        0,
        this.maxCrawlPages
      );

    const results =
      await Promise.all(
        unique.map(
          (url) =>
            this.open(
              url,
              options
            )
        )
      );

    return {
      success:
        results.some(
          (item) =>
            item.success
        ),

      results,

      succeeded:
        results.filter(
          (item) =>
            item.success
        ).length,

      failed:
        results.filter(
          (item) =>
            !item.success
        ).length,

      timestamp:
        new Date().toISOString(),
    };
  }


  // ==========================================================
  // FOLLOW LINKS
  // ==========================================================

  async follow(
    rawUrl,
    options = {}
  ) {
    const first =
      await this.open(
        rawUrl,
        options
      );

    if (
      !first.success
    ) {
      return {
        success: false,

        root:
          first,

        pages: [],
      };
    }

    const requested =
      clampNumber(
        options.limit,
        1,
        this.maxCrawlPages,
        3
      );

    const links =
      Array.isArray(
        first.links
      )
        ? first.links.slice(
            0,
            requested
          )
        : [];

    const pages =
      await this.openMany(
        links,
        options
      );

    return {
      success: true,

      root:
        first,

      pages:
        pages.results,

      succeeded:
        pages.succeeded,

      failed:
        pages.failed,

      timestamp:
        new Date().toISOString(),
    };
  }


  // ==========================================================
  // RESEARCH FROM URLS
  // ==========================================================

  async research(
    urls = [],
    options = {}
  ) {
    const pages =
      await this.openMany(
        urls,
        options
      );

    const successful =
      pages.results.filter(
        (page) =>
          page.success
      );

    const sources =
      successful.map(
        (page) => ({
          title:
            page.title,

          url:
            page.finalUrl ||
            page.url,

          text:
            page.text,

          fetchedAt:
            page.fetchedAt,
        })
      );

    return {
      success:
        successful.length > 0,

      sources,

      sourceCount:
        sources.length,

      failed:
        pages.results.filter(
          (page) =>
            !page.success
        ),

      timestamp:
        new Date().toISOString(),
    };
  }


  // ==========================================================
  // LINK DISCOVERY ONLY
  // ==========================================================

  async discoverLinks(
    rawUrl,
    options = {}
  ) {
    const page =
      await this.open(
        rawUrl,
        options
      );

    if (
      !page.success
    ) {
      return page;
    }

    return {
      success: true,

      url:
        page.finalUrl ||
        page.url,

      title:
        page.title,

      links:
        page.links,

      linkCount:
        page.linkCount,

      fetchedAt:
        page.fetchedAt,
    };
  }


  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      name:
        "ALEX Web Browser Bridge",

      version:
        this.version,

      capabilities: [
        "open_public_url",
        "extract_text",
        "extract_links",
        "follow_links",
        "multi_page_research",
      ],

      restrictions: [
        "http_https_only",
        "private_network_blocked",
        "localhost_blocked",
        "javascript_not_executed",
        "forms_not_submitted",
        "response_size_limited",
        "redirects_limited",
        "crawl_depth_limited",
      ],

      limits: {
        timeoutMs:
          this.timeoutMs,

        maxBytes:
          this.maxBytes,

        maxRedirects:
          this.maxRedirects,

        maxLinks:
          this.maxLinks,

        maxCrawlPages:
          this.maxCrawlPages,

        maxText:
          this.maxText,
      },

      timestamp:
        new Date().toISOString(),
    };
  }
}


// ============================================================
// SINGLETON
// ============================================================

let singletonBrowser =
  null;


function getAgentWebBrowserBridge(
  options = {}
) {
  if (
    !singletonBrowser
  ) {
    singletonBrowser =
      new AgentWebBrowserBridge(
        options
      );
  }

  return singletonBrowser;
}


function resetAgentWebBrowserBridge() {
  singletonBrowser =
    null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,

  AgentWebBrowserBridge,

  getAgentWebBrowserBridge,

  resetAgentWebBrowserBridge,
};