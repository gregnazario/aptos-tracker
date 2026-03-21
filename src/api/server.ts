import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { addressRoutes } from './routes/addresses.js';
import { graphRoutes } from './routes/graph.js';
import { labelRoutes } from './routes/labels.js';
import { syncRoutes } from './routes/sync.js';
import { taxRoutes } from './routes/tax.js';
import { transferRoutes } from './routes/transfers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(): express.Express {
  const app = express();

  app.use(express.json());

  // Serve static files
  app.use(express.static(resolve(__dirname, '../../public')));

  // API routes
  app.use('/api/addresses', addressRoutes());
  app.use('/api/transfers', transferRoutes());
  app.use('/api/labels', labelRoutes());
  app.use('/api/graph', graphRoutes());
  app.use('/api/sync', syncRoutes());
  app.use('/api/tax', taxRoutes());

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, '../../public/index.html'));
  });

  return app;
}
