# Client-Side Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime-toggled client-side mode so the app works as static files with localStorage + IndexedDB, no backend needed.

**Architecture:** The frontend bundle includes both a `RemoteApiClient` (current behavior) and a `LocalApiClient` (browser storage + direct GraphQL). On startup, detect-mode probes for the backend and picks one. Ingestion modules are refactored to accept dependency-injected storage adapters so they work in both Node and browser.

**Tech Stack:** TypeScript, IndexedDB, localStorage, esbuild (existing bundler)

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `src/storage/interface.ts` | `IngestionDeps` interface (storage + config for ingestion pipeline) |
| `src/storage/local-storage.ts` | localStorage CRUD for addresses, labels, cursors, categories, asset metadata |
| `src/storage/indexeddb.ts` | IndexedDB wrapper for transfers + raw_activities with dedup |
| `src/storage/local-graph.ts` | In-memory JS graph aggregation (replaces SQL `getGraphData`) |
| `src/frontend/local-api-client.ts` | `LocalApiClient` — full API surface backed by browser storage |
| `src/frontend/detect-mode.ts` | Startup mode detection, swaps `api` export |

### Modified Files
| File | Change |
|------|--------|
| `src/ingestion/client.ts` | Accept config param instead of importing `config.ts` |
| `src/ingestion/correlator.ts` | Accept `getAssetMeta` as param instead of importing `db/queries.ts` |
| `src/ingestion/fetcher.ts` | Thread config through to client functions |
| `src/ingestion/boundary.ts` | Accept storage callbacks instead of importing `db/queries.ts` |
| `src/ingestion/sync.ts` | Accept `IngestionDeps`, replace `process.stdout.write`, remove `db/queries` imports |
| `src/frontend/api-client.ts` | Change `const api` to `let api`, add `setApiClient()`, export `ApiClient` type |
| `src/frontend/app.ts` | Call `initApi()` before first render, add mode banner logic |
| `src/api/routes/sync.ts` | Pass SQLite deps to refactored sync functions |
| `src/index.ts` | Pass SQLite deps to sync CLI commands |
| `public/index.html` | Add mode banner element |
| `public/css/styles.css` | Banner styling |

### Unchanged
`sankey-view.ts`, `force-view.ts`, `context-menu.ts`, `controls.ts`, `tx-modal.ts`, `tokens/registry.ts`, all DB/schema files.

---

### Task 1: Storage Interface

**Files:**
- Create: `src/storage/interface.ts`

- [ ] **Step 1: Create the interface file**

```typescript
// src/storage/interface.ts
import type { RawActivity } from '../ingestion/client.js';

export interface Transfer {
  sender: string;
  receiver: string;
  amount: string;
  amount_decimal: number;
  asset_type: string;
  asset_name?: string;
  token_standard?: string;
  transaction_version: number;
  event_index?: number;
  timestamp: string;
  entry_function?: string | null;
}

export interface AddressLabel {
  address: string;
  label_type: string;
  label_name: string | null;
  is_boundary: number;
  source: string;
  confidence: number;
}

export interface TrackedAddress {
  address: string;
  alias: string | null;
  is_active: number;
  added_at: string;
}

export interface AssetMeta {
  asset_type: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
}

export interface IngestionConfig {
  graphqlUrl: string;
  apiKey: string;
  batchSize: number;
  rateLimitMs: number;
}

/** Dependency bundle passed to the ingestion pipeline */
export interface IngestionDeps {
  config: IngestionConfig;
  insertTransfers(transfers: Transfer[]): Promise<void>;
  insertRawActivities(activities: RawActivity[]): Promise<void>;
  getSyncCursor(address: string): Promise<{ last_version: number; status: string }>;
  updateSyncCursor(address: string, version: number): Promise<void>;
  setSyncStatus(address: string, status: string): Promise<void>;
  listTrackedAddresses(): Promise<TrackedAddress[]>;
  addTrackedAddress(address: string, alias?: string): Promise<void>;
  getLabel(address: string): Promise<AddressLabel | undefined>;
  upsertLabel(address: string, label: Partial<AddressLabel>): Promise<void>;
  getAssetMeta(assetType: string): Promise<AssetMeta | undefined>;
  onProgress?: (msg: string) => void;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/greg/git/aptos-tracker && npx tsc --noEmit src/storage/interface.ts --moduleResolution bundler --module nodenext --target es2022 --strict --skipLibCheck`

- [ ] **Step 3: Commit**

```bash
git add src/storage/interface.ts
git commit -m "feat: add IngestionDeps interface for storage abstraction"
```

---

### Task 2: Refactor Ingestion Modules

**Files:**
- Modify: `src/ingestion/client.ts`
- Modify: `src/ingestion/correlator.ts`
- Modify: `src/ingestion/fetcher.ts`
- Modify: `src/ingestion/boundary.ts`
- Modify: `src/ingestion/sync.ts`

- [ ] **Step 1: Refactor `client.ts` — remove `config` import, accept params**

Replace `import { config } from '../config.js';` with an `IngestionConfig` import. Every exported function that uses `config.*` gets a config param added. The module-level `config` usage goes away.

Changes:
- `graphqlRequest(query, variables)` → `graphqlRequest(query, variables, config: IngestionConfig)`
- `fetchActivitiesForAddress(address, afterVersion, limit, timeRange)` → add `config: IngestionConfig` param, use `config.batchSize` as default for `limit`, pass config to `graphqlRequest`, use `config.rateLimitMs` for sleep
- `fetchActivitiesByVersions(versions)` → add `config: IngestionConfig` param
- `fetchEntryFunctions(versions)` → add `config: IngestionConfig` param
- `hasPublishedModules(address)` → add `config: IngestionConfig` param, derive baseUrl from `config.graphqlUrl`

- [ ] **Step 2: Refactor `correlator.ts` — remove `db/queries` import**

Replace:
```typescript
import { type Transfer, getAssetMeta } from '../db/queries.js';
```
With:
```typescript
import type { AssetMeta, Transfer } from '../storage/interface.js';
```

Change function signature:
```typescript
export function correlateActivities(
  activities: RawActivity[],
  entryFunctions?: Map<number, string>,
  getAssetMeta?: (assetType: string) => AssetMeta | undefined,
): Transfer[] {
```

This fully removes the `getAssetMeta` function import from `db/queries.js`. The only import from that module was `{ type Transfer, getAssetMeta }` — both are now sourced from `storage/interface.js` (Transfer as type) and the function parameter (getAssetMeta as optional callback).

Line 45 changes from `const meta = getAssetMeta(w.asset_type);` to `const meta = getAssetMeta?.(w.asset_type);` — using the optional function parameter, not the old module-level import.

- [ ] **Step 3: Refactor `fetcher.ts` — thread config through**

Replace:
```typescript
import { config } from '../config.js';
```
With:
```typescript
import type { IngestionConfig } from '../storage/interface.js';
```

Change `fetchAllActivities` to accept `config: IngestionConfig`:
```typescript
export async function fetchAllActivities(
  address: string,
  afterVersion: number,
  config: IngestionConfig,
  onBatch?: (count: number) => void,
  timeRange?: TimeRange,
): Promise<FetchResult> {
```

Pass `config` to all `fetchActivitiesForAddress`, `fetchActivitiesByVersions`, `fetchEntryFunctions` calls. Also update the pagination-termination condition `if (batch.length < config.batchSize) break;` at the end of the `while` loop to use the injected `config.batchSize`.

- [ ] **Step 4: Refactor `boundary.ts` — accept callbacks**

Replace:
```typescript
import type { Transfer } from '../db/queries.js';
import { getLabel, upsertLabel } from '../db/queries.js';
```
With:
```typescript
import type { AddressLabel, Transfer } from '../storage/interface.js';
import type { IngestionConfig } from '../storage/interface.js';
```

Change signatures:
```typescript
export async function checkBoundaries(
  transfers: Transfer[],
  trackedAddress: string,
  deps: {
    getLabel: (addr: string) => Promise<AddressLabel | undefined>;
    upsertLabel: (addr: string, label: Partial<AddressLabel>) => Promise<void>;
    config: IngestionConfig;
  },
): Promise<{ boundaries: string[]; nonBoundaries: string[] }> {
```

`autoDetect` also takes deps. Pass `deps.config` to `hasPublishedModules`.

- [ ] **Step 5: Refactor `sync.ts` — accept `IngestionDeps`**

Replace all `db/queries` imports with `IngestionDeps` usage:

```typescript
import type { IngestionDeps } from '../storage/interface.js';
import { resetChunkSize, type TimeRange } from './client.js';
import { correlateActivities } from './correlator.js';
import { fetchAllActivities } from './fetcher.js';
import { checkBoundaries } from './boundary.js';

export async function syncAddress(
  address: string,
  deps: IngestionDeps,
  options: SyncOptions = {},
): Promise<SyncResult> {
```

Replace `process.stdout.write(...)` with `deps.onProgress?.(...)`.
Replace all `getSyncCursor(address)` → `await deps.getSyncCursor(address)`.
Replace all `setSyncStatus(...)` → `await deps.setSyncStatus(...)`.
Replace `insertRawActivitiesBatch(...)` → `await deps.insertRawActivities(...)`.
Replace `insertTransfersBatch(...)` → `await deps.insertTransfers(...)`.
Replace `updateSyncCursor(...)` → `await deps.updateSyncCursor(...)`.
Replace `listTrackedAddresses()` → `await deps.listTrackedAddresses()`.
Replace `addTrackedAddress(...)` → `await deps.addTrackedAddress(...)`.
Pass `deps.config` to `fetchAllActivities`.
Pass `{ getLabel: deps.getLabel, upsertLabel: deps.upsertLabel, config: deps.config }` to `checkBoundaries`.
Pass `(assetType) => deps.getAssetMeta(assetType).then(m => m ?? undefined)` or a sync wrapper to `correlateActivities` — since correlateActivities is sync and getAssetMeta is now async, pre-fetch asset metadata before calling correlateActivities.

For correlateActivities (sync function needing async getAssetMeta): before calling it, build a sync lookup map:
```typescript
const assetTypes = new Set(activities.map(a => a.asset_type));
const metaMap = new Map<string, AssetMeta>();
for (const at of assetTypes) {
  const m = await deps.getAssetMeta(at);
  if (m) metaMap.set(at, m);
}
const transfers = correlateActivities(activities, entryFunctions, (at) => metaMap.get(at));
```

`syncAll` signature:
```typescript
export async function syncAll(
  deps: IngestionDeps,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
```

- [ ] **Step 6: Verify compilation**

Run: `cd /Users/greg/git/aptos-tracker && npx tsc --noEmit -p tsconfig.json`

Note: This will fail until server-side callers (Task 3) are updated. That's expected — just verify the ingestion modules themselves have no type errors by checking the error output only shows issues in `sync.ts` route callers and `index.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/ingestion/client.ts src/ingestion/correlator.ts src/ingestion/fetcher.ts src/ingestion/boundary.ts src/ingestion/sync.ts
git commit -m "refactor: inject deps into ingestion pipeline for browser compat"
```

---

### Task 3: Update Server-Side Callers

**Files:**
- Modify: `src/api/routes/sync.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create a server-side deps builder**

Add a helper to `src/api/routes/sync.ts` (or a small `src/storage/server-deps.ts` if cleaner) that builds `IngestionDeps` from the existing SQLite functions:

```typescript
import { config } from '../../config.js';
import * as queries from '../../db/queries.js';
import type { IngestionDeps } from '../../storage/interface.js';

function buildServerDeps(): IngestionDeps {
  return {
    config,
    insertTransfers: (t) => { queries.insertTransfersBatch(t as any); return Promise.resolve(); },
    insertRawActivities: (a) => { queries.insertRawActivitiesBatch(a); return Promise.resolve(); },
    getSyncCursor: (addr) => Promise.resolve(queries.getSyncCursor(addr)),
    updateSyncCursor: (addr, v) => { queries.updateSyncCursor(addr, v); return Promise.resolve(); },
    setSyncStatus: (addr, s) => { queries.setSyncStatus(addr, s); return Promise.resolve(); },
    listTrackedAddresses: () => Promise.resolve(queries.listTrackedAddresses()),
    addTrackedAddress: (addr, alias) => { queries.addTrackedAddress(addr, alias); return Promise.resolve(); },
    getLabel: (addr) => Promise.resolve(queries.getLabel(addr)),
    upsertLabel: (addr, label) => { queries.upsertLabel(addr, label); return Promise.resolve(); },
    getAssetMeta: (at) => Promise.resolve(queries.getAssetMeta(at)),
    onProgress: (msg) => process.stdout.write(msg),
  };
}
```

- [ ] **Step 2: Update sync route**

In `src/api/routes/sync.ts`, change the calls to `syncAddress(address, options)` → `syncAddress(address, buildServerDeps(), options)` and `syncAll(options)` → `syncAll(buildServerDeps(), options)`.

- [ ] **Step 3: Update CLI sync command in `src/index.ts`**

Same pattern: build server deps and pass to `syncAddress`/`syncAll`.

- [ ] **Step 4: Verify full backend compiles**

Run: `cd /Users/greg/git/aptos-tracker && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Verify the app still works**

Run: `cd /Users/greg/git/aptos-tracker && pnpm build`
Expected: Builds successfully.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/sync.ts src/index.ts
git commit -m "refactor: pass IngestionDeps to sync from server-side callers"
```

---

### Task 4: localStorage Wrapper

**Files:**
- Create: `src/storage/local-storage.ts`

- [ ] **Step 1: Create the localStorage wrapper**

```typescript
// src/storage/local-storage.ts
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
  const entry: AddressLabel = {
    address,
    label_type: label.label_type || 'user',
    label_name: label.label_name ?? null,
    is_boundary: label.is_boundary ?? 0,
    source: label.source || 'manual',
    confidence: label.confidence ?? 1.0,
    ...(idx >= 0 ? list[idx] : {}),
    ...label,
    address, // ensure address is always correct
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
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/local-storage.ts
git commit -m "feat: add localStorage wrapper for client-side config data"
```

---

### Task 5: IndexedDB Wrapper

**Files:**
- Create: `src/storage/indexeddb.ts`

- [ ] **Step 1: Create the IndexedDB wrapper**

```typescript
// src/storage/indexeddb.ts
import type { Transfer } from './interface.js';
import type { RawActivity } from '../ingestion/client.js';

const DB_NAME = 'aptos-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transfers')) {
        const store = db.createObjectStore('transfers', { keyPath: 'id', autoIncrement: true });
        store.createIndex('sender', 'sender', { unique: false });
        store.createIndex('receiver', 'receiver', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('asset_type', 'asset_type', { unique: false });
        store.createIndex('dedup', ['transaction_version', 'sender', 'receiver', 'asset_type', 'amount'], { unique: true });
      }
      if (!db.objectStoreNames.contains('raw_activities')) {
        const store = db.createObjectStore('raw_activities', { keyPath: ['transaction_version', 'event_index'] });
        store.createIndex('owner_address', 'owner_address', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbInsertTransfers(transfers: Transfer[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('transfers', 'readwrite');
  const store = tx.objectStore('transfers');
  for (const t of transfers) {
    const req = store.add(t);
    // Absorb ConstraintError (dedup) without aborting the transaction
    req.onerror = (e) => {
      if ((req.error as DOMException)?.name === 'ConstraintError') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbInsertRawActivities(activities: RawActivity[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('raw_activities', 'readwrite');
  const store = tx.objectStore('raw_activities');
  for (const a of activities) {
    const req = store.add(a);
    req.onerror = (e) => {
      if ((req.error as DOMException)?.name === 'ConstraintError') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGetAllTransfers(): Promise<Transfer[]> {
  const db = await openDb();
  const tx = db.transaction('transfers', 'readonly');
  const store = tx.objectStore('transfers');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetTransfersByTimeRange(from?: string, to?: string): Promise<Transfer[]> {
  if (!from && !to) return idbGetAllTransfers();
  const db = await openDb();
  const tx = db.transaction('transfers', 'readonly');
  const store = tx.objectStore('transfers');
  const index = store.index('timestamp');
  const lower = from || '';
  const upper = to || '\uffff';
  const range = IDBKeyRange.bound(lower, upper);
  return new Promise((resolve, reject) => {
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetTransfersBySenderReceiver(sender: string, receiver: string, assetType?: string): Promise<Transfer[]> {
  // No compound index on sender+receiver, so filter in memory
  const all = await idbGetAllTransfers();
  return all.filter(t =>
    t.sender === sender && t.receiver === receiver &&
    (!assetType || t.asset_type === assetType)
  );
}

export async function idbGetDistinctAssetTypes(): Promise<string[]> {
  const all = await idbGetAllTransfers();
  return [...new Set(all.map(t => t.asset_type))].sort();
}

export async function idbGetDistinctEntryFunctions(): Promise<{ entry_function: string; count: number }[]> {
  const all = await idbGetAllTransfers();
  const map = new Map<string, number>();
  for (const t of all) {
    if (t.entry_function) map.set(t.entry_function, (map.get(t.entry_function) || 0) + 1);
  }
  return [...map.entries()]
    .map(([entry_function, count]) => ({ entry_function, count }))
    .sort((a, b) => b.count - a.count);
}
```

Note: IndexedDB's `add()` fires `ConstraintError` asynchronously on the request's `onerror` event when a unique index violation occurs. We call `e.preventDefault()` on each request's error to absorb it without aborting the transaction — this matches SQLite's `INSERT OR IGNORE` behavior. Without `preventDefault()`, a single duplicate would abort the entire transaction and drop all subsequent inserts.

- [ ] **Step 2: Commit**

```bash
git add src/storage/indexeddb.ts
git commit -m "feat: add IndexedDB wrapper for transfers and raw activities"
```

---

### Task 6: Local Graph Aggregation

**Files:**
- Create: `src/storage/local-graph.ts`

- [ ] **Step 1: Create local graph aggregation**

This reimplements `getGraphData` from `db/queries.ts` (lines 472–541) as in-memory JS:

```typescript
// src/storage/local-graph.ts
import type { FilterParams } from '../frontend/api-client.js';
import type { AddressLabel, Transfer } from './interface.js';
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

  // Build asset display name lookup once (avoid repeated localStorage deserialization)
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
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/local-graph.ts
git commit -m "feat: add in-memory graph aggregation for local mode"
```

---

### Task 7: Refactor api-client.ts — Switchable Export

**Files:**
- Modify: `src/frontend/api-client.ts`

- [ ] **Step 1: Change `const api` to `let api` and add setter**

At the bottom of `api-client.ts`, change:
```typescript
export const api = {
```
to:
```typescript
// biome-ignore lint/style/useSingleVarDeclarator: switchable for local mode
export let api = {
```

Add at the very end of the file:
```typescript
/** Replace the api implementation (used by detect-mode for local mode) */
export function setApiClient(client: typeof api): void {
  api = client;
}
```

This is the minimal change — `controls.ts`, `context-menu.ts`, `tx-modal.ts` all keep their imports unchanged because ES module `import { api }` creates a live binding to `let` exports.

- [ ] **Step 2: Verify frontend still compiles**

Run: `cd /Users/greg/git/aptos-tracker && pnpm build:frontend`
Expected: Builds successfully.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/api-client.ts
git commit -m "refactor: make api export mutable for mode switching"
```

---

### Task 8: LocalApiClient

**Files:**
- Create: `src/frontend/local-api-client.ts`

- [ ] **Step 1: Create the local API client**

Implements the same interface as the `api` object in `api-client.ts`, backed by localStorage + IndexedDB + direct GraphQL:

```typescript
// src/frontend/local-api-client.ts
import type { AssetInfo, FilterParams, ForceData, SankeyData, TrackedAddress } from './api-client.js';
import { WELL_KNOWN, WELL_KNOWN_CATEGORIES } from '../labels/well-known.js';
import {
  lsAddAddress, lsDeleteLabel, lsGetAssetMeta, lsGetCursor, lsGetLabel,
  lsListAddresses, lsListAssetMeta, lsListCategories, lsListLabels,
  lsRemoveAddress, lsSetSyncStatus, lsUpdateAlias, lsUpdateCursor,
  lsUpsertAssetMeta, lsUpsertCategory, lsUpsertLabel, lsGetGraphqlUrl,
} from '../storage/local-storage.js';
import { idbInsertRawActivities, idbInsertTransfers, idbGetTransfersBySenderReceiver, idbGetDistinctAssetTypes, idbGetDistinctEntryFunctions } from '../storage/indexeddb.js';
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
    // Route generic get() calls to typed methods for local mode compat
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
    // Handle address deletion
    const addrMatch = path.match(/^\/addresses\/(.+)$/);
    if (addrMatch) { lsRemoveAddress(addrMatch[1]); }
    return Promise.resolve(null);
  },

  async getSankeyData(params: FilterParams): Promise<SankeyData> {
    const data = await localGetGraphData(params);
    // Transform to sankey format (same as server graph.ts route)
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
    // Only return types that have metadata
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
      const rule = categories.find(c => {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/local-api-client.ts
git commit -m "feat: add LocalApiClient backed by localStorage + IndexedDB"
```

---

### Task 9: Detect Mode + Wire Up App

**Files:**
- Create: `src/frontend/detect-mode.ts`
- Modify: `src/frontend/app.ts`
- Modify: `public/index.html`
- Modify: `public/css/styles.css`

- [ ] **Step 1: Create detect-mode.ts**

```typescript
// src/frontend/detect-mode.ts
import { setApiClient } from './api-client.js';
import { localApi } from './local-api-client.js';
import { lsGetLabel, lsGetMode, lsUpsertLabel } from '../storage/local-storage.js';
import { WELL_KNOWN } from '../labels/well-known.js';

let detectedMode: 'server' | 'local' = 'server';

export function getMode(): 'server' | 'local' {
  return detectedMode;
}

export async function initApi(): Promise<void> {
  // Manual override
  const forced = lsGetMode();
  if (forced === 'local' || forced === 'server') {
    detectedMode = forced;
    if (forced === 'local') {
      setApiClient(localApi as any);
      seedWellKnownLabels();
    }
    return;
  }

  // Probe backend
  try {
    const resp = await fetch('/api/addresses', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      detectedMode = 'server';
      return;
    }
    // 4xx/5xx = server is up but broken, stay in server mode
    detectedMode = 'server';
  } catch {
    // Network error or timeout → local mode
    detectedMode = 'local';
    setApiClient(localApi as any);
    seedWellKnownLabels();
  }
}

/** Seed well-known labels into localStorage on first local-mode use */
function seedWellKnownLabels(): void {
  for (const entry of WELL_KNOWN) {
    if (!lsGetLabel(entry.address)) {
      lsUpsertLabel(entry.address, {
        label_type: entry.label_type,
        label_name: entry.label_name,
        is_boundary: entry.is_boundary,
        source: 'well_known',
        confidence: 1.0,
      });
    }
  }
}
```

- [ ] **Step 2: Update app.ts — call initApi and show banner**

At the top of `app.ts`, add:
```typescript
import { getMode, initApi } from './detect-mode.js';
```

Change the DOMContentLoaded handler to:
```typescript
document.addEventListener('DOMContentLoaded', async () => {
  await initApi();

  // Show mode banner
  const banner = document.getElementById('mode-banner');
  if (banner && getMode() === 'local') {
    banner.classList.remove('hidden');
  }

  initControls(refreshView);
  initContextMenu(refreshView);
  refreshView();
  // ... rest of event listeners unchanged
```

- [ ] **Step 3: Add banner to index.html**

After `<header>...</header>`, add:
```html
<div id="mode-banner" class="hidden">
  Local mode — data stored in browser. <a href="javascript:void(0)" onclick="localStorage.removeItem('apt_mode');location.reload()">Reset</a>
</div>
```

- [ ] **Step 4: Add banner CSS to styles.css**

Append:
```css
/* Mode banner */
#mode-banner {
  background: #1a3a2a;
  color: #3fb950;
  text-align: center;
  padding: 6px 12px;
  font-size: 13px;
  border-bottom: 1px solid #3fb950;
}
#mode-banner a {
  color: #58a6ff;
  margin-left: 8px;
}
```

- [ ] **Step 5: Build and verify**

Run: `cd /Users/greg/git/aptos-tracker && pnpm build:frontend`
Expected: Builds successfully. If there are import issues (e.g., esbuild pulling in Node modules), troubleshoot — the ingestion modules should no longer import `config.ts` or `db/queries.ts` after Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/detect-mode.ts src/frontend/app.ts public/index.html public/css/styles.css
git commit -m "feat: add runtime mode detection and local mode banner"
```

---

### Task 10: Full Integration Build + Fix

**Files:** All changed files

- [ ] **Step 1: Full backend typecheck**

Run: `cd /Users/greg/git/aptos-tracker && npx tsc --noEmit -p tsconfig.json`

Fix any remaining type errors.

- [ ] **Step 2: Full frontend build**

Run: `cd /Users/greg/git/aptos-tracker && pnpm build:frontend`

Fix any esbuild errors. Key things to watch for:
- esbuild trying to bundle `better-sqlite3` or `node:fs` — means an ingestion module still imports a server module
- Missing exports — typos in import paths

- [ ] **Step 3: Full build**

Run: `cd /Users/greg/git/aptos-tracker && pnpm build`
Expected: Clean build.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues for client-side mode"
```

- [ ] **Step 5: Final commit (squash if many fix commits)**

If Tasks 1-9 all went cleanly and Task 10 had no fixes, this step is a no-op. Otherwise, ensure the working tree is clean and everything builds.
