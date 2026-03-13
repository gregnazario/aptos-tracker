import Database from 'better-sqlite3';

export function initializeDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_addresses (
      address TEXT PRIMARY KEY,
      alias TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      address TEXT PRIMARY KEY REFERENCES tracked_addresses(address) ON DELETE CASCADE,
      last_version INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle'
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      amount TEXT NOT NULL,
      amount_decimal REAL NOT NULL,
      asset_type TEXT NOT NULL,
      asset_name TEXT,
      token_standard TEXT,
      transaction_version INTEGER NOT NULL,
      event_index INTEGER,
      timestamp TEXT NOT NULL,
      UNIQUE(transaction_version, sender, receiver, asset_type, amount)
    );

    CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(sender);
    CREATE INDEX IF NOT EXISTS idx_transfers_receiver ON transfers(receiver);
    CREATE INDEX IF NOT EXISTS idx_transfers_timestamp ON transfers(timestamp);
    CREATE INDEX IF NOT EXISTS idx_transfers_asset_type ON transfers(asset_type);
    CREATE INDEX IF NOT EXISTS idx_transfers_version ON transfers(transaction_version);

    CREATE TABLE IF NOT EXISTS address_labels (
      address TEXT PRIMARY KEY,
      label_type TEXT NOT NULL DEFAULT 'user',
      label_name TEXT,
      is_boundary INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL NOT NULL DEFAULT 1.0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS asset_metadata (
      asset_type TEXT PRIMARY KEY,
      symbol TEXT,
      name TEXT,
      decimals INTEGER NOT NULL DEFAULT 8,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raw_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_version INTEGER NOT NULL,
      event_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount TEXT,
      asset_type TEXT,
      owner_address TEXT NOT NULL,
      is_gas_fee INTEGER,
      token_standard TEXT,
      timestamp TEXT,
      raw_json TEXT,
      UNIQUE(transaction_version, event_index)
    );

    CREATE INDEX IF NOT EXISTS idx_raw_activities_version ON raw_activities(transaction_version);
    CREATE INDEX IF NOT EXISTS idx_raw_activities_owner ON raw_activities(owner_address);
  `);
}
