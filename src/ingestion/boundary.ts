import { getLabel, upsertLabel, isBoundary } from '../db/queries.js';
import { hasPublishedModules } from './client.js';
import type { Transfer } from '../db/queries.js';

/**
 * Check all counterparty addresses in a set of transfers.
 * Returns addresses that are NOT boundaries (i.e., should potentially be tracked).
 */
export async function checkBoundaries(
  transfers: Transfer[],
  trackedAddress: string
): Promise<{ boundaries: string[]; nonBoundaries: string[] }> {
  const counterparties = new Set<string>();

  for (const t of transfers) {
    if (t.sender !== trackedAddress) counterparties.add(t.sender);
    if (t.receiver !== trackedAddress) counterparties.add(t.receiver);
  }

  const boundaries: string[] = [];
  const nonBoundaries: string[] = [];

  for (const addr of counterparties) {
    // Already labeled?
    const label = getLabel(addr);
    if (label) {
      if (label.is_boundary) {
        boundaries.push(addr);
      } else {
        nonBoundaries.push(addr);
      }
      continue;
    }

    // Run auto-detection
    const detected = await autoDetect(addr);
    if (detected.is_boundary) {
      boundaries.push(addr);
    } else {
      nonBoundaries.push(addr);
    }
  }

  return { boundaries, nonBoundaries };
}

/**
 * Run heuristics on an unknown address and auto-label it.
 */
export async function autoDetect(address: string): Promise<{ is_boundary: boolean; label_type: string; confidence: number }> {
  // Check if address has published Move modules
  const hasMods = await hasPublishedModules(address);

  if (hasMods) {
    upsertLabel(address, {
      label_type: 'contract',
      is_boundary: 1,
      source: 'auto_detected',
      confidence: 0.9,
    });
    return { is_boundary: true, label_type: 'contract', confidence: 0.9 };
  }

  // For now, label unknown addresses as 'user' with no boundary
  // More sophisticated heuristics (activity count, counterparty count) require
  // additional API calls and will be run via the `detect` CLI command
  upsertLabel(address, {
    label_type: 'user',
    is_boundary: 0,
    source: 'auto_detected',
    confidence: 0.5,
  });

  return { is_boundary: false, label_type: 'user', confidence: 0.5 };
}
