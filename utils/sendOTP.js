require("dotenv").config();
const nodemailer = require("nodemailer");

// SMTP config — env se aata hai (Brevo/Gmail dono support)
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // 465 = SSL, 587 = STARTTLS
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
  },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 40000,
});

async function sendOTP(to, otp) {
  console.log(`📨 Sending OTP via ${SMTP_HOST}...`);
  console.log(`Receiver: ${to}`);
  console.log(`OTP: ${otp}`);

  const mailOptions = {
    from: `"AI Mock Interview" <${process.env.SMTP_FROM || process.env.EMAIL_USER}>`,
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