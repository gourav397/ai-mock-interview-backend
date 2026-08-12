const { Resend } = require("resend");

// RESEND_API_KEY .env se aayega (Railway Variables me bhi daalna — neeche dekho)
const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP via Resend...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const { data, error } = await resend.emails.send({
      from: "AI Mock Interview <onboarding@resend.dev>",
      to: [email],
      subject: "AI Mock Interview OTP",
      html: `
        <h2>Your OTP is:</h2>
        <h1 style="font-size:32px;letter-spacing:4px;">${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `,
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log("✅ EMAIL SENT via Resend — Message ID:", data?.id);
  } catch (error) {
    console.log("❌ EMAIL FAILED:");
    console.log(error.message || error);
    throw error;
  }
};

module.exports = sendOTP;