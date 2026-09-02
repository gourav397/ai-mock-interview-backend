// ============================================================
// Database Connection — Mongoose 9 compatible
// FIXED: Removed deprecated useNewUrlParser, useUnifiedTopology, strictQuery
// ============================================================

const mongoose = require("mongoose");

// Mongoose 9 defaults: strictQuery=false, no deprecated options needed
// Set strictQuery to true for safety
mongoose.set("strictQuery", true);

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGO_URI not defined in environment");
    }

    const conn = await mongoose.connect(uri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    // Don't crash the server — let it run without DB
    throw error;
  }
};

module.exports = connectDB;