const mongoose = require("mongoose");


const userSchema = new mongoose.Schema(

{
  name: {

    type: String,
    required: true

  },


  email: {

    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true

  },


  password: {

    type: String,
    required: true

  },

  otp: {
  type: String,
  default: null
},

otpExpiry: {
  type: Date,
  default: null
},

isVerified: {
  type: Boolean,
  default: false
},


  role: {

    type: String,
    enum: ["student", "admin"],
    default: "student"

  },


  isActive: {

    type: Boolean,
    default: true

  },


  createdAt: {

    type: Date,
    default: Date.now

  }

}

);


module.exports = mongoose.model("User", userSchema);