const Question = require("../models/Question");
const connectDB = require("../config/db");


const seedQuestions = async()=>{


await connectDB();


const questions = [];


// Helper function

const addQuestion = (
exam,
category,
subject,
topic,
year,
question,
options,
correctAnswer,
explanation
)=>{


questions.push({

exam,
category,
subject,
topic,
year,

question,

options: options.map(o=>({

text:o.text,

isCorrect:o.text===correctAnswer,

explanation:o.explanation

})),

correctAnswer,

explanation,

difficulty:"Medium"

});


};



// =========================
// HSSC CET
// =========================


const haryana = [

["Haryana ka gathan kab hua?",
"1 November 1966"],

["Haryana ki rajdhani kya hai?",
"Chandigarh"],

["Haryana ka rajya pakshi kaunsa hai?",
"Black Francolin"],

["Kurukshetra kis liye prasiddh hai?",
"Mahabharata Yudh"],

["Haryana ka pehla mukhyamantri kaun tha?",
"Bhagwat Dayal Sharma"],

["Panipat kis liye famous hai?",
"Panipat Battles"],

["Surajkund Mela kahan hota hai?",
"Faridabad"],

["Haryana ka rajya pashu kaunsa hai?",
"Black Buck"],

["Hisar kis cheez ke liye famous hai?",
"Steel"],

["Chaudhary Charan Singh Haryana Agricultural University kahan hai?",
"Hisar"]

];


haryana.forEach((q,i)=>{


addQuestion(

"HSSC CET",
"Haryana GK",
"General Knowledge",
"Haryana Important Facts",
2024,

q[0],

[
{
text:q[1],
explanation:"Ye iska correct answer hai."
},

{
text:"Option B",
explanation:"Ye correct answer nahi hai."
},

{
text:"Option C",
explanation:"Ye correct answer nahi hai."
},

{
text:"Option D",
explanation:"Ye correct answer nahi hai."
}

],

q[1],

"Haryana GK ka important exam point."

);


});



// =========================
// SSC GK
// =========================


const ssc=[

["Bharat ko azadi kab mili?","15 August 1947"],

["Samvidhan kab lagu hua?","26 January 1950"],

["Bharat ke pehle rashtrapati kaun the?","Dr Rajendra Prasad"],

["National animal kya hai?","Tiger"],

["ISRO ka full form kya hai?","Indian Space Research Organisation"],

["Qutub Minar kahan hai?","Delhi"],

["Taj Mahal kahan hai?","Agra"],

["Red Fort kisne banwaya?",
"Shah Jahan"],

["Mahatma Gandhi ka janm kab hua?",
"2 October 1869"],

["Quit India Movement kab hua?",
"1942"]

];


ssc.forEach(q=>{


addQuestion(

"SSC",
"General Knowledge",
"Static GK",
"Important Facts",
2024,

q[0],

[
{
text:q[1],
explanation:"Ye correct information hai."
},

{
text:"Wrong Option 1",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 2",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 3",
explanation:"Ye answer nahi hai."
}

],

q[1],

"SSC exams me frequently asked question."

);


});



// =========================
// REASONING
// =========================


const reasoning = [

["Agar CAT ko DBU likha jata hai to DOG ko kaise likhenge?","EPH"],
["Series complete karo: 2,4,8,16,?","32"],
["5,10,15,20 ke baad kya aayega?","25"],
["Agar RAM ko SBN likha hai to BAT ko kaise likhenge?","CBU"],
["Clock me 3 baje kitna angle hota hai?","90 Degree"],
["Odd one out: Apple, Mango, Banana, Carrot","Carrot"],
["India ka north direction kis taraf hota hai?","Uttar"],
["1,3,5,7,?","9"],
["Monday ke baad kaunsa din hota hai?","Tuesday"],
["Father ke brother ko kya kehte hain?","Uncle"],
["A:B = 2:3 aur A=10 to B kya hoga?","15"],
["12 ka square kya hai?","144"],
["RAM kis type ki memory hai?","Primary Memory"],
["CPU ka full form kya hai?","Central Processing Unit"],
["Computer ka brain kise kehte hain?","CPU"]

];


reasoning.forEach(q=>{


addQuestion(

"SSC",
"Reasoning",
"Logical Reasoning",
"Important Questions",
2024,

q[0],

[
{
text:q[1],
explanation:"Ye correct answer hai."
},

{
text:"Wrong Option 1",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 2",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 3",
explanation:"Ye answer nahi hai."
}

],

q[1],

"Reasoning exam ke liye important question."

);

});



// =========================
// TECHNICAL
// =========================


const technical=[

["HTML ka full form kya hai?","Hyper Text Markup Language"],
["CSS ka full form kya hai?","Cascading Style Sheets"],
["JavaScript kaha run hoti hai?","Browser"],
["React kya hai?","JavaScript Library"],
["Node.js kya hai?","JavaScript Runtime"],
["MongoDB kis type ka database hai?","NoSQL Database"],
["API ka full form kya hai?","Application Programming Interface"],
["HTTP ka full form kya hai?","Hyper Text Transfer Protocol"],
["SQL kis liye use hota hai?","Database Management"],
["Git kya hai?","Version Control System"],
["Python kis type ki language hai?","Programming Language"],
["Frontend kis se related hai?","User Interface"],
["Backend ka kaam kya hota hai?","Server Logic"],
["JSON ka use kis liye hota hai?","Data Exchange"],
["Express.js kya hai?","Node.js Framework"]

];


technical.forEach(q=>{


addQuestion(

"Technical",
"Web Development",
"Programming",
"Important Concepts",
2025,

q[0],

[
{
text:q[1],
explanation:"Ye correct technical answer hai."
},

{
text:"Wrong Option 1",
explanation:"Ye correct nahi hai."
},

{
text:"Wrong Option 2",
explanation:"Ye correct nahi hai."
},

{
text:"Wrong Option 3",
explanation:"Ye correct nahi hai."
}

],

q[1],

"Technical interview ke liye important concept."

);

});

// =========================
// SCIENCE
// =========================


const science=[

["Human body ka sabse bada organ kaunsa hai?","Skin"],
["Pani ka chemical formula kya hai?","H2O"],
["Surya ek kya hai?","Star"],
["Plants food kaise banate hain?","Photosynthesis"],
["Blood ka red colour kis wajah se hota hai?","Hemoglobin"],
["Earth ka satellite kaunsa hai?","Moon"],
["Force ki SI unit kya hai?","Newton"],
["Light ki speed sabse zyada kaha hoti hai?","Vacuum"],
["Vitamin C ka source kya hai?","Citrus Fruits"],
["Computer ka inventor kise kaha jata hai?","Charles Babbage"]

];


science.forEach(q=>{


addQuestion(

"SSC",
"Science",
"General Science",
"Important Science Questions",
2024,

q[0],

[
{
text:q[1],
explanation:"Ye correct answer hai."
},

{
text:"Wrong Option 1",
explanation:"Ye correct answer nahi hai."
},

{
text:"Wrong Option 2",
explanation:"Ye correct answer nahi hai."
},

{
text:"Wrong Option 3",
explanation:"Ye correct answer nahi hai."
}

],

q[1],

"Science exams me frequently asked question."

);

});





// =========================
// BANKING
// =========================


const banking=[

["RBI ka full form kya hai?","Reserve Bank of India"],
["SBI ka full form kya hai?","State Bank of India"],
["India ka central bank kaunsa hai?","RBI"],
["ATM ka full form kya hai?","Automated Teller Machine"],
["IFSC ka full form kya hai?","Indian Financial System Code"],
["UPI ka full form kya hai?","Unified Payments Interface"],
["Bank me paisa jama karne ko kya kehte hain?","Deposit"],
["Loan dene wali institution kya hoti hai?","Bank"],
["Cheque kis se related hai?","Banking Transaction"],
["NEFT ka full form kya hai?","National Electronic Funds Transfer"]

];


banking.forEach(q=>{


addQuestion(

"Banking",
"Bank Exam",
"Finance",
"Important Banking Questions",
2024,

q[0],

[
{
text:q[1],
explanation:"Ye correct banking answer hai."
},

{
text:"Wrong Option 1",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 2",
explanation:"Ye answer nahi hai."
},

{
text:"Wrong Option 3",
explanation:"Ye answer nahi hai."
}

],

q[1],

"Bank exams ke liye important question."

);

});


await Question.deleteMany();


await Question.insertMany(questions);


console.log(
`✅ ${questions.length} Questions Added`
);


process.exit();


};


seedQuestions();