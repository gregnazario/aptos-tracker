import type { AssetInfo, FilterParams, ForceData, SankeyData } from './api-client.js';
import { WELL_KNOWN, WELL_KNOWN_CATEGORIES } from '../labels/well-known.js';
import {
  lsAddAddress, lsGetAssetMeta, lsGetCursor, lsGetGraphqlUrl, lsGetLabel,
  lsListAddresses, lsListAssetMeta, lsListCategories, lsListLabels,
  lsRemoveAddress, lsSetSyncStatus, lsUpdateAlias, lsUpdateCursor,
  lsUpsertCategory, lsUpsertLabel,
} from '../storage/local-storage.js';
import type { LocalCategory } from '../storage/local-storage.js';
import {
  idbInsertRawActivities, idbInsertTransfers,
  idbGetTransfersBySenderReceiver, idbGetDistinctAssetTypes,
  idbGetDistinctEntryFunctions,
} from '../storage/indexeddb.js';
import { localGetGraphData } from '../storage/local-graph.js';
import { syncAddress, syncAll, type SyncOptions } from '../ingestion/sync.js';
import type { IngestionDeps } from '../storage/interface.js';

const TYPE_TAGS: Record<string, string> = {
  dex_pool: 'DEX', exchange: 'Exchange', bridge: 'Bridge',
  contract: 'Contract', staking_pool: 'Staking', lending_pool: 'Lending', scam: 'SCAM',
};

function buildNodeName(n: { alias?: string | null; label_name?: string | null; label_type: string; id: string }): string {
  const tag = TYPE_TAGS[n.label_type];
  const base = n.alias || n.label_name || `${n.id.slice(0, 10)}...`;
  return tag ? `${base} [${tag}]` : base;
}

function buildLocalDeps(): IngestionDeps {
  return {
    config: {
      graphqlUrl: lsGetGraphqlUrl(),
      apiKey: '',
      batchSize: 100,
      rateLimitMs: 200,
    },
    insertTransfers: idbInsertTransfers,
    insertRawActivities: idbInsertRawActivities,
    getSyncCursor: (addr) => Promise.resolve(lsGetCursor(addr)),
    updateSyncCursor: (addr, v) => { lsUpdateCursor(addr, v); return Promise.resolve(); },
    setSyncStatus: (addr, s) => { lsSetSyncStatus(addr, s); return Promise.resolve(); },
    listTrackedAddresses: () => Promise.resolve(lsListAddresses()),
    addTrackedAddress: (addr, alias) => { lsAddAddress(addr, alias); return Promise.resolve(); },
    getLabel: (addr) => Promise.resolve(lsGetLabel(addr)),
    upsertLabel: (addr, label) => { lsUpsertLabel(addr, label); return Promise.resolve(); },
    getAssetMeta: (at) => Promise.resolve(lsGetAssetMeta(at)),
  };
}

function getDisplayName(assetType: string): string {
  const meta = lsGetAssetMeta(assetType);
  if (meta?.symbol) return meta.symbol;
  const parts = assetType.split('::');
  return parts[parts.length - 1] || assetType.slice(0, 20);
}

let syncing = false;

export const localApi = {
  get(path: string) {
    if (path === '/addresses') return Promise.resolve(lsListAddresses());
    if (path.startsWith('/transfers?')) {
      const qs = new URLSearchParams(path.split('?')[1]);
      return idbGetTransfersBySenderReceiver(qs.get('sender') || '', qs.get('receiver') || '', qs.get('asset_type') || undefined);
    }
    return Promise.resolve(null);
  },
  post(_path: string, _body?: unknown) { return Promise.resolve(null); },
  put(_path: string, _body?: unknown) { return Promise.resolve(null); },
  patch(_path: string, _body?: unknown) { return Promise.resolve(null); },
  del(path: string) {
    const addrMatch = path.match(/^\/addresses\/(.+)$/);
    if (addrMatch) { lsRemoveAddress(addrMatch[1]); }
    return Promise.resolve(null);
  },

  async getSankeyData(params: FilterParams): Promise<SankeyData> {
    const data = await localGetGraphData(params);
    const nodeIndex = new Map<string, number>();
    for (const [i, n] of data.nodes.entries()) nodeIndex.set(n.id, i);
    return {
      nodes: data.nodes.map(n => ({
        id: n.id,
        name: buildNodeName(n),
        label_type: n.label_type,
        label_name: n.label_name,
        is_boundary: n.is_boundary ? 1 : 0,
        total_volume: n.total_volume,
      })),
      links: data.links
        .filter(l => nodeIndex.has(l.source) && nodeIndex.has(l.target))
        .map(l => ({
          source: nodeIndex.get(l.source)!,
          target: nodeIndex.get(l.target)!,
          value: l.total_amount,
          asset_type: l.asset_type,
          asset_name: l.asset_name,
          transfer_count: l.transfer_count,
        })),
    };
  },

  async getForceData(params: FilterParams): Promise<ForceData> {
    const data = await localGetGraphData(params);
    return {
      nodes: data.nodes.map(n => ({
        id: n.id,
        name: buildNodeName(n),
        alias: n.alias,
        label_type: n.label_type,
        label_name: n.label_name,
        is_boundary: n.is_boundary ? 1 : 0,
        total_volume: n.total_volume,
      })),
      links: data.links.map(l => ({
        source: l.source,
        target: l.target,
        total_amount: l.total_amount,
        asset_type: l.asset_type,
        asset_name: l.asset_name,
        transfer_count: l.transfer_count,
      })),
    };
  },

  async getAssetTypes(): Promise<AssetInfo[]> {
    const types = await idbGetDistinctAssetTypes();
    const meta = lsListAssetMeta();
    const metaSet = new Set(meta.map(m => m.asset_type));
    return types.filter(t => metaSet.has(t)).map(t => ({
      asset_type: t,
      display_name: getDisplayName(t),
    }));
  },

  async triggerSync(address?: string, timeRange?: { from?: string; to?: string }) {
    if (syncing) return;
    syncing = true;
    const deps = buildLocalDeps();
    try {
      const options: SyncOptions = {};
      if (timeRange?.from) options.from = timeRange.from;
      if (timeRange?.to) options.to = timeRange.to;
      if (address) {
        await syncAddress(address, deps, options);
      } else {
        await syncAll(deps, options);
      }
    } finally {
      syncing = false;
    }
  },

  getSyncStatus() {
    return Promise.resolve({ syncing });
  },

  setLabel(address: string, labelType: string, labelName: string | null, isBoundary: boolean) {
    lsUpsertLabel(address, {
      label_type: labelType,
      label_name: labelName,
      is_boundary: isBoundary ? 1 : 0,
    });
    return Promise.resolve();
  },

  addAddress(address: string, alias?: string) {
    lsAddAddress(address, alias);
    return Promise.resolve();
  },

  updateAddressAlias(address: string, alias: string) {
    lsUpdateAlias(address, alias);
    return Promise.resolve();
  },

  getDistinctTaxCategories(): Promise<string[]> {
    const cats = lsListCategories();
    return Promise.resolve([...new Set(cats.map(c => c.tax_category))].sort());
  },

  upsertTaxCategory(pattern: string, taxCategory: string, matchType = 'exact', label?: string) {
    lsUpsertCategory({ pattern, match_type: matchType, tax_category: taxCategory, label: label ?? null });
    return Promise.resolve();
  },

  async getCategorizedEntryFunctions() {
    const entryFns = await idbGetDistinctEntryFunctions();
    const categories = lsListCategories();
    return entryFns.map(ef => {
      const rule = categories.find((c: LocalCategory) => {
        if (c.match_type === 'regex') return new RegExp(c.pattern).test(ef.entry_function);
        return c.pattern === ef.entry_function;
      });
      return {
        entry_function: ef.entry_function,
        count: ef.count,
        tax_category: rule?.tax_category ?? 'unknown',
        confidence: rule ? 1.0 : 0,
        matched_rule: rule?.pattern ?? null,
      };
    });
  },

  getWellKnownLabels() {
    const applied = lsListLabels();
    const appliedSet = new Set(applied.map(l => l.address));
    return Promise.resolve({
      categories: [...WELL_KNOWN_CATEGORIES],
      entries: WELL_KNOWN.map(e => ({ ...e, applied: appliedSet.has(e.address) })),
    });
  },

  async exportLabels(): Promise<void> {
    const labels = lsListLabels();
    const categories = lsListCategories();
    const data = { labels, entry_function_categories: categories };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aptos-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importLabels(file: File): Promise<{ labels: number; categories: number }> {
    const text = await file.text();
    const data = JSON.parse(text);
    let labelCount = 0;
    let catCount = 0;
    if (data.labels) {
      for (const l of data.labels) {
        lsUpsertLabel(l.address, l);
        labelCount++;
      }
    }
    if (data.entry_function_categories) {
      for (const c of data.entry_function_categories) {
        lsUpsertCategory(c);
        catCount++;
      }
    }
    return { labels: labelCount, categories: catCount };
  },
};
