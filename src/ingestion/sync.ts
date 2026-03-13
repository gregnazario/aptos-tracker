import { listTrackedAddresses, getSyncCursor, updateSyncCursor, setSyncStatus,
  insertTransfersBatch, insertRawActivitiesBatch, addTrackedAddress } from '../db/queries.js';
import { fetchAllActivities } from './fetcher.js';
import { correlateActivities } from './correlator.js';
import { checkBoundaries } from './boundary.js';

export interface SyncResult {
  address: string;
  activitiesFetched: number;
  transfersFound: number;
  boundariesHit: string[];
  newAddressesDiscovered: string[];
}

/**
 * Sync a single address: fetch new activities, correlate into transfers, check boundaries.
 */
export async function syncAddress(
  address: string,
  options: { autoExpand?: boolean; full?: boolean } = {}
): Promise<SyncResult> {
  const cursor = getSyncCursor(address);
  const afterVersion = options.full ? 0 : cursor.last_version;

  setSyncStatus(address, 'syncing');
  console.log(`  Syncing ${address.slice(0, 10)}... from version ${afterVersion}`);

  try {
    // Fetch all activities with full transaction context
    const activities = await fetchAllActivities(address, afterVersion, (count) => {
      process.stdout.write(`\r  Fetched ${count} activities...`);
    });

    if (activities.length > 0) {
      console.log(`\n  Got ${activities.length} context activities`);
    } else {
      console.log('  No new activities');
    }

    // Store raw activities
    insertRawActivitiesBatch(activities);

    // Correlate into transfers
    const transfers = correlateActivities(activities);
    console.log(`  Correlated ${transfers.length} transfers`);

    // Store transfers
    if (transfers.length > 0) {
      insertTransfersBatch(transfers);
    }

    // Update cursor to max version
    if (activities.length > 0) {
      const maxVersion = Math.max(...activities.map(a => a.transaction_version));
      updateSyncCursor(address, maxVersion);
    }

    // Check boundaries
    const { boundaries, nonBoundaries } = await checkBoundaries(transfers, address);

    // Auto-expand if requested
    if (options.autoExpand) {
      for (const addr of nonBoundaries) {
        const existing = getSyncCursor(addr);
        if (!existing || existing.last_version === 0) {
          console.log(`  Auto-expanding to track ${addr.slice(0, 10)}...`);
          addTrackedAddress(addr);
        }
      }
    }

    setSyncStatus(address, 'idle');

    return {
      address,
      activitiesFetched: activities.length,
      transfersFound: transfers.length,
      boundariesHit: boundaries,
      newAddressesDiscovered: nonBoundaries,
    };
  } catch (err) {
    setSyncStatus(address, 'error');
    throw err;
  }
}

/**
 * Sync all tracked addresses.
 */
export async function syncAll(
  options: { autoExpand?: boolean; full?: boolean } = {}
): Promise<SyncResult[]> {
  const addresses = listTrackedAddresses();
  const active = addresses.filter(a => a.is_active);

  if (active.length === 0) {
    console.log('No tracked addresses. Add one with: aptos-tracker add <address>');
    return [];
  }

  console.log(`Syncing ${active.length} address(es)...\n`);

  const results: SyncResult[] = [];
  for (const addr of active) {
    try {
      const result = await syncAddress(addr.address, options);
      results.push(result);
    } catch (err: any) {
      console.error(`  Error syncing ${addr.address.slice(0, 10)}...: ${err.message}`);
    }
  }

  return results;
}
