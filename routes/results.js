const express = require("express");

const Result = require("../models/Result");

const router = express.Router();



router.post("/", async(req,res)=>{

console.log("RESULT DATA RECEIVED =", req.body);    


try{


const result = new Result(req.body);


await result.save();



res.json({

message:"Result saved",

result

});


}
catch(error){


res.status(500).json({

message:error.message

});


}


});


router.get("/detail/:id", async (req, res) => {
    try {
        const result = await Result.findById(req.params.id);

        if (!result) {
            return res.status(404).json({
                message: "Result not found"
            });
        }

        res.json(result);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});


router.get("/:userId", async(req,res)=>{


try{


const results = await Result.find({

user:req.params.userId

})
.sort({
createdAt:-1
});



res.json(results);



}
catch(error){


res.status(500).json({

message:error.message

});


}


});



module.exports=router;