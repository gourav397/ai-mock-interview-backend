const express = require("express");
const multer = require("multer");
const path = require("path");
const extractText = require("../utils/extractText");

const Resume=require("../models/Resume");

const {
generateResumeQuestions
}=require("../utils/aiGenerator");

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage
});

router.post(
"/resume",
upload.single("resume"),
async(req,res)=>{


try{


if(!req.file){

return res.status(400).json({

message:"No file uploaded"

});

}



const extractedText =
await extractText(req.file.path);



console.log(
"RESUME TEXT:",
extractedText.substring(0,200)
);



let questions=[];

try{

questions = await generateResumeQuestions(
extractedText,
10
);

}
catch(err){

console.log("AI QUESTION ERROR:",err.message);

questions=[
{
question:"AI service temporarily unavailable",
type:"system"
}
];

}



const resume =
await Resume.create({

filename:req.file.filename,

text:extractedText,

questions

});




res.json({

success:true,

message:"Resume analyzed",

resumeId:resume._id,

questions


});



}
catch(err){


console.log(err);


res.status(500).json({

message:err.message

});


}


});

module.exports = router;