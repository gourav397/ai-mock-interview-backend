const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractResumeText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text || "";
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  }
  if (ext === ".txt") return fs.readFileSync(filePath, "utf8");
  throw new Error("Sirf PDF/DOCX/TXT supported hai");
}

module.exports = { extractResumeText };