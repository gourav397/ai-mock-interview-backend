// ============================================================
// ALEX Backup Manager — Checkpoints before any modification
// ============================================================

const fs = require("fs");
const path = require("path");
const { isProtected } = require("./fileInspector");

const BACKUP_DIR = path.resolve(process.cwd(), ".alex-backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // Create .gitkeep
    fs.writeFileSync(path.join(BACKUP_DIR, ".gitkeep"), "");
  }
}

function backupFile(filePath) {
  ensureBackupDir();

  const absolute = path.resolve(filePath);
  if (isProtected(absolute)) {
    return { success: false, error: "Cannot backup protected file", backupPath: null };
  }
  if (!fs.existsSync(absolute)) {
    return { success: false, error: "File does not exist", backupPath: null };
  }

  const relative = path.relative(process.cwd(), absolute);
  const timestamp = Date.now();
  const safeName = relative.replace(/[/\\]/g, "__");
  const backupPath = path.join(BACKUP_DIR, `${timestamp}__${safeName}`);

  try {
    fs.copyFileSync(absolute, backupPath);
    return { success: true, backupPath, timestamp, relative, size: fs.statSync(absolute).size };
  } catch (err) {
    return { success: false, error: err.message, backupPath: null };
  }
}

function createSnapshot(label = "") {
  ensureBackupDir();

  const timestamp = Date.now();
  const snapshotName = `snapshot__${timestamp}${label ? `__${label.replace(/[^a-zA-Z0-9_-]/g, "_")}` : ""}`;
  const snapshotDir = path.join(BACKUP_DIR, snapshotName);

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const filesToBackup = collectProjectFiles(process.cwd());
    let totalSize = 0;

    for (const file of filesToBackup) {
      const relative = path.relative(process.cwd(), path.resolve(file));
      if (isProtected(relative)) continue;
      const dest = path.join(snapshotDir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      totalSize += fs.statSync(file).size;
    }

    return { success: true, snapshotDir, files: filesToBackup.length, totalSize, timestamp };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function collectProjectFiles(rootDir) {
  const excludeDirs = new Set(["node_modules", ".git", ".alex-backups", "cache"]);
  const result = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!excludeDirs.has(entry.name)) walk(fullPath); }
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const textExts = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".yml", ".yaml", ".html", ".css", ".scss", ".md", ".txt", ".sh", ".mjs", ".cjs", ".vue", ".svelte"]);
        const name = entry.name.toLowerCase();
        if (textExts.has(ext) || name === "dockerfile" || name === "makefile" || name.startsWith(".env")) {
          result.push(fullPath);
        }
      }
    }
  }
  walk(rootDir);
  return result;
}

function restoreFromBackup(backupPath, originalPath) {
  try {
    const absolute = path.resolve(backupPath);
    const original = path.resolve(originalPath);
    if (isProtected(original)) return { success: false, error: "Cannot restore to protected path" };
    if (!fs.existsSync(absolute)) return { success: false, error: "Backup file does not exist" };
    fs.copyFileSync(absolute, original);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function listBackups() {
  ensureBackupDir();
  try {
    const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
    const fileBackups = entries.filter(e => e.isFile()).map(e => {
      const stat = fs.statSync(path.join(BACKUP_DIR, e.name));
      const parts = e.name.split("__");
      return { name: e.name, timestamp: parseInt(parts[0], 10) || 0, originalPath: parts.slice(1).join("__").replace(/__/g, "/"), size: stat.size, created: stat.birthtime };
    }).sort((a, b) => b.timestamp - a.timestamp);

    const snapshots = entries.filter(e => e.isDirectory()).map(e => {
      const stat = fs.statSync(path.join(BACKUP_DIR, e.name));
      return { name: e.name, created: stat.birthtime };
    });

    return { success: true, backups: fileBackups, snapshots };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cleanupOldBackups(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  ensureBackupDir();
  const now = Date.now();
  try {
    const entries = fs.readdirSync(BACKUP_DIR);
    let removed = 0;
    for (const entry of entries) {
      if (entry === ".gitkeep") continue;
      const fullPath = path.join(BACKUP_DIR, entry);
      const stat = fs.statSync(fullPath);
      if (now - stat.birthtimeMs > maxAgeMs) {
        if (stat.isDirectory()) fs.rmSync(fullPath, { recursive: true, force: true });
        else fs.unlinkSync(fullPath);
        removed++;
      }
    }
    if (removed > 0) console.log(`🗑️ ALEX: Cleaned up ${removed} old backups`);
    return { removed };
  } catch { return { removed: 0 }; }
}

module.exports = { backupFile, createSnapshot, restoreFromBackup, listBackups, ensureBackupDir, cleanupOldBackups };