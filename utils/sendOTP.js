const https = require("https");

const sendOTP = async (email, otp) => {
  try {
    console.log("📨 Sending OTP via Resend...");
    console.log("Receiver:", email);
    console.log("OTP:", otp);

    const data = JSON.stringify({
      from: "AI Mock Interview <onboarding@resend.dev>",
      to: [email],
      subject: "AI Mock Interview OTP",
      html: `
        <h2>Your OTP is:</h2>
        <h1 style="font-size:32px;letter-spacing:4px;">${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.resend.com",
          path: "/emails",
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
          }
        },
        (res) => {
          let body = "";

          res.on("data", (chunk) => {
            body += chunk;
          });

          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(body));
            } else {
              reject(new Error(body));
            }
          });
        }
      );

      req.on("error", reject);
      req.write(data);
      req.end();
    });

    console.log("✅ EMAIL SENT:", result.id);

    return result;

  } catch (error) {
    console.log("❌ RESEND EMAIL FAILED");
    console.log(error.message);
    throw error;
  }
};

module.exports = sendOTP;