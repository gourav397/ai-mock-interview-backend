const Interview = require("../models/Interview");
const connectDB = require("../config/db");


const addQuestions = async () => {

  await connectDB();


  const data = [

    {
      category: "Haryana GK",
      difficulty: "Medium",
      questions: [

        {
          question: "Haryana ka gathan kab hua tha?",
          options: [
            {
              text: "1960",
              info: "1960 me Haryana ka gathan nahi hua tha."
            },
            {
              text: "1966",
              info: "1 November 1966 ko Haryana Punjab se alag hokar bana."
            },
            {
              text: "1970",
              info: "1970 me Haryana pehle se ek rajya tha."
            },
            {
              text: "1975",
              info: "1975 Emergency ka samay tha."
            }
          ],
          correctAnswer: "1966"
        },


        {
          question: "Haryana ki rajdhani kya hai?",
          options: [
            {
              text: "Chandigarh",
              info: "Chandigarh Haryana aur Punjab ki shared capital hai."
            },
            {
              text: "Gurugram",
              info: "Gurugram Haryana ka IT hub hai."
            },
            {
              text: "Hisar",
              info: "Hisar educational city hai."
            },
            {
              text: "Panipat",
              info: "Panipat historical city hai."
            }
          ],
          correctAnswer: "Chandigarh"
        }

      ]
    },


    {
      category: "Reasoning",
      difficulty: "Medium",
      questions: [

        {
          question: "Series complete karo: 2,4,8,16,?",
          options:[
            {
              text:"24",
              info:"Wrong, pattern double ho raha hai."
            },
            {
              text:"32",
              info:"Har number double ho raha hai."
            },
            {
              text:"30",
              info:"Ye series pattern follow nahi karta."
            },
            {
              text:"40",
              info:"Wrong option."
            }
          ],
          correctAnswer:"32"
        }

      ]
    },


    {
      category: "General Knowledge",
      difficulty: "Easy",
      questions:[

        {
          question:"Bharat ka samvidhan kab lagu hua?",
          options:[
            {
              text:"26 January 1950",
              info:"Bharat ka Constitution isi din lagu hua."
            },
            {
              text:"15 August 1947",
              info:"Is din Bharat independent hua tha."
            },
            {
              text:"26 November 1949",
              info:"Is din Constitution adopt hua tha."
            },
            {
              text:"2 October 1950",
              info:"Ye Gandhi Jayanti hai."
            }
          ],
          correctAnswer:"26 January 1950"
        }

      ]
    },


    {
      category:"Technical",
      difficulty:"Medium",
      questions:[

        {
          question:"React kya hai?",
          options:[
            {
              text:"JavaScript Library",
              info:"React ek JavaScript library hai UI banane ke liye."
            },
            {
              text:"Database",
              info:"React database nahi hai."
            },
            {
              text:"Operating System",
              info:"React OS nahi hai."
            },
            {
              text:"Programming Language",
              info:"React language nahi hai."
            }
          ],
          correctAnswer:"JavaScript Library"
        }

      ]
    },


    {
      category:"HR Interview",
      difficulty:"Easy",
      questions:[

        {
          question:"Apne bare me bataye ka best answer kya hai?",
          options:[
            {
              text:"Short professional introduction",
              info:"Interview me education, skills aur goals batane chahiye."
            },
            {
              text:"Personal problems",
              info:"Ye professional answer nahi hai."
            },
            {
              text:"Sirf naam",
              info:"Answer incomplete hai."
            },
            {
              text:"Kuch nahi",
              info:"Interview me proper response dena chahiye."
            }
          ],
          correctAnswer:"Short professional introduction"
        }

      ]
    }

  ];


  await Interview.deleteMany();


  await Interview.insertMany(data);


  console.log("✅ All MCQ Categories Added");


  process.exit();

};


addQuestions();