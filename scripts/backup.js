require("dotenv").config();
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const MONGO_URI = process.env.MONGO_URI;
const BACKUP_DIR = path.join(__dirname, "..", "backups");

if (!MONGO_URI) {
  console.log("MONGO_URI missing in .env");
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(BACKUP_DIR, stamp);

exec(`mongodump --uri "${MONGO_URI}" --out "${out}"`, (err, stdout, stderr) => {
  if (err) {
    console.log("Backup fail:", stderr || err.message);
    process.exit(1);
  }
  console.log("✅ Backup done:", out);

  // 7 din se purane backups delete
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  fs.readdirSync(BACKUP_DIR).forEach((f) => {
    const p = path.join(BACKUP_DIR, f);
    try {
      if (fs.statSync(p).isDirectory() && fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log("🗑️ Purana backup hata diya:", f);
      }
    } catch {}
  });
  process.exit(0);
});