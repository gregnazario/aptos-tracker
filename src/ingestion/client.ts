import { config } from '../config.js';

const ACTIVITY_TYPES = [
  '0x1::fungible_asset::Withdraw',
  '0x1::fungible_asset::Deposit',
  '0x1::coin::WithdrawEvent',
  '0x1::coin::DepositEvent',
];

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

async function graphqlRequest(
  query: string,
  variables: Record<string, any>,
): Promise<any> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(config.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });

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
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }
      return json.data;
    } catch (err: any) {
      if (attempt === maxRetries - 1) throw err;
      const wait = 2 ** attempt * 1000;
      console.log(
        `  Request failed (${err.message}), retrying in ${wait}ms...`,
      );
      await sleep(wait);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch fungible asset activities for a specific address, starting after a given version.
 */
export async function fetchActivitiesForAddress(
  address: string,
  afterVersion: number,
  limit: number = config.batchSize,
): Promise<RawActivity[]> {
  const query = `
    query($address: String!, $after_version: bigint!, $limit: Int!, $types: [String!]!) {
      fungible_asset_activities(
        where: {
          owner_address: { _eq: $address }
          type: { _in: $types }
          is_transaction_success: { _eq: true }
          transaction_version: { _gt: $after_version }
        }
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

  const data = await graphqlRequest(query, {
    address,
    after_version: afterVersion,
    limit,
    types: ACTIVITY_TYPES,
  });

  await sleep(config.rateLimitMs);
  return data.fungible_asset_activities;
}

/**
 * Fetch ALL activities within a set of transaction versions (to find counterparties).
 */
export async function fetchActivitiesByVersions(
  versions: number[],
): Promise<RawActivity[]> {
  if (versions.length === 0) return [];

  // Batch versions to avoid query size limits
  const allActivities: RawActivity[] = [];
  const chunkSize = 50;

  for (let i = 0; i < versions.length; i += chunkSize) {
    const chunk = versions.slice(i, i + chunkSize);
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
    await sleep(config.rateLimitMs);
  }

  return allActivities;
}

/**
 * Check if an address has published Move modules (heuristic for contract detection).
 */
export async function hasPublishedModules(address: string): Promise<boolean> {
  try {
    const baseUrl = config.graphqlUrl.replace('/v1/graphql', '');
    const resp = await fetch(
      `${baseUrl}/v1/accounts/${address}/modules?limit=1`,
    );
    if (!resp.ok) return false;
    const modules = await resp.json();
    return Array.isArray(modules) && modules.length > 0;
  } catch {
    return false;
  }
}
