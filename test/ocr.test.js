const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

const tinyPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9iG9UAAAAASUVORK5CYII=',
  'base64'
);

test('POST /api/ocr/extract returns 400 when file is missing', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const app = createApp({ extractTextFromFile: async () => ({ text: 'x', metadata: {} }) });

  const response = await request(app).post('/api/ocr/extract');

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Please upload a file before extracting text.');
});

test('POST /api/ocr/extract rejects unsupported file type', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const app = createApp({ extractTextFromFile: async () => ({ text: 'x', metadata: {} }) });

  const response = await request(app)
    .post('/api/ocr/extract')
    .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Unsupported file type/i);
});

test('POST /api/ocr/extract rejects files larger than 5MB', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const app = createApp({ extractTextFromFile: async () => ({ text: 'x', metadata: {} }) });

  const largeBuffer = Buffer.alloc((5 * 1024 * 1024) + 1, 0x1);
  const response = await request(app)
    .post('/api/ocr/extract')
    .attach('file', largeBuffer, { filename: 'large.jpg', contentType: 'image/jpeg' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'File is too large. Maximum size is 5MB.');
});

test('POST /api/ocr/extract returns extracted text + metadata', async () => {
  process.env.OPENAI_API_KEY = 'test-key';

  const app = createApp({
    extractTextFromFile: async (file) => ({
      text: 'Invoice #42',
      metadata: {
        timestamp: '2026-01-01T00:00:00.000Z',
        fileName: file.originalname,
        contentType: file.mimetype
      }
    })
  });

  const response = await request(app)
    .post('/api/ocr/extract')
    .attach('file', tinyPngBuffer, { filename: 'scan.png', contentType: 'image/png' });

  assert.equal(response.status, 200);
  assert.equal(response.body.text, 'Invoice #42');
  assert.equal(response.body.metadata.fileName, 'scan.png');
  assert.equal(response.body.metadata.contentType, 'image/png');
});

test('POST /api/ocr/extract returns 500 if OPENAI_API_KEY is missing', async () => {
  delete process.env.OPENAI_API_KEY;
  const app = createApp({ extractTextFromFile: async () => ({ text: 'x', metadata: {} }) });

  const response = await request(app)
    .post('/api/ocr/extract')
    .attach('file', tinyPngBuffer, { filename: 'scan.png', contentType: 'image/png' });

  assert.equal(response.status, 500);
  assert.match(response.body.error, /OPENAI_API_KEY/i);
});
