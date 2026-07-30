const { GoogleGenAI } = require("@google/genai");



console.log(
    "AI GENERATOR KEY =",
    process.env.GEMINI_API_KEY
);



const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});





async function generateQuestions(
    category,
    difficulty = "Medium",
    count = 10
) {


    try {


        const prompt = `
Generate ${count} HIGH QUALITY multiple choice questions.

Category: ${category}
Difficulty: ${difficulty}

Rules:

1. Generate important exam level questions.
2. Every question must have exactly 4 options.
3. Every option needs a detailed explanation.
4. Correct answer must exactly match one option text.
5. No duplicate questions.
6. Return ONLY valid JSON.
7. Do not add markdown or extra text.


JSON FORMAT:

[
 {
  "question":"",
  "options":[
    {
      "text":"",
      "explanation":""
    },
    {
      "text":"",
      "explanation":""
    },
    {
      "text":"",
      "explanation":""
    },
    {
      "text":"",
      "explanation":""
    }
  ],
  "correctAnswer":""
 }
]
`;





        const response = await ai.models.generateContent({

            model: "gemini-2.0-flash",

            contents: prompt

        });





        let text = response.text;

        if(typeof text === "function"){

            text = text();

        }

        console.log("FULL GEMINI RESPONSE:");
        console.log(response);

        console.log("GEMINI TEXT:");
        console.log(text);



        text = text
        .replace(/```json/g,"")
        .replace(/```/g,"")
        .trim();






        const questions = JSON.parse(text);






        return questions.map(q => ({

            category,

            difficulty,

            ...q

        }));





    }
    catch(error){


        console.log(
    "GEMINI FULL ERROR:"
);

console.log(error);

return [];

    }



}





module.exports = generateQuestions;