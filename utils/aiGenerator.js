require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-flash-latest";

// Gemini se STRICT JSON mangwayega (valid JSON ke alawa kuch nahi dega)
async function callGemini(prompt, timeoutMs = 120000) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY missing in .env");

  if (prompt.length > 10000) {
    prompt = prompt.slice(0, 10000) + "\n...[text truncated]";
  }

  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 8192,
              responseMimeType: "application/json" // ⬅️ YAHI KEY FIX
            }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (res.status === 503 || res.status === 429) {
        const wait = 5000 * attempt;
        console.log(`⚠️ Gemini ${res.status} — retry ${attempt}/4 in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        lastError = new Error(`Gemini HTTP ${res.status} (after ${attempt} retries)`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 500)}`);
      }

      const data = await res.json();
      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("")
          .trim();

      if (!text) {
        throw new Error("Gemini empty response: " + (data?.candidates?.[0]?.finishReason || "?"));
      }
      return text;
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        console.log(`⏰ Timeout — retry ${attempt}/4...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// Robust parser — valid JSON + Gemini ka JS-style dono handle karega
function parseJsonArray(text) {
  if (!text) return null;

  let start = text.indexOf("[");
  let end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  text = text.slice(start, end + 1);

  // 1) Pehle seedha JSON try karo
  try { return JSON.parse(text); } catch (e) {}

  // 2) Agar fail ho — JS-style fix karke dobara try (single quotes -> double, keys quote)
  try {
    const fixed = text
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/:\s*`([^`]*)`/g, ': "$1"')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  } catch (e) {}

  console.error("❌ JSON PARSE FAIL — raw text:", text.slice(0, 300));
  return null;
}

async function generateQuestions(category, difficulty = "Medium", count = 10) {
  const prompt = `
Generate ${count} HIGH QUALITY multiple choice questions.

Category: ${category}
Difficulty: ${difficulty}

Rules:
1. Important exam level questions.
2. Every question must have exactly 4 options.
3. Every option needs a detailed explanation.
4. Correct answer must exactly match one option text.
5. No duplicate questions.
6. Return ONLY valid JSON array. No markdown.

JSON FORMAT:
[
 {
  "question": "",
  "options": [
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" }
  ],
  "correctAnswer": ""
 }
]
`;

  const text = await callGemini(prompt);
  const arr = parseJsonArray(text);
  if (!Array.isArray(arr)) throw new Error("Gemini ne valid JSON array nahi diya");
  return arr.map((q) => ({ category, difficulty, ...q }));
}

async function generateResumeQuestions(resumeText, count = 50) {

const prompt = `
You are an expert AI mock interviewer.

Analyze this PDF/resume content:

${resumeText}

Generate maximum ${count} important interview questions.

Rules:

1. Questions must be created ONLY from the given PDF content.
2. Select important topics only.
3. If PDF has many pages, cover main topics.
4. Generate technical + HR questions.
5. Every question MUST have exactly 4 options.
6. Every option MUST have explanation.
7. correctAnswer MUST exactly match one option text.
8. Return ONLY JSON array.
9. No markdown.
10. No extra text.

JSON FORMAT:

[
{
"question":"Question here",

"type":"technical",

"topic":"Topic name",

"page":1,

"options":[

{
"text":"Option 1",
"explanation":"Explanation of option 1"
},

{
"text":"Option 2",
"explanation":"Explanation of option 2"
},

{
"text":"Option 3",
"explanation":"Explanation of option 3"
},

{
"text":"Option 4",
"explanation":"Explanation of option 4"
}

],

"correctAnswer":"Option 1",

"difficulty":"Medium"
}
]

`;

const text = await callGemini(prompt);

const arr = parseJsonArray(text);


if(!Array.isArray(arr)){

console.log("❌ Gemini invalid resume questions");

return [];

}


return arr.map(q => ({

question: q.question || "Question",

type: q.type || "technical",

topic: q.topic || "",

page: q.page || 1,

difficulty: q.difficulty || "Medium",

options: Array.isArray(q.options)
?
q.options.map(o=>({

text:o.text || "",

explanation:o.explanation || ""

}))
:
[],

correctAnswer:q.correctAnswer || ""

}));

}

module.exports = { generateQuestions, generateResumeQuestions };