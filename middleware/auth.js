const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({
        message: "No token provided"
      });
    }

    const actualToken = token.split(" ")[1];

    const decoded = jwt.verify(
      actualToken,
      "secretkey"
    );

    req.user = decoded;

    next();

  } catch (error) {
    res.status(401).json({
      message: "Invalid token"
    });
  }
};

module.exports = auth;