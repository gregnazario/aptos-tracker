import { getChunkSize, graphqlRequest } from '../ingestion/client.js';

interface AnsRecord {
  domain: string;
  subdomain: string;
  registered_address: string | null;
  owner_address: string;
}

function formatAnsName(record: AnsRecord): string {
  if (record.subdomain && record.subdomain !== '') {
    return `${record.subdomain}.${record.domain}.apt`;
  }
  return `${record.domain}.apt`;
}

/**
 * Resolve an ANS name (e.g. "greg.apt") to an address.
 * Uses registered_address if set, otherwise falls back to owner_address.
 */
export async function resolveAnsName(
  name: string,
): Promise<string | null> {
  const cleaned = name.replace(/\.apt$/i, '').toLowerCase();
  const parts = cleaned.split('.');

  let domain: string;
  let subdomain: string;
  if (parts.length === 1) {
    domain = parts[0];
    subdomain = '';
  } else if (parts.length === 2) {
    subdomain = parts[0];
    domain = parts[1];
  } else {
    return null;
  }

  const query = `
    query($domain: String!, $subdomain: String!) {
      current_aptos_names(
        where: {
          domain: { _eq: $domain }
          subdomain: { _eq: $subdomain }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        registered_address
        owner_address
        domain
        subdomain
      }
    }
  `;

  try {
    const data = await graphqlRequest(query, { domain, subdomain });
    const records = data.current_aptos_names as AnsRecord[];
    if (records.length > 0) {
      return records[0].registered_address || records[0].owner_address;
    }
    return null;
  } catch (e) {
    console.warn(`ANS resolve failed for "${name}":`, e);
    return null;
  }
}

/**
 * Reverse-lookup: get the primary ANS name for an address.
 * Checks both registered_address and owner_address.
 */
export async function lookupAnsName(
  address: string,
): Promise<string | null> {
  // Try registered_address first
  const query = `
    query($address: String!) {
      by_registered: current_aptos_names(
        where: {
          registered_address: { _eq: $address }
          is_primary: { _eq: true }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        domain
        subdomain
        registered_address
        owner_address
      }
      by_owner: current_aptos_names(
        where: {
          owner_address: { _eq: $address }
          is_primary: { _eq: true }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        domain
        subdomain
        registered_address
        owner_address
      }
    }
  `;

  try {
    const data = await graphqlRequest(query, { address });
    const byRegistered = data.by_registered as AnsRecord[];
    if (byRegistered.length > 0) {
      return formatAnsName(byRegistered[0]);
    }
    const byOwner = data.by_owner as AnsRecord[];
    if (byOwner.length > 0) {
      return formatAnsName(byOwner[0]);
    }
    return null;
  } catch (e) {
    console.warn(`ANS lookup failed for ${address}:`, e);
    return null;
  }
}

/**
 * Batch reverse-lookup: get primary ANS names for multiple addresses.
 * Returns a map of address → ANS name (only includes addresses that have names).
 */
export async function batchLookupAnsNames(
  addresses: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (addresses.length === 0) return result;

  for (let i = 0; i < addresses.length; ) {
    const chunkSize = getChunkSize();
    const chunk = addresses.slice(i, i + chunkSize);
    const query = `
      query($addresses: [String!]!) {
        by_registered: current_aptos_names(
          where: {
            registered_address: { _in: $addresses }
            is_primary: { _eq: true }
            is_active: { _eq: true }
          }
        ) {
          domain
          subdomain
          registered_address
          owner_address
        }
        by_owner: current_aptos_names(
          where: {
            owner_address: { _in: $addresses }
            is_primary: { _eq: true }
            is_active: { _eq: true }
          }
        ) {
          domain
          subdomain
          registered_address
          owner_address
        }
      }
    `;

    try {
      const data = await graphqlRequest(query, { addresses: chunk });

      for (const record of data.by_registered as AnsRecord[]) {
        if (record.registered_address) {
          result.set(record.registered_address, formatAnsName(record));
        }
      }
      for (const record of data.by_owner as AnsRecord[]) {
        // Only add if not already found via registered_address
        if (!result.has(record.owner_address)) {
          result.set(record.owner_address, formatAnsName(record));
        }
      }
    } catch (e) {
      console.warn('ANS batch lookup failed:', e);
    }
    i += chunk.length;
  }

  return result;
}

/**
 * Check if a string looks like an ANS name.
 */
export function isAnsName(input: string): boolean {
  if (input.endsWith('.apt')) return true;
  // Bare name without .apt — must look like a valid ANS name (alphanumeric + hyphens)
  return !input.startsWith('0x') && /^[a-z0-9-]+$/i.test(input);
}
