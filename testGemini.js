require("dotenv").config();

const { keyManager } = require("./config/geminiKeys");

async function test() {
  const keyObj = keyManager.nextKey();

  const key =
    typeof keyObj === "string"
      ? keyObj
      : keyObj?.key || keyObj?.apiKey || keyObj?.value || keyObj?.api_key;

  console.log("Key found:", !!key);
  console.log("Key prefix:", key ? key.slice(0, 8) + "..." : "NONE");

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: "Generate one simple question. Return only JSON." }],
          },
        ],
      }),
    }
  );

  const body = await res.text();

  console.log("HTTP STATUS:", res.status);
  console.log("RESPONSE:", body.slice(0, 2000));
}

test().catch((e) => {
  console.error("TEST ERROR:", e);
});