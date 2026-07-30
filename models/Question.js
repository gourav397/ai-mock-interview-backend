const mongoose = require("mongoose");


const optionSchema = new mongoose.Schema({

text:{
type:String,
required:true
},

explanation:{
type:String,
default:""
}

});


const questionSchema = new mongoose.Schema({

category:{
type:String,
required:true
},


exam:{
type:String,
default:"General"
},


subject:{
type:String,
default:"General"
},


topic:{
type:String,
default:"General"
},


difficulty:{
type:String,
default:"Medium"
},


question:{
type:String,
required:true
},


options:[
optionSchema
],


correctAnswer:{
type:String,
required:true
},


createdAt:{
type:Date,
default:Date.now
}

});


module.exports = mongoose.model(
"Question",
questionSchema
);