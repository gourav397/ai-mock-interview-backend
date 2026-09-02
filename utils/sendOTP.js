require("dotenv").config();

// 🔥 Brevo HTTP API — port 443 (HTTPS) — Railway se kabhi block nahi hota
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER = process.env.SMTP_FROM || process.env.EMAIL_USER;

async function sendOTP(to, otp) {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY missing in env (Railway Variables mein add karo)");
  }

  console.log(`📨 Sending OTP via Brevo API...`);
  console.log(`Receiver: ${to}`);
  console.log(`OTP: ${otp}`);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": BREVO_API_KEY,  // xkeysib-... wali key
    },
    body: JSON.stringify({
      sender: {
        name: "AI Interview",
        email: BREVO_SENDER,
      },
      to: [{ email: to }],
      subject: "Your OTP Code - AI Interview",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Your OTP Code</h2>
          <p>Use this OTP to verify your email:</p>
          <h1 style="letter-spacing: 8px; background: #f0f0f0; padding: 12px; display: inline-block;">
            ${otp}
          </h1>
          <p>This OTP is valid for 5 minutes.</p>
        </div>
      `,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`❌ Brevo API error ${res.status}:`, JSON.stringify(data).slice(0, 400));
    throw new Error(`Brevo API ${res.status}: ${data.message || "send failed"}`);
  }

  console.log(`✅ OTP EMAIL SENT to ${to} (id: ${data.messageId})`);
}

module.exports = sendOTP;