import { getAssetMeta, listAssetMetadata, upsertAssetMeta } from '../db/queries.js';

interface PanoraToken {
  tokenAddress: string | null;
  faAddress: string | null;
  name: string;
  symbol: string;
  decimals: number;
}

interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  canonicalType: string;
}

const PANORA_URL =
  'https://raw.githubusercontent.com/PanoraExchange/Aptos-Tokens/main/token-list.json';

// In-memory lookup: asset_type → token info
const registry = new Map<string, TokenInfo>();

export function lookupToken(assetType: string): TokenInfo | undefined {
  return registry.get(assetType);
}

export function getDisplayName(assetType: string): string {
  const info = registry.get(assetType);
  if (info) return info.symbol;
  // Fallback: last segment of the type
  const parts = assetType.split('::');
  return parts[parts.length - 1] || assetType.slice(0, 20);
}

export function getCanonicalType(assetType: string): string {
  const info = registry.get(assetType);
  return info?.canonicalType ?? assetType;
}

export async function loadTokenRegistry(): Promise<void> {
  // First load from DB cache
  loadFromDb();

  // Then try to fetch fresh data from Panora
  try {
    const resp = await fetch(PANORA_URL);
    if (!resp.ok) {
      console.warn(`Failed to fetch Panora token list: ${resp.status}`);
      return;
    }
    const data = (await resp.json()) as { data: PanoraToken[] };
    const tokens = Array.isArray(data) ? data : data.data ?? [];

    for (const token of tokens) {
      if (!token.symbol) continue;

      // Canonical type prefers FA address, falls back to coin type
      const canonical = token.faAddress || token.tokenAddress;
      if (!canonical) continue;

      const info: TokenInfo = {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        canonicalType: canonical,
      };

      // Register under both addresses if they exist
      if (token.tokenAddress) {
        registry.set(token.tokenAddress, info);
        upsertAssetMeta({
          asset_type: token.tokenAddress,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
        });
      }
      if (token.faAddress) {
        registry.set(token.faAddress, info);
        upsertAssetMeta({
          asset_type: token.faAddress,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
        });
      }
    }

    console.log(`Token registry loaded: ${registry.size} entries`);
  } catch (e) {
    console.warn('Failed to load Panora token list, using DB cache:', e);
  }
}

function loadFromDb(): void {
  const metas = listAssetMetadata();
  for (const meta of metas) {
    if (!meta.symbol) continue;
    registry.set(meta.asset_type, {
      symbol: meta.symbol,
      name: meta.name ?? meta.symbol,
      decimals: meta.decimals,
      canonicalType: meta.asset_type,
    });
  }
}

export function isVerifiedAsset(assetType: string): boolean {
  return registry.has(assetType);
}

export function getAssetDisplayName(assetType: string): string {
  // Check in-memory registry first
  const info = registry.get(assetType);
  if (info) return info.symbol;

  // Check DB
  const meta = getAssetMeta(assetType);
  if (meta?.symbol) return meta.symbol;

  // Fallback
  const parts = assetType.split('::');
  return parts[parts.length - 1] || assetType.slice(0, 20);
}
