import { config } from '../config.js';
import * as queries from '../db/queries.js';
import type { IngestionDeps } from './interface.js';

/**
 * Build IngestionDeps backed by SQLite (server-side / CLI).
 * Wraps synchronous better-sqlite3 calls in Promise.resolve() to satisfy
 * the async IngestionDeps interface.
 */
export function buildServerDeps(
  onProgress?: (msg: string) => void,
): IngestionDeps {
  return {
    config,
    insertTransfers: (t) => {
      queries.insertTransfersBatch(t as any);
      return Promise.resolve();
    },
    insertRawActivities: (a) => {
      queries.insertRawActivitiesBatch(a);
      return Promise.resolve();
    },
    getSyncCursor: (addr) => Promise.resolve(queries.getSyncCursor(addr)),
    updateSyncCursor: (addr, v) => {
      queries.updateSyncCursor(addr, v);
      return Promise.resolve();
    },
    setSyncStatus: (addr, s) => {
      queries.setSyncStatus(addr, s);
      return Promise.resolve();
    },
    listTrackedAddresses: () => Promise.resolve(queries.listTrackedAddresses()),
    addTrackedAddress: (addr, alias) => {
      queries.addTrackedAddress(addr, alias);
      return Promise.resolve();
    },
    getLabel: (addr) => Promise.resolve(queries.getLabel(addr)),
    upsertLabel: (addr, label) => {
      queries.upsertLabel(addr, label);
      return Promise.resolve();
    },
    getAssetMeta: (at) => Promise.resolve(queries.getAssetMeta(at)),
    onProgress: onProgress ?? ((msg) => process.stdout.write(msg)),
  };
}
