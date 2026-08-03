const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

    name:{
        type:String,
        required:false,
        default:""
    },

    email:{
        type:String,
        required:true,
        unique:true,
        lowercase:true,
        trim:true
    },

    password:{
        type:String,
        required:false,
        default:""
    },

    otp:{
        type:String,
        default:null
    },

    otpExpiry:{
        type:Date,
        default:null
    },

    isVerified:{
        type:Boolean,
        default:false
    },

    role:{
        type:String,
        default:"student"
    },

    isActive:{
        type:Boolean,
        default:true
    }

},{
    timestamps:true
});


module.exports = mongoose.model("User",userSchema);