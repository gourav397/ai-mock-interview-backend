require("dotenv").config();

const key = process.env.GEMINI_API_KEY;
console.log("KEY:", key ? "✅ MILA -> " + key.slice(0, 8) + "..." : "❌ UNDEFINED");
if (!key) process.exit(1);

const MODEL = "gemini-2.0-flash";

fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with just: OK" }] }]
    })
  }
)
  .then(async (res) => {
    console.log("HTTP STATUS:", res.status);
    console.log((await res.text()).slice(0, 1200));
  })
  .catch((e) => console.log("NETWORK ERROR:", e.message));