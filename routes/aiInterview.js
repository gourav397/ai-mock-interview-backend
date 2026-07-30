const express = require("express");

const generateQuestions = require("../utils/aiGenerator");


const router = express.Router();



// GENERATE AI INTERVIEW QUESTIONS

router.get("/generate", async(req,res)=>{


    try{


        const {
            category,
            difficulty
        } = req.query;



        if(!category){

            return res.status(400).json({

                message:"Category required"

            });

        }



        const questions = await generateQuestions(

            category,

            difficulty || "Medium",

            10

        );




        res.json({

            category,

            difficulty: difficulty || "Medium",

            total: questions.length,

            questions

        });



    }
    catch(error){


        res.status(500).json({

            message:error.message

        });


    }


});



module.exports = router;