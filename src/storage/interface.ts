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
