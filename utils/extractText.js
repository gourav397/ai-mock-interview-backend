const fs = require("fs");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const path = require("path");

async function extractText(filePath) {

    const ext =
        path.extname(filePath).toLowerCase();

    if (ext === ".pdf") {

        const data =
            await pdf(
                fs.readFileSync(filePath)
            );

        return data.text;

    }

    if (ext === ".docx") {

        const result =
            await mammoth.extractRawText({

                path: filePath

            });

        return result.value;

    }

    if (ext === ".txt") {

        return fs.readFileSync(
            filePath,
            "utf8"
        );

    }

    throw new Error("Unsupported File");

}

module.exports = extractText;