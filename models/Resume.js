const mongoose=require("mongoose");


const resumeSchema=new mongoose.Schema({

user:{
type:mongoose.Schema.Types.ObjectId,
ref:"User"
},


filename:{
type:String,
required:true
},


text:{
type:String,
required:true
},


questions:[
{
question:String,
type:String
}
]


},{

timestamps:true

});


module.exports=mongoose.model(
"Resume",
resumeSchema
);