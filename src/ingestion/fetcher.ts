import { config } from '../config.js';
import {
  fetchActivitiesByVersions,
  fetchActivitiesForAddress,
  fetchEntryFunctions,
  type RawActivity,
  type TimeRange,
} from './client.js';

export interface FetchResult {
  activities: RawActivity[];
  entryFunctions: Map<number, string>;
}

/**
 * Fetch all activities for an address starting from afterVersion.
 * Handles pagination by advancing the version cursor.
 * Optionally scoped to a time range so only relevant data is fetched.
 * Returns both the full transaction context activities and entry functions.
 */
export async function fetchAllActivities(
  address: string,
  afterVersion: number,
  onBatch?: (count: number) => void,
  timeRange?: TimeRange,
): Promise<FetchResult> {
  const allContextActivities: RawActivity[] = [];
  const allEntryFunctions = new Map<number, string>();
  let currentVersion = afterVersion;
  let totalFetched = 0;

  while (true) {
    // Step 1: Fetch activities for this address
    const batch = await fetchActivitiesForAddress(
      address,
      currentVersion,
      config.batchSize,
      timeRange,
    );

    if (batch.length === 0) break;

    totalFetched += batch.length;
    onBatch?.(totalFetched);

    // Step 2: Get unique transaction versions and fetch full context
    const versions = [...new Set(batch.map((a) => a.transaction_version))];
    const contextActivities = await fetchActivitiesByVersions(versions);
    allContextActivities.push(...contextActivities);

    // Step 3: Fetch entry functions for these versions
    const entryFns = await fetchEntryFunctions(versions);
    for (const [version, fn] of entryFns) {
      allEntryFunctions.set(version, fn);
    }

    // Advance cursor
    currentVersion = Math.max(...batch.map((a) => a.transaction_version));

    // If we got fewer than batch size, we've reached the end
    if (batch.length < config.batchSize) break;
  }

  return { activities: allContextActivities, entryFunctions: allEntryFunctions };
}
