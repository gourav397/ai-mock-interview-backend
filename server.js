require("dotenv").config();

console.log(
"AI KEY CHECK:",
process.env.GEMINI_API_KEY
? "FOUND"
: "MISSING"
);

const API_KEY = process.env.GEMINI_API_KEY;
const express = require("express");
const cors = require("cors");

const dotenv = require("dotenv");
const path = require("path");
const uploadRoutes = require("./routes/upload");
dotenv.config({
  path: "./.env"
});

const connectDB = require("./config/db");
const bulkUploader = require("./utils/bulkUploader");
// Routes
const authRoutes = require("./routes/auth");
const questionRoutes = require("./routes/questions");
const interviewRoutes = require("./routes/interview");
const adminQuestionRoutes = require("./routes/adminQuestions");
const aiInterviewRoutes = require("./routes/aiInterview");
const resultRoutes = require("./routes/results");


const app = express();


// =======================
// MIDDLEWARE
// =======================

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));



// =======================
// ENV CHECK
// =======================

console.log("=================================");

console.log(
  "EMAIL USER :",
  process.env.EMAIL_USER
);

console.log(
  process.env.EMAIL_PASS
    ? "EMAIL PASS FOUND ✅"
    : "EMAIL PASS MISSING ❌"
);


console.log(
  process.env.GEMINI_API_KEY
    ? "GEMINI KEY FOUND ✅"
    : "GEMINI KEY MISSING ❌"
);


console.log(
  process.env.MONGO_URI
    ? "MONGO URI FOUND ✅"
    : "MONGO URI MISSING ❌"
);

console.log("=================================");




// =======================
// ROUTES
// =======================

app.use("/api/auth", authRoutes);

app.use("/api/questions", questionRoutes);

app.use("/api/interview", interviewRoutes);

app.use("/api/admin/questions", adminQuestionRoutes);

app.use("/api/ai-interview", aiInterviewRoutes);

app.use("/api/results", resultRoutes);

app.use("/api/upload", uploadRoutes);




// =======================
// HOME
// =======================

app.get("/", (req,res)=>{

    res.json({

        success:true,

        message:"AI Mock Interview Backend Running 🚀"

    });

});




// =======================
// 404
// =======================

app.use((req,res)=>{

    res.status(404).json({

        success:false,

        message:"Route Not Found"

    });

});





// =======================
// START SERVER
// =======================


const PORT = process.env.PORT || 5000;



const startServer = async()=>{

    try{


        // Connect MongoDB first

        await connectDB();



        // Upload questions after DB connection

        const filePath = path.join(
            __dirname,
            "uploads",
            "questions.json"
        );


        await bulkUploader(filePath);



        // Start server

        app.listen(PORT,()=>{

            console.log(
                `🚀 Server Running On Port ${PORT}`
            );

        });



    }
    catch(error){


        console.error(
            "❌ Server Start Failed"
        );


        console.error(
            error.message
        );


        process.exit(1);


    }


};



startServer();