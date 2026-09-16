// ============================================================
// ALEX REEL GENERATOR — v2.1
// Pipeline:
// PLAN → VOICE → VISUALS → SYNC → RENDER → VERIFY → METADATA
//
// Rules:
// - success:true ONLY when final.mp4 exists and is valid
// - FFmpeg / FFprobe bundled support for local + Render
// - Real failure cause is returned
// - No false success
// ============================================================

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

const { getAlexGeminiClient } = require("../config/geminiClient");

// ============================================================
// CONFIG
// ============================================================

const REELS_DIR = path.join(__dirname, "..", "reels");

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

// ============================================================
// RESOLVE FFMPEG / FFPROBE
// ============================================================

const FFMPEG_PATH =
  process.env.FFMPEG_PATH ||
  ffmpegStatic ||
  "ffmpeg";

const FFPROBE_PATH =
  process.env.FFPROBE_PATH ||
  ffprobeStatic?.path ||
  "ffprobe";

console.log("🎬 [REEL] FFmpeg:", FFMPEG_PATH);
console.log("🔍 [REEL] FFprobe:", FFPROBE_PATH);

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDirName(prompt) {
  const ts = Date.now();

  const slug = String(prompt || "reel")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `reel_${ts}_${slug || "untitled"}`;
}

function stripJsonFences(text) {
  let t = String(text || "").trim();

  t = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  return t.trim();
}

function extractJsonObject(text) {
  const t = stripJsonFences(text);

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// TOOL DETECTION
// ============================================================

async function detectBinary(name, executable) {
  if (!executable) {
    return {
      ok: false,
      path: null,
      reason: `${name} executable nahi mila`,
    };
  }

  try {
    await execFileAsync(executable, ["-version"], {
      timeout: 10000,
    });

    return {
      ok: true,
      path: executable,
    };
  } catch (err) {
    return {
      ok: false,
      path: executable,
      reason:
        err?.code === "ENOENT"
          ? `${name} executable nahi mila`
          : `${name} check failed: ${err?.message || "unknown error"}`,
    };
  }
}

// ============================================================
// STEP 1 — PLAN
// ============================================================

function buildPlanPrompt(reelPrompt) {
  return (
    "You are a short-form video director. Create a complete plan for a vertical 9:16 reel (Instagram/YouTube Shorts).\n\n" +
    `USER REQUEST: ${reelPrompt}\n\n` +
    "Return ONLY a JSON object with EXACTLY this shape (no markdown, no explanation):\n" +
    "{\n" +
    '  "topic": "string",\n' +
    '  "audience": "string",\n' +
    '  "durationSeconds": 30,\n' +
    '  "tone": "string",\n' +
    '  "language": "hinglish",\n' +
    '  "hook": "first 2-3 seconds punch line",\n' +
    '  "cta": "call to action line",\n' +
    '  "scenes": [\n' +
    '    { "text": "on-screen caption (max 60 chars)", "narration": "voiceover line (max 25 words)" }\n' +
    "  ]\n" +
    "}\n\n" +
    "Rules: 4 to 6 scenes. language must match user request style (default hinglish). Only valid JSON."
  );
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") {
    return false;
  }

  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    return false;
  }

  const validScenes = plan.scenes.filter(
    (scene) =>
      scene &&
      typeof scene.text === "string" &&
      scene.text.trim().length > 0
  );

  if (validScenes.length === 0) {
    return false;
  }

  plan.scenes = validScenes.slice(0, 8);

  plan.durationSeconds = Math.min(
    90,
    Math.max(
      10,
      Number(plan.durationSeconds) || plan.scenes.length * 6
    )
  );

  plan.topic = String(plan.topic || "AI Reel").slice(0, 120);
  plan.language = String(plan.language || "hinglish").slice(0, 40);
  plan.tone = String(plan.tone || "energetic").slice(0, 60);
  plan.audience = String(plan.audience || "general").slice(0, 120);

  plan.hook = String(
    plan.hook || plan.scenes[0].text
  ).slice(0, 200);

  plan.cta = String(
    plan.cta || "Follow for more!"
  ).slice(0, 200);

  return true;
}

function buildLocalFallbackPlan(reelPrompt) {
  const topic = String(reelPrompt || "AI Reel").slice(0, 120);

  return {
    topic,
    audience: "students and job seekers",
    durationSeconds: 30,
    tone: "energetic",
    language: "hinglish",
    hook: "Ruko! Ye 30 second tumhari life badal sakte hain",
    cta: "Follow karo for more!",
    scenes: [
      {
        text: topic,
        narration:
          `${topic} — ye topic sabko confuse karta hai, but aaj clear ho jayega.`,
      },
      {
        text: "Point 1: Basics clear karo",
        narration:
          "Sabse pehle basics strong karo. Bina basics ke advanced kuch nahi hoga.",
      },
      {
        text: "Point 2: Practice daily",
        narration:
          "Roz thoda practice karo. Consistency beats talent, har baar.",
      },
      {
        text: "Point 3: Real examples",
        narration:
          "Real examples dekho, sirf theory nahi. Samajh tab aata hai jab apply karo.",
      },
      {
        text: "Start aaj hi!",
        narration:
          "Toh der mat karo, aaj se shuru karo. All the best!",
      },
    ],
  };
}

async function stepPlan(reelPrompt, log) {
  const client = getAlexGeminiClient();

  if (!client || !client.isAvailable()) {
    log.push(
      "⚠️ Gemini unavailable — local fallback plan use kar rahe hain"
    );

    return {
      plan: buildLocalFallbackPlan(reelPrompt),
      source: "local-fallback",
    };
  }

  const prompt = buildPlanPrompt(reelPrompt);

  // ==========================================================
  // GEMINI JSON ATTEMPTS
  // ==========================================================

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.call(prompt, {
      temperature: 0.6,
      maxOutputTokens: 4096,
      timeoutMs: 30000,
      responseMimeType: "application/json",
      retries: 2,
    });

    if (!res.error && res.text) {
      const plan = extractJsonObject(res.text);

      if (plan && validatePlan(plan)) {
        log.push(
          `✅ Plan generated via Gemini (JSON attempt ${attempt})`
        );

        return {
          plan,
          source: "gemini-json",
        };
      }

      log.push(
        `⚠️ Attempt ${attempt}: Gemini text aaya but valid JSON plan nahi bana`
      );
    } else if (res.error) {
      log.push(
        `⚠️ Attempt ${attempt}: Gemini plan call failed — ${res.message}`
      );
    }

    await sleep(1000 * attempt);
  }

  // ==========================================================
  // PLAIN TEXT FALLBACK
  // ==========================================================

  const res2 = await client.call(
    prompt +
      "\n\nIMPORTANT: Output must start with { and end with }",
    {
      temperature: 0.6,
      maxOutputTokens: 4096,
      timeoutMs: 30000,
      responseMimeType: "text/plain",
      retries: 2,
    }
  );

  if (!res2.error && res2.text) {
    const plan = extractJsonObject(res2.text);

    if (plan && validatePlan(plan)) {
      log.push(
        "✅ Plan generated via Gemini (plain-text attempt)"
      );

      return {
        plan,
        source: "gemini-plain",
      };
    }

    log.push(
      "⚠️ Plain-text attempt: valid JSON nahi mila"
    );
  } else if (res2.error) {
    log.push(
      `⚠️ Plain-text attempt failed — ${res2.message}`
    );
  }

  // ==========================================================
  // LOCAL FALLBACK
  // ==========================================================

  log.push(
    "⚠️ Gemini se plan nahi bana — local fallback plan use kar rahe hain"
  );

  return {
    plan: buildLocalFallbackPlan(reelPrompt),
    source: "local-fallback",
  };
}

// ============================================================
// STEP 2 — ELEVENLABS VOICE
// ============================================================

const ELEVEN_URL =
  "https://api.elevenlabs.io/v1/text-to-speech";

async function stepVoice(plan, jobDir, log) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const voiceId =
    process.env.ELEVENLABS_VOICE_ID ||
    "21m00Tcm4TlvDq8ikWAM";

  if (!apiKey) {
    log.push(
      "ℹ️ ELEVENLABS_API_KEY nahi hai — voiceover skip, text-only reel banegi"
    );

    return {
      enabled: false,
      sceneAudios: [],
      totalDuration: null,
    };
  }

  const sceneAudios = [];

  for (let i = 0; i < plan.scenes.length; i++) {
    const narration =
      (i === 0 ? plan.hook + " " : "") +
      String(plan.scenes[i].narration || "");

    const outPath = path.join(
      jobDir,
      `voice_${String(i).padStart(2, "0")}.mp3`
    );

    try {
      const res = await fetch(
        `${ELEVEN_URL}/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: narration,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!res.ok) {
        await res.text().catch(() => "");

        log.push(
          `⚠️ ElevenLabs scene ${i + 1} HTTP ${res.status} — is scene ka audio skip`
        );

        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());

      if (buf.length < 1000) {
        log.push(
          `⚠️ ElevenLabs scene ${i + 1}: audio too small, skip`
        );

        continue;
      }

      await fs.promises.writeFile(outPath, buf);

      sceneAudios.push({
        index: i,
        path: outPath,
      });

      log.push(
        `🎙️ Voiceover scene ${i + 1}/${plan.scenes.length} done`
      );
    } catch (err) {
      log.push(
        `⚠️ ElevenLabs scene ${i + 1} failed: ${
          err?.message || "unknown error"
        } — skip`
      );
    }
  }

  if (sceneAudios.length === 0) {
    log.push(
      "⚠️ Koi bhi voiceover nahi bana — text-only reel banegi"
    );

    return {
      enabled: false,
      sceneAudios: [],
      totalDuration: null,
    };
  }

  return {
    enabled: true,
    sceneAudios,
    totalDuration: null,
  };
}

// ============================================================
// STEP 3+4 — VISUALS + SYNC
// ============================================================

async function getAudioDuration(ffprobe, filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      {
        timeout: 15000,
      }
    );

    const duration = parseFloat(stdout.trim());

    return Number.isFinite(duration) && duration > 0
      ? duration
      : null;
  } catch {
    return null;
  }
}

async function stepVisualsSync(
  plan,
  voice,
  jobDir,
  ffmpeg,
  ffprobe,
  log
) {
  const sceneCount = plan.scenes.length;

  const sceneDurations = [];

  // ==========================================================
  // DURATIONS
  // ==========================================================

  if (voice.enabled) {
    for (let i = 0; i < sceneCount; i++) {
      const audio = voice.sceneAudios.find(
        (item) => item.index === i
      );

      if (audio) {
        const duration = await getAudioDuration(
          ffprobe,
          audio.path
        );

        sceneDurations.push(
          duration ? duration + 0.4 : 6
        );
      } else {
        sceneDurations.push(6);
      }
    }
  } else {
    const per = Math.max(
      3,
      plan.durationSeconds / sceneCount
    );

    for (let i = 0; i < sceneCount; i++) {
      sceneDurations.push(per);
    }
  }

  // ==========================================================
  // BACKGROUNDS
  // ==========================================================

  const gradients = [
    "0x0f0c29:0x302b63",
    "0x134e5e:0x71b280",
    "0x41295a:0x2f0743",
    "0x1a2980:0x26d0ce",
    "0x360033:0x0b8793",
    "0x16222a:0x3a6073",
  ];

  const clips = [];

  // ==========================================================
  // SCENE RENDER
  // ==========================================================

  for (let i = 0; i < sceneCount; i++) {
    const duration = Number(sceneDurations[i]).toFixed(2);

    const clipPath = path.join(
      jobDir,
      `scene_${String(i).padStart(2, "0")}.mp4`
    );

    const txtFile = path.join(
      jobDir,
      `caption_${String(i).padStart(2, "0")}.txt`
    );

    // --------------------------------------------------------
    // Caption wrapping
    // --------------------------------------------------------

    const words = String(
      plan.scenes[i].text || ""
    )
      .trim()
      .split(/\s+/);

    const lines = [];

    let line = "";

    for (const word of words) {
      if (
        (line + " " + word).trim().length > 22
      ) {
        if (line.trim()) {
          lines.push(line.trim());
        }

        line = word;
      } else {
        line = (line + " " + word).trim();
      }
    }

    if (line.trim()) {
      lines.push(line.trim());
    }

    await fs.promises.writeFile(
      txtFile,
      lines.slice(0, 4).join("\n"),
      "utf8"
    );

    // --------------------------------------------------------
    // Gradient
    // --------------------------------------------------------

    const grad =
      gradients[i % gradients.length].split(":");

    const fontSize = Math.floor(WIDTH / 12);

    const escapedTxtFile = txtFile
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");

    const vf =
      `drawtext=textfile='${escapedTxtFile}'` +
      `:fontcolor=white` +
      `:fontsize=${fontSize}` +
      `:font='Arial'` +
      `:x=(w-text_w)/2` +
      `:y=(h-text_h)/2` +
      `:line_spacing=${Math.floor(fontSize / 4)}` +
      `:box=1` +
      `:boxcolor=black@0.35` +
      `:boxborderw=24`;

    const args = [
      "-y",

      "-f",
      "lavfi",

      "-i",
      `gradients=s=${WIDTH}x${HEIGHT}:c0=${grad[0]}:c1=${grad[1]}:d=${duration}`,

      "-vf",
      vf,

      "-r",
      String(FPS),

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-pix_fmt",
      "yuv420p",

      "-t",
      duration,

      clipPath,
    ];

    try {
      await execFileAsync(ffmpeg, args, {
        timeout: 120000,
      });

      if (!(await fileExists(clipPath))) {
        throw new Error(
          "FFmpeg completed but scene file create nahi hui"
        );
      }

      clips.push(clipPath);

      log.push(
        `🎬 Scene ${i + 1}/${sceneCount} rendered (${duration}s)`
      );
    } catch (err) {
      throw new Error(
        `Scene ${i + 1} render failed (FFmpeg): ${
          err?.message || "unknown error"
        }`
      );
    }
  }

  // ==========================================================
  // CONCAT
  // ==========================================================

  if (clips.length === 0) {
    throw new Error(
      "Koi scene render nahi hua"
    );
  }

  const listFile = path.join(
    jobDir,
    "clips.txt"
  );

  const listContent = clips
    .map(
      (clip) =>
        `file '${clip.replace(/\\/g, "/")}'`
    )
    .join("\n");

  await fs.promises.writeFile(
    listFile,
    listContent,
    "utf8"
  );

  const videoOnly = path.join(
    jobDir,
    "video_noaudio.mp4"
  );

  try {
    await execFileAsync(
      ffmpeg,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        videoOnly,
      ],
      {
        timeout: 120000,
      }
    );
  } catch (err) {
    throw new Error(
      `Scene concat failed: ${
        err?.message || "unknown error"
      }`
    );
  }

  if (!(await fileExists(videoOnly))) {
    throw new Error(
      "FFmpeg concat ke baad video_noaudio.mp4 nahi bani"
    );
  }

  log.push(
    "🎬 All scenes concatenated"
  );

  return {
    videoOnly,
    sceneDurations,
  };
}

// ============================================================
// STEP 5 — FINAL RENDER
// ============================================================

async function stepRender(
  voice,
  jobDir,
  videoOnly,
  ffmpeg,
  log
) {
  const finalPath = path.join(
    jobDir,
    "final.mp4"
  );

  if (!(await fileExists(videoOnly))) {
    throw new Error(
      "Render start nahi ho sakta — video_noaudio.mp4 missing"
    );
  }

  if (voice.enabled) {
    // --------------------------------------------------------
    // Audio list
    // --------------------------------------------------------

    const audioList = path.join(
      jobDir,
      "audio_list.txt"
    );

    const content = voice.sceneAudios
      .sort((a, b) => a.index - b.index)
      .map(
        (audio) =>
          `file '${audio.path.replace(/\\/g, "/")}'`
      )
      .join("\n");

    await fs.promises.writeFile(
      audioList,
      content,
      "utf8"
    );

    const narrationMp3 = path.join(
      jobDir,
      "narration.mp3"
    );

    // --------------------------------------------------------
    // Concatenate narration
    // --------------------------------------------------------

    try {
      await execFileAsync(
        ffmpeg,
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          audioList,
          "-c",
          "copy",
          narrationMp3,
        ],
        {
          timeout: 60000,
        }
      );
    } catch (err) {
      throw new Error(
        `Voiceover concat failed: ${
          err?.message || "unknown error"
        }`
      );
    }

    // --------------------------------------------------------
    // Mux
    // --------------------------------------------------------

    try {
      await execFileAsync(
        ffmpeg,
        [
          "-y",

          "-i",
          videoOnly,

          "-i",
          narrationMp3,

          "-c:v",
          "libx264",

          "-preset",
          "veryfast",

          "-c:a",
          "aac",

          "-b:a",
          "128k",

          "-shortest",

          "-movflags",
          "+faststart",

          finalPath,
        ],
        {
          timeout: 300000,
        }
      );
    } catch (err) {
      throw new Error(
        `Final video + voice mux failed: ${
          err?.message || "unknown error"
        }`
      );
    }

    log.push(
      "🔊 Voiceover mixed into final video"
    );
  } else {
    // --------------------------------------------------------
    // Silent audio track
    // --------------------------------------------------------

    try {
      await execFileAsync(
        ffmpeg,
        [
          "-y",

          "-i",
          videoOnly,

          "-f",
          "lavfi",

          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",

          "-c:v",
          "libx264",

          "-preset",
          "veryfast",

          "-c:a",
          "aac",

          "-shortest",

          "-movflags",
          "+faststart",

          finalPath,
        ],
        {
          timeout: 300000,
        }
      );
    } catch (err) {
      throw new Error(
        `Silent audio render failed: ${
          err?.message || "unknown error"
        }`
      );
    }

    log.push(
      "🔇 No voiceover — silent audio track added"
    );
  }

  if (!(await fileExists(finalPath))) {
    throw new Error(
      "FFmpeg render complete hua lekin final.mp4 create nahi hui"
    );
  }

  return {
    finalPath,
  };
}

// ============================================================
// STEP 6 — VERIFY FINAL VIDEO
// ============================================================

async function verifyFinalVideo(
  ffprobe,
  finalPath,
  log
) {
  if (!(await fileExists(finalPath))) {
    return {
      ok: false,
      reason:
        "final.mp4 file exist hi nahi karta",
    };
  }

  let stat;

  try {
    stat = await fs.promises.stat(
      finalPath
    );
  } catch (err) {
    return {
      ok: false,
      reason:
        `final.mp4 stat failed: ${
          err?.message || "unknown error"
        }`,
    };
  }

  if (stat.size < 10000) {
    return {
      ok: false,
      reason:
        `final.mp4 too small (${stat.size} bytes) — corrupted render`,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",

        "-select_streams",
        "v:0",

        "-show_entries",
        "stream=width,height,duration",

        "-of",
        "json",

        finalPath,
      ],
      {
        timeout: 15000,
      }
    );

    const info = JSON.parse(stdout);

    const stream = info?.streams?.[0];

    if (!stream) {
      return {
        ok: false,
        reason:
          "ffprobe ko video stream nahi mila",
      };
    }

    const width = Number(stream.width);
    const height = Number(stream.height);
    const duration = Number(stream.duration);

    if (
      width !== WIDTH ||
      height !== HEIGHT
    ) {
      return {
        ok: false,
        reason:
          `Video resolution ${width}x${height} hai, expected ${WIDTH}x${HEIGHT}`,
      };
    }

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return {
        ok: false,
        reason:
          "Video duration invalid hai",
      };
    }

    log.push(
      `🔍 Verified: ${width}x${height}, ${Math.round(
        duration
      )}s, ${(stat.size / 1024 / 1024).toFixed(
        2
      )} MB`
    );

    return {
      ok: true,
      width,
      height,
      duration,
      sizeBytes: stat.size,
    };
  } catch (err) {
    return {
      ok: false,
      reason:
        `ffprobe verification failed: ${
          err?.message || "unknown error"
        }`,
    };
  }
}

// ============================================================
// STEP 7 — METADATA
// ============================================================

async function stepMetadata(
  plan,
  source,
  jobDir,
  verify,
  downloadBase,
  log
) {
  const topicWords = plan.topic
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (word) => word.length > 3
    )
    .slice(0, 3);

  const hashtags = [
    "#reels",
    "#shorts",
    "#viral",
    ...topicWords.map(
      (word) => `#${word.replace(/[^a-z0-9]/g, "")}`
    ),
  ];

  const metadata = {
    jobId: path.basename(jobDir),

    generatedAt:
      new Date().toISOString(),

    planSource: source,

    title:
      `${plan.topic} | ${plan.tone} reel`,

    caption:
      `${plan.hook}\n\n${plan.cta}`,

    hashtags,

    durationSeconds:
      verify.duration ||
      plan.durationSeconds,

    resolution:
      `${verify.width || WIDTH}x${
        verify.height || HEIGHT
      }`,

    sizeBytes:
      verify.sizeBytes,

    videoPath:
      "final.mp4",

    downloadUrl:
      `${downloadBase}/final.mp4`,

    sceneCount:
      plan.scenes.length,

    scenes:
      plan.scenes,
  };

  await fs.promises.writeFile(
    path.join(jobDir, "metadata.json"),
    JSON.stringify(
      metadata,
      null,
      2
    ),
    "utf8"
  );

  log.push(
    "📝 Metadata saved"
  );

  return metadata;
}

// ============================================================
// MAIN ENTRY
// ============================================================

async function generate(reelPrompt) {
  const log = [];

  const prompt =
    String(reelPrompt || "").trim();

  if (!prompt) {
    return {
      success: false,
      error:
        "Reel prompt khali hai — batao reel kis topic par chahiye.",
      log,
    };
  }

  // ==========================================================
  // TOOL DETECTION
  // ==========================================================

  const ffmpegCheck =
    await detectBinary(
      "FFmpeg",
      FFMPEG_PATH
    );

  const ffprobeCheck =
    await detectBinary(
      "FFprobe",
      FFPROBE_PATH
    );

  if (
    !ffmpegCheck.ok ||
    !ffprobeCheck.ok
  ) {
    const missing = [
      !ffmpegCheck.ok
        ? `FFmpeg (${ffmpegCheck.reason})`
        : null,

      !ffprobeCheck.ok
        ? `FFprobe (${ffprobeCheck.reason})`
        : null,
    ]
      .filter(Boolean)
      .join(" and ");

    log.push(
      `❌ ${missing}`
    );

    return {
      success: false,
      error:
        `Reel generate nahi ho sakti — ${missing}`,
      log,
    };
  }

  log.push(
    "✅ FFmpeg available"
  );

  log.push(
    "✅ FFprobe available"
  );

  // ==========================================================
  // JOB DIRECTORY
  // ==========================================================

  const jobId =
    safeDirName(prompt);

  const jobDir =
    path.join(
      REELS_DIR,
      jobId
    );

  try {
    await fs.promises.mkdir(
      jobDir,
      {
        recursive: true,
      }
    );

    log.push(
      `📁 Job dir: reels/${jobId}/`
    );

    // ========================================================
    // STEP 1 — PLAN
    // ========================================================

    const {
      plan,
      source,
    } =
      await stepPlan(
        prompt,
        log
      );

    if (
      !plan ||
      !validatePlan(plan)
    ) {
      return {
        success: false,
        error:
          "Valid reel plan generate nahi hua.",
        jobId,
        log,
      };
    }

    log.push(
      `📋 Plan: "${plan.topic}" — ${plan.scenes.length} scenes (${source})`
    );

    // ========================================================
    // STEP 2 — VOICE
    // ========================================================

    const voice =
      await stepVoice(
        plan,
        jobDir,
        log
      );

    // ========================================================
    // STEP 3+4 — VISUALS + SYNC
    // ========================================================

    const {
      videoOnly,
    } =
      await stepVisualsSync(
        plan,
        voice,
        jobDir,
        ffmpegCheck.path,
        ffprobeCheck.path,
        log
      );

    // ========================================================
    // STEP 5 — RENDER
    // ========================================================

    const {
      finalPath,
    } =
      await stepRender(
        voice,
        jobDir,
        videoOnly,
        ffmpegCheck.path,
        log
      );

    // ========================================================
    // STEP 6 — VERIFY
    // ========================================================

    const verify =
      await verifyFinalVideo(
        ffprobeCheck.path,
        finalPath,
        log
      );

    if (!verify.ok) {
      log.push(
        `❌ Verification failed: ${verify.reason}`
      );

      return {
        success: false,
        error:
          `Reel render hui but verification fail — ${verify.reason}`,
        jobId,
        log,
      };
    }

    // ========================================================
    // STEP 7 — METADATA
    // ========================================================

    const backendUrl =
      process.env.BACKEND_URL ||
      "http://localhost:5000";

    const downloadBase =
      `${backendUrl}/reels/${jobId}`;

    const metadata =
      await stepMetadata(
        plan,
        source,
        jobDir,
        verify,
        downloadBase,
        log
      );

    // ========================================================
    // FINAL SAFETY CHECK
    // ========================================================

    const finalExists =
      await fileExists(
        finalPath
      );

    if (!finalExists) {
      return {
        success: false,
        error:
          "Final safety check failed — final.mp4 missing.",
        jobId,
        log,
      };
    }

    log.push(
      "✅ Reel pipeline completed and verified"
    );

    // ========================================================
    // REAL SUCCESS
    // ========================================================

    return {
      success: true,

      jobId,

      title:
        metadata.title,

      caption:
        metadata.caption,

      hashtags:
        metadata.hashtags,

      downloadUrl:
        metadata.downloadUrl,

      resolution:
        metadata.resolution,

      durationSeconds:
        metadata.durationSeconds,

      sceneCount:
        plan.scenes.length,

      hadVoiceover:
        voice.enabled,

      videoPath:
        finalPath,

      metadataPath:
        path.join(
          jobDir,
          "metadata.json"
        ),

      log,
    };
  } catch (err) {
    // ========================================================
    // REAL FAILURE
    // ========================================================

    const reason =
      err?.message ||
      "Unknown reel pipeline error";

    log.push(
      `❌ Pipeline error: ${reason}`
    );

    return {
      success: false,

      error:
        `Reel generation fail hui — ${reason}`,

      jobId,

      log,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getReelGenerator() {
  if (!instance) {
    instance = {
      generate,
    };

    console.log(
      "🎬 [ALEX] ReelGenerator v2.1 ready"
    );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ReelGenerator: {
    generate,
  },

  getReelGenerator,
};