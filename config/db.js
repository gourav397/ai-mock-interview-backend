// ============================================================
// Database Connection — Mongoose 9 compatible
// FIXED: Fast connection timeout + clear diagnostics
// ============================================================

const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

// Prevent queries from waiting indefinitely when MongoDB
// is unavailable.
mongoose.set("bufferCommands", false);

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGO_URI not defined in environment");
    }

    console.log("🔌 MongoDB: attempting connection...");

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
      minPoolSize: 0,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    return conn;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);

    if (error?.reason) {
      console.error(
        "❌ MongoDB connection reason:",
        error.reason.message || error.reason
      );
    }

    throw error;
  }
};

module.exports = connectDB;