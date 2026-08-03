console.log("🔥 ROUTES AUTH FILE LOADED");
console.log("🔥 AUTH FILE LOADED");
console.log("USER MODEL LOADED");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const router = express.Router();

const otpGenerator = require("otp-generator");
const sendOTP = require("../utils/sendOTP");
const OTP = require("../models/OTP");

const JWT_SECRET = "secretkey";



// ==========================
// SEND OTP
// ==========================


router.post("/send-otp", async(req,res)=>{

try{

const {email}=req.body;


if(!email){

return res.status(400).json({
message:"Email required"
});

}


const cleanEmail=email.trim().toLowerCase();



const existingUser = await User.findOne({
email:cleanEmail
});


if(existingUser){

return res.status(400).json({
message:"Email already registered"
});

}



const otp = otpGenerator.generate(6,{
upperCaseAlphabets:false,
lowerCaseAlphabets:false,
specialChars:false
});



await OTP.findOneAndUpdate(

{
email:cleanEmail
},

{

otp:otp,

expiry:new Date(Date.now()+5*60*1000)

},

{
upsert:true,
new:true
}


);



await sendOTP(cleanEmail,otp);



res.json({
message:"OTP sent successfully"
});


}
catch(error){

console.log(error);

res.status(500).json({
message:error.message
});


}


});




// ==========================
// VERIFY OTP
// ==========================


router.post("/verify-otp",async(req,res)=>{
console.log("🔥 VERIFY OTP ROUTE HIT");
console.log(req.body);    

try{


const {
email,
otp
}=req.body;



const cleanEmail=email.trim().toLowerCase();



const otpData = await OTP.findOne({
email:cleanEmail
});



if(!otpData){

return res.status(400).json({
message:"OTP not found"
});

}



if(otpData.otp !== otp){

return res.status(400).json({
message:"Invalid OTP"
});

}



if(otpData.expiry < Date.now()){


return res.status(400).json({
message:"OTP expired"
});

}



await OTP.deleteOne({
email:cleanEmail
});

console.log("✅ VERIFY SUCCESS");

res.json({

message:"Email verified successfully"

});


}

catch(error){

console.log("VERIFY OTP ERROR:");
console.log(error);

res.status(500).json({
message:error.message
});

}


});





// ==========================
// SIGNUP
// ==========================

router.post("/signup", async(req,res)=>{
console.log("SIGNUP BODY CHECK =====");
console.log(req.body);    

console.log("========== SIGNUP START ==========");
console.log("BODY RECEIVED:", req.body);


try{


const {
name,
email,
password
}=req.body;



console.log("EXTRACTED DATA:");
console.log({
    name,
    email,
    password
});



if(!name || !email || !password){

return res.status(400).json({

message:"Name Email Password required"

});

}



const cleanEmail=email.trim().toLowerCase();



let user = await User.findOne({

email:cleanEmail

});



console.log("EXISTING USER:");
console.log(user);



const hash = await bcrypt.hash(password,10);



if(user){


console.log("UPDATING OLD USER");


user.name = name.trim();

user.password = hash;

user.isVerified = true;

user.role = "student";


console.log("BEFORE SAVE:");
console.log(user);


await user.save();



return res.status(201).json({

success:true,

message:"Account created successfully"

});


}




console.log("CREATING NEW USER");

console.log("FINAL DATA BEFORE CREATE USER");

console.log({
 name:name,
 email:email,
 password:password,
 hash:hash
});
const newUser = new User({    

name:name.trim(),

email:cleanEmail,

password:hash,

isVerified:true,

role:"student"

});


await newUser.save();



res.status(201).json({

success:true,

message:"Account created successfully"

});



}
catch(error){


console.log("========== SIGNUP ERROR ==========");

console.log(error);


res.status(500).json({

message:error.message

});


}


});

// ==========================
// LOGIN
// ==========================


router.post("/login",async(req,res)=>{


try{


const {

email,

password

}=req.body;




const user =
await User.findOne({

email:
email.trim().toLowerCase()

});



if(!user){

return res.status(400).json({

message:"User not found"

});

}




const match =
await bcrypt.compare(

password,

user.password

);



if(!match){

return res.status(400).json({

message:"Invalid password"

});

}





const token =
jwt.sign(

{

id:user._id,

role:user.role

},

JWT_SECRET,

{

expiresIn:"7d"

}

);




res.json({

message:"Login successful",

token,

user:{

id:user._id,

name:user.name,

email:user.email,

role:user.role

}


});



}

catch(error){

console.log("========== FULL ERROR ==========");
console.log(error);

res.status(500).json({
message:error.message
});

}



});





module.exports = router;