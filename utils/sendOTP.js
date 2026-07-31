const nodemailer = require("nodemailer");


const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,

  family: 4,

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

  service:"gmail",

  auth:{

    user:process.env.EMAIL_USER,

    pass:process.env.EMAIL_PASS

  }

});



const sendOTP = async(email,otp)=>{

try{


console.log("📨 Sending OTP...");
console.log("Receiver:",email);
console.log("OTP:",otp);



const info = await transporter.sendMail({

from:`"AI Mock Interview" <${process.env.EMAIL_USER}>`,

to:email,

subject:"AI Mock Interview OTP Verification",

html:`

<h2>Email Verification</h2>

<p>Your OTP is:</p>

<h1>${otp}</h1>

<p>Valid for 5 minutes</p>

`

});



console.log("✅ EMAIL SENT");

console.log(info.response);



return true;



}
catch(error){


console.log("❌ EMAIL FAILED");

console.log(error.message);


throw error;


}


};



module.exports = sendOTP;