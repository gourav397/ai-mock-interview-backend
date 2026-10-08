"use strict";

// ============================================================
// ALEX AUTONOMOUS TASK INTENT
// Version: 1.0.0
//
// Purpose:
//   Detect when the owner wants ALEX to:
//   - keep working until completion
//   - continue automatically
//   - work in background
//   - retry/replan when necessary
//   - complete a long-running task
//
// This module ONLY detects intent.
// It does NOT execute anything.
// ============================================================

// ============================================================
// STRONG AUTONOMOUS PHRASES
// ============================================================

const STRONG_PATTERNS = [
  /\bkarte?\s+raho\b/i,
  /\bkarte?\s+rehna\b/i,
  /\bkarte?\s+rehna\b/i,
  /\bcomplete\s+(?:hone|hote)\s+tak\b/i,
  /\bcomplete\s+hone\s+do\b/i,
  /\bjab\s+tak\s+complete\b/i,
  /\bpoora\s+hone\s+tak\b/i,
  /\bpura\s+hone\s+tak\b/i,
  /\bpoora\s+karo\b/i,
  /\bpura\s+karo\b/i,
  /\bfinish\s+hone\s+tak\b/i,
  /\bfinish\s+tak\b/i,
  /\buntil\s+(?:it|the\s+task|this)\s+is\s+complete\b/i,
  /\buntil\s+(?:it|the\s+task|this)\s+is\s+done\b/i,
  /\bkeep\s+(?:working|going)\b/i,
  /\bkeep\s+working\s+on\b/i,
  /\bcontinue\s+(?:working|until)\b/i,
  /\bwork\s+until\s+(?:done|complete|finished)\b/i,
  /\bdon't\s+stop\b/i,
  /\bdo\s+not\s+stop\b/i,
  /\bwithout\s+stopping\b/i,
  /\bwithout\s+stopping\s+until\b/i,
  /\bbackground\s+(?:me|mein|mode)\b/i,
  /\brun\s+in\s+background\b/i,
  /\bbackground\s+mein\s+karte?\s+raho\b/i,
  /\bautomatically\s+continue\b/i,
  /\bautomatic(?:ally)?\s+retry\b/i,
  /\bkeep\s+retrying\b/i,
  /\bretry\s+until\b/i,
  /\breplan\s+if\b/i,
  /\breplan\s+when\b/i,
];

// ============================================================
// WEAKER TASK PHRASES
// ============================================================

const TASK_PATTERNS = [
  /\btask\b/i,
  /\bkaam\b/i,
  /\bwork\b/i,
  /\bproject\s+par\s+kaam\b/i,
  /\bproject\s+ka\s+kaam\b/i,
  /\bfix\s+(?:this|it|the)\b/i,
  /\bbuild\s+(?:this|it|the)\b/i,
  /\bcreate\s+(?:this|it|the)\b/i,
  /\banalyze\s+(?:this|it|the)\b/i,
  /\bdevelop\s+(?:this|it|the)\b/i,
  /\bimplement\s+(?:this|it|the)\b/i,
  /\bsolve\s+(?:this|it|the)\b/i,
  /\bfinish\s+(?:this|it|the)\b/i,
  /\bcomplete\s+(?:this|it|the)\b/i,
  /\bfix\s+all\b/i,
  /\bsolve\s+all\b/i,
  /\bcomplete\s+all\b/i,
];

// ============================================================
// EXPLICIT AUTONOMOUS PREFIXES
// ============================================================

const EXPLICIT_PREFIXES = [
  /^autonomous(?:\s+task)?\s*:/i,
  /^long[-\s]?running\s+task\s*:/i,
  /^background\s+task\s*:/i,
  /^keep\s+working\s*:/i,
  /^continue\s+working\s*:/i,
  /^finish\s+this\s*:/i,
  /^complete\s+this\s*:/i,
];

// ============================================================
// NEGATIVE / NORMAL CHAT PHRASES
// ============================================================

const NORMAL_CHAT_PATTERNS = [
  /^(hi|hey|hello|hye|namaste)\b/i,
  /\bkaise\s+ho\b/i,
  /\bhow\s+are\s+you\b/i,
  /\bmera\s+naam\b/i,
  /\bmy\s+name\s+is\b/i,
  /\bthank(s|you)?\b/i,
  /\bthanks\b/i,
  /\bgood\s+morning\b/i,
  /\bgood\s+night\b/i,
];

// ============================================================
// CLEAN INPUT
// ============================================================

function cleanInput(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// REMOVE AUTONOMOUS PREFIX
// ============================================================

function stripPrefix(input) {
  let result = input;

  for (const pattern of EXPLICIT_PREFIXES) {
    result = result.replace(pattern, "");
  }

  return result.trim();
}

// ============================================================
// DETECT
// ============================================================

function detectAutonomousTaskIntent(
  input,
  options = {}
) {
  const original =
    cleanInput(input);

  if (!original) {
    return {
      autonomous: false,
      confidence: 0,
      reason: "empty-input",
      taskInput: "",
    };
  }

  // ----------------------------------------------------------
  // Normal conversation should not become an autonomous task.
  // ----------------------------------------------------------

  if (
    NORMAL_CHAT_PATTERNS.some(
      (pattern) =>
        pattern.test(original)
    ) &&
    !STRONG_PATTERNS.some(
      (pattern) =>
        pattern.test(original)
    )
  ) {
    return {
      autonomous: false,
      confidence: 0.05,
      reason: "normal-chat",
      taskInput: original,
    };
  }

  // ----------------------------------------------------------
  // Explicit autonomous prefix
  // ----------------------------------------------------------

  const explicitPrefix =
    EXPLICIT_PREFIXES.some(
      (pattern) =>
        pattern.test(original)
    );

  // ----------------------------------------------------------
  // Strong autonomous intent
  // ----------------------------------------------------------

  const strongMatches =
    STRONG_PATTERNS.filter(
      (pattern) =>
        pattern.test(original)
    );

  // ----------------------------------------------------------
  // Task language
  // ----------------------------------------------------------

  const taskMatches =
    TASK_PATTERNS.filter(
      (pattern) =>
        pattern.test(original)
    );

  // ----------------------------------------------------------
  // Decide
  // ----------------------------------------------------------

  if (
    explicitPrefix ||
    strongMatches.length > 0
  ) {
    const taskInput =
      stripPrefix(original);

    return {
      autonomous: true,

      confidence:
        explicitPrefix
          ? 1
          : Math.min(
              0.98,
              0.75 +
                strongMatches.length *
                  0.08
            ),

      reason:
        explicitPrefix
          ? "explicit-autonomous-request"
          : "autonomous-completion-language",

      taskInput:
        taskInput || original,

      matchedPatterns:
        strongMatches.length,

      taskLanguage:
        taskMatches.length > 0,

      background:
        /\bbackground\b/i.test(
          original
        ),

      keepWorking:
  explicitPrefix ||
  /\bkeep\s+(?:working|going)\b/i.test(
    original
  ) ||
  /\bkarte?\s+raho\b/i.test(
    original
  ),

untilComplete:
  explicitPrefix ||
  /\buntil\b/i.test(
    original
  ) ||
  /\btak\b/i.test(
    original
  ) ||
  /\bcomplete\b/i.test(
    original
  ) ||
  /\bfinish\b/i.test(
    original
  ) ||
  /\bpura\b/i.test(
    original
  ) ||
  /\bpoora\b/i.test(
    original
  ),

      originalInput:
        original,
    };
  }

  // ----------------------------------------------------------
  // Weak task language alone is NOT enough.
  //
  // Example:
  // "task kya hota hai?"
  //
  // should not automatically start a background task.
  // ----------------------------------------------------------

  return {
    autonomous: false,

    confidence:
      taskMatches.length > 0
        ? 0.35
        : 0.05,

    reason:
      taskMatches.length > 0
        ? "ordinary-task-language"
        : "normal-command",

    taskInput:
      original,

    matchedPatterns:
      taskMatches.length,

    originalInput:
      original,
  };
}

// ============================================================
// SHOULD START AUTONOMOUS TASK?
// ============================================================

function shouldStartAutonomousTask(
  input,
  options = {}
) {
  const result =
    detectAutonomousTaskIntent(
      input,
      options
    );

  if (!result.autonomous) {
    return false;
  }

  const minimumConfidence =
    Number(
      options.minimumConfidence
    );

  const threshold =
    Number.isFinite(
      minimumConfidence
    )
      ? minimumConfidence
      : 0.75;

  return (
    Number(
      result.confidence
    ) >= threshold
  );
}

// ============================================================
// BUILD TASK REQUEST
// ============================================================

function buildAutonomousTaskRequest(
  input,
  options = {}
) {
  const detection =
    detectAutonomousTaskIntent(
      input,
      options
    );

  if (!detection.autonomous) {
    return null;
  }

  return {
    input:
      detection.taskInput ||
      detection.originalInput,

    ownerId:
      options.ownerId ||
      "anonymous",

    sessionId:
      options.sessionId ||
      "default",

    windowsAgentToken:
      options.windowsAgentToken ||
      "",

    action:
      "autonomous-task",

    target:
      options.target ||
      "project",

    resumeOnRestart:
      options.resumeOnRestart !== false,

    metadata: {
      autonomous: true,

      detectionReason:
        detection.reason,

      confidence:
        detection.confidence,

      background:
        detection.background,

      keepWorking:
        detection.keepWorking,

      untilComplete:
        detection.untilComplete,

      originalInput:
        detection.originalInput,

      startedAt:
        new Date().toISOString(),
    },
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  detectAutonomousTaskIntent,
  shouldStartAutonomousTask,
  buildAutonomousTaskRequest,
};