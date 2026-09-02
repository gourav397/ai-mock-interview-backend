require("dotenv").config();

const keys = (process.env.GEMINI_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

async function test(k) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Say OK" }] }] })
    }
  );
  const body = await res.text();
  console.log("STATUS:", res.status);
  console.log("RETRY-AFTER:", res.headers.get("retry-after"));
  console.log("BODY:", body.slice(0, 700));
  console.log("====================");
}

(async () => {
  for (let i = 0; i < keys.length; i++) {
    console.log(`KEY ${i + 1}: ${keys[i].slice(0, 10)}...`);
    await test(keys[i]);
    await new Promise(r => setTimeout(r, 1000));
  }
})();