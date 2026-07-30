const mongoose = require("mongoose");


const optionSchema = new mongoose.Schema({

  text: {
    type: String,
    required: true
  },

  info: {
    type: String,
    required: true
  }

});



const questionSchema = new mongoose.Schema({

  question: {
    type: String,
    required: true
  },


  options: [
    optionSchema
  ],


  correctAnswer: {
    type: String,
    required: true
  }

});



const interviewSchema = new mongoose.Schema({

  category: {

    type: String,
    required: true

  },


  difficulty: {

    type: String,
    default: "Medium"

  },


  questions: [

    questionSchema

  ]

});


module.exports = mongoose.model("Interview", interviewSchema);