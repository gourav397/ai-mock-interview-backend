const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const router = express.Router();

const otpGenerator = require("otp-generator");
const sendOTP = require("../utils/sendOTP");


const JWT_SECRET = "secretkey";


// ==========================
// SEND OTP
// ==========================

router.post("/send-otp", async (req, res) => {

console.log("🔥 SEND OTP HIT");
console.log(req.body);

  try {

    const { email } = req.body;

    if(!email){
      return res.status(400).json({
        message:"Email required"
      });
    }


    const cleanEmail = email.trim().toLowerCase();


    const existingUser = await User.findOne({
      email: cleanEmail,
      isVerified:true
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



    await User.findOneAndUpdate(

      {
        email:cleanEmail
      },

      {

        email:cleanEmail,

        otp,

        otpExpiry:
        Date.now() + 5 * 60 * 1000

      },

      {
        upsert:true,
        new:true
      }

    );



    await sendOTP(
      cleanEmail,
      otp
    );



    res.json({

      message:"OTP sent successfully"

    });



  }
  catch(error){

    res.status(500).json({

      message:error.message

    });

  }

});






// ==========================
// VERIFY OTP
// ==========================


router.post("/verify-otp", async(req,res)=>{


try{


const {

email,
otp

}=req.body;



const user = await User.findOne({

email:email.trim().toLowerCase()

});



if(!user){


return res.status(400).json({

message:"User not found"

});


}




if(user.otp !== otp){


return res.status(400).json({

message:"Invalid OTP"

});


}





if(user.otpExpiry < Date.now()){


return res.status(400).json({

message:"OTP expired"

});


}





user.isVerified = true;

user.otp = null;

user.otpExpiry = null;


await user.save();





res.json({

message:"Email verified successfully"

});




}
catch(error){


res.status(500).json({

message:error.message

});


}



});







// ==========================
// SIGNUP
// ==========================


router.post("/signup", async(req,res)=>{


try{


const {

name,
email,
password


}=req.body;



const cleanEmail =
email.trim().toLowerCase();




const user = await User.findOne({

email:cleanEmail

});




if(!user){


return res.status(400).json({

message:"Please verify email first"

});


}





if(!user.isVerified){


return res.status(400).json({

message:"Email not verified"

});


}




const hashedPassword =
await bcrypt.hash(password,10);




user.name=name;

user.password=hashedPassword;

user.role="student";


await user.save();




res.json({

message:"Account created successfully"

});



}
catch(error){


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




const user = await User.findOne({

email:email.trim().toLowerCase()

});





if(!user){


return res.status(400).json({

message:"User not found"

});


}




if(!user.isVerified){


return res.status(400).json({

message:"Please verify email first"

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





const token = jwt.sign(

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


res.status(500).json({

message:error.message

});


}



});





module.exports = router;