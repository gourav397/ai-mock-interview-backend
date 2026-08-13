require("dotenv").config();
const nodemailer = require("nodemailer");

// Gmail SMTP transporter — Resend ki testing limit khatam!
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,   // gouravjangra782@gmail.com
    pass: process.env.EMAIL_PASS,   // Gmail APP PASSWORD (16 digit)
  },
});

async function sendOTP(to, otp) {
  console.log(`📨 Sending OTP via Gmail SMTP...`);
  console.log(`Receiver: ${to}`);
  console.log(`OTP: ${otp}`);

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: to,
    subject: "Your OTP Code - AI Mock Interview",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Your OTP Code</h2>
        <p>Use this OTP to verify your email:</p>
        <h1 style="letter-spacing: 8px; background: #f0f0f0; padding: 12px; display: inline-block;">
          ${otp}
        </h1>
        <p>This OTP is valid for 5 minutes.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  console.log(`✅ OTP EMAIL SENT to ${to}`);
}

module.exports = sendOTP;