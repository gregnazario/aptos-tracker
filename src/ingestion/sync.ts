import type { AssetMeta, IngestionDeps } from '../storage/interface.js';
import { checkBoundaries } from './boundary.js';
import { resetChunkSize, type TimeRange } from './client.js';
import { correlateActivities } from './correlator.js';
import { fetchAllActivities } from './fetcher.js';

export interface SyncOptions {
  autoExpand?: boolean;
  full?: boolean;
  from?: string; // ISO timestamp – only fetch activities on or after this time
  to?: string;   // ISO timestamp – only fetch activities on or before this time
}

export interface SyncResult {
  address: string;
  activitiesFetched: number;
  transfersFound: number;
  boundariesHit: string[];
  newAddressesDiscovered: string[];
}

/**
 * Sync a single address: fetch new activities, correlate into transfers, check boundaries.
 * When from/to are provided, only fetches activities within that time window.
 */
export async function syncAddress(
  address: string,
  deps: IngestionDeps,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const cursor = await deps.getSyncCursor(address);
  const afterVersion = options.full ? 0 : cursor.last_version;

  await deps.setSyncStatus(address, 'syncing');
  deps.onProgress?.(`  Syncing ${address.slice(0, 10)}... from version ${afterVersion}\n`);

  try {
    // Build time range filter (if provided)
    const timeRange: TimeRange | undefined =
      options.from || options.to
        ? { from: options.from, to: options.to }
        : undefined;

    // Fetch all activities with full transaction context + entry functions
    const { activities, entryFunctions } = await fetchAllActivities(
      address,
      afterVersion,
      deps.config,
      (count) => {
        deps.onProgress?.(`\r  Fetched ${count} activities...`);
      },
      timeRange,
    );

    if (activities.length > 0) {
      deps.onProgress?.(`\n  Got ${activities.length} context activities, ${entryFunctions.size} entry functions\n`);
    } else {
      deps.onProgress?.('  No new activities\n');
    }

    // Store raw activities
    await deps.insertRawActivities(activities);

    // Pre-fetch asset metadata for sync correlateActivities call
    const assetTypes = new Set(activities.map(a => a.asset_type));
    const metaMap = new Map<string, AssetMeta>();
    for (const at of assetTypes) {
      const m = await deps.getAssetMeta(at);
      if (m) metaMap.set(at, m);
    }

    // Correlate into transfers (with entry functions)
    const transfers = correlateActivities(
      activities,
      entryFunctions,
      (at) => metaMap.get(at),
    );
    deps.onProgress?.(`  Correlated ${transfers.length} transfers\n`);

    // Store transfers
    if (transfers.length > 0) {
      await deps.insertTransfers(transfers);
    }

    // Update cursor to max version
    if (activities.length > 0) {
      const maxVersion = Math.max(
        ...activities.map((a) => a.transaction_version),
      );
      await deps.updateSyncCursor(address, maxVersion);
    }

    // Check boundaries
    const { boundaries, nonBoundaries } = await checkBoundaries(
      transfers,
      address,
      { getLabel: deps.getLabel, upsertLabel: deps.upsertLabel, config: deps.config },
    );

    // Auto-expand if requested
    if (options.autoExpand) {
      for (const addr of nonBoundaries) {
        const existing = await deps.getSyncCursor(addr);
        if (!existing || existing.last_version === 0) {
          deps.onProgress?.(`  Auto-expanding to track ${addr.slice(0, 10)}...\n`);
          await deps.addTrackedAddress(addr);
        }
      }
    }

    await deps.setSyncStatus(address, 'idle');

    return {
      address,
      activitiesFetched: activities.length,
      transfersFound: transfers.length,
      boundariesHit: boundaries,
      newAddressesDiscovered: nonBoundaries,
    };
  } catch (err) {
    await deps.setSyncStatus(address, 'error');
    throw err;
  }
}

/**
 * Sync all tracked addresses.
 */
export async function syncAll(
  deps: IngestionDeps,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const addresses = await deps.listTrackedAddresses();
  const active = addresses.filter((a) => a.is_active);

  if (active.length === 0) {
    deps.onProgress?.(
      'No tracked addresses. Add one with: aptos-tracker add <address>\n',
    );
    return [];
  }

  resetChunkSize();
  deps.onProgress?.(`Syncing ${active.length} address(es)...\n\n`);

  const results: SyncResult[] = [];
  for (const addr of active) {
    try {
      const result = await syncAddress(addr.address, deps, options);
      results.push(result);
    } catch (err: any) {
      deps.onProgress?.(
        `  Error syncing ${addr.address.slice(0, 10)}...: ${err.message}\n`,
      );
    }
  }

  return results;
}
