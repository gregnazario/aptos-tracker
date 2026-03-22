# Client-Side Mode Design

Add a runtime-toggled client-side only mode so the app can be deployed as static files on cheap hosting without a backend server.

## Problem

The current architecture requires an Express backend with SQLite. This means paying for a server with compute and bandwidth. For a personal tracker, a static-file deployment (GitHub Pages, Netlify, S3) would be free or near-free.

## Decision: Runtime Toggle

The same built frontend bundle supports both modes. On startup it probes for the backend; if unavailable, it falls back to browser-local storage and direct Aptos Indexer calls.

**Detection logic:**
1. `fetch('/api/addresses', { signal: AbortSignal.timeout(3000) })`
2. HTTP 2xx → **server mode**
3. Network error or timeout → **local mode**
4. HTTP 4xx/5xx → **server mode** (server is up but broken — don't silently switch)

A manual override is available via `localStorage.setItem('apt_mode', 'local' | 'server')` to force a mode regardless of detection. A small banner indicates which mode is active.

## Storage Layout

### localStorage (config data)

| Key | Shape |
|-----|-------|
| `apt_addresses` | `{address, alias, is_active, added_at}[]` |
| `apt_labels` | `{address, label_type, label_name, is_boundary, source, confidence}[]` |
| `apt_sync_cursors` | `Record<string, {last_version, last_synced_at, status}>` |
| `apt_entry_categories` | `{pattern, match_type, tax_category, label}[]` |
| `apt_asset_metadata` | `Record<string, {symbol, name, decimals}>` |
| `apt_graphql_url` | `string` (default: mainnet endpoint) |
| `apt_mode` | `'local' \| 'server'` (optional manual override) |

### IndexedDB (database: `aptos-tracker`)

**`transfers` object store:**
- keyPath: auto-increment `id`
- Unique index: `[transaction_version, sender, receiver, asset_type, amount]` (dedup on re-sync)
- Indexes: `sender`, `receiver`, `timestamp`, `asset_type`
- Fields: `sender`, `receiver`, `amount`, `amount_decimal`, `asset_type`, `asset_name`, `token_standard`, `transaction_version`, `event_index`, `timestamp`, `entry_function`

**`raw_activities` object store:**
- keyPath: `[transaction_version, event_index]` (natural dedup via compound key)
- Index: `owner_address`
- Fields: `transaction_version`, `event_index`, `type`, `amount`, `asset_type`, `owner_address`, `is_gas_fee`, `token_standard`, `timestamp`, `raw_json`

## Interfaces

### SyncStorage

Shared interface consumed by ingestion code. All methods are async to support both SQLite (wrapped in Promise.resolve) and IndexedDB backends:

```typescript
interface SyncStorage {
  // Bulk writes
  insertTransfers(transfers: Transfer[]): Promise<void>;
  insertRawActivities(activities: RawActivity[]): Promise<void>;

  // Sync state
  getSyncCursor(address: string): Promise<{ last_version: number } | null>;
  updateSyncCursor(address: string, version: number): Promise<void>;
  setSyncStatus(address: string, status: string): Promise<void>;

  // Address management
  listTrackedAddresses(): Promise<TrackedAddress[]>;

  // Labels
  getLabel(address: string): Promise<Label | null>;
  upsertLabel(address: string, label: LabelInput): Promise<void>;

  // Asset metadata
  getAssetMeta(assetType: string): Promise<{ decimals: number } | null>;
}
```

Note: The SQLite implementation wraps existing synchronous `better-sqlite3` calls in `Promise.resolve()`. The IndexedDB implementation eagerly loads cursors, labels, and asset metadata into an in-memory cache on `initialize()` so reads are fast — the cache is updated on writes.

```typescript
interface SyncStorageWithInit extends SyncStorage {
  initialize(): Promise<void>;  // pre-loads caches, called once at startup
}
```

### ApiClient Interface

Extracted from the current `api-client.ts`. Both `RemoteApiClient` and `LocalApiClient` implement it:

```typescript
// Matches existing types from api-client.ts
type AssetInfo = { asset_type: string; display_name: string };
type SyncStatus = { syncing: boolean; cursors?: unknown[]; lastResults?: unknown[] };
type ImportResult = { labels: number; categories: number };

interface ApiClient {
  getSankeyData(params: GraphParams): Promise<SankeyData>;
  getForceData(params: GraphParams): Promise<ForceData>;
  getAssetTypes(): Promise<AssetInfo[]>;
  getAddresses(): Promise<TrackedAddress[]>;
  addAddress(address: string, alias?: string): Promise<void>;
  removeAddress(address: string): Promise<void>;
  updateAddressAlias(address: string, alias: string): Promise<void>;
  getLabel(address: string): Promise<Label | null>;
  setLabel(address: string, type: string, name: string, boundary: boolean): Promise<void>;
  triggerSync(address?: string, timeRange?: TimeRange): Promise<void>;
  getSyncStatus(): Promise<SyncStatus>;
  getWellKnownLabels(): Promise<WellKnownResponse>;
  getCategorizedEntryFunctions(): Promise<CategorizedFunction[]>;
  getDistinctTaxCategories(): Promise<string[]>;
  upsertTaxCategory(pattern: string, cat: string, matchType?: string, label?: string): Promise<void>;
  exportLabels(): Promise<void>;  // triggers download internally in both modes
  importLabels(file: File): Promise<ImportResult>;
  getTransfers(address: string, params?: TransferParams): Promise<Transfer[]>;
}
```

For `LocalApiClient.getAssetTypes()`: derives `display_name` from `apt_asset_metadata` as `symbol || name || asset_type` (same logic as `getAssetDisplayName` in `tokens/registry.ts`).

For `LocalApiClient.exportLabels()`: reads labels/categories from localStorage, constructs a JSON blob, and triggers a browser download — same UX as server mode.

## Browser-Side Ingestion

The existing ingestion pipeline is reused with the `SyncStorage` adapter. Several modules have Node.js dependencies that need to be resolved:

1. **`client.ts`** — imports `config.ts` which uses `node:fs`. Will be refactored to accept a config object parameter (`{ graphqlUrl, apiKey?, batchSize, rateLimitMs }`) instead of importing the module-level singleton. Server-side callers pass `config` from `config.ts`; browser callers build the config from localStorage (`apt_graphql_url`) with sensible defaults.

2. **`correlator.ts`** — imports `getAssetMeta` from `db/queries.ts`. Will be refactored to accept `getAssetMeta` as a parameter (or via `SyncStorage.getAssetMeta()`), removing the hard dependency on the SQLite module.

3. **`sync.ts`** — uses `process.stdout.write` for progress. Will be replaced with an optional `onProgress?: (msg: string) => void` callback. Also uses `listTrackedAddresses()` and `setSyncStatus()` from `db/queries.ts` — both will be accessed via the `SyncStorage` interface.

4. **`fetcher.ts`** and **`boundary.ts`** — threaded through to use `SyncStorage` and injected config.

5. **GraphQL calls** go directly from the browser to `https://api.mainnet.aptoslabs.com/v1/graphql`. Same queries, same pagination, same retry logic.

6. **Boundary detection** uses the same REST call to check for published modules.

If CORS blocks Aptos Indexer calls, the app shows an error with instructions to configure a proxy URL via `apt_graphql_url` in localStorage.

## Graph Query Logic (Local Mode)

Replaces the SQL-based `getGraphData()` with in-memory JS:

0. Load tracked address set from `apt_addresses` in localStorage (needed for direction filtering)
1. Pull transfers from IndexedDB (pre-filter by timestamp index if date range is set)
2. Filter in JS: `min_amount`, `asset_type`, `direction` (using tracked set to determine inbound/outbound)
3. Aggregate: group by `(sender, receiver, asset_type)` → sum amounts, count transfers
4. Build node list from unique addresses, attach labels from localStorage
5. Return identical `{nodes, links}` shape

Performance is fine for personal use (hundreds to low thousands of transfers).

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/storage/interface.ts` | `SyncStorage`, `SyncStorageWithInit`, and `ApiClient` interfaces |
| `src/storage/local-storage.ts` | localStorage wrapper for config data |
| `src/storage/indexeddb.ts` | IndexedDB wrapper for transfers and raw activities, with in-memory cache |
| `src/storage/local-graph.ts` | In-memory graph aggregation replacing SQL `getGraphData` |
| `src/frontend/local-api-client.ts` | `LocalApiClient` — full API surface backed by browser storage |
| `src/frontend/detect-mode.ts` | Startup detection with timeout and manual override, exports the chosen `ApiClient` |

### Modified Files

| File | Change |
|------|--------|
| `src/frontend/api-client.ts` | Extract `ApiClient` interface, rename impl to `RemoteApiClient` |
| `src/frontend/app.ts` | Import client from `detect-mode.ts`, show mode banner |
| `src/ingestion/client.ts` | Accept config object parameter instead of importing `config.ts` |
| `src/ingestion/sync.ts` | Accept `SyncStorage` adapter, replace `process.stdout.write` with `onProgress` callback |
| `src/ingestion/fetcher.ts` | Thread adapter and config through |
| `src/ingestion/correlator.ts` | Accept `getAssetMeta` via parameter instead of importing from `db/queries` |
| `src/ingestion/boundary.ts` | Thread adapter through |
| `public/index.html` | Add mode indicator banner |
| `public/css/styles.css` | Banner styling |

### Unchanged

All visualization code: `sankey-view.ts`, `force-view.ts`, `context-menu.ts`, `controls.ts`, `tx-modal.ts`.

## Out of Scope

- Data migration between modes (export/import covers this)
- Offline-first with service worker
- Multi-tab sync for IndexedDB
- Encryption of local data
