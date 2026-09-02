const express = require("express");
const QuestionBank = require("../models/QuestionBank");
const InterviewSession = require("../models/InterviewSession");
const { isKeysAlive } = require("../utils/aiChat");

const router = express.Router();

const ADMIN_KEY = process.env.ADMIN_KEY || "change-me-123";

function checkKey(req, res) {
  const k = req.headers["x-admin-key"] || req.query.key;
  if (k !== ADMIN_KEY) {
    res.status(401).json({ message: "Wrong admin key" });
    return false;
  }
  return true;
}

// ---------- OVERVIEW (JSON) ----------
router.get("/overview", async (req, res) => {
  if (!checkKey(req, res)) return;
  try {
    const banks = await QuestionBank.find({}).lean();
    const sessionsToday = await InterviewSession.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    res.json({
      totalBanks: banks.length,
      totalQuestions: banks.reduce((s, b) => s + (b.questions?.length || 0), 0),
      sessionsToday,
      keysConfigured: isKeysAlive(),
      banks: banks
        .map((b) => ({
          category: b.category,
          difficulty: b.difficulty,
          q: b.questions?.length || 0,
          ageHours: Math.round((Date.now() - new Date(b.updatedAt).getTime()) / 3600000)
        }))
        .sort((a, b) => a.category.localeCompare(b.category))
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- RUN REFRESH (cron ko abhi trigger karo) ----------
router.post("/run-refresh", async (req, res) => {
  if (!checkKey(req, res)) return;
  try {
    const { refreshAllBanks } = require("../cron/refreshBanks");
    res.json({ message: "Refresh background mein start ho gaya — 2-3 min mein dekho" });
    refreshAllBanks().catch((e) => console.log("Admin refresh err:", e.message));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------- PANEL (HTML page — browser mein kholo) ----------
router.get("/panel", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Panel</title>
<style>
body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:20px;max-width:900px;margin:auto}
h1{color:#38bdf8}button{background:#2563eb;color:#fff;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;font-size:15px}
button:hover{background:#1d4ed8}.card{background:#1e293b;border-radius:12px;padding:16px;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px;border-bottom:1px solid #334155;text-align:left}
.badge{background:#059669;color:#fff;border-radius:99px;padding:2px 10px;font-size:12px}
</style>
</head>
<body>
<h1>🛠️ Admin Panel</h1>
<div class="card"><button onclick="refresh()">🔄 Refresh</button>
<button onclick="runRefresh()" style="background:#7c3aed">🌙 Abhi Cron Chalao</button>
<span id="msg" style="margin-left:10px"></span></div>
<div id="stats" class="card">Loading...</div>
<div id="banks" class="card">Loading...</div>
<script>
const KEY = new URLSearchParams(location.search).get("key") || "";
async function j(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "x-admin-key": KEY, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.json()).message || r.status);
  return r.json();
}
async function refresh() {
  try {
    const d = await j("/api/admin/overview");
    document.getElementById("stats").innerHTML =
      "📦 Banks: <b>" + d.totalBanks + "</b> | ❓ Total Questions: <b>" + d.totalQuestions +
      "</b> | 🎯 Interviews aaj: <b>" + d.sessionsToday + "</b> | 🔑 Keys: <b>" + (d.keysConfigured ? "5 configured" : "MISSING!") + "</b>";
    document.getElementById("banks").innerHTML =
      "<table><tr><th>Category</th><th>Difficulty</th><th>Questions</th><th>Age (hr)</th></tr>" +
      d.banks.map(b => "<tr><td>" + b.category + "</td><td>" + b.difficulty + "</td><td>" + b.q + "</td><td>" + b.ageHours + "</td></tr>").join("") +
      "</table>";
  } catch (e) { document.getElementById("stats").textContent = "Error: " + e.message; }
}
async function runRefresh() {
  document.getElementById("msg").textContent = "⏳ Start ho gaya...";
  try { await j("/api/admin/run-refresh", { method: "POST" }); document.getElementById("msg").textContent = "✅ Background mein chal raha hai"; }
  catch (e) { document.getElementById("msg").textContent = "Error: " + e.message; }
}
refresh();
</script>
</body>
</html>`);
});

module.exports = router;