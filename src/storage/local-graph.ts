import type { FilterParams } from '../frontend/api-client.js';
import { idbGetTransfersByTimeRange } from './indexeddb.js';
import { lsGetLabel, lsListAddresses, lsListAssetMeta } from './local-storage.js';

interface GraphNode {
  id: string;
  alias: string | null;
  label_type: string;
  label_name: string | null;
  is_boundary: boolean;
  total_volume: number;
}

interface GraphLink {
  source: string;
  target: string;
  asset_type: string;
  asset_name: string | null;
  total_amount: number;
  transfer_count: number;
}

export async function localGetGraphData(filters: FilterParams): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const trackedAddresses = lsListAddresses();
  const trackedSet = new Set(trackedAddresses.map(a => a.address));

  // Build asset display name lookup once
  const assetMetaList = lsListAssetMeta();
  const assetMetaMap = new Map(assetMetaList.map(m => [m.asset_type, m]));
  function getAssetDisplayName(assetType: string): string {
    const meta = assetMetaMap.get(assetType);
    if (meta?.symbol) return meta.symbol;
    const parts = assetType.split('::');
    return parts[parts.length - 1] || assetType.slice(0, 20);
  }

  // Pull transfers from IndexedDB, pre-filtered by timestamp
  const transfers = await idbGetTransfersByTimeRange(filters.from, filters.to);

  // Verified asset types (those we have metadata for)
  const metaSet = new Set(assetMetaList.map(m => m.asset_type));

  const nodeMap = new Map<string, GraphNode>();
  const linkMap = new Map<string, GraphLink>();

  for (const t of transfers) {
    // Only show verified assets
    if (!metaSet.has(t.asset_type)) continue;

    // Min amount filter
    if (filters.min_amount && t.amount_decimal < filters.min_amount) continue;

    // Asset type filter
    if (filters.asset_type && t.asset_type !== filters.asset_type) continue;

    // Direction filter
    if (filters.direction === 'inbound' && !trackedSet.has(t.receiver)) continue;
    else if (filters.direction === 'outbound' && !trackedSet.has(t.sender)) continue;
    else if (!filters.direction || filters.direction === '') {
      if (!trackedSet.has(t.sender) && !trackedSet.has(t.receiver)) continue;
    }

    // Build nodes
    for (const addr of [t.sender, t.receiver]) {
      if (!nodeMap.has(addr)) {
        const label = lsGetLabel(addr);
        const tracked = trackedAddresses.find(a => a.address === addr);
        nodeMap.set(addr, {
          id: addr,
          alias: tracked?.alias ?? label?.label_name ?? null,
          label_type: label?.label_type ?? 'unknown',
          label_name: label?.label_name ?? null,
          is_boundary: label?.is_boundary === 1,
          total_volume: 0,
        });
      }
    }

    // Accumulate volume
    nodeMap.get(t.sender)!.total_volume += t.amount_decimal;
    nodeMap.get(t.receiver)!.total_volume += t.amount_decimal;

    // Build links
    const linkKey = `${t.sender}|${t.receiver}|${t.asset_type}`;
    const existing = linkMap.get(linkKey);
    if (existing) {
      existing.total_amount += t.amount_decimal;
      existing.transfer_count++;
    } else {
      linkMap.set(linkKey, {
        source: t.sender,
        target: t.receiver,
        asset_type: t.asset_type,
        asset_name: getAssetDisplayName(t.asset_type),
        total_amount: t.amount_decimal,
        transfer_count: 1,
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), links: Array.from(linkMap.values()) };
}
