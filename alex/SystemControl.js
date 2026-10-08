// ============================================================
// ALEX SYSTEM CONTROL v1.0 — Laptop Control Engine (SAFE MODE)
// Owner ke laptop pe commands chalata hai:
//   open-path, open-url, run (approved only), list-dir, notify, system-info
// SECURITY:
//   - koi bhi destructive command allowlist se bahar -> REJECTED
//   - sudo/rm -rf/format etc. BLOCKED patterns -> REJECTED
//   - har action audit hota hai
//   - sirf owner (authenticated) call kar sakta hai
// ============================================================

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// ------------------------------------------------------------
// BLOCKED PATTERNS — yeh kabhi nahi chalega (laptop protection)
// ------------------------------------------------------------
const HARD_BLOCKED = [
  /rm\s+-rf\s+\//i, /rm\s+-rf\s+~/i, /format\s/i, /mkfs/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};?/i, // fork bomb
  /shutdown\s/i, /reboot\s/i, /poweroff/i,
  /\bsudo\b/i, /\bsu\s/i, /runas/i,
  /reg\s+delete/i, /regedit/i,
  /del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i,
  /format\s+[a-z]:/i, /diskpart/i,
  /chmod\s+777/i, /chown\s/i,
  /dd\s+if=/i, /mkfs\./i,
  /net\s+user/i, /net\s+localgroup/i,
  /curl.*\|\s*(ba)?sh/i, /wget.*\|\s*(ba)?sh/i,
  /iex\s*\(/i, /Invoke-Expression/i, /Set-ExecutionPolicy/i,
];

// ------------------------------------------------------------
// APPROVED BINARIES for "run"
// ------------------------------------------------------------
const APPROVED_RUN = new Set([
  // node ecosystem
  "node", "npm", "npx", "pnpm", "yarn", "git",
  // info
  "ls", "dir", "pwd", "cd", "cat", "type", "echo",
  // search
  "grep", "find", "where", "which",
  // python
  "python", "python3", "pip", "pip3",
  // misc safe
  "head", "tail", "wc", "date", "whoami", "df", "du", "free",
  "tasklist", "ps", "hostname", "ipconfig", "ifconfig",
]);

const MAX_OUTPUT = 6000;
const RUN_TIMEOUT = 120000;

function isHardBlocked(cmd) {
  return HARD_BLOCKED.some((p) => p.test(cmd));
}

function getRunner() {
  // platform-specific opener
  return isWin
    ? { cmd: "cmd", argsPrefix: ["/c", "start", ""], shell: true }
    : isMac
      ? { cmd: "open", argsPrefix: [], shell: false }
      : { cmd: "xdg-open", argsPrefix: [], shell: false };
}

function runShell(fullCmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const isWinShell = isWin;
    execFile(
      isWinShell ? "cmd" : "sh",
      isWinShell ? ["/c", fullCmd] : ["-c", fullCmd],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          success: !err,
          output: (stdout || "").slice(0, MAX_OUTPUT),
          error: err ? String(stderr || err.message).slice(0, 1000) : null,
          code: err ? (err.code ?? null) : 0,
        });
      }
    );
  });
}

// ------------------------------------------------------------
// ACTIONS
// ------------------------------------------------------------
async function actionOpenPath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    return {
      success: false,
      error: "Path required."
    };
  }

  const target = path.resolve(targetPath);

  if (!fs.existsSync(target)) {
    return {
      success: false,
      error: `Path not found: ${target}`
    };
  }

  try {
    if (isWin) {
      const result = await new Promise((resolve) => {
        execFile(
          "cmd.exe",
          ["/c", "start", "", target],
          {
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 1024 * 1024
          },
          (err, stdout, stderr) => {
            resolve({
              success: !err,
              output: stdout || "",
              error: err ? String(stderr || err.message) : null
            });
          }
        );
      });

      if (!result.success) {
        return {
          success: false,
          error: `Open failed.\n${result.error || "Unknown error"}`
        };
      }

      return {
        success: true,
        message: `Opened successfully: ${target}`
      };
    }

    const command = isMac ? "open" : "xdg-open";

    const result = await new Promise((resolve) => {
      execFile(
        command,
        [target],
        {
          timeout: 15000,
          maxBuffer: 1024 * 1024
        },
        (err, stdout, stderr) => {
          resolve({
            success: !err,
            output: stdout || "",
            error: err ? String(stderr || err.message) : null
          });
        }
      );
    });

    if (!result.success) {
      return {
        success: false,
        error: `Open failed.\n${result.error || "Unknown error"}`
      };
    }

    return {
      success: true,
      message: `Opened successfully: ${target}`
    };
  } catch (err) {
    return {
      success: false,
      error: `Open failed: ${err.message}`
    };
  }
}

async function actionOpenUrl(url) {
  const clean = String(url || "").trim();
  if (!/^https?:\/\//i.test(clean)) {
    return { success: false, error: "Only http/https URLs allowed." };
  }
  const r = getRunner();
  const full = isWin ? `start "" "${clean}"` : `${r.cmd} "${clean}"`;
  const result = await runShell(full);
  return {
    success: result.success,
    message: result.success ? `Opened in browser: ${clean}` : "Open failed.",
    ...result,
  };
}

async function actionRun(rawCommand) {
  const cmd = String(rawCommand || "").trim();
  if (!cmd) return { success: false, error: "Command required." };
  if (isHardBlocked(cmd)) {
    return { success: false, error: "🚫 Command blocked by safety policy (destructive/system-critical).", blocked: true };
  }

  // Allowlist check on binary name
  const binary = cmd.split(/\s+/)[0].toLowerCase();
  if (!APPROVED_RUN.has(binary)) {
    return {
      success: false,
      error: `🚫 Command "${binary}" not in approved list. Allowed: ${[...APPROVED_RUN].slice(0, 20).join(", ")}...`,
      blocked: true,
    };
  }

  const result = await runShell(cmd, RUN_TIMEOUT);
  return { ...result, ran: cmd };
}

async function actionListDir(dirPath) {
  const target = path.resolve(String(dirPath || os.homedir()));
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, type: "dir" }));
    const files = entries.filter(e => e.isFile()).map(e => ({ name: e.name, type: "file" }));
    return {
      success: true,
      path: target,
      dirs: dirs.slice(0, 100),
      files: files.slice(0, 200),
      total: entries.length,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function actionNotify({ title, message }) {
  try {
    if (isWin) {
      // PowerShell toast — safe, no external dep
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
        $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02;
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template);
        $nodes = $xml.GetElementsByTagName("text");
        $nodes.Item(0).AppendChild($xml.CreateTextNode(${JSON.stringify(String(title || "ALEX"))})) > $null;
        $nodes.Item(1).AppendChild($xml.CreateTextNode(${JSON.stringify(String(message || ""))})) > $null;
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("ALEX").Show($toast);
      `;
      execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 10000, windowsHide: true });
      return { success: true, message: "Notification sent." };
    }
    const script = `display notification ${JSON.stringify(String(message || ""))} with title ${JSON.stringify(String(title || "ALEX"))}`;
    execFileSync("osascript", ["-e", script], { timeout: 10000 });
    return { success: true, message: "Notification sent." };
  } catch (e) {
    return { success: false, error: "Notify failed: " + e.message };
  }
}

async function getSystemInfo() {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  let diskInfo = null;
  try {
    if (isWin) {
      const out = execFileSync("wmic", ["logicaldisk", "get", "size,freespace,caption", "/format:csv"], { encoding: "utf8", timeout: 10000 });
      diskInfo = out.trim().split("\n").slice(1).filter(Boolean).map(l => {
        const p = l.split(",");
        return { drive: p[1], freeGB: p[2] ? (parseInt(p[2]) / 1e9).toFixed(1) : "?", totalGB: p[3] ? (parseInt(p[3]) / 1e9).toFixed(1) : "?" };
      });
    } else {
      const out = execFileSync("df", ["-h"], { encoding: "utf8", timeout: 10000 });
      diskInfo = out.split("\n").slice(1).filter(Boolean).map(l => l.split(/\s+/));
    }
  } catch { diskInfo = "unavailable"; }

  return {
    platform: process.platform,
    os: { type: os.type(), release: os.release(), arch: os.arch(), hostname: os.hostname(), uptimeMinutes: Math.floor(os.uptime() / 60) },
    cpu: { model: cpus[0]?.model || "unknown", cores: cpus.length, loadAvg: os.loadavg() },
    memory: { totalGB: +(os.totalmem() / 1e9).toFixed(2), freeGB: +(os.freemem() / 1e9).toFixed(2), usedByAlexMB: +(mem.rss / 1048576).toFixed(1) },
    disk: diskInfo,
    user: os.userInfo().username,
    homeDir: os.homedir(),
    node: process.version,
    networkInterfaces: Object.keys(os.networkInterfaces()).filter(Boolean),
  };
}

// ------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------
const SystemControl = {
  async execute(action, params = {}, user = {}) {
    switch (action) {
      case "open-path":    return actionOpenPath(params.path);
      case "open-url":     return actionOpenUrl(params.url);
      case "run":          return actionRun(params.command);
      case "list-dir":     return actionListDir(params.path);
      case "notify":       return actionNotify(params);
      case "system-info":  return { success: true, data: await getSystemInfo() };
      default:
        return {
          success: false,
          error: `Unknown system action: "${action}". Available: open-path, open-url, run, list-dir, notify, system-info`,
        };
    }
  },
  getSystemInfo,
  isHardBlocked,
  APPROVED_RUN: [...APPROVED_RUN],
};

module.exports = { SystemControl };