"use strict";

const {
  verifyToken,
} = require("../config/jwt");

// ============================================================
// OWNER AUTH MIDDLEWARE
// ============================================================
//
// यह middleware केवल privileged owner/admin routes के लिए है.
//
// Allowed:
//   1. JWT role = owner
//   2. JWT role = admin
//   3. valid x-admin-key
//
// Normal student/user JWT:
//   -> हमेशा 403
//
// IMPORTANT:
// JWT verification central config से होगी.
// Security middleware को userAuth में downgrade नहीं करना.
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
    if (
      a.charCodeAt(i) !==
      b.charCodeAt(i)
    ) {
      valid = false;
    }
  }

  return valid;
}


// ============================================================
// JWT ERROR HANDLER
// ============================================================

function sendJwtError(res, error) {
  // ----------------------------------------------------------
  // EXPIRED TOKEN
  // ----------------------------------------------------------

  if (
    error?.name === "TokenExpiredError" ||
    error?.code === "ERR_JWT_EXPIRED"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      authorized: false,
      code: "TOKEN_EXPIRED",
      message:
        "Owner login session expired. Please login again.",
    });
  }

  // ----------------------------------------------------------
  // INVALID SIGNATURE / INVALID JWT
  // ----------------------------------------------------------

  if (
    error?.name === "JsonWebTokenError" ||
    error?.code ===
      "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    error?.code === "ERR_JWT_INVALID"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      authorized: false,
      code: "TOKEN_INVALID",
      message:
        "Invalid authentication token. Please logout and login again.",
    });
  }

  // ----------------------------------------------------------
  // MISSING TOKEN
  // ----------------------------------------------------------

  if (
    error?.code === "JWT_MISSING"
  ) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      authorized: false,
      code: "TOKEN_MISSING",
      message:
        "Authentication token is required.",
    });
  }

  // ----------------------------------------------------------
  // UNKNOWN AUTH ERROR
  // ----------------------------------------------------------

  console.error(
    "❌ OWNER AUTH JWT ERROR:",
    error?.message || error
  );

  return res.status(401).json({
    success: false,
    authenticated: false,
    authorized: false,
    code: "AUTHENTICATION_FAILED",
    message:
      "Owner authentication failed. Please login again.",
  });
}


// ============================================================
// OWNER AUTH
// ============================================================

function ownerAuth(req, res, next) {
  // ----------------------------------------------------------
  // Never trust values inserted by previous middleware.
  // This middleware establishes privileged context itself.
  // ----------------------------------------------------------

  delete req.owner;

  if (req.user) {
    delete req.user.isOwner;
    delete req.user.isAdmin;
  }

  // ==========================================================
  // BEARER JWT
  // ==========================================================

  const authHeader =
    req.headers.authorization;

  const hasBearer =
    typeof authHeader === "string" &&
    authHeader.startsWith("Bearer ");

  if (hasBearer) {
    const token =
      authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        authorized: false,
        code: "TOKEN_MISSING",
        message:
          "Authentication token is missing.",
      });
    }

    try {
      // ------------------------------------------------------
      // CENTRAL JWT VERIFICATION
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
          authorized: false,
          code: "TOKEN_INVALID",
          message:
            "Invalid authentication token.",
        });
      }

      // ------------------------------------------------------
      // IDENTITY
      // ------------------------------------------------------

      const userId =
        decoded.id ||
        decoded._id ||
        decoded.userId ||
        null;

      // ------------------------------------------------------
      // ROLE
      // ------------------------------------------------------

      const role =
        cleanString(
          decoded.role
        ).toLowerCase();

      // ------------------------------------------------------
      // AUTHENTICATED BUT NOT OWNER
      // ------------------------------------------------------

      if (
        role !== "owner" &&
        role !== "admin"
      ) {
        return res.status(403).json({
          success: false,
          authenticated: true,
          authorized: false,
          code: "OWNER_ACCESS_REQUIRED",
          message:
            "Owner/admin authorization is required for this action.",
        });
      }

      // ------------------------------------------------------
      // OWNER/ADMIN ID REQUIRED
      // ------------------------------------------------------

      if (!userId) {
        return res.status(401).json({
          success: false,
          authenticated: false,
          authorized: false,
          code: "TOKEN_ID_MISSING",
          message:
            "Authentication token does not contain a valid owner identity.",
        });
      }

      // ------------------------------------------------------
      // OWNER CONTEXT
      // ------------------------------------------------------

      req.owner = {
        authenticated: true,

        authorized: true,

        method: "jwt",

        userId: String(userId),

        email:
          decoded.email || null,

        role,

        tokenId:
          decoded.jti || null,
      };

      // ------------------------------------------------------
      // USER CONTEXT
      // ------------------------------------------------------

      req.user = {
        authenticated: true,

        userId: String(userId),

        id: String(userId),

        email:
          decoded.email || null,

        role,

        isOwner:
          role === "owner" ||
          role === "admin",

        isAdmin:
          role === "admin",

        tokenId:
          decoded.jti || null,
      };

      return next();

    } catch (error) {
      return sendJwtError(
        res,
        error
      );
    }
  }

  // ==========================================================
  // ADMIN KEY
  // ==========================================================
  //
  // Existing owner-control functionality can still authenticate
  // using x-admin-key.
  //
  // This does NOT create a fake database user ID.
  // ==========================================================

  const adminKey =
    req.headers["x-admin-key"];

  if (adminKey) {
    const expectedKey =
      cleanString(
        process.env.ADMIN_KEY
      );

    // --------------------------------------------------------
    // SERVER ADMIN KEY NOT CONFIGURED
    // --------------------------------------------------------

    if (!expectedKey) {
      console.error(
        "❌ OWNER AUTH: ADMIN_KEY is missing."
      );

      return res.status(403).json({
        success: false,
        authenticated: false,
        authorized: false,
        code: "ADMIN_AUTH_NOT_CONFIGURED",
        message:
          "Owner authentication is not configured.",
      });
    }

    // --------------------------------------------------------
    // COMPARE
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
        authorized: false,
        code: "ADMIN_KEY_INVALID",
        message:
          "Admin authentication failed.",
      });
    }

    // --------------------------------------------------------
    // ADMIN KEY OWNER CONTEXT
    // --------------------------------------------------------

    req.owner = {
      authenticated: true,

      authorized: true,

      method: "admin_key",

      userId: null,

      email: null,

      role: "owner",

      tokenId: null,
    };

    // --------------------------------------------------------
    // COMPATIBILITY USER CONTEXT
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
    authorized: false,
    code: "AUTHENTICATION_REQUIRED",
    message:
      "Owner authentication required.",
  });
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  ownerAuth,
};