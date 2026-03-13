import { getDb } from '../db/connection.js';
import { getLabel, upsertLabel, listLabels } from '../db/queries.js';
import { hasPublishedModules } from '../ingestion/client.js';

interface DetectionResult {
  address: string;
  label_type: string;
  confidence: number;
  reason: string;
}

/**
 * Run auto-detection heuristics on all unlabeled or low-confidence addresses
 * found in transfers.
 */
export async function detectBoundaries(): Promise<DetectionResult[]> {
  const db = getDb();
  const results: DetectionResult[] = [];

  // Find all unique addresses in transfers that aren't confidently labeled
  const addresses = db.prepare(`
    SELECT DISTINCT address FROM (
      SELECT sender AS address FROM transfers
      UNION
      SELECT receiver AS address FROM transfers
    ) t
    WHERE address NOT IN (
      SELECT address FROM address_labels WHERE confidence >= 0.8
    )
  `).all() as { address: string }[];

  console.log(`Running detection on ${addresses.length} address(es)...`);

  for (const { address } of addresses) {
    const existing = getLabel(address);

    // Heuristic 1: Has published modules → contract/boundary
    const hasMods = await hasPublishedModules(address);
    if (hasMods) {
      upsertLabel(address, {
        label_type: 'contract',
        is_boundary: 1,
        source: 'auto_detected',
        confidence: 0.9,
      });
      results.push({ address, label_type: 'contract', confidence: 0.9, reason: 'Has published Move modules' });
      continue;
    }

    // Heuristic 2: High counterparty count → likely exchange or pool
    const counterpartyCount = db.prepare(`
      SELECT COUNT(DISTINCT other) as cnt FROM (
        SELECT receiver AS other FROM transfers WHERE sender = ?
        UNION
        SELECT sender AS other FROM transfers WHERE receiver = ?
      )
    `).get(address, address) as { cnt: number };

    if (counterpartyCount.cnt >= 100) {
      upsertLabel(address, {
        label_type: 'exchange',
        is_boundary: 1,
        source: 'auto_detected',
        confidence: 0.5,
      });
      results.push({ address, label_type: 'exchange', confidence: 0.5, reason: `${counterpartyCount.cnt} counterparties` });
      continue;
    }

    // Heuristic 3: Multiple asset types + many counterparties → likely pool
    const assetTypeCount = db.prepare(`
      SELECT COUNT(DISTINCT asset_type) as cnt FROM transfers
      WHERE sender = ? OR receiver = ?
    `).get(address, address) as { cnt: number };

    if (assetTypeCount.cnt >= 3 && counterpartyCount.cnt >= 20) {
      upsertLabel(address, {
        label_type: 'dex_pool',
        is_boundary: 1,
        source: 'auto_detected',
        confidence: 0.7,
      });
      results.push({ address, label_type: 'dex_pool', confidence: 0.7, reason: `${assetTypeCount.cnt} asset types, ${counterpartyCount.cnt} counterparties` });
      continue;
    }
  }

  return results;
}
