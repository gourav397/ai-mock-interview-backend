const mongoose = require("mongoose");


const attemptSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },


  category: {
    type: String,
    required: true
  },


  questions: [
    {
      question: String,
      answer: String
    }
  ],


  score: {
    type: Number,
    default: 0
  },


  totalQuestions: {
    type: Number,
    default: 0
  },


  createdAt: {
    type: Date,
    default: Date.now
  }

});


module.exports = mongoose.model("Attempt", attemptSchema);