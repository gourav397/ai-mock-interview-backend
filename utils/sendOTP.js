const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP via Gmail...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "AI Mock Interview OTP",
      html: `
        <h2>Your OTP is:</h2>
        <h1 style="font-size:32px;letter-spacing:4px;">${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `
    };

    console.log("📤 Calling Gmail sendMail...");

    const result = await transporter.sendMail(mailOptions);

    console.log("✅ EMAIL SENT via Gmail:", result.messageId);

    return result;

  } catch (error) {
    console.log("❌ GMAIL EMAIL FAILED");
    console.log("ERROR:", error.message);
    console.log("CODE:", error.code);
    throw error;
  }
};

module.exports = sendOTP;