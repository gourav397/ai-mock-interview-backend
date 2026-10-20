// ============================================================
// ALEX Gemini Client — Production / High Reliability
// Uses centralized geminiKeys.js for key rotation/state
//
// IMPORTANT:
// - Gemini model fallback
// - Automatic API-key rotation
// - Automatic retry / backoff
// - Handles 429 / 401 / 403 / 404 / 5xx / timeout / network errors
// - Preserves centralized keyManager state
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
      "gemini-3.8-flash";

    this.available = envStatus.count > 0;

    console.log(
      `🤖 [ALEX] Gemini client ready — model: ${this.model} | keys: ${envStatus.count}`
    );
  }

  isAvailable() {
    try {
      return (
        this.available &&
        envStatus.count > 0 &&
        keyManager.usableCount() > 0
      );
    } catch {
      return this.available && envStatus.count > 0;
    }
  }

  async _sleep(ms) {
    if (!ms || ms <= 0) return;

    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  _getRetryDelay(attempt, response = null) {
    try {
      const retryAfter =
        response?.headers?.get?.("retry-after");

      if (retryAfter) {
        const seconds = Number(retryAfter);

        if (
          Number.isFinite(seconds) &&
          seconds > 0
        ) {
          return Math.min(
            seconds * 1000,
            15000
          );
        }
      }
    } catch {
      // Ignore Retry-After parsing errors
    }

    const base = Math.min(
      1000 * Math.pow(2, attempt),
      8000
    );

    const jitter = Math.floor(
      Math.random() * 500
    );

    return base + jitter;
  }

 
  _getMaxAttempts(chatMode, options = {}) {
    const keyCount = Math.max(
      1,
      Math.min(15, Number(keyManager.count) || 1)
    );

    // Normal ALEX chat ko fast rakho.
    if (chatMode) {
      const requestedRetries =
        typeof options.retries === "number"
          ? Math.max(0, Math.floor(options.retries))
          : 2;

      return Math.min(3, requestedRetries + 1);
    }

    // Interview/question generation:
    // available keys ko retry attempts mein use karo.
    const requestedRetries =
      typeof options.retries === "number"
        ? Math.max(0, Math.floor(options.retries))
        : 0;

    return Math.min(
      15,
      Math.max(keyCount, requestedRetries + 1)
    );
  }

  _buildGenerationConfig({
    chatMode,
    maxOutputTokens,
    responseMimeType,
  }) {
    /*
     * Keep the generation configuration compatible
     * with the selected Gemini model.
     */
    const config = {
      maxOutputTokens,
    };

    if (responseMimeType) {
      config.responseMimeType =
        responseMimeType;
    }

    return config;
  }

  async call(prompt, options = {}) {
    if (
      !this.available ||
      envStatus.count === 0
    ) {
      return {
        error: true,
        message:
          "Gemini API is not configured",
        aiUnavailable: true,
      };
    }

    const chatMode =
      options.chatMode === true;

    const timeoutMs =
      typeof options.timeoutMs === "number"
        ? Math.max(
            5000,
            options.timeoutMs
          )
        : chatMode
          ? 30000
          : 60000;

    const maxOutputTokens =
      typeof options.maxOutputTokens === "number"
        ? Math.max(
            128,
            options.maxOutputTokens
          )
        : chatMode
          ? 2000
          : 4096;

    const responseMimeType =
      options.responseMimeType ||
      (chatMode
        ? "text/plain"
        : "application/json");

    const model =
      options.model ||
      this.model;

    /*
     * Model fallback order:
     * 1. Model requested by caller or environment
     * 2. gemini-3.6-flash
     * 3. gemini-3.5-flash-lite
     *
     * Duplicate model names are removed.
     */
    const modelCandidates = [
      ...new Set(
        [
          model,
          "gemini-3.6-flash",
          "gemini-3.5-flash-lite",
        ].filter(Boolean)
      ),
    ];

    const safePrompt =
      String(prompt || "").trim();

    if (!safePrompt) {
      return {
        error: true,
        message:
          "Gemini prompt is empty",
        aiUnavailable: false,
      };
    }

    const truncatedPrompt =
      safePrompt.length > 12000
        ? safePrompt.slice(0, 12000) +
          "\n...[truncated]"
        : safePrompt;

    const maxAttempts =
      this._getMaxAttempts(
        chatMode,
        options
      );

    let lastError = null;

    let consecutiveNoKeyAttempts = 0;

    const failedModels = new Set();

    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt++
    ) {
      /*
       * Select a model for this attempt.
       * If a model returns 404, the next attempt
       * will try another configured candidate.
       */
      const availableModels =
        modelCandidates.filter(
          (candidate) =>
            !failedModels.has(candidate)
        );

      if (availableModels.length === 0) {
        lastError =
          lastError ||
          new Error(
            "All configured Gemini models failed"
          );

        break;
      }

      const requestModel =
        availableModels[
          attempt % availableModels.length
        ];

      let keyObj = null;

      try {
        keyObj =
          keyManager.nextKey();
      } catch (keyError) {
        lastError = keyError;
      }

      /*
       * No currently usable key.
       * Wait for key cooldown if possible instead
       * of immediately failing.
       */
      if (!keyObj) {
        consecutiveNoKeyAttempts++;

        let waitMs = null;

        try {
          waitMs =
            keyManager.minWaitMs();
        } catch {
          waitMs = null;
        }

        if (
          waitMs !== null &&
          Number.isFinite(waitMs) &&
          waitMs > 0
        ) {
          const safeWait =
            Math.min(waitMs, 10000);

          console.log(
            `⏳ [ALEX] Waiting ${safeWait}ms for Gemini key availability`
          );

          await this._sleep(
            safeWait
          );

          continue;
        }

        /*
         * Small recovery wait before another
         * key-manager attempt.
         */
        if (
          consecutiveNoKeyAttempts <
          maxAttempts
        ) {
          await this._sleep(1000);
          continue;
        }

        break;
      }

      consecutiveNoKeyAttempts = 0;

      const controller =
        new AbortController();

      const timer =
        setTimeout(() => {
          controller.abort();
        }, timeoutMs);

      try {
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${encodeURIComponent(requestModel)}:generateContent`;

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

          generationConfig:
            this._buildGenerationConfig({
              chatMode,
              maxOutputTokens,
              responseMimeType,
            }),
        };

        console.log(
          `🤖 [ALEX] Gemini request — attempt ${
            attempt + 1
          }/${maxAttempts} | model: ${requestModel} | key #${
            keyObj.index + 1
          }`
        );

        const res =
          await fetch(url, {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
              "x-goog-api-key":
                keyObj.key,
            },

            body:
              JSON.stringify(body),

            signal:
              controller.signal,
          });

        clearTimeout(timer);

        let responseText = "";
        let responseBody = null;

        try {
          responseText =
            await res.text();

          if (responseText) {
            responseBody =
              JSON.parse(
                responseText
              );
          }
        } catch {
          responseBody = null;
        }

        // ====================================================
        // SUCCESS
        // ====================================================

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

          const text =
            parts
              .map((part) =>
                typeof part?.text ===
                "string"
                  ? part.text
                  : ""
              )
              .join("")
              .trim();

          if (text) {
            try {
              keyManager.reportSuccess(
                keyObj
              );
            } catch {
              // Response is already successful.
            }

            console.log(
              `✅ [ALEX] Gemini response received — model: ${requestModel} | ${text.length} chars`
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
              ?.blockReason ||
            null;

          lastError =
            new Error(
              blockReason
                ? `Gemini blocked response: ${blockReason}`
                : `Gemini returned no text. Finish reason: ${finishReason}`
            );

          console.log(
            `⚠️ [ALEX] Gemini returned no usable text — model: ${requestModel} — attempt ${
              attempt + 1
            }/${maxAttempts}`
          );

          try {
            keyManager.reportFailure(
              keyObj,
              "soft"
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          if (
            attempt <
            maxAttempts - 1
          ) {
            await this._sleep(
              this._getRetryDelay(
                attempt
              )
            );
          }

          continue;
        }

        // ====================================================
        // 429 — RATE LIMIT / QUOTA
        // ====================================================

        if (res.status === 429) {
          const lowerBody =
            responseText.toLowerCase();

          const isDaily =
            /per day|daily|requests per day|rpd|quota/i.test(
              lowerBody
            );

          console.log(
            `⏸️ [ALEX] Gemini 429 — model: ${requestModel} — key #${
              keyObj.index + 1
            } — ${
              isDaily
                ? "daily quota"
                : "rate limit"
            }`
          );

          try {
            keyManager.reportFailure(
              keyObj,
              "quota",
              {
                isDaily,
              }
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          lastError =
            new Error(
              isDaily
                ? "Gemini daily quota exhausted"
                : "Gemini rate limited"
            );

          if (
            attempt <
            maxAttempts - 1
          ) {
            await this._sleep(
              this._getRetryDelay(
                attempt,
                res
              )
            );
          }

          continue;
        }

        // ====================================================
        // 401 / 403 — INVALID / REJECTED KEY
        // ====================================================

        if (
          res.status === 401 ||
          res.status === 403
        ) {
          console.log(
            `🚫 [ALEX] Gemini key #${
              keyObj.index + 1
            } rejected (${res.status})`
          );

          try {
            keyManager.reportFailure(
              keyObj,
              "keyInvalid",
              {
                detail:
                  `HTTP ${res.status}`,
              }
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          lastError =
            new Error(
              `Gemini API key rejected (${res.status})`
            );

          // Immediately rotate to another key.
          continue;
        }

        // ====================================================
        // 404 — MODEL NOT FOUND
        // ====================================================

        if (res.status === 404) {
          console.log(
            `⚠️ [ALEX] Gemini model not found: ${requestModel}; trying fallback model if available`
          );

          failedModels.add(requestModel);

          try {
            keyManager.reportFailure(
              keyObj,
              "model404"
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          lastError =
            new Error(
              `Gemini model "${requestModel}" not found`
            );

          const remainingModels =
            modelCandidates.filter(
              (candidateModel) =>
                !failedModels.has(
                  candidateModel
                )
            );

          if (
            remainingModels.length > 0 &&
            attempt < maxAttempts - 1
          ) {
            // Move to the next available model.
            continue;
          }

          if (
            remainingModels.length === 0
          ) {
            console.log(
              "❌ [ALEX] All fallback Gemini models returned 404"
            );

            break;
          }

          continue;
        }

        // ====================================================
        // 5xx — GEMINI SERVER ERROR
        // ====================================================

        if (res.status >= 500) {
          console.log(
            `🔴 [ALEX] Gemini server error ${
              res.status
            } — model: ${requestModel} — attempt ${
              attempt + 1
            }/${maxAttempts}`
          );

          try {
            keyManager.reportFailure(
              keyObj,
              "serverError"
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          const providerMessage =
            responseBody?.error?.message ||
            responseText.slice(0, 300);

          lastError =
            new Error(
              `Gemini HTTP ${res.status}${
                providerMessage
                  ? `: ${providerMessage}`
                  : ""
              }`
            );

          if (
            attempt <
            maxAttempts - 1
          ) {
            await this._sleep(
              this._getRetryDelay(
                attempt,
                res
              )
            );
          }

          continue;
        }

        // ====================================================
        // OTHER HTTP ERROR
        // ====================================================

        const errorMessage =
          responseBody?.error
            ?.message ||
          responseText.slice(
            0,
            500
          ) ||
          `Gemini HTTP ${res.status}`;

        console.log(
          `⚠️ [ALEX] Gemini HTTP ${res.status} — model: ${requestModel} — rotating/retrying`
        );

        lastError =
          new Error(
            errorMessage
          );

        try {
          keyManager.reportFailure(
            keyObj,
            "soft"
          );
        } catch {
          // Ignore key-manager reporting failure.
        }

        if (
          attempt <
          maxAttempts - 1
        ) {
          await this._sleep(
            this._getRetryDelay(
              attempt,
              res
            )
          );
        }

        continue;
      } catch (error) {
        clearTimeout(timer);

        lastError = error;

        // ====================================================
        // TIMEOUT
        // ====================================================

        if (
          error?.name ===
          "AbortError"
        ) {
          console.log(
            `⏱️ [ALEX] Gemini timeout (${timeoutMs}ms) — model: ${requestModel} — attempt ${
              attempt + 1
            }/${maxAttempts}`
          );

          try {
            keyManager.reportFailure(
              keyObj,
              "timeout"
            );
          } catch {
            // Ignore key-manager reporting failure.
          }

          if (
            attempt <
            maxAttempts - 1
          ) {
            await this._sleep(
              this._getRetryDelay(
                attempt
              )
            );
          }

          continue;
        }

        // ====================================================
        // NETWORK / FETCH ERROR
        // ====================================================

        console.log(
          `🔴 [ALEX] Gemini network error — model: ${requestModel} — attempt ${
            attempt + 1
          }/${maxAttempts}: ${error?.message || "unknown error"}`
        );

        try {
          keyManager.reportFailure(
            keyObj,
            "soft"
          );
        } catch {
          // Ignore key-manager reporting failure.
        }

        if (
          attempt <
          maxAttempts - 1
        ) {
          await this._sleep(
            this._getRetryDelay(
              attempt
            )
          );
        }

        continue;
      }
    }

    // ========================================================
    // FINAL INTERNAL FAILURE
    //
    // Do NOT pretend that an AI answer was generated.
    // The caller can decide how to recover gracefully.
    // ========================================================

    console.log(
      `❌ [ALEX] Gemini exhausted recovery attempts: ${
        lastError?.message ||
        "unknown Gemini failure"
      }`
    );

    return {
      error: true,
      message:
        lastError?.message ||
        "Gemini service temporarily unavailable",
      aiUnavailable: true,
      retryable: true,
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