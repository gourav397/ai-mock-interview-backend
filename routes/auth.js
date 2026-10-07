console.log("🔥 ROUTES AUTH FILE LOADED");
console.log("🔥 AUTH FILE LOADED");
console.log("USER MODEL LOADED");

const express = require("express");
const bcrypt = require("bcrypt");

const User = require("../models/User");

const router = express.Router();

const otpGenerator = require("otp-generator");
const sendOTP = require("../utils/sendOTP");
const OTP = require("../models/OTP");

// ============================================================
// CENTRAL JWT
// ============================================================
//
// IMPORTANT:
// Login token ab central JWT configuration se banega.
//
// userAuth.js
// ownerAuth.js
// auth.js
//
// tino same JWT_SECRET + algorithm + issuer + audience
// configuration use karenge.
//
// JWT_SECRET ko kabhi hardcode nahi karna.
// ============================================================

const {
  signToken,
  getJwtSecret,
} = require("../config/jwt");

// ============================================================
// JWT SECRET STARTUP CHECK
// ============================================================

try {
  getJwtSecret();

  console.log(
    "✅ AUTH: JWT_SECRET FOUND"
  );
} catch (error) {
  console.error(
    "❌ AUTH: JWT_SECRET is missing from environment variables."
  );
}

// ============================================================
// SEND OTP
// ============================================================

router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const cleanEmail = email
      .trim()
      .toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const existingUser = await User.findOne({
      email: cleanEmail,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    await OTP.findOneAndUpdate(
      {
        email: cleanEmail,
      },
      {
        otp,
        expiry: new Date(
          Date.now() + 5 * 60 * 1000
        ),
      },
      {
        upsert: true,
        new: true,
      }
    );

    await sendOTP(
      cleanEmail,
      otp
    );

    return res.json({
      success: true,
      message: "OTP sent successfully",
    });

  } catch (error) {
    console.error(
      "❌ SEND OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to send OTP",
    });
  }
});

// ============================================================
// VERIFY OTP
// ============================================================

router.post(
  "/verify-otp",
  async (req, res) => {
    console.log(
      "🔥 VERIFY OTP ROUTE HIT"
    );

    try {
      const {
        email,
        otp,
      } = req.body;

      if (
        !email ||
        typeof email !== "string" ||
        !otp
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email and OTP required",
        });
      }

      const cleanEmail =
        email
          .trim()
          .toLowerCase();

      const otpData =
        await OTP.findOne({
          email: cleanEmail,
        });

      if (!otpData) {
        return res.status(400).json({
          success: false,
          message: "OTP not found",
        });
      }

      if (
        String(otpData.otp) !==
        String(otp)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
        });
      }

      if (
        otpData.expiry &&
        otpData.expiry.getTime() <
          Date.now()
      ) {
        return res.status(400).json({
          success: false,
          message: "OTP expired",
        });
      }

      await OTP.deleteOne({
        email: cleanEmail,
      });

      console.log(
        "✅ VERIFY SUCCESS"
      );

      return res.json({
        success: true,
        message:
          "Email verified successfully",
      });

    } catch (error) {
      console.error(
        "❌ VERIFY OTP ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "OTP verification failed",
      });
    }
  }
);

// ============================================================
// SIGNUP
// ============================================================

router.post(
  "/signup",
  async (req, res) => {
    console.log(
      "========== SIGNUP START =========="
    );

    try {
      const {
        name,
        email,
        password,
      } = req.body;

      if (
        !name ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name Email Password required",
        });
      }

      if (
        typeof name !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid signup data",
        });
      }

      const cleanName =
        name.trim();

      const cleanEmail =
        email
          .trim()
          .toLowerCase();

      if (
        !cleanName ||
        !cleanEmail ||
        !password.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name Email Password required",
        });
      }

      let user =
        await User.findOne({
          email: cleanEmail,
        });

      const hash =
        await bcrypt.hash(
          password,
          10
        );

      // ======================================================
      // EXISTING USER
      // ======================================================

      if (user) {
        console.log(
          "UPDATING OLD USER"
        );

        user.name =
          cleanName;

        user.password =
          hash;

        user.isVerified =
          true;

        // IMPORTANT:
        // Public signup kabhi owner/admin account
        // create nahi karega.
        //
        // Existing owner/admin account ka role yahan
        // accidentally preserve karna bhi allowed nahi hai
        // according to the existing signup behavior.
        user.role = "student";

        await user.save();

        return res.status(201).json({
          success: true,
          message:
            "Account created successfully",
        });
      }

      // ======================================================
      // NEW USER
      // ======================================================

      console.log(
        "CREATING NEW USER"
      );

      const newUser =
        new User({
          name: cleanName,

          email: cleanEmail,

          password: hash,

          isVerified: true,

          role: "student",
        });

      await newUser.save();

      return res.status(201).json({
        success: true,
        message:
          "Account created successfully",
      });

    } catch (error) {
      console.error(
        "========== SIGNUP ERROR =========="
      );

      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Signup failed",
      });
    }
  }
);

// ============================================================
// LOGIN
// ============================================================

router.post(
  "/login",
  async (req, res) => {
    try {
      // ======================================================
      // JWT SECRET CHECK
      // ======================================================

      let jwtSecret;

      try {
        jwtSecret =
          getJwtSecret();
      } catch (jwtError) {
        console.error(
          "❌ LOGIN: JWT_SECRET is missing."
        );

        return res.status(500).json({
          success: false,
          message:
            "Authentication service is not configured.",
        });
      }

      // ======================================================
      // INPUT
      // ======================================================

      const {
        email,
        password,
      } = req.body;

      if (
        !email ||
        !password ||
        typeof email !== "string" ||
        typeof password !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password required",
        });
      }

      const cleanEmail =
        email
          .trim()
          .toLowerCase();

      // ======================================================
      // FIND USER
      // ======================================================

      const user =
        await User.findOne({
          email: cleanEmail,
        });

      if (!user) {
        return res.status(400).json({
          success: false,
          message:
            "User not found",
        });
      }

      // ======================================================
      // PASSWORD CHECK
      // ======================================================

      if (!user.password) {
        return res.status(400).json({
          success: false,
          message:
            "Account password is not configured.",
        });
      }

      const match =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!match) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid password",
        });
      }

      // ======================================================
      // ROLE
      // ======================================================
      //
      // student -> normal ALEX access
      // owner   -> owner ALEX access
      // admin   -> admin ALEX access
      //
      // Database ka actual role preserve hota hai.
      // ======================================================

      const role =
        String(
          user.role || "student"
        ).toLowerCase();

      // ======================================================
      // JWT
      // ======================================================
      //
      // IMPORTANT:
      //
      // OLD:
      // jwt.sign(payload, JWT_SECRET, ...)
      //
      // NEW:
      // signToken(payload)
      //
      // signToken automatically:
      // - same JWT_SECRET
      // - HS256
      // - issuer
      // - audience
      //
      // set karta hai.
      // ======================================================

      const token =
        signToken({
          id: user._id.toString(),

          email: user.email,

          role,
        });

      // Secret ko use kiya gaya hai sirf
      // configuration validation ke liye.
      //
      // Actual secret value kabhi log nahi karna.
      void jwtSecret;

      console.log(
        `✅ LOGIN SUCCESS: ${cleanEmail} | role=${role}`
      );

      // ======================================================
      // RESPONSE
      // ======================================================

      return res.json({
        success: true,

        message:
          "Login successful",

        token,

        user: {
          id: user._id,

          name: user.name,

          email: user.email,

          role,
        },
      });

    } catch (error) {
      console.error(
        "========== LOGIN ERROR =========="
      );

      console.error(
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Login failed",
      });
    }
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;