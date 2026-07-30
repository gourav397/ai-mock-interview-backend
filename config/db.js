const mongoose = require("mongoose");

const connectDB = async () => {
  console.log("🔄 Connecting MongoDB...");

  try {
    await mongoose.connect(
      "mongodb+srv://gouravjangra782_db_user:Gourav99402@gourav.96j7fco.mongodb.net/ai-mock-interview"
    );

    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.log("❌ MongoDB Connection Error:", error.message);
  }
};

module.exports = connectDB;