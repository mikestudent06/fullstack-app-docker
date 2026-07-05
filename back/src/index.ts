import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();

async function start(): Promise<void> {
  await initDb();

  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
