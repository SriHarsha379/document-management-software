const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { createOcrRouter } = require('../routes/ocr');
const { extractTextFromFile } = require('../services/ocrService');

dotenv.config();

function createApp(options = {}) {
  const app = express();
  const ocrExtractor = options.extractTextFromFile || extractTextFromFile;

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api/ocr', createOcrRouter({ extractTextFromFile: ocrExtractor }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

module.exports = { createApp };
