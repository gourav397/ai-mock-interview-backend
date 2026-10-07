"use strict";

const jwt = require("jsonwebtoken");

const JWT_ISSUER = "ai-interview-backend";
const JWT_AUDIENCE = "ai-interview-app";

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    throw new Error(
      "JWT_SECRET is missing. Configure the same JWT_SECRET in the backend environment."
    );
  }

  return secret;
}

function signToken(payload = {}, options = {}) {
  const secret = getJwtSecret();

  return jwt.sign(
    {
      ...payload,
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn: options.expiresIn || "7d",
      issuer: options.issuer || JWT_ISSUER,
      audience: options.audience || JWT_AUDIENCE,
    }
  );
}

function verifyToken(token) {
  const cleanToken = String(token || "").trim();

  if (!cleanToken) {
    const error = new Error("JWT token is missing.");
    error.code = "JWT_MISSING";
    throw error;
  }

  return jwt.verify(cleanToken, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function decodeToken(token) {
  const cleanToken = String(token || "").trim();

  if (!cleanToken) return null;

  return jwt.decode(cleanToken);
}

module.exports = {
  JWT_ISSUER,
  JWT_AUDIENCE,
  getJwtSecret,
  signToken,
  verifyToken,
  decodeToken,
};