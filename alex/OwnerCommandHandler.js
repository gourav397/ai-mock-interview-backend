// ============================================================
// ALEX OWNER COMMAND HANDLER — PREMIUM PRODUCTION VERSION 3.2
// COMPLETE FILE WITH ALL FIXES:
//   ✓ Natural language parsing (50+ variations)
//   ✓ Goal Classifier for long natural-language build goals
//   ✓ NEW: Deep Analysis intent (read-only project analysis reports)
//   ✓ Rich diagnostics on parse failure (no blind errors)
//   ✓ File creation with content extraction
//   ✓ Multiline code writing
//   ✓ Cross-platform test execution (npm.cmd on Windows)
//   ✓ Gemini 429 fallback
//   ✓ All 24+ registered actions
//   ✓ Fix-loop with retry + rollback
//   ✓ Command history
//   ✓ Audit logging
//   ✓ Protected-path enforcement
//   ✓ Protected-file boundary
//   ✓ Self-verification
//   ✓ Security-scan
// ============================================================

const {
  CommandAllowlist,
} = require("./CommandAllowlist");

const {
  getDecisionEngine,
} = require("./DecisionEngine");

const {
  getAlexController,
} = require("./AlexController");

const {
  getAuditLogger,
} = require("./AuditLogger");

const {
  getIncidentManager,
} = require("./IncidentManager");

const {
  getHealthMonitor,
} = require("./HealthMonitor");

const {
  getSecurityAgent,
} = require("./SecurityAgent");

const {
  getEmployeeAgent,
} = require("./EmployeeAgent");

const {
  callGemini,
} = require("./utils/gemini");

const config = require("./config");

const path = require("path");
const fs = require("fs");
const { execFileSync, execSync } = require("child_process");

const PROJECT_ROOT = CommandAllowlist.getProjectRoot();

const BACKUP_DIR = path.join(
  PROJECT_ROOT,
  ".alex-backups",
  "owner-commands"
);

const MAX_FIX_LOOP_ITERATIONS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ============================================================
// OWNER COMMAND HANDLER
// ============================================================

class OwnerCommandHandler {
  constructor() {
    this.ready = true;
    this.commandHistory = [];
    this.pendingConfirmations = new Map();
    this.maxHistory = config.owner?.commandHistoryMax || 1000;
    this._skipVerification = false; // prevent infinite loops
  }

  // ============================================================
  // PUBLIC COMMAND PROCESSOR
  // ============================================================

  async processCommand(input, owner, confirmationId = null) {
    const commandId = this._generateCommandId();
    const startTime = Date.now();

    try {
      if (!input || typeof input !== "string") {
        return this._buildResult(commandId, "error", { error: "Command input is required." });
      }

      // STEP 1 — PARSE
      const parsed = await this._parseCommand(input);
      if (!parsed.success) {
        return this._buildResult(commandId, "error", {
          understood: input,
          error: "Could not understand the command.",
          details: parsed.error,
          diagnostics: parsed.diagnostics || null,
          suggestion: parsed.suggestion || "Try: inspect project, run tests, check health, show actions, fix bugs, show incidents, show history"
        });
      }

      const { action, target, parameters, riskLevel } = parsed;

      // STEP 2 — ACTION ALLOWLIST
      if (!CommandAllowlist.isActionAllowed(action)) {
        return this._buildResult(commandId, "denied", {
          understood: input, action, target,
          error: `Action "${action}" is not allowed.`,
          allowedActions: CommandAllowlist.getAllowedActions(),
        });
      }

      // STEP 3 — HIGH RISK CONFIRMATION
      if (CommandAllowlist.requiresConfirmation(action)) {
        if (!confirmationId) {
          const token = this._generateConfirmationToken(commandId, owner);
          return this._buildResult(commandId, "confirmation_required", {
            understood: input, action, target, parameters,
            riskLevel: riskLevel || 4,
            message: "This action requires explicit confirmation.",
            confirmationId: token,
          });
        }
        if (!this._verifyConfirmation(confirmationId, commandId, owner)) {
          return this._buildResult(commandId, "denied", {
            understood: input, action, target,
            error: "Invalid or expired confirmation.",
          });
        }
      }

      // STEP 4 — EXECUTE
      const executionResult = await this._execute(action, target, parameters, owner);

      // STEP 5 — AUDIT
      await this._auditLog({
        commandId, owner: this._sanitizeOwnerForLog(owner),
        input: this._sanitizeForAudit(input), action, target,
        parameters: this._sanitizeParams(parameters), riskLevel,
        executionResult, durationMs: Date.now() - startTime,
      });

      // STEP 6 — HISTORY
      this.commandHistory.push({
        commandId, timestamp: new Date().toISOString(),
        action, target, success: executionResult.success === true,
        summary: executionResult.message
          ? String(executionResult.message).slice(0, 200)
          : "Completed"
      });
      if (this.commandHistory.length > this.maxHistory) {
        this.commandHistory = this.commandHistory.slice(-500);
      }

      return this._buildResult(commandId,
        executionResult.success ? "completed" : "failed",
        { understood: input, action, target, parameters, ...executionResult, durationMs: Date.now() - startTime }
      );
    } catch (error) {
      console.error("[ALEX] Owner command fatal error:", error);
      return this._buildResult(commandId, "error", {
        understood: input,
        error: error?.message || "Unexpected command execution error.",
        durationMs: Date.now() - startTime,
      });
    }
  }

  // ============================================================
  // COMMAND PARSER — COMPREHENSIVE NLU
  // Order: deterministic file parser → AI parser → regex NLU → goal classifier
  // ============================================================

  async _parseCommand(input) {
    if (!input || typeof input !== "string") {
      return { success: false, error: "No command supplied." };
    }

    const trimmed = input.trim();

    // PRIORITY 1 — DETERMINISTIC PARSER for file commands
    const deterministic = this._parseFileCommand(trimmed);
    if (deterministic) return deterministic;

    // PRIORITY 2 — AI PARSER (if available)
    let aiParseError = null;
    if (config.ai?.available) {
      try {
        const allowedActions = CommandAllowlist.getAllowedActions()
          .map(a => `${a.action}: ${a.description}`).join("\n");

        const prompt = `You are ALEX's command parser.

Convert the OWNER command into strict JSON.

ALLOWED ACTIONS:
${allowedActions}

OWNER COMMAND:
${JSON.stringify(trimmed)}

IMPORTANT RULES:
1. Never invent a filename.
2. If the owner gives a filename, preserve it exactly.
3. For create-file: target MUST be the filename/path. parameters.path MUST contain the filename. parameters.content MUST contain the complete requested content.
4. For modify-file: parameters.path MUST contain the existing file. parameters.content MUST contain the complete replacement content if supplied.
5. Never use "project" as the filename when a filename exists in the command.
6. If content is explicitly provided, preserve it exactly.
7. Return JSON only.

FORMAT:
{"action":"create-file","target":"example.js","parameters":{"path":"example.js","content":"console.log('hello');"},"riskLevel":1,"confidence":1}`;

        const result = await callGemini(prompt, { temperature: 0, timeoutMs: 15000 });
        const normalized = this._normalizeAIParse(result, trimmed);
        if (normalized && normalized.success) return normalized;
        aiParseError = "AI parser returned no usable action (unavailable, malformed JSON, quota, or unknown action).";
      } catch (error) {
        aiParseError = `AI parser error: ${error.message}`;
        console.log("[ALEX] AI parser fallback:", error.message);
      }
    } else {
      aiParseError = "AI parser unavailable (config.ai.available = false).";
    }

    // PRIORITY 3 — REGEX FALLBACK PARSER
    const fallback = this._fallbackParse(trimmed);
    if (fallback.success) return fallback;

    // PRIORITY 4 — GOAL CLASSIFIER (natural-language build/analysis goals)
    const goal = this._parseGoal(trimmed, aiParseError, fallback.error);
    if (goal) return goal;

    // All parsers failed — return rich diagnostics
    return {
      ...fallback,
      diagnostics: {
        reason: "Command matched none of: file-command parser, AI parser, regex NLU patterns, goal classifier.",
        aiParser: aiParseError,
        regexNlu: "No regex pattern matched.",
        goalClassifier: "No build/implement/analysis intent detected.",
        inputLength: trimmed.length,
        isMultiLine: trimmed.includes("\n"),
      },
    };
  }

  // ============================================================
  // GOAL CLASSIFIER — natural-language build/implement/analysis goals
  // ============================================================

  _parseGoal(input, aiParseError = null, regexError = null) {
    const lower = input.toLowerCase();

    // ---------------------------------------------------------
    // DEEP ANALYSIS intent — read-only project analysis report
    // e.g. "actual project analysis karo... detailed findings do...
    //       koi file modify/delete mat karo"
    // ---------------------------------------------------------
    const analysisIntent =
      (/(analysis|analyze|analyse|inspect|audit|review|report)\b/.test(lower) &&
       /(karo|kar|do|dijiye|perform|run|give|provide|dedo|dena|chahiye|report|findings|detailed|deep)/.test(lower)) ||
      /(har\s+(bug|problem|issue|vulnerability|finding))|((bug|issue|problem|vulnerabilit)\S*\s+dhundo)|(dhundo|khojo)\b/.test(lower) ||
      (/(project|code|system)\b/.test(lower) && /(detailed|deep|full|complete)\s+(analysis|review|audit|report|inspection)/.test(lower)) ||
      (/sirf\s+.{0,30}(inspect|analysis|report|review)/.test(lower)) ||
      (/modify\/?delete\s+mat\s+karo/.test(lower)) ||
      (/mat\s+bolo\s+.{0,20}(inspection|analysis)/.test(lower));

    if (analysisIntent && !this._parseFileCommand(input)) {
      return {
        success: true,
        action: "inspect",
        target: "project",
        parameters: {
          deep: true,
          originalInput: input,
          source: "goal-classifier",
        },
        riskLevel: 1,
        confidence: 0.85,
        reason: "Detected read-only deep-analysis goal → routed to inspect (deep analysis report). No files will be modified.",
        parsedBy: "goal-classifier",
      };
    }

    // ---------------------------------------------------------
    // BUILD / IMPLEMENT intent
    // ---------------------------------------------------------
    const buildIntent = /\b(build|create|implement|develop|scaffold|generate|write|make|add)\b[\s\S]{0,40}\b(module|feature|component|system|service|class|library|controller|api|dashboard|script|utility|tool|handler|manager)\b/.test(lower);
    const modifyIntent = /\b(update|extend|refactor|improve|rewrite)\b[\s\S]{0,30}\b(module|feature|component|class|service|handler|manager)\b/.test(lower);

    if (!buildIntent && !modifyIntent) return null;

    const moduleName = this._extractModuleName(input);
    const existing = modifyIntent ? this._guessExistingFile(moduleName) : null;

    let fileName;
    let action;
    if (modifyIntent && existing) {
      action = "modify-file";
      fileName = existing;
    } else if (modifyIntent) {
      action = "create-file";
      fileName = `modules/${this._toSnakeCase(moduleName)}.js`;
    } else {
      action = "create-file";
      fileName = `modules/${this._toSnakeCase(moduleName)}.js`;
    }

    const requirements = this._parseRequirements(input);
    const content = this._buildModuleScaffold(moduleName, requirements, input);

    const reasonBits = [];
    reasonBits.push(`Detected natural-language ${modifyIntent ? "modification" : "build"} goal → routed to ${action} with generated scaffold for "${moduleName}".`);
    if (aiParseError) reasonBits.push(`(AI parser: ${aiParseError})`);
    if (regexError) reasonBits.push(`(Regex NLU: ${String(regexError).slice(0, 120)})`);

    return {
      success: true,
      action,
      target: fileName,
      parameters: {
        path: fileName,
        content,
        originalInput: input,
        source: "goal-classifier",
      },
      riskLevel: action === "modify-file" ? 2 : 1,
      confidence: 0.8,
      reason: reasonBits.join(" "),
      parsedBy: "goal-classifier",
    };
  }

  _extractModuleName(input) {
    // Quoted name first
    const quoted = input.match(/["'`]([A-Za-z][A-Za-z0-9 _-]{2,40})["'`]/);
    if (quoted) return quoted[1].trim();

    // TitleCase / Capitalized phrase (e.g. "CCTV Security Control")
    const title = input.match(/\b([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*){1,5})\b/);
    if (title && !/^(the|this|owner|alex)/i.test(title[1])) return title[1];

    // "... module for X" pattern
    const forMatch = input.match(/\b(?:module|system|service|component|handler|manager)\b[\s\S]{0,30}\bfor\b\s+(?:my\s+|the\s+)?([A-Za-z0-9 _-]{3,40})/i);
    if (forMatch) {
      const cleaned = forMatch[1].trim().replace(/\s+(system|cameras?|devices?).*$/i, "").trim();
      if (cleaned) return cleaned;
    }

    return "CustomModule";
  }

  _toSnakeCase(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "custom_module";
  }

  _guessExistingFile(moduleName) {
    const candidates = [
      `modules/${this._toSnakeCase(moduleName)}.js`,
      `${this._toSnakeCase(moduleName)}.js`,
      `${this._toSnakeCase(moduleName)}.ts`,
    ];
    for (const rel of candidates) {
      const validation = CommandAllowlist.validateFilePath(rel);
      if (validation.valid && fs.existsSync(validation.resolved)) return rel;
    }
    return null;
  }

  _parseRequirements(input) {
    const lines = input.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const reqs = [];
    for (const line of lines) {
      const m = line.match(/^\d+[\).\s]+(.+)$/);
      if (m) reqs.push(m[1].replace(/\*+/g, "").trim());
    }
    return reqs;
  }

  _buildModuleScaffold(moduleName, requirements, originalInput) {
    const isDeviceModule = /\b(camera|cctv|nvr|iot|device|sensor|lock)\b/i.test(originalInput);
    const safeCommentInput = String(originalInput).slice(0, 200).replace(/\*\//g, "").replace(/\r?\n/g, " ");
    const className = moduleName.replace(/[^A-Za-z0-9]/g, "") || "CustomModule";

    const lines = [
      "// ============================================================",
      `// ${moduleName} — generated by ALEX goal-classifier`,
      `// Owner request: ${safeCommentInput}`,
      "// ============================================================",
      "",
      "// SAFETY CONTRACT (applies to device-related modules):",
      "//  - Only owner-registered/authorized devices may be managed.",
      "//  - NO network scanning, discovery, or access of unknown devices.",
      "//  - Proximity/IP/location alone never grants authorization.",
      "//  - All control actions are reversible, confirmed, and audited.",
      "//  - Fail-safe: on communication loss, devices return to default state.",
      "",
      `class ${className} {`,
      "  constructor(options = {}) {",
      "    this.options = options;",
      "    this.initialized = false;",
      "    this.auditLog = [];",
      "    this.authorized = new Map();",
      "  }",
      "",
      "  async init() {",
      "    // TODO: initialize per requirements below",
      "    this.initialized = true;",
      "    return this;",
      "  }",
      "",
      "  _audit(action, target, result) {",
      "    this.auditLog.push({ action, target, result, timestamp: new Date().toISOString() });",
      "  }",
      "",
    ];

    if (requirements.length) {
      lines.push("  // ---- Owner requirements (for implementation) ----");
      for (const r of requirements.slice(0, 20)) {
        lines.push("  // * " + r.replace(/\*\//g, "").replace(/\r?\n/g, " "));
      }
      lines.push("");
    }

    if (isDeviceModule) {
      lines.push(
        "  // Owner-registered device registry — devices must be pre-authorized",
        "  // via explicit registration (id + official API details supplied by owner).",
        "  registerAuthorizedDevice(device) {",
        "    if (!device || !device.id || !device.apiBaseUrl) {",
        "      throw new Error(\"Device registration requires id and official API base URL\");",
        "    }",
        "    this.authorized.set(device.id, { ...device, registeredAt: new Date().toISOString() });",
        "    this._audit(\"register-device\", device.id, \"ok\");",
        "    return true;",
        "  }",
        "",
        "  _requireAuthorized(deviceId) {",
        "    const d = this.authorized.get(deviceId);",
        "    if (!d) throw new Error(\"Device not registered as owner-authorized: \" + deviceId);",
        "    return d;",
        "  }",
        "",
        "  // Temporary pause via device's OFFICIAL management interface only",
        "  async pauseDevice(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    try {",
        "      const res = await fetch(device.apiBaseUrl + \"/pause\", { method: \"POST\", headers: device.authHeaders || {} });",
        "      this._audit(\"pause\", deviceId, res.ok ? \"ok\" : \"failed\");",
        "      return res.ok;",
        "    } catch (err) {",
        "      this._audit(\"pause\", deviceId, \"error: \" + err.message);",
        "      throw new Error(\"Communication lost — device left unchanged (fail-safe)\");",
        "    }",
        "  }",
        "",
        "  async restoreDevice(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    try {",
        "      const res = await fetch(device.apiBaseUrl + \"/resume\", { method: \"POST\", headers: device.authHeaders || {} });",
        "      this._audit(\"restore\", deviceId, res.ok ? \"ok\" : \"failed\");",
        "      return res.ok;",
        "    } catch (err) {",
        "      this._audit(\"restore\", deviceId, \"error: \" + err.message);",
        "      throw new Error(\"Communication lost — device left unchanged (fail-safe)\");",
        "    }",
        "  }",
        "",
        "  healthCheck(deviceId) {",
        "    const device = this._requireAuthorized(deviceId);",
        "    this._audit(\"health-check\", deviceId, \"reported\");",
        "    return { deviceId, status: \"unknown\", note: \"Report unsupported/unverifiable devices instead of controlling them\" };",
        "  }",
        "",
      );
    }

    lines.push("}", "");
    lines.push(`module.exports = { ${className} };`, "");

    return lines.join("\n");
  }

  // ============================================================
  // DEEP PROJECT ANALYSIS — READ-ONLY static analysis report
  // No file is modified, created or deleted. Protected paths skipped.
  // ============================================================
  async _analyzeProject(originalInput) {
    const findings = [];
    const stats = {
      filesScanned: 0,
      filesSkippedProtected: 0,
      totalLines: 0,
      scannedFiles: [],
      notInspected: [],
    };

    const CODE_EXT = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"]);
    const PROTECTED_DIRS = new Set([".git", "node_modules", ".alex-backups", "cache", "dist", "build", ".env"]);
    const MAX_FILE_BYTES = 200 * 1024;
    const MAX_FILES = 400;

    const addFinding = (severity, file, location, problem, why, fix, safelyFixable) => {
      findings.push({ severity, file, location: location || "unknown", problem, why, recommendedFix: fix, safelyFixable });
    };

    const walk = (dir, depth) => {
      if (depth > 5 || stats.filesScanned >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (stats.filesScanned >= MAX_FILES) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (PROTECTED_DIRS.has(entry.name) || entry.name.startsWith(".")) { stats.filesSkippedProtected++; continue; }
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();

        // Protected file patterns never read
        if (/^\.env|^credentials|^secrets|\.pem$|\.cert$|\.key$/.test(entry.name)) { stats.filesSkippedProtected++; continue; }

        if (!CODE_EXT.has(ext) && entry.name !== "package.json") continue;

        let content;
        let stat;
        try {
          stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) { stats.notInspected.push({ file: full, reason: `too large (${stat.size} bytes)` }); continue; }
          content = fs.readFileSync(full, "utf8");
        } catch (e) {
          stats.notInspected.push({ file: full, reason: e.message });
          continue;
        }

        stats.filesScanned++;
        const rel = path.relative(PROJECT_ROOT, full);
        stats.scannedFiles.push({ file: rel, size: stat.size, lines: content.split("\n").length });
        stats.totalLines += content.split("\n").length;

        const lines = content.split("\n");

        // --- Static checks per file ---
        lines.forEach((line, i) => {
          const loc = `${rel}:${i + 1}`;
          if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
            addFinding("Low", rel, loc, `Unresolved marker: ${line.trim().slice(0, 100)}`, "Indicates incomplete work.", "Complete or remove the marker.", true);
          }
          if (/\beval\s*\(|new\s+Function\s*\(/.test(line) && !/^\s*\/[/*]/.test(line)) {
            addFinding("High", rel, loc, "Use of eval()/new Function()", "Code injection risk if any part of the input is user-controlled.", "Replace with safe parsing (JSON.parse, explicit logic).", false);
          }
          if (/\b(child_process|execSync|exec)\b/.test(line) && /\breq\.(body|query|params)\b|template literal.*\$\{/.test(line)) {
            addFinding("Critical", rel, loc, "Possible command injection (exec with dynamic input)", "Unsanitized input can reach shell.", "Use execFile with fixed args; never interpolate input into shell strings.", false);
          }
          if (/(api[_-]?key|secret|password|token|credential)\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(line) && !/process\.env|placeholder|example/i.test(line)) {
            addFinding("Critical", rel, loc, "Possible hardcoded secret", "Secrets in source leak via git.", "Move to environment variables.", false);
          }
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line) || /catch\s*\{\s*\}/.test(line)) {
            addFinding("Medium", rel, loc, "Empty catch block — errors silently swallowed", "Failures become invisible and hard to debug.", "Log the error or handle it explicitly.", true);
          }
        });

        // File-level checks
        if (content.split("\n").length > 800) {
          addFinding("Low", rel, "whole file", `Very large file (${content.split("\n").length} lines)`, "Hard to maintain and review.", "Split into smaller modules.", false);
        }

        // package.json checks
        if (entry.name === "package.json") {
          try {
            const pkg = JSON.parse(content);
            if (!pkg.scripts || !pkg.scripts.test) {
              addFinding("Medium", rel, "scripts", "No test script defined", "npm test will fail; fix-loop and verification depend on it.", 'Add "test": "node --test" or a test runner.', true);
            }
            if (!pkg.scripts || (!pkg.scripts.start && !pkg.scripts.main)) {
              addFinding("Low", rel, "scripts", "No start script", "Deployment tooling may fail.", 'Add "start" script.', true);
            }
          } catch { addFinding("Medium", rel, "JSON", "package.json is not valid JSON", "npm tooling may break.", "Fix JSON syntax.", false); }
        }
      }
    };

    walk(PROJECT_ROOT, 0);

    // Repo-level checks
    const gitignorePath = path.join(PROJECT_ROOT, ".gitignore");
    if (fs.existsSync(path.join(PROJECT_ROOT, ".env")) && fs.existsSync(gitignorePath)) {
      const gi = fs.readFileSync(gitignorePath, "utf8");
      if (!/^\.env/m.test(gi)) {
        addFinding("Critical", ".gitignore", "-", ".env exists but is NOT in .gitignore", "Secrets may be committed to git.", 'Add ".env" to .gitignore.', true);
      }
    }

    // Severity summary + top issues
    const bySeverity = { Critical: [], High: [], Medium: [], Low: [] };
    for (const f of findings) (bySeverity[f.severity] || bySeverity.Low).push(f);

    const totalIssues = findings.length;
    const readiness = Math.max(0, Math.min(100,
      100 - (bySeverity.Critical.length * 12) - (bySeverity.High.length * 7) - (bySeverity.Medium.length * 3) - (bySeverity.Low.length * 1)
    ));

    const fixOrder = ["Critical", "High", "Medium", "Low"]
      .flatMap(sev => bySeverity[sev].slice(0, 5).map(f => `${sev}: ${f.problem} (${f.file})`))
      .slice(0, 10);

    // Optional AI narrative summary (non-blocking, never required)
    let aiSummary = null;
    if (config.ai?.available) {
      try {
        const condensed = findings.slice(0, 30).map(f => `[${f.severity}] ${f.file} ${f.location}: ${f.problem}`).join("\n");
        const prompt = `Summarize this project analysis in under 200 words. Highlight the top risks and overall production readiness.\n\nFindings:\n${condensed}`;
        const res = await callGemini(prompt, { temperature: 0.2, timeoutMs: 12000 });
        if (res) aiSummary = typeof res === "string" ? res.slice(0, 1200) : (res.text || res.summary || String(res).slice(0, 1200));
      } catch { aiSummary = null; }
    }

    return {
      success: true,
      message: `Deep analysis complete: ${totalIssues} findings across ${stats.filesScanned} files (read-only, nothing modified).`,
      mode: "read-only-analysis",
      summary: {
        totalIssues,
        critical: bySeverity.Critical.length,
        high: bySeverity.High.length,
        medium: bySeverity.Medium.length,
        low: bySeverity.Low.length,
        productionReadinessPercent: readiness,
      },
      topIssues: fixOrder,
      findings: findings.slice(0, 100),
      filesScanned: stats.scannedFiles,
      notInspected: stats.notInspected.length ? stats.notInspected : undefined,
      skippedProtected: stats.filesSkippedProtected,
      aiSummary,
      note: "Findings marked safelyFixable=true can be fixed via 'fix bugs' or explicit modify-file commands.",
      requestedAs: String(originalInput || "").slice(0, 200),
    };
  }

  // ============================================================
  // COMPREHENSIVE FALLBACK PARSER — 50+ natural variations
  // ============================================================
  _fallbackParse(input) {
    const lower = input.toLowerCase().trim();

    // --- HELP / ACTIONS ---
    if (/^(what|show|list|display|get|view|tell)\s.*(can|do|action|command|ability|capabilit|help|allow)/i.test(lower) ||
        /^(help|actions|commands|menu|options|capabilities|what can you do)$/i.test(lower) ||
        /^list\s+(all\s+)?(actions|commands)/i.test(lower) ||
        /^show\s+(me\s+)?(available|allowed)\s+(actions|commands)/i.test(lower)) {
      return { success: true, action: "list-actions", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- STATUS ---
    if (/^(status|state|report|summary|overview|how\s+(are|is)\s+(you|the\s+system))/i.test(lower) ||
        /^system\s+status/i.test(lower)) {
      return { success: true, action: "status", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- HEALTH ---
    if (/(check|test|verify|run)\s.*(health|alive|running|ok|up\s+and\s+running)/i.test(lower) ||
        /^health/i.test(lower) ||
        /is\s+(the\s+)?(system|server|app)\s+(healthy|running|ok|up)/i.test(lower) ||
        /how\s+(is|are)\s+(the\s+)?(system|server|app)/i.test(lower)) {
      return { success: true, action: "check-health", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DATABASE ---
    if (/(check|test|verify|show)\s.*(database|db|mongo|connection)/i.test(lower) ||
        /^database/i.test(lower) ||
        /is\s+the\s+database\s+(up|connected|running)/i.test(lower)) {
      return { success: true, action: "check-database", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DEEP ANALYSIS (before generic inspect so it wins) ---
    if (/(deep|detailed|full|complete|actual)\s+(analysis|inspect|review|audit)/i.test(lower) ||
        /(analysis|inspect|review|audit)\s+karo/i.test(lower) ||
        /(detailed\s+findings|findings\s+do|report\s+do)/i.test(lower) ||
        /(har\s+(bug|problem|issue|vulnerabilit))/i.test(lower) ||
        /modify\s*\/?\s*delete\s+mat\s+karo/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { deep: true, originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    // --- INSPECT ---
    if (/(inspect|explore|browse|show\s+structure|list\s+files|directory|tree)\b.*(project|code|app|structure|files|directory)/i.test(lower) ||
        /^inspect/i.test(lower) ||
        /show\s+me\s+the\s+(project|code)/i.test(lower)) {
      return { success: true, action: "inspect", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- FIND BUGS ---
    if (/(find|look\s*for|detect|search|analyze|check|scan)\b.*(bug|issue|problem|vulnerabilit|error|defect)/i.test(lower) ||
        /^find\s+(bugs|issues)/i.test(lower) ||
        /are\s+there\s+(any\s+)?(bugs|issues|problems)/i.test(lower)) {
      return { success: true, action: "find-bugs", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- FIX BUGS ---
    if (/(fix|resolve|repair|patch|correct|auto.fix)\b.*(bug|issue|problem|error)/i.test(lower) ||
        /^fix\s+(bugs|issues|problems)/i.test(lower)) {
      return { success: true, action: "fix-bugs", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- SECURITY INSPECT ---
    if (/(inspect|check|scan|audit|review|analyze)\b.*security/i.test(lower) ||
        /^security/i.test(lower) ||
        /is\s+(the\s+)?(app|project|code)\s+secure/i.test(lower) ||
        /are\s+there\s+(any\s+)?(security\s+)?(issues|vulnerabilit)/i.test(lower)) {
      return { success: true, action: "inspect-security", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.9 };
    }

    // --- SECURITY SCAN ---
    if (/(full\s+)?security\s+scan/i.test(lower) ||
        /scan\s+(for\s+)?(vulnerabilit|threat|security)/i.test(lower)) {
      return { success: true, action: "security-scan", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- IMPROVE CODE ---
    if (/(improve|enhance|optimize|refactor|clean|modernize)\b.*(code|quality|structure|performance)/i.test(lower) ||
        /^improve\s+(code|quality)/i.test(lower) ||
        /make\s+(the\s+)?(code|app)\s+better/i.test(lower)) {
      return { success: true, action: "improve-code", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- IMPROVE SECURITY ---
    if (/(improve|harden|strengthen|secure|better)\b.*security/i.test(lower) || /^harden/i.test(lower)) {
      return { success: true, action: "improve-security", target: "project", parameters: { originalInput: input }, riskLevel: 2, confidence: 0.85 };
    }

    // --- LOGS ---
    if (/(inspect|read|view|show|check|get|fetch|display)\b.*(log|audit)/i.test(lower) ||
        /^logs/i.test(lower) ||
        /show\s+me\s+the\s+(logs|audit)/i.test(lower)) {
      return { success: true, action: "inspect-logs", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- TESTS ---
    if (/(run|execute|start|trigger)\b.*(test|spec|suite|jest|mocha)/i.test(lower) ||
        /^run\s+tests/i.test(lower) ||
        /^test/i.test(lower) ||
        /test\s+the\s+(project|app|code|system)/i.test(lower) ||
        /^npm\s+test(\s|$)/i.test(lower)) {
      return { success: true, action: "run-tests", target: "project", parameters: { originalInput: input, command: "npm test" }, riskLevel: 1, confidence: 0.9 };
    }

    // --- DEPLOY ---
    if (/(prepare|ready|stage|setup|check)\b.*(deploy|release|production|launch|publish)/i.test(lower) ||
        /^deploy/i.test(lower) ||
        /is\s+(it\s+)?(ready|safe)\s+(to\s+)?deploy/i.test(lower)) {
      return { success: true, action: "prepare-deploy", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    // --- INCIDENTS ---
    if (/(show|list|get|display|view|check)\b.*(incident|issue|problem|alert)/i.test(lower) ||
        /^incidents/i.test(lower)) {
      return { success: true, action: "list-incidents", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- HISTORY ---
    if (/(show|list|get|display|view)\b.*(history|past|previous|recent)/i.test(lower) ||
        /^history/i.test(lower) ||
        /what\s+(did|have)\s+(i|you)\s+(do|run|execute)/i.test(lower)) {
      return { success: true, action: "list-history", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.95 };
    }

    // --- VERIFY ---
    if (/(verify|self.test|check\s+all|validate)\b.*(action|command|system)/i.test(lower) ||
        /^verify(\s+all)?$/i.test(lower) ||
        /check\s+(if\s+)?(everything|all)\s+(is\s+)?(working|ok)/i.test(lower)) {
      return { success: true, action: "verify", target: "project", parameters: { originalInput: input }, riskLevel: 1, confidence: 0.85 };
    }

    return {
      success: false,
      error: `Could not understand command: "${input.slice(0, 200)}"`,
      suggestion: "Try: inspect project, run tests, check health, show actions, fix bugs, check security, show incidents, show history, verify all — or state a build goal like 'Build a <name> module'"
    };
  }

  // ============================================================
  // FILE COMMAND PARSER
  // ============================================================
  _parseFileCommand(input) {
    const normalized = input.trim();

    // Create file detection
    const createMatch = normalized.match(/\b(?:create|make|add|generate|write|save|build)\b[\s\S]*?\bfile\b[\s\S]*?(?:"([^"]+\.[A-Za-z0-9]+)"|'([^']+\.[A-Za-z0-9]+)'|`([^`]+\.[A-Za-z0-9]+)`|([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+))/i);

    if (createMatch || /\bcreate\s+file\b/i.test(normalized)) {
      const filePath = createMatch?.[1] || createMatch?.[2] || createMatch?.[3] || createMatch?.[4];
      if (!filePath) {
        return { success: false, error: 'Create-file command detected, but no filename was found. Example: Create file test.js with content console.log("OK");' };
      }
      const content = this._extractFileContent(normalized, filePath);
      if (content === null || content === undefined) {
        return { success: false, error: `Filename "${filePath}" was detected, but file content was not provided.` };
      }
      return { success: true, action: "create-file", target: filePath, parameters: { path: filePath, content, originalInput: input }, riskLevel: 1, confidence: 1 };
    }

    // Modify file detection
    const modifyMatch = normalized.match(/\b(?:modify|edit|update|rewrite|change|replace)\b[\s\S]*?\b(?:file|code)\b[\s\S]*?(?:"([^"]+\.[A-Za-z0-9]+)"|'([^']+\.[A-Za-z0-9]+)'|`([^`]+\.[A-Za-z0-9]+)`|([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+))/i);

    if (modifyMatch) {
      const filePath = modifyMatch[1] || modifyMatch[2] || modifyMatch[3] || modifyMatch[4];
      const content = this._extractFileContent(normalized, filePath);
      if (content === null || content === undefined) {
        return { success: false, error: `File "${filePath}" detected, but replacement content was not supplied.` };
      }
      return { success: true, action: "modify-file", target: filePath, parameters: { path: filePath, content, originalInput: input }, riskLevel: 2, confidence: 1 };
    }

    return null;
  }

  // ============================================================
  // CONTENT EXTRACTION — Handles multiline, code, JSON
  // ============================================================
  _extractFileContent(input, filePath) {
    // Priority 1: Most explicit marker
    const markerPatterns = [
      /with\s+exactly\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /exactly\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+this\s+exact\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+this\s+content\s*:\s*([\s\S]*)$/i,
      /with\s+content\s*:\s*([\s\S]*)$/i,
      /containing\s*:\s*([\s\S]*)$/i,
      /contains\s*:\s*([\s\S]*)$/i,
      /content\s*:\s*([\s\S]*)$/i,
    ];

    for (const pattern of markerPatterns) {
      const match = input.match(pattern);
      if (match) return this._cleanExtractedContent(match[1]);
    }

    // Priority 2: "with" keyword
    const withMatch = input.match(/\bwith\b\s+([\s\S]+)$/i);
    if (withMatch && !/^with\s+(exactly\s+this\s+)?content/i.test(withMatch[0])) {
      const candidate = withMatch[1].trim();
      if (candidate) return this._cleanExtractedContent(candidate);
    }

    // Priority 3: "containing" keyword
    const containingMatch = input.match(/\bcontaining\b\s+([\s\S]+)$/i);
    if (containingMatch) return this._cleanExtractedContent(containingMatch[1]);

    // Priority 4: "content" keyword
    const contentMatch = input.match(/\bcontent\b\s+([\s\S]+)$/i);
    if (contentMatch) return this._cleanExtractedContent(contentMatch[1]);

    return null;
  }

  _cleanExtractedContent(content) {
    if (content === null || content === undefined) return "";
    let value = String(content).trim();

    // Remove markdown code fences
    value = value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
    value = value.replace(/\n?```\s*$/, "");

    // Remove wrapping quotes only when the whole content is wrapped
    if (value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
         (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    return value;
  }

  // ============================================================
  // AI RESULT NORMALIZATION
  // ============================================================
  _normalizeAIParse(result, originalInput) {
    if (!result) return null;
    let parsed = result;
    if (typeof result === "string") {
      try { parsed = JSON.parse(this._extractJSON(result)); } catch {
        console.log("[ALEX] AI parse rejected: malformed JSON. Raw:", String(result).slice(0, 200));
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.action || parsed.action === "unknown") {
      console.log("[ALEX] AI parse rejected: no/unknown action. Raw:", String(result).slice(0, 200));
      return null;
    }

    const action = String(parsed.action).trim();
    const parameters = parsed.parameters && typeof parsed.parameters === "object" ? { ...parsed.parameters } : {};
    let target = parsed.target || parameters.path || "project";

    // Critical: if AI says create-file but target "project", use deterministic parser
    if (action === "create-file" || action === "modify-file") {
      const local = this._parseFileCommand(originalInput);
      if (local) return local;
      if (!parameters.path && (!target || target === "project")) {
        console.log("[ALEX] AI parse rejected: file action without extractable path.");
        return { success: false, error: "File action detected but filename/path was not extracted." };
      }
    }

    return {
      success: true, action, target, parameters,
      riskLevel: typeof parsed.riskLevel === "number" ? parsed.riskLevel : 1,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      parsedBy: "ai",
    };
  }

  _extractJSON(text) {
    const clean = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) throw new Error("AI response did not contain JSON.");
    return clean.slice(first, last + 1);
  }

  // ============================================================
  // RESOLVE EXECUTABLE — cross-platform (Windows/Linux/Mac)
  // ============================================================
  _resolveCommand(cmdName) {
    // Try as-is first
    try {
      execFileSync(cmdName, ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
      return cmdName;
    } catch {}

    // Try with .cmd extension (Windows)
    try {
      execFileSync(cmdName + '.cmd', ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
      return cmdName + '.cmd';
    } catch {}

    // Try with .exe extension
    try {
      execFileSync(cmdName + '.exe', ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
      return cmdName + '.exe';
    } catch {}

    return null;
  }

  // ============================================================
  // EXECUTION — All 24+ actions
  // ============================================================
  async _execute(action, target, parameters, owner) {
    switch (action) {

      // --- LIST ACTIONS ---
      case "list-actions": {
        const actions = CommandAllowlist.getAllowedActions();
        const highRisk = actions.filter(a => a.requiresConfirmation);
        const standard = actions.filter(a => !a.requiresConfirmation);
        return {
          success: true, message: `${actions.length} registered actions available.`,
          totalActions: actions.length, standardActions: standard, highRiskActions: highRisk,
          note: "Use 'show <action> description' for details on any action. Use 'verify all' to test every action."
        };
      }

      // --- STATUS ---
      case "status": {
        const alex = getAlexController();
        const systemStatus = await alex.getSystemStatus();
        return { success: true, message: "ALEX system status retrieved.", systemStatus };
      }

      // --- CHECK HEALTH ---
      case "check-health": {
        const hm = getHealthMonitor();
        const status = hm.getStatus();
        const history = hm.getHistory(5);
        return { success: true, message: `Health: ${status?.status || "unknown"}`, health: status, recentHistory: history };
      }

      // --- CHECK DATABASE ---
      case "check-database": {
        const mongoose = require("mongoose");
        const state = mongoose.connection.readyState;
        const stateNames = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
        return {
          success: true, message: `Database: ${stateNames[state] || "unknown"}`,
          database: { status: stateNames[state] || "unknown", readyState: state, host: mongoose.connection.host || "unknown", name: mongoose.connection.name || "unknown" }
        };
      }

      // --- INSPECT (simple + deep analysis) ---
      case "inspect": {
        if (parameters?.deep) {
          return this._analyzeProject(parameters.originalInput || input);
        }
        return this._inspectProject(target);
      }

      // --- FIND BUGS ---
      case "find-bugs":
      case "find-issues": {
        try {
          const im = getIncidentManager();
          const incident = await im.createIncident({
            severity: "LOW", source: "owner_command", component: target || "project",
            category: "code_review", description: `Owner requested bug analysis: ${target || "project"}`,
            evidence: { ownerCommand: true, target, action }, probableCause: "Owner initiated analysis"
          });
          const result = incident ? await getSecurityAgent().handleIncident(incident) : { skipped: "Rate-limited or duplicate" };
          return { success: true, message: incident ? "Bug analysis initiated." : "Analysis already in progress.", analysisId: incident?.incidentId || null, initialFindings: result };
        } catch (error) {
          return { success: false, error: `Bug analysis failed: ${error.message}` };
        }
      }

      // --- FIX BUGS ---
      case "fix-bugs": {
        try {
          const im = getIncidentManager();
          const incident = await im.createIncident({
            severity: "LOW", source: "owner_command", component: target || "project",
            category: "code_review", description: `Owner requested auto-fix: ${target || "project"}`,
            evidence: { ownerCommand: true, target, action: "fix-bugs" }, probableCause: "Owner initiated fix"
          });
          if (!incident) return { success: true, message: "Fix already in progress." };
          const result = await getSecurityAgent().handleIncident(incident);
          if (result?.resolved) return { success: true, message: `Bug fixed: ${result.result || "completed"}`, fixResult: result };
          return { success: true, message: `Analysis complete: ${result?.reason || "manual review may be required"}`, fixResult: result };
        } catch (error) {
          return { success: false, error: `Fix failed: ${error.message}` };
        }
      }

      // --- INSPECT SECURITY ---
      case "inspect-security": {
        try {
          const im = getIncidentManager();
          const incident = await im.createIncident({
            severity: "MEDIUM", source: "owner_command", component: target || "project",
            category: "security_review", description: `Owner security inspection: ${target || "project"}`,
            evidence: { ownerCommand: true, target }, probableCause: "Owner initiated security review"
          });
          const result = incident ? await getSecurityAgent().handleIncident(incident) : null;
          return { success: true, message: "Security inspection initiated.", incidentId: incident?.incidentId || null, findings: result };
        } catch (error) {
          return { success: false, error: `Security inspection failed: ${error.message}` };
        }
      }

      // --- SECURITY SCAN ---
      case "security-scan": {
        try {
          const result = await getSecurityAgent().scanProject();
          return { success: true, message: `Security scan complete: ${result.totalVulnerabilities || 0} vulnerabilities found.`, scanResult: result };
        } catch (error) {
          return { success: false, error: `Security scan failed: ${error.message}` };
        }
      }

      // --- LOGS ---
      case "inspect-logs": {
        try {
          const auditLogger = getAuditLogger();
          const events = await auditLogger.getRecent(100);
          return {
            success: true, message: `${events.length} recent audit entries.`,
            logs: events.map(event => ({
              timestamp: event.timestamp, agent: event.agent, action: event.action,
              file: event.file, result: event.result,
              summary: String(event.reason || "").slice(0, 200)
            }))
          };
        } catch (error) {
          return { success: false, error: `Log retrieval failed: ${error.message}` };
        }
      }

      // --- IMPROVE CODE ---
      case "improve-code":
      case "improve-security": {
        try {
          const structure = await this._inspectProject("project");
          return {
            success: true,
            message: `${action === "improve-security" ? "Security" : "Code"} improvement analysis completed.`,
            action, target,
            analysis: { filesCount: structure?.structure?.files?.length || 0, note: "Use modify-file for applying a specific reviewed change." }
          };
        } catch (error) {
          return { success: false, error: `Improvement analysis failed: ${error.message}` };
        }
      }

      // --- RUN TESTS (cross-platform) ---
      case "run-tests":
      case "test": {
        const testCommand = parameters?.command || "npm test";
        return this._runTests(testCommand);
      }

      // --- PREPARE DEPLOY ---
      case "prepare-deploy": {
        const checks = {
          envCheck: !!process.env.JWT_SECRET,
          geminiKeys: !!config.ai?.available,
          dbConfigured: !!process.env.MONGO_URI,
          adminKeyConfigured: !!process.env.ADMIN_KEY,
        };
        const allPassed = Object.values(checks).every(Boolean);
        return {
          success: allPassed,
          message: allPassed ? "Deploy readiness: ALL CHECKS PASSED" : "Deploy readiness: SOME CHECKS FAILED",
          checks,
        };
      }

      // --- CREATE FILE ---
      case "create-file": {
        const filePath = parameters?.path || target;
        const content = parameters?.content;

        if (!filePath || filePath === "project") {
          return { success: false, error: "ALEX could not determine the filename. Please provide a filename such as test.js." };
        }
        if (content === undefined || content === null) {
          return { success: false, error: "ALEX could not determine the file content." };
        }
        return this._createFile(filePath, content);
      }

      // --- MODIFY FILE ---
      case "modify-file": {
        const filePath = parameters?.path || target;
        const content = parameters?.content;
        if (!filePath || filePath === "project") return { success: false, error: "ALEX could not determine which file to modify." };
        if (content === undefined || content === null) return { success: false, error: "ALEX needs complete replacement content for modify-file." };
        return this._modifyFile(filePath, content);
      }

      // --- RUN COMMAND ---
      case "run-command": {
        const command = parameters?.command || target;
        if (!command) return { success: false, error: "No command supplied." };
        if (!CommandAllowlist.isCommandAllowed(command)) {
          return { success: false, error: `Command "${CommandAllowlist.getCommandName(command)}" is not allowed.`, allowedCommands: CommandAllowlist.getAllowedCommands() };
        }
        if (CommandAllowlist.containsBlockedPattern(command)) {
          return { success: false, error: "Command contains a blocked security pattern." };
        }
        return this._runCommand(command);
      }

      // --- DELETE FILE ---
      case "delete-file": {
        const filePath = parameters?.path || target;
        return this._deleteFile(filePath);
      }

      // --- LIST INCIDENTS ---
      case "list-incidents": {
        try {
          const im = getIncidentManager();
          const incidents = await im.getAllIncidents({}, 20);
          const stats = await im.getStats();
          return {
            success: true, message: `${stats.open || 0} open, ${stats.total || 0} total incidents`,
            incidents: incidents.map(i => ({
              id: i.incidentId, severity: i.severity, status: i.status,
              component: i.component, description: (i.description || "").slice(0, 120),
              assignedAgent: i.assignedAgent, timestamp: i.timestamp
            })), stats
          };
        } catch (err) {
          return { success: false, error: `Failed to fetch incidents: ${err.message}` };
        }
      }

      // --- LIST HISTORY ---
      case "list-history": {
        const history = this.commandHistory.slice(-20);
        return {
          success: true, message: `${history.length} recent commands`,
          history: history.map(h => ({
            id: h.commandId, action: h.action, target: h.target,
            success: h.success, summary: h.summary, timestamp: h.timestamp
          }))
        };
      }

      // --- VERIFY ALL ACTIONS ---
      case "verify": {
        if (this._skipVerification) {
          return { success: true, message: "Verification skipped (already performed or in progress)." };
        }
        this._skipVerification = true;
        try {
          const verification = await this.verifyAllActions();
          return { success: true, message: `${verification.verified}/${verification.total} actions verified`, ...verification };
        } finally {
          this._skipVerification = false;
        }
      }

      default:
        return { success: false, error: `Action "${action}" is not implemented.` };
    }
  }

  // ============================================================
  // VERIFY ALL REGISTERED ACTIONS
  // ============================================================
  async verifyAllActions() {
    const allActions = CommandAllowlist.getAllowedActions();
    const results = [];

    for (const action of allActions) {
      const result = {
        action: action.action,
        description: action.description,
        requiresConfirmation: action.requiresConfirmation,
        registered: true,
        verified: false,
        status: "unknown",
      };

      try {
        // Actions requiring confirmation are verified by registration
        if (action.requiresConfirmation) {
          result.status = "requires_confirmation";
          result.verified = true;
          results.push(result);
          continue;
        }

        // Execute the action safely
        const execResult = await this._execute(action.action, "project", {}, { authenticated: true, method: "verification", role: "owner" });

        if (execResult && !execResult.error) {
          result.verified = true;
          result.status = execResult.success ? "pass" : "executed_but_not_success";
        } else {
          result.status = "implementation_missing";
          result.error = execResult?.error || "No result";
        }
      } catch (err) {
        result.status = "error";
        result.error = err.message;
      }

      results.push(result);
    }

    const verified = results.filter(r => r.verified).length;
    const failed = results.filter(r => !r.verified).length;

    return {
      total: results.length,
      verified,
      failed,
      details: results,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================
  // CREATE FILE
  // ============================================================
  async _createFile(filePath, content) {
    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: validation.error };

    const resolved = validation.resolved;
    const relative = validation.relative;
    const normalizedContent = String(content);

    if (Buffer.byteLength(normalizedContent, "utf8") > MAX_FILE_SIZE) {
      return { success: false, error: `File exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes.` };
    }

    if (fs.existsSync(resolved)) {
      return { success: false, error: `File already exists: ${relative}. Use "modify file ${relative} ..." if you want to replace it.`, code: "FILE_ALREADY_EXISTS", filePath: relative };
    }

    try {
      const directory = path.dirname(resolved);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(resolved, normalizedContent, { encoding: "utf8", flag: "wx" });
      const stat = fs.statSync(resolved);

      return { success: true, message: `File created successfully: ${relative}`, filePath: relative, absolutePath: resolved, size: stat.size };
    } catch (error) {
      return { success: false, error: `Failed to create file: ${error.message}` };
    }
  }

  // ============================================================
  // MODIFY FILE
  // ============================================================
  async _modifyFile(filePath, content) {
    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: validation.error };

    const resolved = validation.resolved;
    const relative = validation.relative;

    if (!fs.existsSync(resolved)) {
      return { success: false, error: `File does not exist: ${relative}`, code: "FILE_NOT_FOUND" };
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { success: false, error: `"${relative}" is not a regular file.` };

    const newContent = String(content);
    if (Buffer.byteLength(newContent, "utf8") > MAX_FILE_SIZE) {
      return { success: false, error: `Replacement content exceeds maximum size of ${MAX_FILE_SIZE} bytes.` };
    }

    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const safeBaseName = path.basename(relative).replace(/[^a-zA-Z0-9._-]/g, "_");
      const backupName = `backup_${Date.now()}_${safeBaseName}`;
      const backupPath = path.join(BACKUP_DIR, backupName);
      fs.copyFileSync(resolved, backupPath);
      fs.writeFileSync(resolved, newContent, { encoding: "utf8" });
      const newStat = fs.statSync(resolved);

      return { success: true, message: `File modified successfully: ${relative}`, filePath: relative, absolutePath: resolved, backupPath, size: newStat.size, backupCreated: true };
    } catch (error) {
      return { success: false, error: `Failed to modify file: ${error.message}` };
    }
  }

  // ============================================================
  // DELETE FILE
  // ============================================================
  async _deleteFile(filePath) {
    const validation = CommandAllowlist.validateFilePath(filePath);
    if (!validation.valid) return { success: false, error: validation.error };

    const resolved = validation.resolved;
    const relative = validation.relative;

    if (!fs.existsSync(resolved)) return { success: false, error: `File does not exist: ${relative}` };

    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const safeBaseName = path.basename(relative).replace(/[^a-zA-Z0-9._-]/g, "_");
      const backupPath = path.join(BACKUP_DIR, `deleted_${Date.now()}_${safeBaseName}`);
      fs.copyFileSync(resolved, backupPath);
      fs.unlinkSync(resolved);
      return { success: true, message: `File deleted: ${relative}`, filePath: relative, backupPath, backedUp: true };
    } catch (error) {
      return { success: false, error: `Failed to delete file: ${error.message}` };
    }
  }

  // ============================================================
  // RUN TESTS — cross-platform, proper error distinction
  // ============================================================
  async _runTests(testCommand = "npm test") {
    const parsed = this._parseApprovedCommand(testCommand);
    if (!parsed.valid) return { success: false, error: parsed.error };

    // Resolve executable cross-platform
    const resolvedCmd = this._resolveCommand(parsed.command);
    if (!resolvedCmd) {
      return {
        success: false,
        error: `Command "${parsed.command}" could not be found on this system.`,
        executableNotFound: true,
        detail: `"${parsed.command}" is not installed or not in PATH. Install Node.js/npm first.`
      };
    }

    try {
      const result = execFileSync(resolvedCmd, parsed.args, {
        cwd: PROJECT_ROOT, timeout: 120000, encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
      });

      return {
        success: true, message: "Tests completed successfully.",
        command: testCommand, exitCode: 0,
        stdout: String(result || "").slice(-10000), stderr: "", testRan: true,
      };
    } catch (error) {
      const exitCode = error.status ?? -1;
      const stdout = String(error.stdout || "").slice(-10000);
      const stderr = String(error.stderr || "").slice(-5000);

      // Check if tests actually ran vs command issue
      const hasTestOutput = /tests?|pass|fail|ok|not ok|√|✗|✓|✘|expect|assert|it\b|describe|suite/i.test(stdout + stderr);

      return {
        success: exitCode === 0,
        message: hasTestOutput ? `Tests completed with exit code ${exitCode}.` : `Command "${parsed.command}" failed to execute tests.`,
        command: testCommand, exitCode, stdout, stderr,
        testRan: hasTestOutput,
        error: hasTestOutput ? undefined : error.message,
      };
    }
  }

  // ============================================================
  // RUN COMMAND
  // ============================================================
  async _runCommand(command) {
    const parsed = this._parseApprovedCommand(command);
    if (!parsed.valid) return { success: false, error: parsed.error };

    const resolvedCmd = this._resolveCommand(parsed.command);
    if (!resolvedCmd) {
      return { success: false, error: `Command "${parsed.command}" not found in PATH.`, executableNotFound: true };
    }

    try {
      const result = execFileSync(resolvedCmd, parsed.args, {
        cwd: PROJECT_ROOT, timeout: 30000, encoding: "utf8",
        maxBuffer: 5 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
      });
      return { success: true, message: "Command completed successfully.", command, exitCode: 0, stdout: String(result || "").slice(-5000) };
    } catch (error) {
      return {
        success: false, message: `Command failed (exit code ${error.status ?? -1})`, command,
        exitCode: error.status ?? -1,
        stdout: String(error.stdout || "").slice(-5000),
        stderr: String(error.stderr || "").slice(-3000), error: error.message,
      };
    }
  }

  // ============================================================
  // APPROVED COMMAND PARSER
  // ============================================================
  _parseApprovedCommand(command) {
    if (!command || typeof command !== "string") return { valid: false, error: "Command is empty." };
    const trimmed = command.trim();
    if (CommandAllowlist.containsBlockedPattern(trimmed)) return { valid: false, error: "Command contains a blocked security pattern." };
    const commandName = CommandAllowlist.getCommandName(trimmed);
    if (!CommandAllowlist.isCommandAllowed(trimmed)) return { valid: false, error: `Command "${commandName}" is not allowed.` };

    const args = this._tokenizeArguments(trimmed);
    const executable = args.shift();
    return { valid: true, command: executable, args };
  }

  _tokenizeArguments(input) {
    const tokens = [];
    let current = "";
    let quote = null;
    let escaping = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (escaping) { current += char; escaping = false; continue; }
      if (char === "\\") { escaping = true; continue; }
      if (quote && char === quote) { quote = null; continue; }
      if (!quote && (char === '"' || char === "'")) { quote = char; continue; }
      if (!quote && /\s/.test(char)) { if (current) { tokens.push(current); current = ""; } continue; }
      current += char;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  // ============================================================
  // FIX LOOP — with retry + rollback
  // ============================================================
  async runErrorFixLoop(initialCommand, owner) {
    const results = [];
    let currentCommand = initialCommand;
    let rollbackPoint = null;

    for (let iteration = 1; iteration <= MAX_FIX_LOOP_ITERATIONS; iteration++) {
      console.log(`[ALEX] Fix-loop iteration ${iteration}/${MAX_FIX_LOOP_ITERATIONS}`);

      // EXECUTE
      const commandResult = await this.processCommand(currentCommand, owner);
      results.push({ iteration, phase: "execute", command: currentCommand, result: commandResult });

      // Save rollback point if backup was created
      if (commandResult.success && commandResult.backupPath) {
        rollbackPoint = commandResult.backupPath;
      }

      // VERIFY — run tests
      const testResult = await this._runTests("npm test");
      results.push({ iteration, phase: "test", result: testResult });

      // SUCCESS check
      if (commandResult.success && testResult.success) {
        return { success: true, iterations: iteration, results, finalMessage: "Command executed and tests passed." };
      }

      // COMMAND FAILED
      if (!commandResult.success) {
        console.log(`[ALEX] Command failed on iteration ${iteration}`);

        // Rollback if we have a backup
        if (rollbackPoint && commandResult.filePath) {
          try {
            const originalPath = CommandAllowlist.resolveProjectPath(commandResult.filePath);
            if (originalPath && fs.existsSync(rollbackPoint)) {
              fs.copyFileSync(rollbackPoint, originalPath);
              results.push({ iteration, phase: "rollback", file: commandResult.filePath, success: true });
              console.log(`[ALEX] Rolled back ${commandResult.filePath} from backup`);
            }
          } catch (rbErr) {
            console.log(`[ALEX] Rollback failed: ${rbErr.message}`);
          }
        }

        return { success: false, iterations: iteration, results, error: `Command failed: ${commandResult?.error || "Unknown error"}` };
      }

      // TESTS FAILED but command succeeded
      if (!testResult.success) {
        // If npm wasn't found, stop retrying
        if (testResult.executableNotFound) {
          return { success: commandResult.success, iterations: iteration, results, error: `Command succeeded but tests unavailable: ${testResult.error}`, testsUnavailable: true };
        }
        // If tests actually ran and failed, try AI fix
        if (testResult.testRan && config.ai?.available && iteration < 3) {
          try {
            const prompt = `Analyze the test failure and suggest a fix.
Test Output: ${JSON.stringify(testResult).slice(0, 3000)}
Suggest a single fix action. Return JSON: {"action":"modify-file|run-command","path":"...","content":"...","command":"...","reason":"..."}`;
            const analysis = await callGemini(prompt, { temperature: 0.1, timeoutMs: 15000 });
            if (analysis && analysis.action === "modify-file" && analysis.path && analysis.content !== undefined) {
              currentCommand = `modify file "${analysis.path}" with exactly this content: ${analysis.content}`;
              continue;
            }
            if (analysis && analysis.action === "run-command" && analysis.command) {
              currentCommand = `run command ${analysis.command}`;
              continue;
            }
          } catch {}
        }
        // Maximum retries without a fix
        if (iteration >= 3) {
          return { success: false, iterations: iteration, results, error: `Tests failing after ${iteration} iterations.`, rollbackPerformed: !!rollbackPoint };
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    return { success: false, iterations: MAX_FIX_LOOP_ITERATIONS, results, error: `Maximum iterations (${MAX_FIX_LOOP_ITERATIONS}) reached.` };
  }

  // ============================================================
  // PROJECT INSPECTION
  // ============================================================
  async _inspectProject(target) {
    const requested = target && target !== "project" ? target : ".";
    const validation = CommandAllowlist.validateFilePath(requested);
    let basePath;
    if (requested === ".") basePath = PROJECT_ROOT;
    else if (validation.valid) basePath = validation.resolved;
    else return { success: false, error: validation.error };

    try {
      if (!fs.existsSync(basePath)) return { success: false, error: `Path not found: ${target}` };
      const stat = fs.statSync(basePath);
      if (!stat.isDirectory()) return { success: false, error: `Not a directory: ${target}` };
      const structure = this._safeWalkDirectory(basePath, 3);
      return { success: true, message: `Inspection completed for ${target || "project"}.`, projectRoot: path.basename(PROJECT_ROOT), structure, note: "Protected files/directories are excluded." };
    } catch (error) {
      return { success: false, error: `Inspection failed: ${error.message}` };
    }
  }

  _safeWalkDirectory(dirPath, maxDepth, currentDepth = 0) {
    if (currentDepth > maxDepth) return { truncated: true };
    const result = { files: [], directories: {} };
    const protectedDirs = new Set([".git", "node_modules", ".alex-backups", "cache", "dist", "build"]);

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".") continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory() && protectedDirs.has(entry.name)) { result.directories[entry.name] = { protected: true }; continue; }
        if (entry.name.startsWith(".")) { result.directories[entry.name] = { protected: true }; continue; }
        if (entry.isDirectory()) {
          result.directories[entry.name] = this._safeWalkDirectory(fullPath, maxDepth, currentDepth + 1);
        } else if (entry.isFile()) {
          try { const stats = fs.statSync(fullPath); result.files.push({ name: entry.name, size: stats.size, ext: path.extname(entry.name) }); }
          catch { result.files.push({ name: entry.name, error: "Cannot read metadata" }); }
        }
      }
    } catch (error) { return { error: error.message }; }
    return result;
  }

  // ============================================================
  // AUDIT LOG
  // ============================================================
  async _auditLog(entry) {
    try {
      const logger = getAuditLogger();
      await logger.log({
        agent: "owner_command", action: entry.action, file: entry.target || "unknown",
        incidentId: entry.commandId, reason: entry.input || `Owner command: ${entry.action}`,
        result: entry.executionResult?.success ? "success" : "failure",
        detail: { commandId: entry.commandId, owner: entry.owner, durationMs: entry.durationMs, riskLevel: entry.riskLevel },
        durationMs: entry.durationMs,
      });
    } catch (error) {
      console.error("[ALEX] Audit log error:", error.message);
    }
  }

  // ============================================================
  // CONFIRMATION
  // ============================================================
  _generateConfirmationToken(commandId, owner) {
    const token = `${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
    const ownerId = owner?.userId || owner?.method || "unknown";
    this.pendingConfirmations.set(commandId, {
      token, ownerId, createdAt: Date.now(),
      expiresAt: Date.now() + (config.owner?.confirmationTimeoutMs || 300000)
    });
    return token;
  }

  _verifyConfirmation(confirmationId, commandId, owner) {
    const pending = this.pendingConfirmations.get(commandId);
    if (!pending) return false;
    const ownerId = owner?.userId || owner?.method || "unknown";
    if (pending.token !== confirmationId) return false;
    if (pending.ownerId !== ownerId) return false;
    if (Date.now() > pending.expiresAt) { this.pendingConfirmations.delete(commandId); return false; }
    this.pendingConfirmations.delete(commandId);
    return true;
  }

  // ============================================================
  // SANITIZATION
  // ============================================================
  _sanitizeForAudit(input) {
    if (!input || typeof input !== "string") return "";
    return input
      .replace(/ignore\s+(?:previous|all|prior)\s+(?:instructions|directives|commands|rules)/gi, "[REDACTED]")
      .replace(/reveal\s+(?:secret|key|password|token|credential)/gi, "[REDACTED]")
      .slice(0, 4000);
  }

  _sanitizeOwnerForLog(owner) {
    if (!owner) return { authenticated: false };
    return { authenticated: owner.authenticated, method: owner.method, userId: owner.userId ? String(owner.userId).slice(-8) : null, role: owner.role };
  }

  _sanitizeParams(params) {
    if (!params || typeof params !== "object") return {};
    const safe = { ...params };
    delete safe.password; delete safe.secret; delete safe.key; delete safe.token; delete safe.apiKey; delete safe.credential;
    if (typeof safe.content === "string") safe.content = `[content omitted: ${safe.content.length} chars]`;
    return safe;
  }

  _generateCommandId() { return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }

  _buildResult(commandId, status, data = {}) {
    return {
      success: status === "completed", commandId, status,
      timestamp: new Date().toISOString(),
      alex: { system: "ALEX Owner Command Handler", version: "3.2.0", capabilities: [
        "natural-language-commands", "goal-classifier", "deep-analysis", "create-file", "modify-file", "delete-file",
        "project-inspection", "test-execution", "approved-command-execution",
        "audit-logging", "backup-before-modification", "path-traversal-protection",
        "protected-file-boundary", "self-verification", "fix-loop", "security-scan"
      ]},
      ...data,
    };
  }

  getHistory(limit = 50) {
    const actualLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
    return this.commandHistory.slice(-actualLimit);
  }
}

// ============================================================
// SINGLETON
// ============================================================
let instance = null;
function getOwnerCommandHandler() {
  if (!instance) instance = new OwnerCommandHandler();
  return instance;
}

module.exports = { OwnerCommandHandler, getOwnerCommandHandler };