import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { createGeminiProvider } from './ai/gemini.js';
import { clientDist, createApp } from './app.js';
import { connectDatabase, databaseStatus, disconnectDatabase } from './config/database.js';
import { readEnv } from './config/env.js';
import { createMongoRepository } from './ledger/repository.js';

async function start() {
  try {
    loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { HOST, PORT, MONGODB_URI, PUBLIC_DEMO, PUBLIC_ORIGIN, GEMINI_API_KEY, GEMINI_MODEL } = readEnv(process.env);
  const production = process.env.NODE_ENV === 'production';
  if (production) {
    const index = await stat(join(clientDist, 'index.html')).catch(() => null);
    if (!index?.isFile() || index.size === 0) {
      console.error('Production frontend is missing. Run npm run build before npm start.');
      process.exitCode = 1;
      return;
    }
  }
  const uri = PUBLIC_DEMO ? '' : MONGODB_URI;
  const mode = PUBLIC_DEMO ? 'public-demo' : uri ? 'database' : 'demo';
  if (uri) {
    try {
      await connectDatabase(uri);
    } catch {
      console.error('Database unavailable. Ledger requests will return HTTP 503. Restart after restoring the connection.');
    }
  }

  const app = createApp({
    mode, publicOrigin: PUBLIC_ORIGIN,
    repository: uri ? createMongoRepository() : undefined,
    getDatabaseStatus: () => databaseStatus(uri),
    aiProvider: PUBLIC_DEMO ? null : createGeminiProvider({ apiKey: GEMINI_API_KEY, model: GEMINI_MODEL }),
  });
  const server = createServer(production
    ? { requestTimeout: 30_000, headersTimeout: 15_000, connectionsCheckingInterval: 5_000 }
    : {}, app);
  server.once('error', () => {
    console.error('API could not listen on the configured host and port.');
    process.exitCode = 1;
    void disconnectDatabase();
  });
  server.listen(PORT, HOST, () => {
    console.log('CashRescue API listening on %s:%d (%s mode, database %s).', HOST, PORT, mode, databaseStatus(uri));
  });

  const shutdown = () => {
    server.close(() => void disconnectDatabase());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

try {
  await start();
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Invalid server configuration fields: %s.', error.issues.map(({ path }) => path.join('.')).join(', '));
  } else {
    console.error('Server startup failed.');
  }
  process.exitCode = 1;
}
