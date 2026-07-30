const express = require("express");
const cors = require("cors");

const fs = require("fs");
const dotenv = require("dotenv");
const path = require("path");

const resultRoutes = require("./routes/results");

process.env.GEMINI_API_KEY = "AQ.Ab8RN6LnTNHZPAJRwoWhyq98k7YMzyNM-KCFNhI0PLyTVPU67Q";

console.log(
    "DIRECT KEY TEST =",
    process.env.GEMINI_API_KEY
);

// LOAD ENV FORCE

const envPath = path.join(
    __dirname,
    ".env"
);


const envConfig = dotenv.parse(
    fs.readFileSync(envPath)
);

console.log("ENV FILE DATA:");
console.log(envConfig);


Object.keys(envConfig).forEach(key => {

    process.env[key] = envConfig[key];

});


console.log(
    "ENV KEY =",
    process.env.GEMINI_API_KEY
);



const bulkUploader = require("./utils/bulkUploader");

const connectDB = require("./config/db");



const app = express();



// DATABASE

connectDB();



const filePath = path.join(
  __dirname,
  "uploads",
  "questions.json"
);


bulkUploader(filePath);




// MIDDLEWARE

app.use(cors());

app.use(express.json());






// ROUTES

const authRoutes = require("./routes/auth");

const questionRoutes = require("./routes/questions");

const interviewRoutes = require("./routes/interview");

const adminQuestionRoutes = require("./routes/adminQuestions");

const aiInterviewRoutes = require("./routes/aiInterview");








app.use("/api/auth", authRoutes);

app.use("/api/questions", questionRoutes);

app.use("/api/interview", interviewRoutes);

app.use("/api/admin/questions", adminQuestionRoutes);

app.use("/api/ai-interview", aiInterviewRoutes);

app.use("/api/results", resultRoutes);








app.get("/",(req,res)=>{


res.send(

"AI Exam Backend Running 🚀"

);


});








const PORT = process.env.PORT || 5000;



app.listen(PORT,()=>{


console.log(

`🚀 Server running on http://localhost:${PORT}`

);


});