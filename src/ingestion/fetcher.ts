import { config } from '../config.js';
import {
  fetchActivitiesByVersions,
  fetchActivitiesForAddress,
  type RawActivity,
} from './client.js';

/**
 * Fetch all activities for an address starting from afterVersion.
 * Handles pagination by advancing the version cursor.
 * Returns both the owner's activities and the full transaction context.
 */
export async function fetchAllActivities(
  address: string,
  afterVersion: number,
  onBatch?: (count: number) => void,
): Promise<RawActivity[]> {
  const allContextActivities: RawActivity[] = [];
  let currentVersion = afterVersion;
  let totalFetched = 0;

  while (true) {
    // Step 1: Fetch activities for this address
    const batch = await fetchActivitiesForAddress(
      address,
      currentVersion,
      config.batchSize,
    );

    if (batch.length === 0) break;

    totalFetched += batch.length;
    onBatch?.(totalFetched);

    // Step 2: Get unique transaction versions and fetch full context
    const versions = [...new Set(batch.map((a) => a.transaction_version))];
    const contextActivities = await fetchActivitiesByVersions(versions);

    allContextActivities.push(...contextActivities);

    // Advance cursor
    currentVersion = Math.max(...batch.map((a) => a.transaction_version));

    // If we got fewer than batch size, we've reached the end
    if (batch.length < config.batchSize) break;
  }

  return allContextActivities;
}
