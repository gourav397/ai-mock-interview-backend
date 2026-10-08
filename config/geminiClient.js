// ============================================================
// ALEX Gemini Client — Production
// Uses centralized geminiKeys.js for key rotation/state
// ============================================================

const {
  keyManager,
  envStatus,
} = require("./geminiKeys");

class AlexGeminiClient {
  constructor() {
    this.model =
      process.env.ALEX_GEMINI_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-3.5-flash";

    this.available = envStatus.count > 0;

    console.log(
      `🤖 [ALEX] Gemini client ready — model: ${this.model} | keys: ${envStatus.count}`
    );
  }

  isAvailable() {
    return this.available && keyManager.usableCount() > 0;
  }

  async _sleep(ms) {
    if (!ms || ms <= 0) return;

    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  _getRetryDelay(attempt, response = null) {
    // Respect Gemini/server Retry-After if available
    try {
      const retryAfter =
        response?.headers?.get?.("retry-after");

      if (retryAfter) {
        const seconds = Number(retryAfter);

        if (Number.isFinite(seconds) && seconds > 0) {
          return Math.min(seconds * 1000, 15000);
        }
      }
    } catch {
      // Ignore header parsing errors
    }

    // Exponential backoff:
    // attempt 0 -> 1000ms
    // attempt 1 -> 2000ms
    // attempt 2 -> 4000ms
    // attempt 3 -> 8000ms
    // attempt 4 -> 10000ms max

    const base = Math.min(
      1000 * Math.pow(2, attempt),
      10000
    );

    // Small jitter prevents synchronized retries
    const jitter = Math.floor(Math.random() * 500);

    return base + jitter;
  }

  async call(prompt, options = {}) {
    if (!this.available || envStatus.count === 0) {
      return {
        error: true,
        message: "No Gemini API keys configured",
        aiUnavailable: true,
      };
    }

    const chatMode = options.chatMode === true;

    const temperature =
      typeof options.temperature === "number"
        ? options.temperature
        : chatMode
          ? 0.8
          : 0.3;

    const timeoutMs =
      typeof options.timeoutMs === "number"
        ? options.timeoutMs
        : chatMode
          ? 15000
          : 60000;

    const maxOutputTokens =
      typeof options.maxOutputTokens === "number"
        ? options.maxOutputTokens
        : chatMode
          ? 2000
          : 4096;

    const maxRetries =
      typeof options.retries === "number"
        ? Math.max(1, options.retries)
        : chatMode
          ? 3
          : Math.min(
              5,
              Math.max(3, keyManager.count)
            );

    const responseMimeType =
      options.responseMimeType ||
      (chatMode
        ? "text/plain"
        : "application/json");

    const model =
      options.model || this.model;

    const safePrompt = String(prompt || "");

    if (!safePrompt.trim()) {
      return {
        error: true,
        message: "Gemini prompt is empty",
      };
    }

    const truncatedPrompt =
      safePrompt.length > 12000
        ? safePrompt.slice(0, 12000) +
          "\n...[truncated]"
        : safePrompt;

    let lastError = null;

    for (
      let attempt = 0;
      attempt < maxRetries;
      attempt++
    ) {
      const keyObj = keyManager.nextKey();

      if (!keyObj) {
        const waitMs =
          keyManager.minWaitMs();

        if (
          waitMs !== null &&
          waitMs > 0 &&
          waitMs < 15000
        ) {
          console.log(
            `⏳ [ALEX] Waiting ${waitMs}ms for an available Gemini key`
          );

          await this._sleep(waitMs);

          continue;
        }

        return {
          error: true,
          message:
            "All Gemini API keys are temporarily unavailable",
          aiUnavailable: true,
        };
      }

      const controller =
        new AbortController();

      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        // ----------------------------------------------------
        // CORRECT GEMINI URL
        // ----------------------------------------------------

        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${encodeURIComponent(model)}:generateContent`;

        const body = {
          contents: [
            {
              parts: [
                {
                  text: truncatedPrompt,
                },
              ],
            },
          ],

          generationConfig: {
            temperature,
            topP: 0.95,
            maxOutputTokens,
            responseMimeType,
          },
        };

        console.log(
          `🤖 [ALEX] Gemini request — attempt ${attempt + 1}/${maxRetries} | model: ${model} | key #${keyObj.index + 1}`
        );

        const res = await fetch(url, {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            "x-goog-api-key": keyObj.key,
          },

          body: JSON.stringify(body),

          signal: controller.signal,
        });

        clearTimeout(timer);

        let responseBody = null;
        let responseText = "";

        try {
          responseText = await res.text();

          if (responseText) {
            responseBody =
              JSON.parse(responseText);
          }
        } catch {
          responseBody = null;
        }

        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------

        if (res.ok) {
          const candidates =
            Array.isArray(
              responseBody?.candidates
            )
              ? responseBody.candidates
              : [];

          const candidate =
            candidates[0];

          const parts =
            Array.isArray(
              candidate?.content?.parts
            )
              ? candidate.content.parts
              : [];

          const text = parts
            .map((part) =>
              typeof part?.text === "string"
                ? part.text
                : ""
            )
            .join("")
            .trim();

          if (text) {
            keyManager.reportSuccess(
              keyObj
            );

            console.log(
              `✅ [ALEX] Gemini response received — ${text.length} chars`
            );

            return {
              error: false,
              text,
            };
          }

          const finishReason =
            candidate?.finishReason ||
            "UNKNOWN";

          const blockReason =
            responseBody
              ?.promptFeedback
              ?.blockReason || null;

          console.log(
            "⚠️ [ALEX] Gemini returned no text:",
            JSON.stringify({
              finishReason,
              blockReason,
              candidates:
                candidates.length,
            })
          );

          lastError = new Error(
            blockReason
              ? `Gemini blocked response: ${blockReason}`
              : `Gemini returned no text. Finish reason: ${finishReason}`
          );

          keyManager.reportFailure(
            keyObj,
            "soft"
          );

          continue;
        }

        // ----------------------------------------------------
        // 429 — RATE LIMIT / QUOTA
        // ----------------------------------------------------

        if (res.status === 429) {
          const lowerBody =
            responseText.toLowerCase();

          const isDaily =
            /per day|daily|requests per day|rpd|quota/i.test(
              lowerBody
            );

          console.log(
            `⏸️ [ALEX] Gemini 429 — key #${
              keyObj.index + 1
            } — ${
              isDaily
                ? "daily quota"
                : "rate limit"
            }`
          );

          keyManager.reportFailure(
            keyObj,
            "quota",
            {
              isDaily,
            }
          );

          lastError = new Error(
            isDaily
              ? "Gemini daily quota exhausted"
              : "Gemini rate limited"
          );

          if (attempt < maxRetries - 1) {
            const delay =
              this._getRetryDelay(
                attempt,
                res
              );

            console.log(
              `⏳ [ALEX] 429 retry in ${delay}ms`
            );

            await this._sleep(delay);
          }

          continue;
        }

        // ----------------------------------------------------
        // 401 / 403 — INVALID KEY
        // ----------------------------------------------------

        if (
          res.status === 401 ||
          res.status === 403
        ) {
          console.log(
            `🚫 [ALEX] Gemini key #${
              keyObj.index + 1
            } rejected (${res.status})`
          );

          keyManager.reportFailure(
            keyObj,
            "keyInvalid",
            {
              detail: `HTTP ${res.status}`,
            }
          );

          lastError = new Error(
            `Gemini API key rejected (${res.status})`
          );

          // No delay needed — immediately try
          // another key.
          continue;
        }

        // ----------------------------------------------------
        // 404 — MODEL NOT FOUND
        // ----------------------------------------------------

        if (res.status === 404) {
          console.log(
            `⚠️ [ALEX] Gemini model not found: ${model}`
          );

          keyManager.reportFailure(
            keyObj,
            "model404"
          );

          lastError = new Error(
            `Gemini model "${model}" not found`
          );

          // Model problem will not be fixed by
          // rotating keys.
          break;
        }

        // ----------------------------------------------------
        // 5xx — GEMINI SERVER ERROR
        // ----------------------------------------------------

        if (res.status >= 500) {
          console.log(
            `🔴 [ALEX] Gemini server error ${res.status} — attempt ${
              attempt + 1
            }/${maxRetries}`
          );

          console.log(
            responseText.slice(0, 500)
          );

          keyManager.reportFailure(
            keyObj,
            "serverError"
          );

          lastError = new Error(
            `Gemini HTTP ${res.status}`
          );

          if (attempt < maxRetries - 1) {
            const delay =
              this._getRetryDelay(
                attempt,
                res
              );

            console.log(
              `⏳ [ALEX] ${res.status} retry in ${delay}ms`
            );

            await this._sleep(delay);
          }

          continue;
        }

        // ----------------------------------------------------
        // OTHER HTTP ERROR
        // ----------------------------------------------------

        const errorMessage =
          responseBody?.error?.message ||
          responseText.slice(0, 500) ||
          `Gemini HTTP ${res.status}`;

        lastError =
          new Error(errorMessage);

        keyManager.reportFailure(
          keyObj,
          "soft"
        );

      } catch (error) {
        clearTimeout(timer);

        lastError = error;

        // ----------------------------------------------------
        // TIMEOUT
        // ----------------------------------------------------

        if (
          error?.name === "AbortError"
        ) {
          console.log(
            `⏱️ [ALEX] Gemini timeout (${timeoutMs}ms) — attempt ${
              attempt + 1
            }/${maxRetries}`
          );

          keyManager.reportFailure(
            keyObj,
            "timeout"
          );

          if (attempt < maxRetries - 1) {
            const delay =
              this._getRetryDelay(
                attempt
              );

            console.log(
              `⏳ [ALEX] Timeout retry in ${delay}ms`
            );

            await this._sleep(delay);
          }

          continue;
        }

        // ----------------------------------------------------
        // NETWORK / FETCH ERROR
        // ----------------------------------------------------

        console.log(
          "🔴 [ALEX] Gemini request error:",
          error?.message || error
        );

        keyManager.reportFailure(
          keyObj,
          "soft"
        );

        if (attempt < maxRetries - 1) {
          const delay =
            this._getRetryDelay(
              attempt
            );

          console.log(
            `⏳ [ALEX] Network retry in ${delay}ms`
          );

          await this._sleep(delay);
        }

        continue;
      }
    }

    // --------------------------------------------------------
    // FINAL FAILURE
    // --------------------------------------------------------

    console.log(
      `❌ [ALEX] Gemini failed after ${maxRetries} attempts: ${
        lastError?.message ||
        "unknown error"
      }`
    );

    return {
      error: true,
      message:
        lastError?.message ||
        "Gemini call failed after retries",
      aiUnavailable: true,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAlexGeminiClient() {
  if (!instance) {
    instance =
      new AlexGeminiClient();
  }

  return instance;
}

module.exports = {
  AlexGeminiClient,
  getAlexGeminiClient,
};