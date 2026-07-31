const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const { error } = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "AI Mock Interview OTP",
      html: `
        <h2>Your OTP is:</h2>
        <h1>${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `,
    });

    if (error) {
      console.log("❌ EMAIL FAILED");
      console.log(error);
      throw new Error(error.message);
    }

    console.log("✅ EMAIL SENT");
  } catch (err) {
    console.log("❌ EMAIL FAILED");
    console.log(err.message);
    throw err;
  }
};

module.exports = sendOTP;