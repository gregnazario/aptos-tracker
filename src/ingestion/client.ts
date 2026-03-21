import { config } from '../config.js';

const ACTIVITY_TYPES = [
  '0x1::fungible_asset::Withdraw',
  '0x1::fungible_asset::Deposit',
  '0x1::coin::WithdrawEvent',
  '0x1::coin::DepositEvent',
];

// Default chunk size for _in queries; shrinks on timeout
let activeChunkSize = 20;
const MIN_CHUNK_SIZE = 5;
const MAX_CHUNK_SIZE = 20;
const REQUEST_TIMEOUT_MS = 30_000;

export interface RawActivity {
  transaction_version: number;
  transaction_timestamp: string;
  type: string;
  amount: string;
  asset_type: string;
  owner_address: string;
  is_gas_fee: boolean;
  event_index: number;
  token_standard: string;
}

function isTimeout(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('aborted') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up')
    );
  }
  return false;
}

export async function graphqlRequest(
  query: string,
  variables: Record<string, any>,
): Promise<any> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      const resp = await fetch(config.graphqlUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (resp.status === 429) {
        const wait = 2 ** attempt * 1000;
        console.log(`  Rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`GraphQL HTTP ${resp.status}: ${await resp.text()}`);
      }

      const json = await resp.json();
      if (json.errors) {
        const errMsg = JSON.stringify(json.errors);
        if (errMsg.toLowerCase().includes('timeout')) {
          throw new TimeoutError(`GraphQL timeout: ${errMsg}`);
        }
        throw new Error(`GraphQL errors: ${errMsg}`);
      }
      return json.data;
    } catch (err: any) {
      clearTimeout(timer);

      if (isTimeout(err) || err instanceof TimeoutError) {
        shrinkChunkSize();
        if (attempt === maxRetries - 1) throw err;
        const wait = 2 ** attempt * 2000;
        console.log(`  Timeout, shrunk chunk size to ${activeChunkSize}, retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (attempt === maxRetries - 1) throw err;
      const wait = 2 ** attempt * 1000;
      console.log(
        `  Request failed (${err.message}), retrying in ${wait}ms...`,
      );
      await sleep(wait);
    }
  }
}

class TimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TimeoutError';
  }
}

function shrinkChunkSize(): void {
  if (activeChunkSize > MIN_CHUNK_SIZE) {
    activeChunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(activeChunkSize / 2));
  }
}

export function getChunkSize(): number {
  return activeChunkSize;
}

export function resetChunkSize(): void {
  activeChunkSize = MAX_CHUNK_SIZE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TimeRange {
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
}

/**
 * Fetch fungible asset activities for a specific address, starting after a given version.
 * Optionally filters by timestamp range to avoid fetching data outside the requested window.
 */
export async function fetchActivitiesForAddress(
  address: string,
  afterVersion: number,
  limit: number = config.batchSize,
  timeRange?: TimeRange,
): Promise<RawActivity[]> {
  // Build the where clause dynamically based on whether time range is provided
  const hasFrom = !!timeRange?.from;
  const hasTo = !!timeRange?.to;

  const timestampFilter = [
    hasFrom ? 'transaction_timestamp: { _gte: $from }' : null,
    hasTo ? 'transaction_timestamp: { _lte: $to }' : null,
  ].filter(Boolean);

  // Merge timestamp filters into a single _and if both exist, otherwise inline
  const timestampClause = timestampFilter.length > 0
    ? timestampFilter.join(', ')
    : '';

  const varDefs = [
    '$address: String!',
    '$after_version: bigint!',
    '$limit: Int!',
    '$types: [String!]!',
    hasFrom ? '$from: timestamp!' : null,
    hasTo ? '$to: timestamp!' : null,
  ].filter(Boolean).join(', ');

  const whereFields = [
    'owner_address: { _eq: $address }',
    'type: { _in: $types }',
    'is_transaction_success: { _eq: true }',
    'transaction_version: { _gt: $after_version }',
    timestampClause,
  ].filter(Boolean).join(', ');

  const query = `
    query(${varDefs}) {
      fungible_asset_activities(
        where: { ${whereFields} }
        order_by: { transaction_version: asc }
        limit: $limit
      ) {
        transaction_version
        transaction_timestamp
        type
        amount
        asset_type
        owner_address
        is_gas_fee
        event_index
        token_standard
      }
    }
  `;

  const variables: Record<string, any> = {
    address,
    after_version: afterVersion,
    limit,
    types: ACTIVITY_TYPES,
  };
  if (hasFrom) variables.from = timeRange!.from;
  if (hasTo) variables.to = timeRange!.to;

  const data = await graphqlRequest(query, variables);

  await sleep(config.rateLimitMs);
  return data.fungible_asset_activities;
}

/**
 * Fetch ALL activities within a set of transaction versions (to find counterparties).
 * Uses adaptive chunk sizing — shrinks on timeout.
 */
export async function fetchActivitiesByVersions(
  versions: number[],
): Promise<RawActivity[]> {
  if (versions.length === 0) return [];

  const allActivities: RawActivity[] = [];

  for (let i = 0; i < versions.length; ) {
    const chunk = versions.slice(i, i + activeChunkSize);
    const query = `
      query($versions: [bigint!]!, $types: [String!]!) {
        fungible_asset_activities(
          where: {
            transaction_version: { _in: $versions }
            is_transaction_success: { _eq: true }
            type: { _in: $types }
          }
          order_by: [{ transaction_version: asc }, { event_index: asc }]
        ) {
          transaction_version
          transaction_timestamp
          type
          amount
          asset_type
          owner_address
          is_gas_fee
          event_index
          token_standard
        }
      }
    `;

    const data = await graphqlRequest(query, {
      versions: chunk,
      types: ACTIVITY_TYPES,
    });

    allActivities.push(...data.fungible_asset_activities);
    i += chunk.length;
    await sleep(config.rateLimitMs);
  }

  return allActivities;
}

/**
 * Fetch entry function names for a set of transaction versions.
 * Returns a map: version → entry_function_id_str (e.g. "0x1::aptos_account::transfer")
 */
export async function fetchEntryFunctions(
  versions: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (versions.length === 0) return result;

  for (let i = 0; i < versions.length; ) {
    const chunk = versions.slice(i, i + activeChunkSize);
    const query = `
      query($versions: [bigint!]!) {
        user_transactions(
          where: { version: { _in: $versions } }
        ) {
          version
          entry_function_id_str
        }
      }
    `;

    const data = await graphqlRequest(query, { versions: chunk });
    for (const tx of data.user_transactions) {
      if (tx.entry_function_id_str) {
        result.set(Number(tx.version), tx.entry_function_id_str);
      }
    }
    i += chunk.length;
    await sleep(config.rateLimitMs);
  }

  return result;
}

/**
 * Check if an address has published Move modules (heuristic for contract detection).
 */
export async function hasPublishedModules(address: string): Promise<boolean> {
  try {
    const baseUrl = config.graphqlUrl.replace('/v1/graphql', '');
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
    const resp = await fetch(
      `${baseUrl}/v1/accounts/${address}/modules?limit=1`,
      { headers },
    );
    if (!resp.ok) return false;
    const modules = await resp.json();
    return Array.isArray(modules) && modules.length > 0;
  } catch {
    return false;
  }
}
