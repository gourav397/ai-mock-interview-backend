const nodemailer = require("nodemailer");


const transporter = nodemailer.createTransport({

    service:"gmail",

    auth:{
        user:process.env.EMAIL_USER,
        pass:process.env.EMAIL_PASS
    }

});



const sendOTP = async(email, otp)=>{

    try{

        console.log("📨 Sending OTP...");
        console.log("Receiver:", email);
        console.log("OTP:", otp);


        await transporter.sendMail({

            from:process.env.EMAIL_USER,

            to:email,

            subject:"AI Mock Interview OTP",

            html:`
                <h2>Your OTP is:</h2>
                <h1>${otp}</h1>
                <p>This OTP is valid for 5 minutes.</p>
            `

        });


        console.log("✅ EMAIL SENT");


    }
    catch(error){

        console.log("❌ EMAIL FAILED");
        console.log(error.message);

        throw error;

    }

};



module.exports = sendOTP;