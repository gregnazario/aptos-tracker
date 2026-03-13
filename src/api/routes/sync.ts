import { Router } from 'express';
import { getSyncCursor, listTrackedAddresses } from '../../db/queries.js';
import { syncAddress, syncAll } from '../../ingestion/sync.js';

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
    const { address, autoExpand } = req.body || {};

    // Return immediately, sync runs in background
    res.json({ ok: true, message: 'Sync started' });

    try {
      if (address) {
        lastSyncResults = [await syncAddress(address, { autoExpand })];
      } else {
        lastSyncResults = await syncAll({ autoExpand });
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
