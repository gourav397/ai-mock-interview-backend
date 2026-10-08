"use strict";

const { verifyToken } = require("../config/jwt");

/**
 * ============================================================
 * LEGACY AUTH MIDDLEWARE
 * ============================================================
 *
 * This middleware is kept for routes that still import:
 *
 *     require("../middleware/auth")
 *
 * IMPORTANT:
 * - Never use hardcoded "secretkey"
 * - Never use a separate JWT secret
 * - Never use jwt.verify() directly here
 *
 * All JWT verification goes through config/jwt.js so that:
 * - JWT_SECRET is identical everywhere
 * - algorithm is HS256
 * - issuer is identical
 * - audience is identical
 * - invalid/expired tokens are handled consistently
 * ============================================================
 */

const auth = (req, res, next) => {
  try {
    // ========================================================
    // AUTHORIZATION HEADER
    // ========================================================

    const authorization =
      req.headers.authorization;

    if (
      !authorization ||
      typeof authorization !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
        code: "AUTH_REQUIRED",
      });
    }

    // ========================================================
    // BEARER TOKEN
    // ========================================================

    const parts =
      authorization.trim().split(/\s+/);

    if (
      parts.length !== 2 ||
      parts[0].toLowerCase() !== "bearer" ||
      !parts[1]
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid authorization header. Use Bearer <token>.",
        code: "AUTH_HEADER_INVALID",
      });
    }

    const token =
      parts[1].trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing.",
        code: "TOKEN_MISSING",
      });
    }

    // ========================================================
    // CENTRAL JWT VERIFICATION
    // ========================================================
    //
    // IMPORTANT:
    // Do NOT replace this with:
    //
    // jwt.verify(token, "secretkey")
    //
    // config/jwt.js is now the single source of truth.
    // ========================================================

    const decoded =
      verifyToken(token);

    if (
      !decoded ||
      typeof decoded !== "object"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
        code: "TOKEN_INVALID",
      });
    }

    // ========================================================
    // USER ID
    // ========================================================

    const userId =
      decoded.id ||
      decoded._id ||
      decoded.userId ||
      null;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token does not contain a user ID.",
        code: "TOKEN_USER_MISSING",
      });
    }

    // ========================================================
    // NORMALIZE ROLE
    // ========================================================

    const role =
      String(
        decoded.role || "student"
      )
        .trim()
        .toLowerCase();

    // ========================================================
    // ATTACH USER
    // ========================================================

    req.user = {
      ...decoded,

      id: String(userId),

      userId: String(userId),

      role,
    };

    // ========================================================
    // OWNER CONTEXT
    // ========================================================
    //
    // Keep compatibility with routes that expect req.owner.
    //
    // Normal students are NOT converted into owners.
    // ========================================================

    if (
      role === "owner" ||
      role === "admin"
    ) {
      req.owner = {
        id: String(userId),

        userId: String(userId),

        email:
          decoded.email || null,

        role,
      };
    }

    // ========================================================
    // CONTINUE
    // ========================================================

    return next();

  } catch (error) {
    console.error(
      "❌ AUTH MIDDLEWARE ERROR:",
      error?.code || error?.name || "UNKNOWN",
      error?.message || error
    );

    // ========================================================
    // JWT ERROR RESPONSE
    // ========================================================

    if (
      error?.code === "JWT_EXPIRED" ||
      error?.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token has expired. Please login again.",
        code: "TOKEN_EXPIRED",
      });
    }

    if (
      error?.code === "JWT_MISSING"
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing.",
        code: "TOKEN_MISSING",
      });
    }

    if (
      error?.name === "JsonWebTokenError" ||
      error?.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication token is invalid.",
        code: "TOKEN_INVALID",
      });
    }

    // ========================================================
    // JWT SECRET / CONFIGURATION ERROR
    // ========================================================

    if (
      String(
        error?.message || ""
      )
        .toLowerCase()
        .includes("jwt_secret")
    ) {
      return res.status(500).json({
        success: false,
        message:
          "Authentication service is not configured correctly.",
        code: "AUTH_CONFIG_ERROR",
      });
    }

    // ========================================================
    // FALLBACK
    // ========================================================

    return res.status(401).json({
      success: false,
      message:
        "Authentication failed.",
      code: "AUTH_FAILED",
    });
  }
};

module.exports = auth;