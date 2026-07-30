const mongoose = require("mongoose");


const resultSchema = new mongoose.Schema({

    user:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true
    },


    category:{
        type:String,
        required:true
    },


    difficulty:{
        type:String,
        default:"Medium"
    },


    totalQuestions:{
        type:Number,
        required:true
    },


    score:{
    type:Number,
    required:true
},


percentage:{
    type:Number
},


correctQuestions:{
    type:Number,
    default:0
},


wrongQuestions:{
    type:Number,
    default:0
},


performance:{
    type:String,
    default:""
},


createdAt:{
    type:Date,
    default:Date.now
}


});


module.exports = mongoose.model(
    "Result",
    resultSchema
);