import type { RawActivity } from './client.js';
import type { Transfer } from '../db/queries.js';
import { getAssetMeta } from '../db/queries.js';

/**
 * Correlate raw activities into Transfer records.
 *
 * Strategy: Group activities by (transaction_version, asset_type).
 * Within each group, match Withdraw events to Deposit events with the same amount.
 * A Withdraw from address A + Deposit to address B of the same amount = transfer A → B.
 */
export function correlateActivities(activities: RawActivity[]): Transfer[] {
  // Group by transaction_version + asset_type
  const groups = new Map<string, RawActivity[]>();

  for (const a of activities) {
    if (a.is_gas_fee) continue;
    const key = `${a.transaction_version}|${a.asset_type}`;
    const group = groups.get(key);
    if (group) {
      group.push(a);
    } else {
      groups.set(key, [a]);
    }
  }

  const transfers: Transfer[] = [];

  for (const [, group] of groups) {
    const withdrawals = group.filter(a =>
      a.type.includes('Withdraw')
    );
    const deposits = group.filter(a =>
      a.type.includes('Deposit')
    );

    // Match withdrawals to deposits by amount
    const usedDeposits = new Set<number>();

    for (const w of withdrawals) {
      for (let i = 0; i < deposits.length; i++) {
        if (usedDeposits.has(i)) continue;
        const d = deposits[i];

        // Same amount, different addresses → this is a transfer
        if (w.amount === d.amount && w.owner_address !== d.owner_address) {
          const meta = getAssetMeta(w.asset_type);
          const decimals = meta?.decimals ?? 8;
          const amountDecimal = parseFloat(w.amount) / Math.pow(10, decimals);

          transfers.push({
            sender: w.owner_address,
            receiver: d.owner_address,
            amount: w.amount,
            amount_decimal: amountDecimal,
            asset_type: w.asset_type,
            asset_name: meta?.symbol ?? extractAssetName(w.asset_type),
            token_standard: w.token_standard,
            transaction_version: w.transaction_version,
            event_index: w.event_index,
            timestamp: w.transaction_timestamp,
          });
          usedDeposits.add(i);
          break;
        }
      }
    }
  }

  return transfers;
}

/**
 * Extract a short asset name from the full asset_type string.
 * e.g. "0x1::aptos_coin::AptosCoin" → "APT"
 */
function extractAssetName(assetType: string): string {
  if (assetType.includes('aptos_coin::AptosCoin') || assetType === '0x1::aptos_coin::AptosCoin') {
    return 'APT';
  }
  // Try to get the last segment
  const parts = assetType.split('::');
  return parts[parts.length - 1] || assetType.slice(0, 10);
}
