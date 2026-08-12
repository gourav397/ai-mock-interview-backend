const nodemailer = require("nodemailer");
const dns = require("dns");

// ⭐ YEH FIX HAI: Node ko bolo IPv4 hi use kare (Railway pe IPv6 nahi chalta)
dns.setDefaultResultOrder("ipv4first");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  family: 4,                        // extra safety
  connectionTimeout: 15000,         // 15 sec me fail ho jaye, hang na ho
  greetingTimeout: 15000,
  socketTimeout: 15000,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const info = await transporter.sendMail({
      from: `"AI Mock Interview" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "AI Mock Interview OTP",
      html: `
        <h2>Your OTP is:</h2>
        <h1>${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `
    });

    console.log("✅ EMAIL SENT:", info.messageId);
  } catch (error) {
    console.log("❌ EMAIL FAILED");
    console.log(error);
    throw error;
  }
};

module.exports = sendOTP;