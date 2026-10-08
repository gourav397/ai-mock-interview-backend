// ============================================================
// ALEX REEL GENERATOR — v3.2
// 10–12 SECOND INSTAGRAM REEL PIPELINE
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { getAlexGeminiClient } = require("../config/geminiClient");

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const REELS_DIR = path.join(__dirname, "..", "reels");

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

// Final reel target: 11 seconds
const TARGET_DURATION_SECONDS = 11;

// Generate 2 Veo clips, then trim final output to 11 sec.
const SCENE_COUNT = 2;

const VEO_MODEL =
  process.env.VEO_MODEL || "veo-3.1-fast-generate-preview";

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

const CAPTIONS_ENABLED =
  String(process.env.REEL_CAPTIONS || "true").toLowerCase() !== "false";

const POLL_INTERVAL_MS = 10000;
const VEO_TIMEOUT_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_START_RETRIES = 3;

ensureDir(REELS_DIR);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ------------------------------------------------------------
// FFMPEG
// ------------------------------------------------------------

let ffmpegStatic = null;
let ffprobeStatic = null;

try {
  ffmpegStatic = require("ffmpeg-static");
} catch (_) {}

try {
  ffprobeStatic = require("ffprobe-static");
} catch (_) {}

const FFMPEG_PATH =
  process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

const FFPROBE_PATH =
  process.env.FFPROBE_PATH ||
  (ffprobeStatic && ffprobeStatic.path) ||
  "ffprobe";

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeText(v, f = "") {
  return v === undefined || v === null ? f : String(v).trim();
}

function cleanFileName(v) {
  return String(v || "reel")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100);
}

function createJobId() {
  return (
    "reel_" +
    Date.now() +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// ------------------------------------------------------------
// GEMINI API KEY POOL
// ------------------------------------------------------------

function getGeminiKeys() {
  const multi = safeText(process.env.GEMINI_API_KEYS);

  if (multi) {
    return multi
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  const single = safeText(process.env.GEMINI_API_KEY);

  return single ? [single] : [];
}

// ------------------------------------------------------------
// HTTP HELPERS
// ------------------------------------------------------------

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = VEO_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

async function fetchJson(
  url,
  options = {},
  timeoutMs = VEO_TIMEOUT_MS
) {
  const response = await fetchWithTimeout(
    url,
    options,
    timeoutMs
  );

  const body = await readResponseBody(response);

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      body?.raw ||
      `HTTP ${response.status}`;

    const error = new Error(
      `[HTTP ${response.status}] ${message}`
    );

    error.status = response.status;
    error.body = body;

    throw error;
  }

  return body;
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function describeVeoError(error) {
  const s = Number(error?.status || 0);

  if (s === 401 || s === 403) {
    return (
      "API key invalid hai YA Veo paid tier/billing available nahi hai. (" +
      error.message +
      ")"
    );
  }

  if (s === 429) {
    return (
      "Veo quota/rate limit exceed ho gaya hai. (" +
      error.message +
      ")"
    );
  }

  if (s === 404) {
    return (
      "Model '" +
      VEO_MODEL +
      "' available nahi hai. (" +
      error.message +
      ")"
    );
  }

  if (error?.name === "AbortError") {
    return "Request timeout — Veo server response nahi de raha.";
  }

  if (
    error?.code === "ENOTFOUND" ||
    error?.code === "ECONNREFUSED"
  ) {
    return (
      "Network blocked — generativelanguage.googleapis.com reachable nahi hai."
    );
  }

  return error?.message || "Unknown error";
}

// ------------------------------------------------------------
// DEFAULT PLAN
// ------------------------------------------------------------

function buildDefaultPlan(topic = "") {
  const cleanTopic =
    safeText(topic) ||
    "Two jungle animals become unexpected friends";

  return {
    topic: cleanTopic,

    audience: "Instagram short-form audience",

    durationSeconds: TARGET_DURATION_SECONDS,

    tone:
      "cinematic, emotional, realistic and family friendly",

    language: "simple Hinglish",

    hook:
      "Jungle mein aaj ek unexpected friendship hone wali thi!",

    cta:
      "Aisi cinematic stories ke liye follow karo!",

    characters: [
      {
        name: "Lion",
        species: "African lion",
        personality: "calm, brave and kind",
        voice:
          "deep warm confident male animal voice",
      },
      {
        name: "Tiger",
        species: "Bengal tiger",
        personality: "strong, loyal and friendly",
        voice:
          "slightly lighter warm male animal voice, clearly different from Lion",
      },
    ],

    scenes: [
      {
        durationSeconds: 8,

        visualPrompt:
          "A majestic African lion and a Bengal tiger slowly approach each other in a beautiful lush jungle at golden hour. They look curious but peaceful. Photorealistic wildlife cinematography, detailed fur, warm sunlight rays, cinematic depth of field, slow camera movement.",

        dialogue:
          "Lion: Dost, tum bhi yahan akele ho?",

        action:
          "The lion calmly approaches the tiger. The tiger looks surprised, then relaxes and gives a friendly expression.",

        caption:
          "Kabhi kabhi dosti unexpected jagah milti hai...",

        sfx:
          "soft jungle ambience, birds, leaves and gentle wind",

        music:
          "emotional cinematic background music, low volume",
      },

      {
        durationSeconds: 8,

        visualPrompt:
          "The same African lion and Bengal tiger now walk side by side through the glowing jungle toward a beautiful sunset clearing. They move naturally together like close friends. Photorealistic cinematic wildlife movie, realistic fur, golden light, smooth tracking camera, emotional ending.",

        dialogue:
          "Tiger: Akela kyun? Ab hum dono saath hain!",

        action:
          "The tiger walks beside the lion. They look at each other warmly and continue walking together toward the sunset.",

        caption:
          "Aur wahi se ek beautiful friendship shuru hui ❤️",

        sfx:
          "soft footsteps, leaves, birds and gentle wind",

        music:
          "uplifting emotional cinematic ending",
      },
    ],
  };
}

// ------------------------------------------------------------
// PLAN VALIDATION
// ------------------------------------------------------------

function validatePlan(plan, topic) {
  const fallback = buildDefaultPlan(topic);

  if (!plan || typeof plan !== "object") {
    return fallback;
  }

  const result = {
    ...fallback,
    ...plan,
  };

  result.topic =
    safeText(plan.topic) || fallback.topic;

  result.audience =
    safeText(plan.audience) || fallback.audience;

  result.tone =
    safeText(plan.tone) || fallback.tone;

  result.language =
    safeText(plan.language) || fallback.language;

  result.hook =
    safeText(plan.hook) || fallback.hook;

  result.cta =
    safeText(plan.cta) || fallback.cta;

  if (
    !Array.isArray(plan.characters) ||
    !plan.characters.length
  ) {
    result.characters = fallback.characters;
  } else {
    result.characters = plan.characters
      .slice(0, 5)
      .map((c, i) => ({
        name:
          safeText(c?.name) ||
          `Animal ${i + 1}`,

        species:
          safeText(c?.species) ||
          "wild animal",

        personality:
          safeText(c?.personality) ||
          "expressive",

        voice:
          safeText(c?.voice) ||
          "distinct natural animal voice",
      }));
  }

  if (
    !Array.isArray(plan.scenes) ||
    plan.scenes.length < SCENE_COUNT
  ) {
    result.scenes = fallback.scenes;
  } else {
    result.scenes = plan.scenes
      .slice(0, SCENE_COUNT)
      .map((s, i) => ({
        durationSeconds: 8,

        visualPrompt:
          safeText(s?.visualPrompt) ||
          fallback.scenes[i].visualPrompt,

        dialogue:
          safeText(s?.dialogue) ||
          fallback.scenes[i].dialogue,

        action:
          safeText(s?.action) ||
          fallback.scenes[i].action,

        caption:
          safeText(s?.caption) ||
          fallback.scenes[i].caption,

        sfx:
          safeText(s?.sfx) ||
          fallback.scenes[i].sfx,

        music:
          safeText(s?.music) ||
          fallback.scenes[i].music,
      }));
  }

  // Final output is always trimmed to target duration.
  result.durationSeconds =
    TARGET_DURATION_SECONDS;

  return result;
}

// ------------------------------------------------------------
// STEP 1 — GEMINI STORY PLAN
// ------------------------------------------------------------

async function stepPlan(topic) {
  console.log("[REEL] STEP 1 — STORY PLAN");

  const client = getAlexGeminiClient();

  if (
    !client ||
    typeof client.call !== "function"
  ) {
    console.warn(
      "[REEL] Gemini client unavailable — using fallback plan"
    );

    return buildDefaultPlan(topic);
  }

  const prompt = `
You are the story director for a cinematic Instagram Reel.

Create ONE short family-friendly wildlife friendship story.

REQUIREMENTS:

- Final reel duration must be 10–12 seconds.
- Target final duration: 11 seconds.
- Exactly 2 scenes.
- Each Veo scene can be around 8 seconds.
- The final video will be trimmed to exactly 11 seconds.
- Vertical 9:16.
- Cinematic wildlife movie quality.
- Realistic animals.
- Animals physically move and interact.
- Animals speak short dialogue.
- Every main animal must have a clearly distinct voice.
- Facial expressions must match emotions.
- Actions must match dialogue.
- Include cinematic camera movement.
- Include jungle ambience, music and sound effects.
- No violence.
- No gore.
- No weapons.
- No copyrighted characters.
- No real-person impersonation.
- Same animal characters must remain visually consistent.
- Dialogue must be very short because this is an 11-second reel.
- Story should have a strong hook and satisfying ending.

Return ONLY valid JSON:

{
  "topic": "...",
  "audience": "Instagram short-form audience",
  "durationSeconds": 11,
  "tone": "...",
  "language": "simple Hinglish",
  "hook": "...",
  "cta": "...",
  "characters": [
    {
      "name": "...",
      "species": "...",
      "personality": "...",
      "voice": "..."
    }
  ],
  "scenes": [
    {
      "durationSeconds": 8,
      "visualPrompt": "...",
      "dialogue": "...",
      "action": "...",
      "caption": "...",
      "sfx": "...",
      "music": "..."
    },
    {
      "durationSeconds": 8,
      "visualPrompt": "...",
      "dialogue": "...",
      "action": "...",
      "caption": "...",
      "sfx": "...",
      "music": "..."
    }
  ]
}

USER STORY REQUEST:
${safeText(topic) ||
"Create an original emotional jungle friendship story."}
`;

  try {
    const response = await client.call(prompt, {
      model:
        process.env.ALEX_GEMINI_MODEL ||
        process.env.GEMINI_MODEL ||
        "gemini-3.5-flash",

      temperature: 0.7,
      timeoutMs: 60000,
      maxOutputTokens: 4096,
      retries: 3,
      responseMimeType: "application/json",
    });

    if (!response || response.error) {
      throw new Error(
        response?.message ||
        "Gemini story planning call failed"
      );
    }

    const raw =
      String(response.text || "").trim();

    if (!raw) {
      throw new Error(
        "Gemini returned empty story plan"
      );
    }

    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.warn(
        "[REEL] Gemini returned invalid JSON:",
        parseError.message
      );

      throw new Error(
        "Gemini story plan JSON parse failed"
      );
    }

    return validatePlan(
      parsed,
      topic
    );
  } catch (error) {
    console.warn(
      "[REEL] Gemini planning failed:",
      error.message
    );

    console.warn(
      "[REEL] Using fallback story plan."
    );

    return buildDefaultPlan(topic);
  }
}

// ------------------------------------------------------------
// VEO PROMPT
// ------------------------------------------------------------

function buildCharacterBible(plan) {
  return plan.characters
    .map(
      (c) =>
        `${c.name}: ${c.species}, ${c.personality} personality, ${c.voice}.`
    )
    .join(" ");
}

function buildVeoPrompt(
  plan,
  scene,
  index
) {
  const characterBible =
    buildCharacterBible(plan);

  const dialogue =
    safeText(
      scene.dialogue,
      "No dialogue."
    );

  const action =
    safeText(
      scene.action,
      "Natural movement."
    );

  const visualPrompt =
    safeText(
      scene.visualPrompt,
      "Cinematic wildlife jungle scene."
    );

  const sfx =
    safeText(
      scene.sfx,
      "Natural jungle ambience."
    );

  const music =
    safeText(
      scene.music,
      "Subtle cinematic instrumental background music."
    );

  return `
Create a cinematic vertical wildlife video clip.

FORMAT:
- Portrait 9:16.
- Photorealistic cinematic wildlife film.
- Natural realistic animal anatomy.
- High-detail realistic fur.
- Realistic environmental lighting.
- Professional cinematic camera movement.
- No watermark.
- No logos.
- No UI.
- No subtitles burned into the video.
- No random text.

STORY:
${plan.topic}

SCENE ${index + 1} OF ${SCENE_COUNT}:
${visualPrompt}

CHARACTER CONSISTENCY:
${characterBible}

ACTION:
${action}

DIALOGUE:
${dialogue}

VOICE REQUIREMENTS:
- Animals must actually speak audible dialogue.
- Keep voices clearly different.
- Sync mouth/jaw movement naturally.
- Do not replace dialogue with random animal noises.

EXPRESSIONS:
- Expressions must match the story.
- Natural eye movement.
- Natural head movement.
- Natural ears and mouth movement.
- Animals must visibly react to one another.

SOUND EFFECTS:
${sfx}

BACKGROUND MUSIC:
${music}

AUDIO MIX:
- Dialogue must be the clearest element.
- Music lower than dialogue.
- Natural ambience.

CAMERA:
- Cinematic wildlife camera movement.
- Smooth tracking or dolly movement.
- Never fully static.

IMPORTANT:
This is scene ${index + 1} of ${SCENE_COUNT}.
Keep animal appearance consistent.
Do not introduce unrelated characters.
Do not change species.
`;
}

// ------------------------------------------------------------
// VEO START
// ------------------------------------------------------------

async function startVeoGeneration(prompt) {
  const keys = getGeminiKeys();

  if (!keys.length) {
    throw new Error(
      "No Gemini API key found. Set GEMINI_API_KEYS."
    );
  }

  let lastError = null;

  for (
    let keyIndex = 0;
    keyIndex < keys.length;
    keyIndex++
  ) {
    const apiKey = keys[keyIndex];

    for (
      let attempt = 1;
      attempt <= MAX_START_RETRIES;
      attempt++
    ) {
      try {
        console.log(
          `[VEO] Starting generation (key #${
            keyIndex + 1
          }, attempt ${attempt})`
        );

        const url =
          `${GEMINI_BASE_URL}/models/` +
          `${encodeURIComponent(VEO_MODEL)}` +
          `:predictLongRunning`;

        const body = {
          instances: [
            {
              prompt,
            },
          ],

          parameters: {
            aspectRatio: "9:16",
            resolution: "720p",
          },
        };

        const response =
          await fetchJson(
            url,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "x-goog-api-key":
                  apiKey,
              },

              body: JSON.stringify(body),
            },

            START_TIMEOUT_MS
          );

        if (!response?.name) {
          throw new Error(
            "Veo did not return an operation name"
          );
        }

        return {
          operationName:
            response.name,

          apiKey,
        };
      } catch (error) {
        lastError = error;

        console.warn(
          `[VEO] Start failed: ${describeVeoError(
            error
          )}`
        );

        const status =
          Number(error?.status || 0);

        if (
          status === 401 ||
          status === 403 ||
          status === 404
        ) {
          break;
        }

        if (
          isRetryableStatus(status) ||
          error?.name === "AbortError"
        ) {
          if (
            attempt <
            MAX_START_RETRIES
          ) {
            await sleep(
              3000 * attempt
            );

            continue;
          }
        } else {
          break;
        }
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Unable to start Veo generation"
    )
  );
}

// ------------------------------------------------------------
// VEO POLL
// ------------------------------------------------------------

async function pollVeoOperation(
  operationName,
  preferredKey
) {
  const keys = getGeminiKeys();

  const orderedKeys = [
    preferredKey,
    ...keys.filter(
      (k) => k !== preferredKey
    ),
  ].filter(Boolean);

  const startedAt = Date.now();

  let consecutiveFailures = 0;

  while (true) {
    if (
      Date.now() - startedAt >
      VEO_TIMEOUT_MS
    ) {
      throw new Error(
        "Veo generation timed out after " +
          VEO_TIMEOUT_MS / 60000 +
          " minutes"
      );
    }

    let statusResponse = null;
    let successfulPoll = false;

    for (const apiKey of orderedKeys) {
      try {
        const url =
          `${GEMINI_BASE_URL}/` +
          operationName.replace(
            /^\/+/,
            ""
          );

        statusResponse =
          await fetchJson(
            url,
            {
              method: "GET",
              headers: {
                "x-goog-api-key":
                  apiKey,
              },
            },
            60000
          );

        successfulPoll = true;
        consecutiveFailures = 0;

        break;
      } catch (error) {
        console.warn(
          `[VEO] Poll failed: ${error.message}`
        );
      }
    }

    if (!successfulPoll) {
      consecutiveFailures++;

      if (
        consecutiveFailures >= 6
      ) {
        throw new Error(
          "Veo polling failed 6 times in a row"
        );
      }

      await sleep(
        POLL_INTERVAL_MS
      );

      continue;
    }

    if (statusResponse?.error) {
      throw new Error(
        statusResponse.error.message ||
          "Veo generation failed"
      );
    }

    if (
      statusResponse?.done === true
    ) {
      const response =
        statusResponse.response ||
        {};

      const samples =
        response
          ?.generateVideoResponse
          ?.generatedSamples ||
        response
          ?.generateVideoResponse
          ?.generatedVideos ||
        response?.generatedVideos ||
        response?.videos ||
        [];

      if (
        !Array.isArray(samples) ||
        !samples.length
      ) {
        throw new Error(
          "Veo completed but returned no video."
        );
      }

      const video =
        samples[0]?.video ||
        samples[0];

      const uri =
        video?.uri ||
        video?.videoUri ||
        video?.gcsUri;

      if (!uri) {
        throw new Error(
          "Veo completed but no video URI was returned"
        );
      }

      return {
        uri,
        operation:
          statusResponse,
      };
    }

    console.log(
      "[VEO] Generation still running..."
    );

    await sleep(
      POLL_INTERVAL_MS
    );
  }
}

// ------------------------------------------------------------
// VEO DOWNLOAD
// ------------------------------------------------------------

async function downloadVeoVideo(
  videoUri,
  apiKey,
  outputPath
) {
  console.log(
    "[VEO] Downloading generated video..."
  );

  let downloadUrl = videoUri;

  if (
    downloadUrl.startsWith("/") ||
    downloadUrl.includes(
      "generativelanguage.googleapis.com"
    )
  ) {
    if (
      !downloadUrl.startsWith("http")
    ) {
      downloadUrl =
        `${GEMINI_BASE_URL}/` +
        downloadUrl.replace(
          /^\/+/,
          ""
        );
    }

    if (
      !downloadUrl.includes(
        "alt=media"
      )
    ) {
      downloadUrl +=
        (downloadUrl.includes("?")
          ? "&"
          : "?") +
        "alt=media";
    }
  }

  const response =
    await fetchWithTimeout(
      downloadUrl,
      {
        method: "GET",

        headers: {
          "x-goog-api-key":
            apiKey,
        },

        redirect: "follow",
      },

      DOWNLOAD_TIMEOUT_MS
    );

  if (!response.ok) {
    const body =
      await readResponseBody(
        response
      );

    throw new Error(
      body?.error?.message ||
        body?.message ||
        `Veo download failed: HTTP ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (buffer.length < 100000) {
    throw new Error(
      `Downloaded Veo video too small (${buffer.length} bytes)`
    );
  }

  fs.writeFileSync(
    outputPath,
    buffer
  );

  console.log(
    `[VEO] Video saved: ${outputPath} (${(
      buffer.length /
      1024 /
      1024
    ).toFixed(1)} MB)`
  );

  return outputPath;
}

// ------------------------------------------------------------
// FFMPEG
// ------------------------------------------------------------

function escapeFilterPath(filePath) {
  let value = String(
    filePath
  ).replace(/\\/g, "/");

  value = value.replace(
    /:/g,
    "\\:"
  );

  value = value.replace(
    /'/g,
    "\\'"
  );

  return value;
}

async function ffprobeVideo(
  filePath
) {
  const { stdout } =
    await execFileAsync(
      FFPROBE_PATH,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-show_streams",
        "-of",
        "json",
        filePath,
      ],
      {
        windowsHide: true,
        maxBuffer:
          10 * 1024 * 1024,
      }
    );

  const data =
    JSON.parse(stdout);

  const streams =
    Array.isArray(
      data.streams
    )
      ? data.streams
      : [];

  const videoStream =
    streams.find(
      (s) =>
        s.codec_type ===
        "video"
    ) || null;

  const audioStream =
    streams.find(
      (s) =>
        s.codec_type ===
        "audio"
    ) || null;

  return {
    duration: Number(
      data?.format
        ?.duration || 0
    ),

    hasVideo:
      Boolean(videoStream),

    hasAudio:
      Boolean(audioStream),

    width: Number(
      videoStream?.width || 0
    ),

    height: Number(
      videoStream?.height || 0
    ),

    fps:
      videoStream?.r_frame_rate ||
      null,

    videoCodec:
      videoStream?.codec_name ||
      null,

    audioCodec:
      audioStream?.codec_name ||
      null,
  };
}

// ------------------------------------------------------------
// NORMALIZE ONE CLIP
// ------------------------------------------------------------

async function normalizeScene(
  inputPath,
  outputPath,
  caption,
  captionPath
) {
  console.log(
    `[FFMPEG] Normalizing ${path.basename(
      inputPath
    )}`
  );

  const info =
    await ffprobeVideo(
      inputPath
    );

  let filter;

  if (
    CAPTIONS_ENABLED &&
    caption
  ) {
    fs.writeFileSync(
      captionPath,
      safeText(caption),
      "utf8"
    );

    const escapedCaptionPath =
      escapeFilterPath(
        captionPath
      );

    filter = [
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
      "fps=30",
      "format=yuv420p",

      `drawtext=textfile='${escapedCaptionPath}':` +
        "fontcolor=white:fontsize=54:borderw=4:bordercolor=black:" +
        "x=(w-text_w)/2:y=h-220:fix_bounds=true",
    ].join(",");
  } else {
    filter = [
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
      "fps=30",
      "format=yuv420p",
    ].join(",");
  }

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-map",
    "0:v:0",
  ];

  if (info.hasAudio) {
    args.push(
      "-map",
      "0:a:0?",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2"
    );
  } else {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map",
      "1:a",
      "-shortest"
    );
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    outputPath
  );

  await execFileAsync(
    FFMPEG_PATH,
    args,
    {
      windowsHide: true,
      maxBuffer:
        20 * 1024 * 1024,
      timeout:
        5 * 60 * 1000,
    }
  );

  if (
    !fs.existsSync(
      outputPath
    ) ||
    fs.statSync(
      outputPath
    ).size < 10000
  ) {
    throw new Error(
      "FFmpeg normalization produced invalid output"
    );
  }

  return outputPath;
}

// ------------------------------------------------------------
// CONCAT + FINAL 11 SECOND TRIM
// ------------------------------------------------------------

async function stepConcat(
  normalizedPaths,
  jobDir
) {
  console.log(
    "[REEL] STEP 4 — CONCAT + 11 SECOND FINAL TRIM"
  );

  const concatListPath =
    path.join(
      jobDir,
      "concat.txt"
    );

  const lines =
    normalizedPaths.map(
      (filePath) => {
        const escaped =
          filePath
            .replace(
              /\\/g,
              "/"
            )
            .replace(
              /'/g,
              "'\\''"
            );

        return `file '${escaped}'`;
      }
    );

  fs.writeFileSync(
    concatListPath,
    lines.join("\n"),
    "utf8"
  );

  const outputPath =
    path.join(
      jobDir,
      "final_reel.mp4"
    );

  await execFileAsync(
    FFMPEG_PATH,
    [
      "-y",

      "-f",
      "concat",

      "-safe",
      "0",

      "-i",
      concatListPath,

      "-t",
      String(
        TARGET_DURATION_SECONDS
      ),

      "-c:v",
      "libx264",

      "-preset",
      "medium",

      "-crf",
      "18",

      "-pix_fmt",
      "yuv420p",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      "-ar",
      "48000",

      "-ac",
      "2",

      "-movflags",
      "+faststart",

      outputPath,
    ],
    {
      windowsHide: true,

      maxBuffer:
        30 * 1024 * 1024,

      timeout:
        10 * 60 * 1000,
    }
  );

  if (
    !fs.existsSync(
      outputPath
    ) ||
    fs.statSync(
      outputPath
    ).size < 10000
  ) {
    throw new Error(
      "FFmpeg final reel output invalid"
    );
  }

  return outputPath;
}

// ------------------------------------------------------------
// FINAL VERIFY
// ------------------------------------------------------------

async function verifyFinalVideo(
  filePath
) {
  console.log(
    "[REEL] STEP 5 — FINAL VIDEO VERIFY"
  );

  if (
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      "Final MP4 does not exist"
    );
  }

  const stats =
    fs.statSync(filePath);

  if (stats.size < 100000) {
    throw new Error(
      `Final MP4 too small: ${stats.size} bytes`
    );
  }

  const info =
    await ffprobeVideo(
      filePath
    );

  if (!info.hasVideo) {
    throw new Error(
      "Final MP4 has no video stream"
    );
  }

  if (
    info.width !== WIDTH ||
    info.height !== HEIGHT
  ) {
    throw new Error(
      `Invalid final resolution: ${info.width}x${info.height}`
    );
  }

  // Final must be 10–12 seconds.
  if (
    info.duration < 10 ||
    info.duration > 12
  ) {
    throw new Error(
      `Invalid final duration: ${info.duration.toFixed(
        2
      )} seconds`
    );
  }

  if (!info.hasAudio) {
    console.warn(
      "[REEL] WARNING: no audio stream"
    );
  }

  return {
    ...info,
    sizeBytes:
      stats.size,
  };
}

// ------------------------------------------------------------
// METADATA
// ------------------------------------------------------------

function buildMetadata(
  jobId,
  plan,
  finalPath,
  verification
) {
  return {
    jobId,

    generator:
      "ALEX REEL GENERATOR",

    version:
      "3.2",

    model:
      VEO_MODEL,

    title:
      plan.topic ||
      "Cinematic Animal Story",

    topic:
      plan.topic,

    caption:
      plan.hook,

    cta:
      plan.cta,

    hashtags: [
      "#AIReel",
      "#AnimalStory",
      "#Wildlife",
      "#Cinematic",
      "#Veo",
      "#InstagramReels",
    ],

    durationSeconds:
      verification.duration,

    resolution:
      `${verification.width}x${verification.height}`,

    aspectRatio:
      "9:16",

    fps:
      FPS,

    videoCodec:
      verification.videoCodec,

    audioCodec:
      verification.audioCodec,

    hasAudio:
      verification.hasAudio,

    hasVideo:
      verification.hasVideo,

    sizeBytes:
      verification.sizeBytes,

    videoPath:
      finalPath,

    scenes:
      plan.scenes,

    characters:
      plan.characters,

    generatedAt:
      new Date().toISOString(),
  };
}

// ------------------------------------------------------------
// JOB SYSTEM
// ------------------------------------------------------------

const reelJobs =
  new Map();

const JOB_TTL_MS =
  24 * 60 * 60 * 1000;

function updateJob(
  jobId,
  patch = {}
) {
  const job =
    reelJobs.get(jobId);

  if (!job) return null;

  Object.assign(
    job,
    patch,
    {
      updatedAt:
        Date.now(),
    }
  );

  return job;
}

function getJob(jobId) {
  return (
    reelJobs.get(jobId) ||
    null
  );
}

function createJob(
  jobId,
  topic
) {
  const job = {
    jobId,

    topic,

    status:
      "queued",

    progress:
      0,

    stage:
      "queued",

    message:
      "Reel generation queued",

    result:
      null,

    error:
      null,

    createdAt:
      Date.now(),

    updatedAt:
      Date.now(),
  };

  reelJobs.set(
    jobId,
    job
  );

  return job;
}

function cleanupJobs() {
  const now =
    Date.now();

  for (
    const [jobId, job] of
    reelJobs.entries()
  ) {
    if (
      now -
        Number(
          job.updatedAt ||
            job.createdAt ||
            now
        ) >
      JOB_TTL_MS
    ) {
      reelJobs.delete(
        jobId
      );
    }
  }
}

setInterval(
  cleanupJobs,
  60 * 60 * 1000
).unref();

// ------------------------------------------------------------
// REEL GENERATOR
// ------------------------------------------------------------

class ReelGenerator {
  constructor() {
    this.version =
      "3.2";

    this.name =
      "ALEX REEL GENERATOR";
  }

  async generate(
    options = {}
  ) {
    const startedAt =
      Date.now();

    const topic =
      safeText(
        options.topic ||
          options.prompt ||
          options.story ||
          options.request
      ) ||
      "Create a cinematic jungle friendship story.";

    const jobId =
      safeText(
        options.jobId
      ) ||
      createJobId();

    const jobDir =
      path.join(
        REELS_DIR,
        jobId
      );

    ensureDir(
      jobDir
    );

    const log = [];

    if (
      !reelJobs.has(jobId)
    ) {
      createJob(
        jobId,
        topic
      );
    }

    updateJob(
      jobId,
      {
        status:
          "processing",

        progress:
          5,

        stage:
          "planning",

        message:
          "Creating story plan...",

        topic,
      }
    );

    try {
      console.log(
        "=================================================="
      );

      console.log(
        `[REEL] ${this.name} v${this.version}`
      );

      console.log(
        `[REEL] JOB: ${jobId}`
      );

      console.log(
        `[REEL] TOPIC: ${topic}`
      );

      console.log(
        `[REEL] MODEL: ${VEO_MODEL}`
      );

      console.log(
        `[REEL] TARGET: ${TARGET_DURATION_SECONDS}s`
      );

      console.log(
        `[REEL] SCENES: ${SCENE_COUNT}`
      );

      console.log(
        "=================================================="
      );

      // ------------------------------------------------------
      // STORY PLAN
      // ------------------------------------------------------

      updateJob(
        jobId,
        {
          progress:
            10,

          stage:
            "planning",

          message:
            "Gemini story plan bana raha hai...",
        }
      );

      const plan =
        await stepPlan(
          topic
        );

      fs.writeFileSync(
        path.join(
          jobDir,
          "plan.json"
        ),

        JSON.stringify(
          plan,
          null,
          2
        ),

        "utf8"
      );

      log.push(
        "Story plan created"
      );

      updateJob(
        jobId,
        {
          progress:
            15,

          stage:
            "planning-complete",

          message:
            "Story plan ready",
        }
      );

      // ------------------------------------------------------
      // VEO SCENES
      // ------------------------------------------------------

      updateJob(
        jobId,
        {
          progress:
            20,

          stage:
            "veo",

          message:
            `${SCENE_COUNT} cinematic scenes generate ho rahe hain...`,
        }
      );

      const scenePaths =
        [];

      for (
        let i = 0;
        i < SCENE_COUNT;
        i++
      ) {
        const scene =
          plan.scenes[i];

        const sceneNumber =
          i + 1;

        const prompt =
          buildVeoPrompt(
            plan,
            scene,
            sceneNumber
          );

        const scenePath =
          path.join(
            jobDir,
            `veo_scene_${sceneNumber}.mp4`
          );

        console.log(
          `[VEO] Generating scene ${sceneNumber}/${SCENE_COUNT}`
        );

        log.push(
          `VEO scene ${sceneNumber}/${SCENE_COUNT} generation started`
        );

        updateJob(
          jobId,
          {
            progress:
              20 +
              i * 20,

            stage:
              `veo-scene-${sceneNumber}`,

            message:
              `Veo scene ${sceneNumber}/${SCENE_COUNT} generate ho raha hai...`,
          }
        );

        const started =
          await startVeoGeneration(
            prompt
          );

        updateJob(
          jobId,
          {
            progress:
              25 +
              i * 20,

            stage:
              `veo-scene-${sceneNumber}-polling`,

            message:
              `Veo scene ${sceneNumber}/${SCENE_COUNT} processing...`,
          }
        );

        const completed =
          await pollVeoOperation(
            started.operationName,
            started.apiKey
          );

        await downloadVeoVideo(
          completed.uri,
          started.apiKey,
          scenePath
        );

        scenePaths.push(
          scenePath
        );

        log.push(
          `VEO scene ${sceneNumber}/${SCENE_COUNT} generated successfully`
        );

        updateJob(
          jobId,
          {
            progress:
              30 +
              (i + 1) * 15,

            stage:
              `veo-scene-${sceneNumber}-complete`,

            message:
              `Veo scene ${sceneNumber}/${SCENE_COUNT} complete`,
          }
        );
      }

      // ------------------------------------------------------
      // NORMALIZE
      // ------------------------------------------------------

      updateJob(
        jobId,
        {
          progress:
            65,

          stage:
            "normalizing",

          message:
            "Scenes ko 1080x1920 mein process kar raha hai...",
        }
      );

      const normalizedPaths =
        [];

      for (
        let i = 0;
        i <
        scenePaths.length;
        i++
      ) {
        const outputPath =
          path.join(
            jobDir,
            `normalized_${i + 1}.mp4`
          );

        const captionPath =
          path.join(
            jobDir,
            `caption_${i + 1}.txt`
          );

        await normalizeScene(
          scenePaths[i],
          outputPath,
          plan.scenes[i]
            .caption,
          captionPath
        );

        normalizedPaths.push(
          outputPath
        );
      }

      log.push(
        "All scenes normalized to 1080x1920"
      );

      // ------------------------------------------------------
      // CONCAT + TRIM
      // ------------------------------------------------------

      updateJob(
        jobId,
        {
          progress:
            80,

          stage:
            "concatenating",

          message:
            `Scenes ko final ${TARGET_DURATION_SECONDS}-second reel mein combine kar raha hai...`,
        }
      );

      const finalPath =
        await stepConcat(
          normalizedPaths,
          jobDir
        );

      log.push(
        `Final reel trimmed to ${TARGET_DURATION_SECONDS} seconds`
      );

      // ------------------------------------------------------
      // VERIFY
      // ------------------------------------------------------

      updateJob(
        jobId,
        {
          progress:
            92,

          stage:
            "verifying",

          message:
            "Final MP4 verify kar raha hai...",
        }
      );

      const verification =
        await verifyFinalVideo(
          finalPath
        );

      log.push(
        "Final MP4 verified"
      );

      // ------------------------------------------------------
      // METADATA
      // ------------------------------------------------------

      const metadata =
        buildMetadata(
          jobId,
          plan,
          finalPath,
          verification
        );

      const metadataPath =
        path.join(
          jobDir,
          "metadata.json"
        );

      fs.writeFileSync(
        metadataPath,

        JSON.stringify(
          metadata,
          null,
          2
        ),

        "utf8"
      );

      const downloadUrl =
        `/reels/${jobId}/final_reel.mp4`;

      const durationMs =
        Date.now() -
        startedAt;

      const result = {
        success:
          true,

        jobId,

        generator:
          this.name,

        version:
          this.version,

        model:
          VEO_MODEL,

        videoPath:
          finalPath,

        metadataPath,

        downloadUrl,

        resolution:
          `${verification.width}x${verification.height}`,

        aspectRatio:
          "9:16",

        duration:
          verification.duration,

        sceneCount:
          SCENE_COUNT,

        hasAudio:
          verification.hasAudio,

        hasVideo:
          verification.hasVideo,

        sizeBytes:
          verification.sizeBytes,

        title:
          metadata.title,

        caption:
          metadata.caption,

        hashtags:
          metadata.hashtags,

        log,

        elapsedMs:
          durationMs,
      };

      updateJob(
        jobId,
        {
          status:
            "completed",

          progress:
            100,

          stage:
            "completed",

          message:
            "Reel successfully generated",

          result,

          error:
            null,
        }
      );

      console.log(
        "=================================================="
      );

      console.log(
        "[REEL] SUCCESS"
      );

      console.log(
        `[REEL] JOB: ${jobId}`
      );

      console.log(
        `[REEL] MP4: ${finalPath}`
      );

      console.log(
        `[REEL] Resolution: ${verification.width}x${verification.height}`
      );

      console.log(
        `[REEL] Duration: ${verification.duration.toFixed(
          2
        )}s`
      );

      console.log(
        `[REEL] Audio: ${
          verification.hasAudio
            ? "YES"
            : "NO"
        }`
      );

      console.log(
        "=================================================="
      );

      return result;
    } catch (error) {
      const friendly =
        describeVeoError(
          error
        );

      console.error(
        "=================================================="
      );

      console.error(
        "[REEL] FAILED"
      );

      console.error(
        `[REEL] JOB: ${jobId}`
      );

      console.error(
        friendly
      );

      console.error(
        "=================================================="
      );

      log.push(
        `FAILED: ${friendly}`
      );

      try {
        fs.writeFileSync(
          path.join(
            jobDir,
            "error.json"
          ),

          JSON.stringify(
            {
              success:
                false,

              jobId,

              error:
                friendly,

              rawError:
                error.message,

              stack:
                error.stack,

              log,

              createdAt:
                new Date().toISOString(),
            },

            null,
            2
          ),

          "utf8"
        );
      } catch (_) {}

      updateJob(
        jobId,
        {
          status:
            "failed",

          progress:
            100,

          stage:
            "failed",

          message:
            friendly,

          error:
            friendly,

          result:
            null,
        }
      );

      error.friendlyMessage =
        friendly;

      throw error;
    }
  }

  // ----------------------------------------------------------
  // BACKGROUND JOB
  // ----------------------------------------------------------

  startJob(
    options = {}
  ) {
    const topic =
      safeText(
        options.topic ||
          options.prompt ||
          options.story ||
          options.request
      ) ||
      "Create a cinematic jungle friendship story.";

    const jobId =
      safeText(
        options.jobId
      ) ||
      createJobId();

    createJob(
      jobId,
      topic
    );

    console.log(
      `[REEL] BACKGROUND JOB STARTED: ${jobId}`
    );

    setImmediate(
      () => {
        this.generate({
          ...options,
          jobId,
          topic,
        }).catch(
          (error) => {
            console.error(
              `[REEL] Background job ${jobId} failed:`,
              error.message
            );
          }
        );
      }
    );

    return {
      success:
        true,

      jobId,

      status:
        "processing",

      processing:
        true,

      completed:
        false,

      progress:
        0,

      stage:
        "queued",

      message:
        `Reel generation started — ${TARGET_DURATION_SECONDS}-second final reel`,
    };
  }

  getJob(
    jobId
  ) {
    return getJob(
      jobId
    );
  }
}

// ------------------------------------------------------------
// SINGLETON
// ------------------------------------------------------------

let reelGeneratorInstance =
  null;

function getReelGenerator() {
  if (
    !reelGeneratorInstance
  ) {
    reelGeneratorInstance =
      new ReelGenerator();
  }

  return reelGeneratorInstance;
}

// ------------------------------------------------------------
// EXPORTS
// ------------------------------------------------------------

module.exports = {
  ReelGenerator,

  getReelGenerator,

  generateReel:
    async function (
      options
    ) {
      return getReelGenerator()
        .generate(options);
    },

  startReelJob:
    function (
      options
    ) {
      return getReelGenerator()
        .startJob(options);
    },

  getReelJob:
    function (
      jobId
    ) {
      return getReelGenerator()
        .getJob(jobId);
    },
};