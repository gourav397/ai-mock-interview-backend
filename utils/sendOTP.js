const nodemailer = require("nodemailer");

const sendOTP = async(email, otp)=>{

    try{

        console.log("📨 Sending OTP...");
        console.log("Receiver:", email);
        console.log("OTP:", otp);


        const transporter = nodemailer.createTransport({

            service:"gmail",

            auth:{
                user:process.env.EMAIL_USER,
                pass:process.env.EMAIL_PASS
            },

            tls:{
                rejectUnauthorized:false
            }

        });



        await transporter.sendMail({

            from:process.env.EMAIL_USER,

            to:email,

            subject:"AI Mock Interview - Email Verification OTP",

            text:`Your OTP is ${otp}. It is valid for 5 minutes.`

        });



        console.log("✅ EMAIL SENT");


        return true;


    }
    catch(error){

        console.log("❌ EMAIL FAILED");
        console.log(error.message);

        throw error;

    }

};


module.exports = sendOTP;