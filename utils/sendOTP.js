const nodemailer = require("nodemailer");

const sendOTP = async (email, otp) => {

    try {

        console.log("📨 Sending OTP...");
        console.log("Receiver:", email);
        console.log("OTP:", otp);


        const transporter = nodemailer.createTransport({

            host: "smtp.gmail.com",

            port: 587,

            secure: false,

            requireTLS: true,

            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },

            family: 4

        });



        await transporter.sendMail({

            from: process.env.EMAIL_USER,

            to: email,

            subject: "AI Mock Interview OTP Verification",

            text: `Your OTP is ${otp}. Valid for 5 minutes.`

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