// ============================================================
// ALEX SECURITY FIXER — Automatic Vulnerability Remediation
// Detects → Fixes → Verifies → Reports
// ============================================================

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

class SecurityFixer {
  /**
   * Apply a batch of auto-fixes to the project
   */
  async applyFixes(fixPlan) {
    if (!fixPlan || !fixPlan.vulnerabilities || !fixPlan.vulnerabilities.length) {
      return { success: true, message: "No vulnerabilities to fix.", fixesApplied: 0 };
    }

    const results = {
      total: fixPlan.vulnerabilities.length,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    };

    for (const vuln of fixPlan.vulnerabilities) {
      // Skip non-auto-fixable
      if (!vuln.autoFixable || !vuln.fix) {
        results.details.push({
          id: vuln.id,
          file: vuln.file,
          fixed: false,
          reason: "Not auto-fixable — requires manual review",
        });
        continue;
      }

      results.attempted++;
      
      try {
        const fixResult = await this._applySingleFix(vuln);
        if (fixResult.success) {
          results.succeeded++;
          results.details.push({
            id: vuln.id,
            file: vuln.file,
            line: vuln.line,
            fixed: true,
            fix: fixResult.description,
          });
        } else {
          results.failed++;
          results.details.push({
            id: vuln.id,
            file: vuln.file,
            fixed: false,
            reason: fixResult.error,
          });
        }
      } catch (err) {
        results.failed++;
        results.details.push({
          id: vuln.id,
          file: vuln.file,
          fixed: false,
          reason: err.message,
        });
      }
    }

    return {
      success: results.succeeded > 0,
      message: `Fixed ${results.succeeded}/${results.attempted} auto-fixable vulnerabilities. ${results.failed} failed, ${results.total - results.attempted} skipped (require manual review).`,
      ...results,
    };
  }

  /**
   * Apply a single vulnerability fix
   */
  async _applySingleFix(vuln) {
    const absolutePath = path.resolve(PROJECT_ROOT, vuln.file);

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: "File not found." };
    }

    // Create a backup first
    const backupDir = path.join(PROJECT_ROOT, ".alex-backups", "security-fixes");
    fs.mkdirSync(backupDir, { recursive: true });

    const backupName = `fix_${Date.now()}_${path.basename(vuln.file)}`;
    const backupPath = path.join(backupDir, backupName);
    fs.copyFileSync(absolutePath, backupPath);

    // Read current content
    let content = fs.readFileSync(absolutePath, "utf8");
    let modified = false;

    switch (vuln.fix.type) {
      case "replace": {
        // Simple text replacement
        if (content.includes(vuln.fix.find)) {
          content = content.replace(vuln.fix.find, vuln.fix.replace);
          modified = true;
          
          // If env variable is needed, add a note
          if (vuln.fix.envRequired) {
            content = `// 🔒 SECURITY FIX: Moved ${vuln.fix.envRequired} to environment variable\n//    Add to .env: ${vuln.fix.envRequired}=your-value-here\n` + content;
          }
        }
        break;
      }

      case "wrap": {
        // Wrap vulnerable code with sanitization
        if (vuln.fix.replace && content.includes(vuln.fix.find)) {
          content = content.replace(vuln.fix.find, vuln.fix.replace);
          modified = true;
        }
        break;
      }

      default:
        return { success: false, error: `Unknown fix type: ${vuln.fix.type}` };
    }

    if (!modified) {
      return { success: false, error: "Could not apply fix — pattern not found in file." };
    }

    // Write the fixed content
    fs.writeFileSync(absolutePath, content, "utf8");

    return {
      success: true,
      description: `${vuln.id}: ${vuln.fix.type} fix applied to line ${vuln.line}`,
      backupPath,
    };
  }

  /**
   * Rollback a security fix
   */
  async rollbackFix(backupPath, originalPath) {
    try {
      const absolute = path.resolve(PROJECT_ROOT, backupPath);
      const original = path.resolve(PROJECT_ROOT, originalPath);

      if (!fs.existsSync(absolute)) {
        return { success: false, error: "Backup file not found." };
      }

      fs.copyFileSync(absolute, original);
      return { success: true, message: "Rollback successful." };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

let instance = null;

function getSecurityFixer() {
  if (!instance) instance = new SecurityFixer();
  return instance;
}

module.exports = {
  SecurityFixer,
  getSecurityFixer,
};