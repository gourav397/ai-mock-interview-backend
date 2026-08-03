const mongoose = require("mongoose");


const otpSchema = new mongoose.Schema({

email:{
    type:String,
    required:true,
    unique:true,
    lowercase:true,
    trim:true
},


otp:{
    type:String,
    required:true
},


expiry:{
    type:Date,
    required:true
}


},{
timestamps:true
});


module.exports = mongoose.model("OTP",otpSchema);