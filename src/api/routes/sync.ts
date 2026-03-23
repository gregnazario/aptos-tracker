import { Router } from 'express';
import { getSyncCursor, listTrackedAddresses } from '../../db/queries.js';
import { syncAddress, syncAll } from '../../ingestion/sync.js';
import { buildServerDeps } from '../../storage/server-deps.js';

let syncInProgress = false;
let lastSyncResults: any = null;

export function syncRoutes(): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    if (syncInProgress) {
      res.status(409).json({ error: 'Sync already in progress' });
      return;
    }

    syncInProgress = true;
    const { address, autoExpand, from, to } = req.body || {};

    // Return immediately, sync runs in background
    res.json({ ok: true, message: 'Sync started' });

    const deps = buildServerDeps();
    try {
      if (address) {
        lastSyncResults = [await syncAddress(address, deps, { autoExpand, from, to })];
      } else {
        lastSyncResults = await syncAll(deps, { autoExpand, from, to });
      }
    } catch (err: any) {
      lastSyncResults = { error: err.message };
    } finally {
      syncInProgress = false;
    }
  });

  router.get('/status', (_req, res) => {
    const addresses = listTrackedAddresses();
    const cursors = addresses.map((a) => ({
      address: a.address,
      alias: a.alias,
      ...getSyncCursor(a.address),
    }));

    res.json({
      syncing: syncInProgress,
      cursors,
      lastResults: lastSyncResults,
    });
  });

  return router;
}
