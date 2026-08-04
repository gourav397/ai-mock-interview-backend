const express = require("express");
const multer = require("multer");
const path = require("path");
const extractText = require("../utils/extractText");

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage
});

router.post(
    "/resume",
    upload.single("resume"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "No file uploaded"
                });

            }

            const extractedText =
                await extractText(req.file.path);

            res.json({

                success: true,

                filename: req.file.filename,

                extractedText

            });

        }
        catch (err) {

            console.log(err);

            res.status(500).json({

                success: false,

                message: err.message

            });

        }

    }
);

module.exports = router;