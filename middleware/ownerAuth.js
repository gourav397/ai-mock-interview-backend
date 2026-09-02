// ============================================================
// OWNER AUTHENTICATION MIDDLEWARE — FIXED
// Uses the ACTUAL JWT secret from routes/auth.js ("secretkey")
// Server-side owner verification only.
// ============================================================

const jwt = require("jsonwebtoken");

/**
 * Owner Authentication Middleware
 *
 * Verifies server-side:
 * 1. JWT cryptographically valid (signed by the actual auth system's secret)
 * 2. User has "admin" or "owner" role
 *
 * Also supports ADMIN_KEY for API/phone access with constant-time comparison.
 *
 * The JWT_SECRET here must match routes/auth.js which uses "secretkey"
 * as the hardcoded signing key. An env var override is supported.
 */
function ownerAuth(req, res, next) {
  // Clear any client-supplied identity
  delete req.owner;
  if (req.user) delete req.user.isOwner;

  // -------------------------------------------------------
  // STRATEGY 1: JWT Bearer Token
  // -------------------------------------------------------
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    try {
      // CRITICAL: Must match the JWT secret used by routes/auth.js
      // routes/auth.js hardcodes: const JWT_SECRET = "secretkey";
      // Allow override via env for production, but default to "secretkey"
      const jwtSecret = process.env.JWT_SECRET || "secretkey";

      const decoded = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
      });

      // Role must come from server-decoded token
      const role = (decoded.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner") {
        console.warn(
          `⚠️ OWNER AUTH REJECTED: User ${decoded.id || "unknown"} attempted owner access with role="${decoded.role}"`
        );
        return res.status(403).json({ success: false, message: "Access denied." });
      }

      req.owner = {
        authenticated: true,
        method: "jwt",
        userId: decoded.id || decoded._id || null,
        email: decoded.email || null,
        role: decoded.role,
        tokenId: decoded.jti || null,
      };

      return next();
    } catch (err) {
      // Never reveal which check failed
      return res.status(403).json({ success: false, message: "Access denied." });
    }
  }

  // -------------------------------------------------------
  // STRATEGY 2: ADMIN_KEY (phone/API access)
  // Constant-time comparison
  // -------------------------------------------------------
  const adminKey = req.headers["x-admin-key"];
  if (adminKey) {
    const expectedKey = process.env.ADMIN_KEY;
    if (!expectedKey) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Constant-time length + character comparison
    if (adminKey.length !== expectedKey.length) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    let valid = true;
    for (let i = 0; i < adminKey.length; i++) {
      if (adminKey[i] !== expectedKey[i]) { valid = false; }
    }

    if (!valid) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    req.owner = {
      authenticated: true,
      method: "admin_key",
      userId: null,
      email: null,
      role: "owner",
      tokenId: null,
    };

    return next();
  }

  // No authentication provided
  return res.status(403).json({ success: false, message: "Access denied." });
}

module.exports = { ownerAuth };