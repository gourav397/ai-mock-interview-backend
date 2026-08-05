require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash"; // 404 aaye to "gemini-3-flash" try karo

async function callGemini(prompt, timeoutMs = 90000) {

let attempts = 3;


while(attempts--){

try{

const res = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
{
method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({

contents:[
{
parts:[
{
text:prompt
}
]
}
],

generationConfig:{
temperature:0.5,
maxOutputTokens:4096
}

}

)
}
);


if(res.status===503){

console.log("Gemini busy retrying...");

await new Promise(
resolve=>setTimeout(resolve,5000)
);

continue;

}


if(!res.ok){

const body = await res.text();

throw new Error(
`Gemini HTTP ${res.status}: ${body}`
);

}


const data = await res.json();


const text =
data?.candidates?.[0]
?.content
?.parts
?.map(p=>p.text || "")
?.join("")
?.trim();


if(!text){

throw new Error("Gemini empty response");

}


return text;


}
catch(err){

if(attempts===0)
throw err;

}

}

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

async function generateResumeQuestions(resumeText, count = 10) {

const prompt = `
You are an AI technical interviewer.

Analyze this resume:

${resumeText}

Generate ${count} interview questions.

Rules:
1. Questions must be based on resume.
2. Mix technical and HR.
3. Return ONLY JSON array.
4. No markdown.
5. Every item must be object.

Format:

[
 {
  "question":"Explain your project?",
  "type":"technical"
 }
]
`;


const text = await callGemini(prompt);


const arr = parseJsonArray(text);


if(!Array.isArray(arr)){
throw new Error("Invalid Gemini Questions");
}


// IMPORTANT FIX
return arr.map(q=>({

question:
typeof q === "string"
? q
: q.question,

type:
q.type || "technical"

}));

}

module.exports = { generateQuestions, generateResumeQuestions };
