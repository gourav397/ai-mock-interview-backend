// ============================================================
// ALEX File Inspector — Safe file operations with protection
// ============================================================

const fs = require("fs");
const path = require("path");

const PROTECTED_PATTERNS = [
  /[/\\]\.env/, /[/\\]\.env\./, /[/\\]node_modules[/\\]/,
  /[/\\]\.git[/\\]/, /[/\\]\.alex-backups[/\\]/,
  /\.pem$/, /\.cert$/, /\.key$/,
  /credentials/, /secrets?[^/\\]*\./,
];

function isProtected(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return PROTECTED_PATTERNS.some(p => p.test(normalized));
}

function resolveSafe(filePath) {
  const absolute = path.resolve(filePath);
  if (isProtected(absolute)) {
    return { success: false, error: "Access denied: path is protected", protected: true };
  }
  return { success: true, absolute };
}

function readFile(filePath) {
  const resolved = resolveSafe(filePath);
  if (!resolved.success) return resolved;

  try {
    if (!fs.existsSync(resolved.absolute)) {
      return { success: false, error: "File not found" };
    }
    const stat = fs.statSync(resolved.absolute);
    // Don't read files larger than 5MB
    if (stat.size > 5 * 1024 * 1024) {
      return { success: false, error: "File too large (>5MB)" };
    }
    const content = fs.readFileSync(resolved.absolute, "utf8");
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function listDir(dirPath) {
  const resolved = resolveSafe(dirPath);
  if (!resolved.success) return resolved;

  try {
    const absolute = resolved.absolute;
    if (!fs.existsSync(absolute)) return { success: false, error: "Directory not found" };
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => ({ name: e.name, type: "file" }));
    const dirs = entries.filter(e => e.isDirectory()).map(e => ({ name: e.name, type: "directory" }));
    return { success: true, entries: [...dirs, ...files] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getDirectoryTree(dirPath, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  const resolved = resolveSafe(dirPath);
  if (!resolved.success) return [];

  try {
    const entries = fs.readdirSync(resolved.absolute, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(resolved.absolute, entry.name);
      const relPath = path.relative(process.cwd(), fullPath);
      if (entry.isDirectory()) {
        result.push({ name: entry.name, type: "directory", path: relPath, children: getDirectoryTree(fullPath, maxDepth, currentDepth + 1) });
      } else {
        const stat = fs.statSync(fullPath);
        result.push({ name: entry.name, type: "file", path: relPath, size: stat.size });
      }
    }
    return result;
  } catch { return []; }
}

function readTail(filePath, lines = 100) {
  const resolved = resolveSafe(filePath);
  if (!resolved.success) return resolved;

  try {
    if (!fs.existsSync(resolved.absolute)) return { success: false, error: "File not found" };
    const content = fs.readFileSync(resolved.absolute, "utf8");
    const allLines = content.split("\n");
    const tailLines = allLines.slice(Math.max(0, allLines.length - lines));
    return { success: true, content: tailLines.join("\n"), totalLines: allLines.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function exists(filePath) {
  const resolved = resolveSafe(filePath);
  if (!resolved.success) return false;
  return fs.existsSync(resolved.absolute);
}

module.exports = { readFile, listDir, getDirectoryTree, readTail, exists, isProtected, resolveSafe };