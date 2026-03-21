import { getDb } from './connection.js';

// --- Tracked Addresses ---

export function addTrackedAddress(address: string, alias?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO tracked_addresses (address, alias) VALUES (?, ?)
  `).run(address, alias ?? null);
  db.prepare(`
    INSERT OR IGNORE INTO sync_cursors (address) VALUES (?)
  `).run(address);
}

export function removeTrackedAddress(address: string): void {
  getDb()
    .prepare('DELETE FROM tracked_addresses WHERE address = ?')
    .run(address);
}

export function listTrackedAddresses(): Array<{
  address: string;
  alias: string | null;
  is_active: number;
  added_at: string;
}> {
  return getDb()
    .prepare('SELECT * FROM tracked_addresses ORDER BY added_at DESC')
    .all() as any;
}

export function getTrackedAddress(address: string) {
  return getDb()
    .prepare('SELECT * FROM tracked_addresses WHERE address = ?')
    .get(address) as any;
}

export function updateTrackedAddressAlias(
  address: string,
  alias: string | null,
): void {
  getDb()
    .prepare('UPDATE tracked_addresses SET alias = ? WHERE address = ?')
    .run(alias, address);
}

// --- Sync Cursors ---

export function getSyncCursor(address: string): {
  last_version: number;
  status: string;
} {
  const row = getDb()
    .prepare('SELECT * FROM sync_cursors WHERE address = ?')
    .get(address) as any;
  return row || { last_version: 0, status: 'idle' };
}

export function updateSyncCursor(address: string, version: number): void {
  getDb()
    .prepare(`
    UPDATE sync_cursors SET last_version = ?, last_synced_at = datetime('now'), status = 'idle'
    WHERE address = ?
  `)
    .run(version, address);
}

export function setSyncStatus(address: string, status: string): void {
  getDb()
    .prepare('UPDATE sync_cursors SET status = ? WHERE address = ?')
    .run(status, address);
}

// --- Transfers ---

export interface Transfer {
  id?: number;
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

export function insertTransfer(t: Transfer): void {
  getDb()
    .prepare(`
    INSERT OR IGNORE INTO transfers
      (sender, receiver, amount, amount_decimal, asset_type, asset_name, token_standard, transaction_version, event_index, timestamp, entry_function)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      t.sender,
      t.receiver,
      t.amount,
      t.amount_decimal,
      t.asset_type,
      t.asset_name ?? null,
      t.token_standard ?? null,
      t.transaction_version,
      t.event_index ?? null,
      t.timestamp,
      t.entry_function ?? null,
    );
}

export function insertTransfersBatch(transfers: Transfer[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transfers
      (sender, receiver, amount, amount_decimal, asset_type, asset_name, token_standard, transaction_version, event_index, timestamp, entry_function)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items: Transfer[]) => {
    for (const t of items) {
      stmt.run(
        t.sender,
        t.receiver,
        t.amount,
        t.amount_decimal,
        t.asset_type,
        t.asset_name ?? null,
        t.token_standard ?? null,
        t.transaction_version,
        t.event_index ?? null,
        t.timestamp,
        t.entry_function ?? null,
      );
    }
  });
  insertMany(transfers);
}

export interface TransferQuery {
  address?: string;
  sender?: string;
  receiver?: string;
  from?: string;
  to?: string;
  min_amount?: number;
  asset_type?: string;
  direction?: string;
  verified_only?: boolean;
  limit?: number;
  offset?: number;
}

export function queryTransfers(q: TransferQuery): Transfer[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (q.address) {
    conditions.push('(sender = ? OR receiver = ?)');
    params.push(q.address, q.address);
  }
  if (q.sender) {
    conditions.push('sender = ?');
    params.push(q.sender);
  }
  if (q.receiver) {
    conditions.push('receiver = ?');
    params.push(q.receiver);
  }
  if (q.from) {
    conditions.push('timestamp >= ?');
    params.push(q.from);
  }
  if (q.to) {
    conditions.push('timestamp <= ?');
    params.push(q.to);
  }
  if (q.min_amount !== undefined) {
    conditions.push('amount_decimal >= ?');
    params.push(q.min_amount);
  }
  if (q.asset_type) {
    conditions.push('asset_type = ?');
    params.push(q.asset_type);
  }
  if (q.verified_only) {
    conditions.push('asset_type IN (SELECT asset_type FROM asset_metadata)');
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = q.limit || 1000;
  const offset = q.offset || 0;

  return getDb()
    .prepare(`
    SELECT * FROM transfers ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `)
    .all(...params, limit, offset) as Transfer[];
}

export function getDistinctAssetTypes(): string[] {
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT t.asset_type FROM transfers t
      INNER JOIN asset_metadata am ON t.asset_type = am.asset_type
      ORDER BY t.asset_type
    `)
    .all() as any[];
  return rows.map((r) => r.asset_type);
}

export function getDistinctEntryFunctions(): { entry_function: string; count: number }[] {
  return getDb()
    .prepare(`
      SELECT entry_function, COUNT(*) as count
      FROM transfers
      WHERE entry_function IS NOT NULL
        AND asset_type IN (SELECT asset_type FROM asset_metadata)
      GROUP BY entry_function
      ORDER BY count DESC
    `)
    .all() as any[];
}

export function listAssetMetadata(): AssetMeta[] {
  return getDb()
    .prepare('SELECT * FROM asset_metadata ORDER BY symbol')
    .all() as AssetMeta[];
}

// --- Address Labels ---

export interface AddressLabel {
  address: string;
  label_type: string;
  label_name: string | null;
  is_boundary: number;
  source: string;
  confidence: number;
  updated_at: string;
}

export function getLabel(address: string): AddressLabel | undefined {
  return getDb()
    .prepare('SELECT * FROM address_labels WHERE address = ?')
    .get(address) as AddressLabel | undefined;
}

export function upsertLabel(
  address: string,
  label: Partial<AddressLabel>,
): void {
  const existing = getLabel(address);
  if (existing) {
    const fields: string[] = [];
    const params: any[] = [];
    if (label.label_type !== undefined) {
      fields.push('label_type = ?');
      params.push(label.label_type);
    }
    if (label.label_name !== undefined) {
      fields.push('label_name = ?');
      params.push(label.label_name);
    }
    if (label.is_boundary !== undefined) {
      fields.push('is_boundary = ?');
      params.push(label.is_boundary);
    }
    if (label.source !== undefined) {
      fields.push('source = ?');
      params.push(label.source);
    }
    if (label.confidence !== undefined) {
      fields.push('confidence = ?');
      params.push(label.confidence);
    }
    fields.push("updated_at = datetime('now')");
    params.push(address);
    getDb()
      .prepare(
        `UPDATE address_labels SET ${fields.join(', ')} WHERE address = ?`,
      )
      .run(...params);
  } else {
    getDb()
      .prepare(`
      INSERT INTO address_labels (address, label_type, label_name, is_boundary, source, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(
        address,
        label.label_type || 'user',
        label.label_name ?? null,
        label.is_boundary ?? 0,
        label.source || 'manual',
        label.confidence ?? 1.0,
      );
  }
}

export function deleteLabel(address: string): void {
  getDb().prepare('DELETE FROM address_labels WHERE address = ?').run(address);
}

export function listLabels(): AddressLabel[] {
  return getDb()
    .prepare('SELECT * FROM address_labels ORDER BY label_type, address')
    .all() as AddressLabel[];
}

export function isBoundary(address: string): boolean {
  const label = getLabel(address);
  return label?.is_boundary === 1;
}

// --- Asset Metadata ---

export interface AssetMeta {
  asset_type: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
}

export function getAssetMeta(assetType: string): AssetMeta | undefined {
  return getDb()
    .prepare('SELECT * FROM asset_metadata WHERE asset_type = ?')
    .get(assetType) as AssetMeta | undefined;
}

export function upsertAssetMeta(meta: AssetMeta): void {
  getDb()
    .prepare(`
    INSERT INTO asset_metadata (asset_type, symbol, name, decimals)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(asset_type) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, decimals=excluded.decimals, updated_at=datetime('now')
  `)
    .run(meta.asset_type, meta.symbol, meta.name, meta.decimals);
}

// --- Raw Activities ---

export function insertRawActivity(activity: any): void {
  getDb()
    .prepare(`
    INSERT OR IGNORE INTO raw_activities
      (transaction_version, event_index, type, amount, asset_type, owner_address, is_gas_fee, token_standard, timestamp, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      activity.transaction_version,
      activity.event_index,
      activity.type,
      activity.amount,
      activity.asset_type,
      activity.owner_address,
      activity.is_gas_fee ? 1 : 0,
      activity.token_standard,
      activity.transaction_timestamp,
      JSON.stringify(activity),
    );
}

export function insertRawActivitiesBatch(activities: any[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO raw_activities
      (transaction_version, event_index, type, amount, asset_type, owner_address, is_gas_fee, token_standard, timestamp, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items: any[]) => {
    for (const a of items) {
      stmt.run(
        a.transaction_version,
        a.event_index,
        a.type,
        a.amount,
        a.asset_type,
        a.owner_address,
        a.is_gas_fee ? 1 : 0,
        a.token_standard,
        a.transaction_timestamp,
        JSON.stringify(a),
      );
    }
  });
  insertMany(activities);
}

// --- Entry Function Categories ---

export interface EntryFunctionCategory {
  id?: number;
  pattern: string;
  match_type: string;
  tax_category: string;
  label: string | null;
  source: string;
  confidence: number;
  updated_at: string;
}

export function getCategory(pattern: string): EntryFunctionCategory | undefined {
  return getDb()
    .prepare('SELECT * FROM entry_function_categories WHERE pattern = ?')
    .get(pattern) as EntryFunctionCategory | undefined;
}

export function upsertCategory(cat: Partial<EntryFunctionCategory> & { pattern: string; tax_category: string }): void {
  getDb()
    .prepare(`
      INSERT INTO entry_function_categories (pattern, match_type, tax_category, label, source, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern) DO UPDATE SET
        match_type=excluded.match_type,
        tax_category=excluded.tax_category,
        label=excluded.label,
        source=excluded.source,
        confidence=excluded.confidence,
        updated_at=datetime('now')
    `)
    .run(
      cat.pattern,
      cat.match_type || 'exact',
      cat.tax_category,
      cat.label ?? null,
      cat.source || 'manual',
      cat.confidence ?? 1.0,
    );
}

export function deleteCategory(pattern: string): void {
  getDb()
    .prepare('DELETE FROM entry_function_categories WHERE pattern = ?')
    .run(pattern);
}

export function listCategories(): EntryFunctionCategory[] {
  return getDb()
    .prepare('SELECT * FROM entry_function_categories ORDER BY tax_category, pattern')
    .all() as EntryFunctionCategory[];
}

export function getDistinctTaxCategories(): string[] {
  const rows = getDb()
    .prepare('SELECT DISTINCT tax_category FROM entry_function_categories ORDER BY tax_category')
    .all() as { tax_category: string }[];
  return rows.map((r) => r.tax_category);
}

// --- Graph Data ---

export interface GraphNode {
  id: string;
  alias: string | null;
  label_type: string;
  label_name: string | null;
  is_boundary: boolean;
  total_volume: number;
}

export interface GraphLink {
  source: string;
  target: string;
  asset_type: string;
  asset_name: string | null;
  total_amount: number;
  transfer_count: number;
}

export function getGraphData(filters: TransferQuery): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  // Extract direction before passing to queryTransfers (it's handled here, not in SQL)
  const { direction, ...sqlFilters } = filters;
  const transfers = queryTransfers({ ...sqlFilters, limit: 50000 });

  // We always need the tracked set: "all" keeps transfers involving any tracked
  // address, "inbound"/"outbound" apply stricter per-side checks.
  const tracked = listTrackedAddresses();
  const trackedSet = new Set(tracked.map((a) => a.address));

  const nodeMap = new Map<string, GraphNode>();
  const linkMap = new Map<string, GraphLink>();

  for (const t of transfers) {
    // Direction filter: inbound = receiver is tracked, outbound = sender is tracked,
    // all = at least one side is tracked (exclude unrelated intermediate transfers)
    if (direction === 'inbound' && !trackedSet.has(t.receiver)) continue;
    else if (direction === 'outbound' && !trackedSet.has(t.sender)) continue;
    else if (!direction || direction === '') {
      if (!trackedSet.has(t.sender) && !trackedSet.has(t.receiver)) continue;
    }

    // Build nodes
    for (const addr of [t.sender, t.receiver]) {
      if (!nodeMap.has(addr)) {
        const label = getLabel(addr);
        const tracked = getTrackedAddress(addr);
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
    const senderNode = nodeMap.get(t.sender)!;
    senderNode.total_volume += t.amount_decimal;
    const receiverNode = nodeMap.get(t.receiver)!;
    receiverNode.total_volume += t.amount_decimal;

    // Build links (aggregate by sender+receiver+asset)
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
        asset_name: t.asset_name ?? null,
        total_amount: t.amount_decimal,
        transfer_count: 1,
      });
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: Array.from(linkMap.values()),
  };
}
