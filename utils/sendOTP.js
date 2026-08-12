const brevo = require("@getbrevo/brevo");

const client = new brevo.BrevoClient({
  apiKey: process.env.BREVO_API_KEY
});

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP via Brevo...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const sendSmtpEmail = {
      sender: {
        name: "AI Mock Interview",
        email: process.env.EMAIL_USER // gouravjangra782@gmail.com
      },
      to: [{ email }],
      subject: "AI Mock Interview OTP",
      htmlContent: `
        <h2>Your OTP is:</h2>
        <h1 style="font-size:32px;letter-spacing:4px;">${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `
    };

    const result = await client.transactionalEmails.sendTransacEmail(sendSmtpEmail);
    console.log("✅ EMAIL SENT via Brevo:", result.messageId);

  } catch (error) {
    console.log("❌ BREVO EMAIL FAILED");
    console.log(error.response?.body || error.message);
    throw error;
  }
};

module.exports = sendOTP;