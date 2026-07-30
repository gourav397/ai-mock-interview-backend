const express = require("express");
const Question = require("../models/Question");

const router = express.Router();




// GET ALL QUESTIONS

router.get("/", async(req,res)=>{

try{


const {
exam,
category,
search
}=req.query;



let filter={};



if(exam){

filter.exam=exam;

}



if(category){

filter.category=category;

}



if(search){

filter.question={
$regex:search,
$options:"i"
};

}




const questions =
await Question.aggregate([
  {
    $match: filter
  },
  {
    $sample:{
      size:50
    }
  }
]);



res.json(questions);



}
catch(error){


res.status(500).json({

message:error.message

});


}


});







// GET SINGLE QUESTION

router.get("/:id",async(req,res)=>{


try{


const question =
await Question.findById(
req.params.id
);



res.json(question);



}
catch(error){


res.status(500).json({

message:error.message

});


}



});


// BULK UPLOAD QUESTIONS

router.post("/upload", async(req,res)=>{

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






// ADD QUESTION

router.post("/",async(req,res)=>{


try{


const question =
new Question(req.body);



await question.save();



res.json({

message:"Question Added",

question

});



}
catch(error){


res.status(500).json({

message:error.message

});


}



});









// UPDATE QUESTION


router.put("/:id",async(req,res)=>{


try{


const question =
await Question.findByIdAndUpdate(

req.params.id,

req.body,

{
new:true
}

);



res.json({

message:"Updated",

question

});


}
catch(error){


res.status(500).json({

message:error.message

});


}


});









// DELETE QUESTION


router.delete("/:id",async(req,res)=>{


try{


await Question.findByIdAndDelete(

req.params.id

);



res.json({

message:"Deleted"

});


}
catch(error){


res.status(500).json({

message:error.message

});


}


});





module.exports = router;