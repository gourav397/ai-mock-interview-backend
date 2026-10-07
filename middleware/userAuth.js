"use strict";

const jwt = require("jsonwebtoken");

const {
  verifyToken,
} = require("../config/jwt");

// ============================================================
// USER AUTH MIDDLEWARE
// ============================================================
//
// Normal users:
//   - valid JWT required
//
// Owner/Admin:
//   - valid JWT required
//   - req.owner context also created
//
// ADMIN_KEY:
//   - only acts as an owner/admin authentication mechanism
//   - NEVER upgrades a normal JWT user
//
// IMPORTANT:
// Authentication MUST use the central JWT verifier.
// Do not use jwt.verify() directly here.
// ============================================================


// ============================================================
// SAFE STRING
// ============================================================

function cleanString(value) {
  return String(value || "").trim();
}


// ============================================================
// ADMIN KEY COMPARISON
// ============================================================
//
// Timing-safe comparison without logging secrets.
// ============================================================

function safeAdminKeyMatch(provided, expected) {
  const a = cleanString(provided);
  const b = cleanString(expected);

  if (!a || !b) {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let valid = true;

  for (let i = 0; i < a.length; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      valid = false;
    }
  }

  return valid;
}


// ============================================================
// JWT ERROR RESPONSE
// ============================================================

function sendJwtError(res, error) {
  if (
    error?.name === "TokenExpiredError" ||
    error?.code === "ERR_JWT_EXPIRED"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      code: "TOKEN_EXPIRED",
      message:
        "Login session expired. Please login again.",
    });
  }

  if (
    error?.name === "JsonWebTokenError" ||
    error?.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    error?.code === "ERR_JWT_INVALID"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      code: "TOKEN_INVALID",
      message:
        "Invalid authentication token. Please logout and login again.",
    });
  }

  if (
    error?.code === "JWT_MISSING"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      code: "TOKEN_MISSING",
      message:
        "Authentication required. Please login first.",
    });
  }

  console.error(
    "❌ USER AUTH JWT ERROR:",
    error?.message || error
  );

  return res.status(401).json({
    success: false,
    authenticated: false,
    code: "AUTHENTICATION_FAILED",
    message:
      "Authentication failed. Please login again.",
  });
}


// ============================================================
// USER AUTH
// ============================================================

function userAuth(req, res, next) {
  // ----------------------------------------------------------
  // Never trust an existing req.user/req.owner value.
  // This middleware establishes the authenticated identity.
  // ----------------------------------------------------------

  delete req.user;
  delete req.owner;

  // ----------------------------------------------------------
  // AUTHORIZATION HEADER
  // ----------------------------------------------------------

  const authHeader =
    req.headers.authorization;

  const hasBearer =
    typeof authHeader === "string" &&
    authHeader.startsWith("Bearer ");

  // ==========================================================
  // JWT AUTHENTICATION
  // ==========================================================

  if (hasBearer) {
    const token =
      authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        code: "TOKEN_MISSING",
        message:
          "Authentication token is missing.",
      });
    }

    try {
      // ------------------------------------------------------
      // CENTRAL JWT VERIFICATION
      // ------------------------------------------------------
      //
      // This verifies:
      // - JWT_SECRET
      // - HS256
      // - issuer
      // - audience
      // - expiration
      // - signature
      // ------------------------------------------------------

      const decoded =
        verifyToken(token);

      if (
        !decoded ||
        typeof decoded !== "object"
      ) {
        return res.status(401).json({
          success: false,
          authenticated: false,
          code: "TOKEN_INVALID",
          message:
            "Invalid authentication token.",
        });
      }

      // ------------------------------------------------------
      // USER ID
      // ------------------------------------------------------

      const userId =
        decoded.id ||
        decoded._id ||
        decoded.userId ||
        null;

      if (!userId) {
        return res.status(401).json({
          success: false,
          authenticated: false,
          code: "TOKEN_ID_MISSING",
          message:
            "Authentication token does not contain a valid user identity.",
        });
      }

      // ------------------------------------------------------
      // ROLE
      // ------------------------------------------------------

      const role =
        cleanString(
          decoded.role || "student"
        ).toLowerCase();

      const isAdmin =
        role === "admin";

      const isOwner =
        role === "owner" ||
        isAdmin;

      // ------------------------------------------------------
      // AUTHENTICATED USER
      // ------------------------------------------------------

      req.user = {
        authenticated: true,

        userId: String(userId),

        id: String(userId),

        email:
          decoded.email || null,

        role,

        isOwner,

        isAdmin,

        tokenId:
          decoded.jti || null,
      };

      // ------------------------------------------------------
      // OWNER CONTEXT
      // ------------------------------------------------------
      //
      // Only a JWT whose database-backed role is owner/admin
      // receives owner context.
      //
      // Normal student users NEVER become owners here.
      // ------------------------------------------------------

      if (isOwner) {
        req.owner = {
          authenticated: true,

          method: "jwt",

          userId: String(userId),

          email:
            decoded.email || null,

          role,

          tokenId:
            decoded.jti || null,
        };
      }

      return next();

    } catch (error) {
      return sendJwtError(
        res,
        error
      );
    }
  }

  // ==========================================================
  // ADMIN KEY AUTHENTICATION
  // ==========================================================
  //
  // This is a separate owner/admin authentication method.
  //
  // It is NOT used for normal users.
  //
  // It exists for existing owner-control functionality that
  // already uses x-admin-key.
  // ==========================================================

  const adminKey =
    req.headers["x-admin-key"];

  if (adminKey) {
    const expectedKey =
      cleanString(
        process.env.ADMIN_KEY
      );

    // --------------------------------------------------------
    // ADMIN_KEY MUST EXIST SERVER-SIDE
    // --------------------------------------------------------

    if (!expectedKey) {
      console.error(
        "❌ USER AUTH: ADMIN_KEY is missing."
      );

      return res.status(403).json({
        success: false,
        authenticated: false,
        code: "ADMIN_AUTH_NOT_CONFIGURED",
        message:
          "Owner authentication is not configured.",
      });
    }

    // --------------------------------------------------------
    // VALIDATE ADMIN KEY
    // --------------------------------------------------------

    const valid =
      safeAdminKeyMatch(
        adminKey,
        expectedKey
      );

    if (!valid) {
      return res.status(403).json({
        success: false,
        authenticated: false,
        code: "ADMIN_KEY_INVALID",
        message:
          "Admin authentication failed.",
      });
    }

    // --------------------------------------------------------
    // ADMIN KEY OWNER CONTEXT
    // --------------------------------------------------------
    //
    // There is intentionally no fake user ID here.
    // Existing owner routes can identify this as admin-key
    // authentication using method === "admin_key".
    // --------------------------------------------------------

    req.owner = {
      authenticated: true,

      method: "admin_key",

      userId: null,

      email: null,

      role: "owner",

      tokenId: null,
    };

    // --------------------------------------------------------
    // Keep req.user available for routes that expect it.
    //
    // This does NOT pretend that we know a database user ID.
    // --------------------------------------------------------

    req.user = {
      authenticated: true,

      userId: null,

      id: null,

      email: null,

      role: "owner",

      isOwner: true,

      isAdmin: true,

      tokenId: null,

      authMethod: "admin_key",
    };

    return next();
  }

  // ==========================================================
  // NO AUTHENTICATION
  // ==========================================================

  return res.status(401).json({
    success: false,
    authenticated: false,
    code: "AUTHENTICATION_REQUIRED",
    message:
      "Authentication required. Please login first.",
  });
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  userAuth,
};