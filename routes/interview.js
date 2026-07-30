const express = require("express");
const Question = require("../models/Question");

const router = express.Router();


// GET ALL CATEGORIES

router.get("/categories", async(req,res)=>{

try{

const categories = await Question.distinct("category");

res.json(categories);


}
catch(error){

res.status(500).json({
message:error.message
});

}

});




// GET RANDOM QUESTIONS

router.get("/questions", async(req,res)=>{


try{


const {
category,
difficulty,
limit
}=req.query;



let filter={};



if(category){

filter.category=category;

}



if(difficulty){

filter.difficulty=difficulty;

}




let questions = await Question.aggregate([

{
$match:filter
},

{
$sample:{
size:Number(limit) || 10
}
}

]);


// SHUFFLE OPTIONS

questions = questions.map(q=>{


q.options = q.options.sort(
()=>Math.random()-0.5
);


return q;

});




res.json(questions);



}
catch(error){

res.status(500).json({
message:error.message
});

}


});




module.exports=router;