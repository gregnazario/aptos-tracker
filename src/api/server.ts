import express from 'express';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { addressRoutes } from './routes/addresses.js';
import { transferRoutes } from './routes/transfers.js';
import { labelRoutes } from './routes/labels.js';
import { graphRoutes } from './routes/graph.js';
import { syncRoutes } from './routes/sync.js';

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

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, '../../public/index.html'));
  });

  return app;
}
