const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const path = require("path");

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || ""; // scanned PDF me undefined na aaye
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || ""; // kuch cases me undefined ho sakta hai
  }

  if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf8");
  }

  throw new Error("Unsupported File Type");
}

module.exports = extractText;