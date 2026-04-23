import app from './app.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen(PORT, () => {
  console.log(`DMS Backend running on http://localhost:${PORT}`);
  console.log(`API:     http://localhost:${PORT}/api`);
  console.log(`Health:  http://localhost:${PORT}/api/health`);
});
