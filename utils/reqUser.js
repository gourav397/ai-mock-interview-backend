const jwt = require("jsonwebtoken");

// Agar kisi middleware ne req.user set kiya hai → wahi use karo
// Nahi to "Authorization: Bearer <token>" header se khud parse karo
function getUser(req) {
  if (req.user && (req.user._id || req.user.id)) return req.user;

  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;

  try {
    const decoded = jwt.verify(h.slice(7), process.env.JWT_SECRET || "secret");
    const id = decoded.id || decoded._id || decoded.userId;
    return id ? { _id: id } : null;
  } catch {
    return null;
  }
}

module.exports = { getUser };