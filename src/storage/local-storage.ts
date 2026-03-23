import type { AddressLabel, AssetMeta, TrackedAddress } from './interface.js';

const KEYS = {
  addresses: 'apt_addresses',
  labels: 'apt_labels',
  cursors: 'apt_sync_cursors',
  categories: 'apt_entry_categories',
  assetMeta: 'apt_asset_metadata',
  graphqlUrl: 'apt_graphql_url',
  mode: 'apt_mode',
} as const;

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Tracked Addresses ---
export function lsListAddresses(): TrackedAddress[] {
  return read<TrackedAddress[]>(KEYS.addresses, []);
}

export function lsAddAddress(address: string, alias?: string): void {
  const list = lsListAddresses();
  if (list.some(a => a.address === address)) return;
  list.push({ address, alias: alias ?? null, is_active: 1, added_at: new Date().toISOString() });
  write(KEYS.addresses, list);
}

export function lsRemoveAddress(address: string): void {
  write(KEYS.addresses, lsListAddresses().filter(a => a.address !== address));
}

export function lsUpdateAlias(address: string, alias: string): void {
  const list = lsListAddresses();
  const found = list.find(a => a.address === address);
  if (found) { found.alias = alias; write(KEYS.addresses, list); }
}

// --- Labels ---
export function lsGetLabel(address: string): AddressLabel | undefined {
  return read<AddressLabel[]>(KEYS.labels, []).find(l => l.address === address);
}

export function lsListLabels(): AddressLabel[] {
  return read<AddressLabel[]>(KEYS.labels, []);
}

export function lsUpsertLabel(address: string, label: Partial<AddressLabel>): void {
  const list = read<AddressLabel[]>(KEYS.labels, []);
  const idx = list.findIndex(l => l.address === address);
  const defaults: AddressLabel = {
    address,
    label_type: label.label_type || 'user',
    label_name: label.label_name ?? null,
    is_boundary: label.is_boundary ?? 0,
    source: label.source || 'manual',
    confidence: label.confidence ?? 1.0,
  };
  const entry: AddressLabel = {
    ...defaults,
    ...(idx >= 0 ? list[idx] : {}),
    ...label,
    address,
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  write(KEYS.labels, list);
}

export function lsDeleteLabel(address: string): void {
  write(KEYS.labels, read<AddressLabel[]>(KEYS.labels, []).filter(l => l.address !== address));
}

// --- Sync Cursors ---
export function lsGetCursor(address: string): { last_version: number; status: string } {
  const map = read<Record<string, { last_version: number; last_synced_at: string | null; status: string }>>(KEYS.cursors, {});
  return map[address] ?? { last_version: 0, status: 'idle' };
}

export function lsUpdateCursor(address: string, version: number): void {
  const map = read<Record<string, any>>(KEYS.cursors, {});
  map[address] = { ...map[address], last_version: version, last_synced_at: new Date().toISOString(), status: 'idle' };
  write(KEYS.cursors, map);
}

export function lsSetSyncStatus(address: string, status: string): void {
  const map = read<Record<string, any>>(KEYS.cursors, {});
  if (!map[address]) map[address] = { last_version: 0, last_synced_at: null };
  map[address].status = status;
  write(KEYS.cursors, map);
}

// --- Asset Metadata ---
export function lsGetAssetMeta(assetType: string): AssetMeta | undefined {
  const map = read<Record<string, AssetMeta>>(KEYS.assetMeta, {});
  return map[assetType];
}

export function lsUpsertAssetMeta(meta: AssetMeta): void {
  const map = read<Record<string, AssetMeta>>(KEYS.assetMeta, {});
  map[meta.asset_type] = meta;
  write(KEYS.assetMeta, map);
}

export function lsListAssetMeta(): AssetMeta[] {
  return Object.values(read<Record<string, AssetMeta>>(KEYS.assetMeta, {}));
}

// --- Entry Function Categories ---
export interface LocalCategory {
  pattern: string;
  match_type: string;
  tax_category: string;
  label: string | null;
}

export function lsListCategories(): LocalCategory[] {
  return read<LocalCategory[]>(KEYS.categories, []);
}

export function lsUpsertCategory(cat: LocalCategory): void {
  const list = lsListCategories();
  const idx = list.findIndex(c => c.pattern === cat.pattern);
  if (idx >= 0) list[idx] = cat; else list.push(cat);
  write(KEYS.categories, list);
}

export function lsDeleteCategory(pattern: string): void {
  write(KEYS.categories, lsListCategories().filter(c => c.pattern !== pattern));
}

// --- Config ---
export function lsGetGraphqlUrl(): string {
  return localStorage.getItem(KEYS.graphqlUrl) || 'https://api.mainnet.aptoslabs.com/v1/graphql';
}

export function lsGetMode(): string | null {
  return localStorage.getItem(KEYS.mode);
}
