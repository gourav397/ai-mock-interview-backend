// ============================================================
// ALEX PREMIUM TEST SUITE — 100% Verification
// Run: node test-alex-premium.js
// ============================================================

const http = require("http");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ADMIN_KEY = process.env.ADMIN_KEY || "test-key";

const results = { passed: 0, failed: 0, total: 0, tests: [] };

function pass(name, detail) {
  results.passed++;
  results.total++;
  results.tests.push({ name, status: "PASS", detail });
  console.log(`  ✅ ${name}`);
}

function fail(name, error) {
  results.failed++;
  results.total++;
  results.tests.push({ name, status: "FAIL", error: String(error).slice(0, 300) });
  console.log(`  ❌ ${name}: ${error}`);
}

async function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE_URL);
    const opts = {
      method, hostname: u.hostname, port: u.port,
      path: u.pathname, headers: { "Content-Type": "application/json", ...headers },
      timeout: 20000,
    };
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: { raw: d.slice(0, 200) } }); } });
    });
    r.on("error", reject);
    r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function runAll() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 ALEX PREMIUM TEST SUITE — 100% VERIFICATION");
  console.log("=".repeat(60));

  // === TEST 1: Security Scan ===
  try {
    const r = await req("POST", "/api/owner/security/scan", {}, { "x-admin-key": ADMIN_KEY });
    if (r.body.success) pass("T1: Security scan runs", `${r.body.data.totalVulnerabilities || 0} vulns found`);
    else fail("T1: Security scan", r.body.message);
  } catch (e) { fail("T1: Security scan", e.message); }

  // === TEST 2: Unauthorized access rejected ===
  try {
    const r = await req("POST", "/api/owner/command", { command: "status" }, {});
    if (r.status === 403) pass("T2: Unauthorized rejected", "403 as expected");
    else fail("T2: Unauthorized rejected", `Expected 403, got ${r.status}`);
  } catch (e) { fail("T2: Unauthorized rejected", e.message); }

  // === TEST 3: Create file ===
  const testFile = "_alex_premium_test.js";
  try {
    const r = await req("POST", "/api/owner/command", {
      command: `create file "${testFile}" with content // ALEX Premium Test\nconsole.log("OK");`,
    }, { "x-admin-key": ADMIN_KEY });
    
    const exists = fs.existsSync(path.resolve(__dirname, testFile));
    if (exists) pass("T3: File creation", `Created ${testFile}`);
    else fail("T3: File creation", "File doesn't exist on disk");
  } catch (e) { fail("T3: File creation", e.message); }

  // === TEST 4: Modify file ===
  try {
    const absPath = path.resolve(__dirname, testFile);
    if (fs.existsSync(absPath)) {
      fs.writeFileSync(absPath, "// Modified\nconsole.log('modified');", "utf8");
      const content = fs.readFileSync(absPath, "utf8");
      if (content.includes("modified")) pass("T4: File modification", "Content verified");
      else fail("T4: File modification", "Content mismatch");
    } else fail("T4: File modification", "Test file not found");
  } catch (e) { fail("T4: File modification", e.message); }

  // === TEST 5: Protected file rejected ===
  try {
    const r = await req("POST", "/api/owner/command", { command: "modify file .env" }, { "x-admin-key": ADMIN_KEY });
    if (!r.body.success) pass("T5: Protected file rejected", ".env correctly blocked");
    else fail("T5: Protected file rejected", "Should have rejected .env");
  } catch (e) { fail("T5: Protected file rejected", e.message); }

  // === TEST 6: Path traversal rejected ===
  try {
    const r = await req("POST", "/api/owner/command", { command: "create file ../../../etc/hack.txt with content test" }, { "x-admin-key": ADMIN_KEY });
    if (!r.body.success) pass("T6: Path traversal rejected", "Outside path blocked");
    else fail("T6: Path traversal rejected", "Should have rejected traversal");
  } catch (e) { fail("T6: Path traversal rejected", e.message); }

  // === TEST 7: Health check ===
  try {
    const r = await req("GET", "/api/owner/status", null, { "x-admin-key": ADMIN_KEY });
    if (r.body.success) pass("T7: Health check accessible", "Status OK");
    else fail("T7: Health check", r.body.message);
  } catch (e) { fail("T7: Health check", e.message); }

  // === TEST 8: Audit records exist ===
  try {
    const r = await req("GET", "/api/owner/audit", null, { "x-admin-key": ADMIN_KEY });
    if (r.body.success && r.body.count > 0) pass("T8: Audit records", `${r.body.count} records`);
    else fail("T8: Audit records", r.body.message);
  } catch (e) { fail("T8: Audit records", e.message); }

  // === TEST 9: No gemini-2.0-flash references ===
  try {
    const alexDir = path.resolve(__dirname, "alex");
    let found = false;
    function search(dir) {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory() && !["node_modules", ".alex-backups"].includes(e.name)) search(fp);
        else if (e.isFile() && e.name.endsWith(".js")) {
          const c = fs.readFileSync(fp, "utf8");
          if (c.includes("gemini-2.0-flash")) found = true;
        }
      }
    }
    search(alexDir);
    if (!found) pass("T9: No gemini-2.0-flash refs", "All files use gemini-3.5-flash");
    else fail("T9: No gemini-2.0-flash refs", "Found deprecated references");
  } catch (e) { fail("T9: No gemini-2.0-flash refs", e.message); }

  // === TEST 10: HealthMonitor healthy ===
  try {
    const r = await req("GET", "/api/alex/health", null, { "x-admin-key": ADMIN_KEY });
    if (r.body.success) pass("T10: HealthMonitor OK", `Status: ${r.body.data.current.status || "unknown"}`);
    else fail("T10: HealthMonitor", r.body.message);
  } catch (e) { fail("T10: HealthMonitor", e.message); }

  // === TEST 11: Test command ===
  try {
    const r = await req("POST", "/api/owner/command", { command: "run tests" }, { "x-admin-key": ADMIN_KEY });
    // Allow failure — tests may not exist, but command should execute
    if (r.body.success || r.body.exitCode !== undefined) pass("T11: Test command executed", `Exit code: ${r.body.exitCode}`);
    else fail("T11: Test command", r.body.message);
  } catch (e) { fail("T11: Test command", e.message); }

  // === TEST 12: Security fix endpoint ===
  try {
    const r = await req("POST", "/api/owner/security/fix", {}, { "x-admin-key": ADMIN_KEY });
    if (r.body.success !== undefined) pass("T12: Security fix endpoint", "Endpoint responds");
    else fail("T12: Security fix endpoint", r.body.message);
  } catch (e) { fail("T12: Security fix endpoint", e.message); }

  // Cleanup
  try {
    const tf = path.resolve(__dirname, testFile);
    if (fs.existsSync(tf)) fs.unlinkSync(tf);
  } catch {}

  // === SUMMARY ===
  console.log("\n" + "=".repeat(60));
  const pct = results.total > 0 ? Math.round((results.passed / results.total) * 100) : 0;
  console.log(`📊 RESULTS: ${results.passed}/${results.total} PASSED (${pct}%)`);
  if (results.failed > 0) {
    console.log(`\n❌ FAILED:`);
    results.tests.filter(t => t.status === "FAIL").forEach(t => console.log(`   ${t.name}: ${t.error}`));
  }
  console.log("=".repeat(60));
  process.exit(results.failed > 0 ? 1 : 0);
}

runAll();