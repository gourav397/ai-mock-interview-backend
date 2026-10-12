/*
 * ============================================================
 * ALEX — AGENT ASSISTANT CORE
 * Version: 2.0.0
 * ============================================================
 *
 * PURPOSE
 * -------
 * ALEX ka unified assistant core.
 *
 * This layer gives ALEX one stable interface for:
 *
 *   • Normal conversation
 *   • Memory
 *   • Web research
 *   • Computer tools
 *   • Autonomous tasks
 *   • Project/system operations
 *   • Capability inspection
 *   • Live weather (read-only)
 *
 * IMPORTANT
 * ---------
 * This file does not bypass authentication, permissions,
 * allowlists, runtime checks, or WindowsAgent authentication.
 *
 * ============================================================
 */

"use strict";

const {
  getAgentConversationGateway,
} = require("./AgentConversationGateway");

const {
  getAgentGoalRouter,
} = require("./AgentGoalRouter");

const {
  getAgentCapabilityHub,
} = require("./AgentCapabilityHub");

// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "2.0.0";

const STATUS = Object.freeze({
  COMPLETED: "completed",
  PROCESSING: "processing",
  FAILED: "failed",
  NEEDS_CONFIRMATION: "waiting_confirmation",
  NEEDS_CLARIFICATION: "needs_clarification",
  PLANNED: "planned",
  UNAVAILABLE: "capability_unavailable",
});

const ROUTES = Object.freeze({
  CHAT: "chat",
  MEMORY: "memory",
  TOOL: "tool",
  RESEARCH: "research",
  AUTONOMOUS: "autonomous",
  CLARIFICATION: "clarification",
  UNKNOWN: "unknown",
});

// ============================================================
// HELPERS
// ============================================================

function stringValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function objectValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function getErrorMessage(error) {
  return (
    error?.message ||
    error?.reason ||
    String(error || "Unknown error")
  );
}

function hasMethod(target, method) {
  return Boolean(
    target &&
    typeof target[method] === "function"
  );
}

function normalizeRole(value) {
  return stringValue(value).toLowerCase();
}

function isOwnerContext(context = {}) {
  const user = context?.user || {};
  const owner = context?.owner || {};

  const userRole = normalizeRole(user.role);
  const ownerRole = normalizeRole(owner.role);

  return (
    user.isOwner === true ||
    user.isAdmin === true ||
    owner.isOwner === true ||
    owner.isAdmin === true ||
    userRole === "owner" ||
    userRole === "admin" ||
    ownerRole === "owner" ||
    ownerRole === "admin"
  );
}

function getAccessMode(context = {}) {
  return isOwnerContext(context)
    ? "owner"
    : "user";
}

function normalizeSessionId(sessionId) {
  const value = stringValue(sessionId);

  return (
    value ||
    `alex-session-${Date.now()}`
  );
}

// ============================================================
// LIVE WEATHER HELPERS
// Read-only public weather data from Open-Meteo.
// Does not execute computer or owner-only actions.
// ============================================================

function isWeatherRequest(message) {
  const text = stringValue(message);

  if (!text) {
    return false;
  }

  return (
    /\bweather\b/i.test(text) ||
    /\bforecast\b/i.test(text) ||
    /\btemp(?:erature|ature)?\b/i.test(text) ||
    /\bmausam\b/i.test(text) ||
    /\btaapman\b/i.test(text) ||
    /\btapman\b/i.test(text) ||
    /\bhumidity\b/i.test(text) ||
    /\brainfall\b/i.test(text) ||
    /\bbarish\b/i.test(text) ||
    /\bbaarish\b/i.test(text) ||
    /तापमान|मौसम|बारिश|बरसात/.test(text)
  );
}

function extractWeatherLocation(message) {
  const text = stringValue(message);

  /*
   * Words that indicate the location phrase has ended.
   */
  const stopWords = new Set([
    "ka",
    "ki",
    "ke",
    "hai",
    "hain",
    "h",
    "batao",
    "btao",
    "batana",
    "bta",
    "kitna",
    "kitni",
    "kya",
    "abhi",
    "aaj",
    "kal",
    "today",
    "tomorrow",
    "now",
    "currently",
    "right",
    "please",
    "weather",
    "forecast",
    "temperature",
    "temp",
    "tempature",
    "humidity",
    "rain",
    "rainfall",
    "mausam",
    "tapman",
    "taapman",
    "barish",
    "baarish",
    "degree",
    "degrees",
    "celsius",
    "fahrenheit",
    "bta",
    "dikhao",
    "bata",
    "kitne",
    "kaisa",
    "kaisi",
    "kesa",
    "kesi",
    "me",
    "mein",
    "and",
    "or",
  ]);

  /*
   * Match common location phrases:
   *   weather in Bhiwani
   *   temperature at New Delhi
   *   Haryana me Bhiwani ka temperature
   *
   * Using the last valid location phrase helps the
   * "Haryana me Bhiwani..." format resolve to Bhiwani.
   */
  const pattern =
    /(?:\bin\b|\bat\b|\bfor\b|\bme\b|\bmein\b)\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ'’-]*(?:\s+[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ'’-]*){0,4})/gi;

  let match;
  let selectedLocation = "";

  while ((match = pattern.exec(text)) !== null) {
    const words = stringValue(match[1])
      .split(/\s+/)
      .filter(Boolean);

    const locationWords = [];

    for (const word of words) {
      const normalized = word
        .toLowerCase()
        .replace(/[.,!?;:]+$/g, "");

      if (
        !normalized ||
        stopWords.has(normalized)
      ) {
        break;
      }

      locationWords.push(word);
    }

    const candidate = locationWords
      .join(" ")
      .replace(/[.,!?;:]+$/g, "")
      .trim();

    if (candidate) {
      selectedLocation = candidate;
    }
  }

  /*
   * Handle messages that mention a city without "in/me/at":
   * "Bhiwani ka temperature batao".
   */
  if (!selectedLocation) {
    const withoutWeatherWords = text
      .replace(
        /\b(what|whats|what's|is|the|weather|forecast|temperature|tempature|temp|humidity|rainfall|rain|today|tomorrow|now|currently|right|please|tell|me|batao|btao|batana|bta|kitna|kitni|kitne|ka|ki|ke|hai|hain|h|abhi|aaj|kaisa|kaisi|degree|degrees|celsius|fahrenheit|mausam|tapman|taapman|barish|baarish)\b/gi,
        " "
      )
      .replace(/[?.,!;:]+/g, " ")
      .trim();

    const words = withoutWeatherWords
      .split(/\s+/)
      .filter(Boolean);

    const knownStates = new Set([
      "haryana",
      "punjab",
      "rajasthan",
      "delhi",
      "uttar",
      "pradesh",
      "himachal",
      "uttarakhand",
      "bihar",
      "jharkhand",
      "gujarat",
      "maharashtra",
      "goa",
      "karnataka",
      "kerala",
      "tamil",
      "nadu",
      "telangana",
      "andhra",
      "odisha",
      "assam",
      "sikkim",
      "manipur",
      "mizoram",
      "nagaland",
      "tripura",
      "meghalaya",
      "arunachal",
      "chhattisgarh",
      "madhya",
      "west",
      "bengal",
      "uttaranchal",
    ]);

    const filtered = words.filter(
      (word) =>
        !knownStates.has(
          word.toLowerCase()
        )
    );

    if (filtered.length > 0) {
      selectedLocation = filtered
        .slice(0, 3)
        .join(" ");
    }
  }

  return selectedLocation.trim();
}

function getWeatherDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };

  return descriptions[Number(code)] ||
    "Weather condition unavailable";
}

async function fetchLiveWeather(location) {
  const normalizedLocation =
    stringValue(location);

  if (!normalizedLocation) {
    throw new Error(
      "City or location is required."
    );
  }

  if (typeof fetch !== "function") {
    throw new Error(
      "This Node.js runtime does not support fetch."
    );
  }

  /*
   * Step 1: Find coordinates using Open-Meteo geocoding.
   */
  const geocodingUrl = new URL(
    "https://geocoding-api.open-meteo.com/v1/search"
  );

  geocodingUrl.searchParams.set(
    "name",
    normalizedLocation
  );

  geocodingUrl.searchParams.set(
    "count",
    "5"
  );

  geocodingUrl.searchParams.set(
    "language",
    "en"
  );

  geocodingUrl.searchParams.set(
    "format",
    "json"
  );

  const geocodingResponse = await fetch(
    geocodingUrl.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    }
  );

  if (!geocodingResponse.ok) {
    throw new Error(
      `Weather location lookup failed (HTTP ${geocodingResponse.status}).`
    );
  }

  const geocodingData =
    await geocodingResponse.json();

  const results = Array.isArray(
    geocodingData?.results
  )
    ? geocodingData.results
    : [];

  if (results.length === 0) {
    throw new Error(
      `Location "${normalizedLocation}" was not found. Please provide a city name.`
    );
  }

  /*
   * Prefer a result in India when multiple matches exist.
   */
  const place =
    results.find(
      (item) =>
        stringValue(item?.country_code)
          .toUpperCase() === "IN"
    ) || results[0];

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new Error(
      "The selected location has invalid coordinates."
    );
  }

  /*
   * Step 2: Fetch current conditions for the coordinates.
   */
  const forecastUrl = new URL(
    "https://api.open-meteo.com/v1/forecast"
  );

  forecastUrl.searchParams.set(
    "latitude",
    String(latitude)
  );

  forecastUrl.searchParams.set(
    "longitude",
    String(longitude)
  );

  forecastUrl.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "rain",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(",")
  );

  forecastUrl.searchParams.set(
    "timezone",
    "auto"
  );

  const forecastResponse = await fetch(
    forecastUrl.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    }
  );

  if (!forecastResponse.ok) {
    throw new Error(
      `Live weather service failed (HTTP ${forecastResponse.status}).`
    );
  }

  const forecastData =
    await forecastResponse.json();

  const current =
    objectValue(forecastData?.current);

  if (
    current.temperature_2m === undefined ||
    current.temperature_2m === null
  ) {
    throw new Error(
      "The weather service did not return a current temperature."
    );
  }

  return {
    location: {
      name: stringValue(place.name),
      region: stringValue(place.admin1),
      country: stringValue(place.country),
      latitude,
      longitude,
    },

    current: {
      temperatureC: Number(
        current.temperature_2m
      ),

      feelsLikeC:
        current.apparent_temperature === undefined
          ? null
          : Number(
              current.apparent_temperature
            ),

      humidity:
        current.relative_humidity_2m === undefined
          ? null
          : Number(
              current.relative_humidity_2m
            ),

      isDay:
        current.is_day === undefined
          ? null
          : Number(current.is_day) === 1,

      precipitationMm:
        current.precipitation === undefined
          ? null
          : Number(
              current.precipitation
            ),

      rainMm:
        current.rain === undefined
          ? null
          : Number(current.rain),

      weatherCode:
        current.weather_code === undefined
          ? null
          : Number(current.weather_code),

      windSpeedKmh:
        current.wind_speed_10m === undefined
          ? null
          : Number(
              current.wind_speed_10m
            ),

      windDirection:
        current.wind_direction_10m === undefined
          ? null
          : Number(
              current.wind_direction_10m
            ),

      time: stringValue(
        current.time
      ),

      timezone: stringValue(
        forecastData?.timezone
      ),
    },
  };
}

function formatLiveWeatherReply(weather) {
  const location = weather.location;
  const current = weather.current;

  const placeName = [
    location.name,
    location.region,
    location.country,
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    `🌦️ **${placeName} ka live weather**`,
    "",
    `🌡️ Temperature: ${current.temperatureC}°C`,
  ];

  if (current.feelsLikeC !== null) {
    lines.push(
      `🤔 Feels like: ${current.feelsLikeC}°C`
    );
  }

  if (current.humidity !== null) {
    lines.push(
      `💧 Humidity: ${current.humidity}%`
    );
  }

  if (current.weatherCode !== null) {
    lines.push(
      `☁️ Condition: ${getWeatherDescription(current.weatherCode)}`
    );
  }

  if (current.windSpeedKmh !== null) {
    lines.push(
      `💨 Wind speed: ${current.windSpeedKmh} km/h`
    );
  }

  if (current.precipitationMm !== null) {
    lines.push(
      `🌧️ Precipitation: ${current.precipitationMm} mm`
    );
  }

  if (current.time) {
    lines.push(
      "",
      `🕒 Weather data time: ${current.time}${
        current.timezone
          ? ` (${current.timezone})`
          : ""
      }`
    );
  }

  lines.push(
    "",
    "_Source: Open-Meteo live weather API._"
  );

  return lines.join("\n");
}

// ============================================================
// AGENT ASSISTANT CORE
// ============================================================

class AgentAssistantCore {
  constructor(options = {}) {
    this.name =
      "ALEX Agent Assistant Core";

    this.version =
      VERSION;

    this.conversation =
      options.conversation ||
      getAgentConversationGateway();

    this.goalRouter =
      options.goalRouter ||
      getAgentGoalRouter();

    this.capabilityHub =
      options.capabilityHub ||
      getAgentCapabilityHub();

    this.stats = {
      total: 0,
      messages: 0,
      chat: 0,
      memory: 0,
      tools: 0,
      research: 0,
      autonomous: 0,
      clarification: 0,
      failures: 0,
      confirmations: 0,
    };
  }

  // ==========================================================
  // MAIN ASSISTANT ENTRY
  // ==========================================================

  async ask({
    ownerId = null,
    ownerKey = null,
    sessionId = null,
    message = "",
    context = {},
    execute = true,
    confirmed = false,
    confirmationReason = "",
    useBrain = true,
  } = {}) {
    this.stats.total += 1;
    this.stats.messages += 1;

    const text =
      stringValue(message);

    const safeContext =
      objectValue(context);

    const resolvedSession =
      normalizeSessionId(sessionId);

    // --------------------------------------------------------
    // EMPTY MESSAGE
    // --------------------------------------------------------

    if (!text) {
      this.stats.clarification += 1;

      return {
        success: true,
        status: STATUS.NEEDS_CLARIFICATION,
        route: ROUTES.CLARIFICATION,
        message:
          "ALEX ko message nahi mila. Batao kya karna hai.",
        sessionId: resolvedSession,
      };
    }

    // --------------------------------------------------------
    // LIVE WEATHER
    // Read-only information; no owner action is performed.
    // --------------------------------------------------------

    if (isWeatherRequest(text)) {
      const location =
        extractWeatherLocation(text);

      if (!location) {
        this.stats.clarification += 1;

        return {
          success: true,
          status: STATUS.NEEDS_CLARIFICATION,
          route: ROUTES.CLARIFICATION,
          sessionId: resolvedSession,
          reply:
            "Kis city ka live weather chahiye? City ka naam batao, jaise: Bhiwani ka temperature abhi kitna hai?",
          message:
            "Please provide a city or location for the weather report.",
        };
      }

      try {
        const weather =
          await fetchLiveWeather(location);

        const reply =
          formatLiveWeatherReply(weather);

        const weatherResult = {
          success: true,
          status: STATUS.COMPLETED,
          route: ROUTES.CHAT,
          sessionId: resolvedSession,
          reply,
          message: reply,
          result: {
            type: "live_weather",
            provider: "Open-Meteo",
            data: weather,
          },
        };

        this._recordResult(
          weatherResult
        );

        return weatherResult;
      } catch (error) {
        this.stats.failures += 1;

        console.error(
          "[ALEX] Live weather request failed:",
          error?.message || error
        );

        return {
          success: false,
          status: STATUS.FAILED,
          route: ROUTES.CHAT,
          sessionId: resolvedSession,
          reply:
            "Abhi live weather data fetch nahi ho paaya. Network ya weather service unavailable ho sakti hai. Thodi der baad dobara try karo.",
          message:
            "Live weather data could not be fetched.",
          error: getErrorMessage(error),
        };
      }
    }

    // --------------------------------------------------------
    // ACCESS CONTEXT
    // --------------------------------------------------------

    const accessMode =
      getAccessMode(safeContext);

    // --------------------------------------------------------
    // BUILD SAFE CONTEXT
    // --------------------------------------------------------

    const assistantContext = {
      ...safeContext,

      accessMode,

      isOwner:
        isOwnerContext(safeContext),

      sessionId:
        resolvedSession,

      assistantVersion:
        this.version,
    };

    /*
     * ConversationGateway is the primary path.
     *
     * USER
     *   ↓
     * CORE
     *   ↓
     * GATEWAY
     *   ↓
     * GOAL ROUTER
     */

    if (
      hasMethod(
        this.conversation,
        "handleMessage"
      )
    ) {
      try {
        const result =
          await this.conversation.handleMessage({
            ownerId,
            ownerKey,

            sessionId:
              resolvedSession,

            message:
              text,

            context:
              assistantContext,

            execute:
              execute !== false,

            confirmed:
              confirmed === true,

            confirmationReason:
              stringValue(
                confirmationReason
              ),

            useBrain:
              useBrain !== false,
          });

        this._recordResult(result);

        return {
          success:
            result?.success !== false,

          status:
            result?.status ||
            STATUS.COMPLETED,

          route:
            result?.route ||
            ROUTES.CHAT,

          sessionId:
            result?.sessionId ||
            resolvedSession,

          taskId:
            result?.taskId ||
            result?.result?.taskId ||
            null,

          reply:
            result?.reply ||
            null,

          message:
            result?.message ||
            null,

          result:
            result || null,

          requiresConfirmation:
            result?.requiresConfirmation === true,

          tool:
            result?.tool ||
            null,

          error:
            result?.error ||
            null,
        };
      } catch (error) {
        this.stats.failures += 1;

        console.error(
          "[ALEX] Conversation gateway failed:",
          error?.message || error
        );

        return {
          success: false,
          status: STATUS.FAILED,
          route: ROUTES.UNKNOWN,
          sessionId: resolvedSession,
          error: getErrorMessage(error),
        };
      }
    }

    // --------------------------------------------------------
    // SAFETY FALLBACK
    // --------------------------------------------------------

    this.stats.failures += 1;

    return {
      success: false,
      status: STATUS.UNAVAILABLE,
      route: ROUTES.UNKNOWN,
      sessionId: resolvedSession,
      error:
        "ALEX conversation gateway is unavailable.",
    };
  }

  // ==========================================================
  // PLAN ONLY
  // ==========================================================

  async plan({
    ownerId = null,
    ownerKey = null,
    sessionId = null,
    message = "",
    context = {},
  } = {}) {
    const text =
      stringValue(message);

    if (!text) {
      return {
        success: false,
        status: STATUS.NEEDS_CLARIFICATION,
        route: ROUTES.CLARIFICATION,
        error: "Message is required.",
      };
    }

    if (
      !hasMethod(
        this.goalRouter,
        "route"
      )
    ) {
      return {
        success: false,
        status: STATUS.UNAVAILABLE,
        error:
          "AgentGoalRouter is unavailable.",
      };
    }

    const resolvedSession =
      normalizeSessionId(sessionId);

    try {
      const result =
        await this.goalRouter.route({
          ownerId,
          ownerKey,

          sessionId:
            resolvedSession,

          message:
            text,

          context:
            objectValue(context),

          execute: false,
        });

      return {
        success:
          result?.success !== false,

        status:
          result?.status ||
          STATUS.PLANNED,

        route:
          result?.route ||
          ROUTES.UNKNOWN,

        sessionId:
          result?.sessionId ||
          resolvedSession,

        intent:
          result?.intent ||
          null,

        goal:
          result?.intent?.goal ||
          result?.goal ||
          text,

        tool:
          result?.tool ||
          null,

        args:
          result?.args ||
          null,

        result:
          result || null,
      };
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: STATUS.FAILED,
        error: getErrorMessage(error),
      };
    }
  }

  // ==========================================================
  // INSPECT REQUEST
  // ==========================================================

  async inspect({
    message = "",
    context = {},
  } = {}) {
    const text =
      stringValue(message);

    if (!text) {
      return {
        success: false,
        status: STATUS.NEEDS_CLARIFICATION,
        error: "Message is required.",
      };
    }

    const safeContext =
      objectValue(context);

    if (
      hasMethod(
        this.goalRouter,
        "inspect"
      )
    ) {
      try {
        return await this.goalRouter.inspect({
          message: text,

          context: {
            ...safeContext,

            accessMode:
              getAccessMode(safeContext),

            isOwner:
              isOwnerContext(safeContext),
          },
        });
      } catch (error) {
        this.stats.failures += 1;

        return {
          success: false,
          status: STATUS.FAILED,
          error: getErrorMessage(error),
        };
      }
    }

    return this.plan({
      message: text,
      context: safeContext,
    });
  }

  // ==========================================================
  // DIRECT RESEARCH
  // ==========================================================

  async research({
    question = "",
    urls = [],
    discover = false,
    options = {},
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "researchWeb"
      )
    ) {
      return {
        success: false,
        status: STATUS.UNAVAILABLE,
        route: ROUTES.RESEARCH,
        error:
          "Research capability is unavailable.",
      };
    }

    const normalizedQuestion =
      stringValue(question);

    if (
      !normalizedQuestion &&
      (!Array.isArray(urls) ||
        urls.length === 0)
    ) {
      return {
        success: false,
        status: STATUS.NEEDS_CLARIFICATION,
        route: ROUTES.RESEARCH,
        error:
          "Research question or URL is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.researchWeb({
          question:
            normalizedQuestion,

          urls:
            Array.isArray(urls)
              ? urls
              : [],

          discover:
            discover === true,

          options:
            objectValue(options),
        });

      this._recordResult(result);

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: STATUS.FAILED,
        route: ROUTES.RESEARCH,
        error: getErrorMessage(error),
      };
    }
  }

  // ==========================================================
  // DIRECT AUTONOMOUS TASK
  // ==========================================================

  async runTask({
    goal = "",
    ownerId = null,
    sessionId = null,
    metadata = {},
    confirmations = {},
    stopOnFailure = true,
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "runAutonomous"
      )
    ) {
      return {
        success: false,
        status: STATUS.UNAVAILABLE,
        route: ROUTES.AUTONOMOUS,
        error:
          "Autonomous capability is unavailable.",
      };
    }

    const normalizedGoal =
      stringValue(goal);

    if (!normalizedGoal) {
      return {
        success: false,
        status: STATUS.NEEDS_CLARIFICATION,
        route: ROUTES.AUTONOMOUS,
        error:
          "Autonomous task goal is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.runAutonomous({
          goal: normalizedGoal,
          ownerId,

          sessionId:
            normalizeSessionId(sessionId),

          metadata:
            objectValue(metadata),

          confirmations:
            objectValue(confirmations),

          stopOnFailure:
            stopOnFailure !== false,
        });

      this._recordResult(result);

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: STATUS.FAILED,
        route: ROUTES.AUTONOMOUS,
        error: getErrorMessage(error),
      };
    }
  }

  // ==========================================================
  // DIRECT COMPUTER ACTION
  // ==========================================================

  async computer({
    ownerId = null,
    sessionId = null,
    goal = "",
    agentToken = "",
    tool = "",
    args = {},
    confirmed = false,
    confirmationReason = "",
    metadata = {},
  } = {}) {
    if (
      !hasMethod(
        this.capabilityHub,
        "executeComputer"
      )
    ) {
      return {
        success: false,
        status: STATUS.UNAVAILABLE,
        route: ROUTES.TOOL,
        error:
          "Computer capability is unavailable.",
      };
    }

    const normalizedTool =
      stringValue(tool);

    if (!normalizedTool) {
      return {
        success: false,
        status: STATUS.NEEDS_CLARIFICATION,
        route: ROUTES.TOOL,
        error:
          "Computer tool is required.",
      };
    }

    try {
      const result =
        await this.capabilityHub.executeComputer({
          ownerId,

          sessionId:
            normalizeSessionId(sessionId),

          goal:
            stringValue(goal),

          agentToken:
            stringValue(agentToken),

          tool:
            normalizedTool,

          args:
            objectValue(args),

          confirmed:
            confirmed === true,

          confirmationReason:
            stringValue(confirmationReason),

          metadata:
            objectValue(metadata),
        });

      this._recordResult(result);

      return result;
    } catch (error) {
      this.stats.failures += 1;

      return {
        success: false,
        status: STATUS.FAILED,
        route: ROUTES.TOOL,
        error: getErrorMessage(error),
      };
    }
  }

  // ==========================================================
  // CAPABILITY DISCOVERY
  // ==========================================================

  getCapabilities() {
    if (
      hasMethod(
        this.capabilityHub,
        "getCapabilities"
      )
    ) {
      try {
        return this.capabilityHub
          .getCapabilities();
      } catch (error) {
        console.warn(
          "[ALEX] Capability discovery failed:",
          error?.message || error
        );

        return [];
      }
    }

    return [];
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  health() {
    const capabilities =
      this.getCapabilities();

    const available =
      capabilities.filter(
        (item) =>
          item?.available === true
      ).length;

    let status = "unavailable";

    if (
      capabilities.length > 0 &&
      available === capabilities.length
    ) {
      status = "healthy";
    } else if (available > 0) {
      status = "degraded";
    }

    return {
      success: true,
      status,
      name: this.name,
      version: this.version,
      capabilities,
      availableCapabilities: available,
      totalCapabilities: capabilities.length,
      stats: this.getStats(),
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================
  // STATS
  // ==========================================================

  _recordResult(result) {
    const route =
      stringValue(result?.route).toLowerCase();

    switch (route) {
      case ROUTES.CHAT:
        this.stats.chat += 1;
        break;

      case ROUTES.MEMORY:
        this.stats.memory += 1;
        break;

      case ROUTES.TOOL:
        this.stats.tools += 1;
        break;

      case ROUTES.RESEARCH:
        this.stats.research += 1;
        break;

      case ROUTES.AUTONOMOUS:
        this.stats.autonomous += 1;
        break;

      case ROUTES.CLARIFICATION:
        this.stats.clarification += 1;
        break;

      default:
        break;
    }

    if (
      result?.status ===
      STATUS.NEEDS_CONFIRMATION
    ) {
      this.stats.confirmations += 1;
    }

    if (result?.success === false) {
      this.stats.failures += 1;
    }
  }

  getStats() {
    return {
      ...this.stats,
      version: this.version,
    };
  }

  resetStats() {
    this.stats = {
      total: 0,
      messages: 0,
      chat: 0,
      memory: 0,
      tools: 0,
      research: 0,
      autonomous: 0,
      clarification: 0,
      failures: 0,
      confirmations: 0,
    };

    return this.getStats();
  }

  // ==========================================================
  // INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,
      name: this.name,
      version: this.version,

      architecture: {
        conversation: Boolean(this.conversation),
        goalRouter: Boolean(this.goalRouter),
        capabilityHub: Boolean(this.capabilityHub),
      },

      routes: {
        ...ROUTES,
      },

      capabilities:
        this.getCapabilities(),

      stats:
        this.getStats(),

      timestamp:
        new Date().toISOString(),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let singleton = null;

function createAgentAssistantCore(options = {}) {
  return new AgentAssistantCore(options);
}

function getAgentAssistantCore(options = {}) {
  if (!singleton) {
    singleton =
      createAgentAssistantCore(options);
  }

  return singleton;
}

function resetAgentAssistantCore() {
  singleton = null;
}

function isAgentAssistantCore(value) {
  return Boolean(
    value &&
    typeof value.ask === "function" &&
    typeof value.plan === "function" &&
    typeof value.inspect === "function"
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  VERSION,
  STATUS,
  ROUTES,
  AgentAssistantCore,
  createAgentAssistantCore,
  getAgentAssistantCore,
  resetAgentAssistantCore,
  isAgentAssistantCore,
};