const express = require('express');
const multer = require('multer');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      cb(new Error('Unsupported file type. Please upload JPG, PNG, or PDF.'));
      return;
    }
    cb(null, true);
  }
}).single('file');

function createOcrRouter({ extractTextFromFile }) {
  const router = express.Router();

  router.post('/extract', (req, res) => {
    upload(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'File is too large. Maximum size is 5MB.' });
          return;
        }

        res.status(400).json({ error: err.message || 'Invalid file upload.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Please upload a file before extracting text.' });
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        res.status(500).json({ error: 'Server OCR configuration is missing. Please set OPENAI_API_KEY.' });
        return;
      }

      try {
        const result = await extractTextFromFile(req.file);
        res.json(result);
      } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Could not extract text right now. Please try again.' });
      }
    });
  });

  return router;
}

module.exports = { createOcrRouter, MAX_FILE_SIZE, ALLOWED_TYPES };
