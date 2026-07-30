const fs = require("fs");
const Question = require("../models/Question");

const bulkUploader = async (filePath) => {

    try {

        const rawData = fs.readFileSync(filePath, "utf8");

        const questions = JSON.parse(rawData);

        let added = 0;
        let skipped = 0;

        for (const q of questions) {

            const exists = await Question.findOne({
                question: q.question,
                category: q.category
            });

            if (exists) {
                skipped++;
                continue;
            }

            await Question.create(q);
            added++;
        }

        console.log("================================");
        console.log("Upload Completed");
        console.log("Added :", added);
        console.log("Skipped :", skipped);
        console.log("Total :", questions.length);
        console.log("================================");

    } catch (err) {

        console.log(err);

    }

};

module.exports = bulkUploader;