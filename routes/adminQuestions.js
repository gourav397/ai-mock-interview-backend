const express = require("express");
const Question = require("../models/Question");

const router = express.Router();


// UPLOAD BULK QUESTIONS

router.post("/upload", async (req,res)=>{

    try{

        const questions = req.body;


        if(!Array.isArray(questions)){

            return res.status(400).json({
                message:"Array format required"
            });

        }


        const result = await Question.insertMany(
            questions
        );


        res.json({

            message:"Questions uploaded successfully",

            total: result.length

        });


    }
    catch(error){

        res.status(500).json({

            message:error.message

        });

    }


});


module.exports = router;