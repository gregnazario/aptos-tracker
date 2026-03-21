import { getLabel, upsertLabel } from '../db/queries.js';
import { WELL_KNOWN } from './well-known.js';

/**
 * Seed the database with well-known DEX, exchange, bridge, and protocol addresses.
 * Only inserts if the address doesn't already have a label.
 */
export function seedKnownAddresses(): number {
  let seeded = 0;
  for (const entry of WELL_KNOWN) {
    const existing = getLabel(entry.address);
    if (!existing) {
      upsertLabel(entry.address, {
        label_type: entry.label_type,
        label_name: entry.label_name,
        is_boundary: entry.is_boundary,
        source: 'well_known',
        confidence: 1.0,
      });
      seeded++;
    }
  }
  return seeded;
}
