import { upsertLabel, getLabel } from '../db/queries.js';

interface SeedEntry {
  address: string;
  label_type: string;
  label_name: string;
  is_boundary: number;
}

const SEED_DATA: SeedEntry[] = [
  // DEX Pools
  { address: '0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12', label_type: 'dex_pool', label_name: 'LiquidSwap', is_boundary: 1 },
  { address: '0xc7efb4076dbe143cbcd98cfaaa929ecfc8f299203dfff63b95ccb6bfe19850fa', label_type: 'dex_pool', label_name: 'PancakeSwap', is_boundary: 1 },
  { address: '0x48271d39d0b05bd6efca2278f22277d6fcc375504f9839fd73f74ace240861af', label_type: 'dex_pool', label_name: 'ThalaSwap', is_boundary: 1 },
  { address: '0xa5d3ac4d429052674ed38adc62d010e52d7c24ca159194d17ddc196ddb7e480b', label_type: 'dex_pool', label_name: 'ThalaSwap V2', is_boundary: 1 },
  { address: '0x6547d9f1d481fdc5e0e0e78134a41b5e5217e979a87b9657325c32b26723b90b', label_type: 'dex_pool', label_name: 'Cellana Finance', is_boundary: 1 },
  { address: '0xec42a352cc65eca17a9fa85d0fc602295897ed6b8b8af6a6c79ef490eb8f9eba', label_type: 'dex_pool', label_name: 'Sushi', is_boundary: 1 },
  { address: '0x163df34fccbf003ce219d3f1d9e70d140b60571bc0517a0f35c3e0fe86b0a8a3', label_type: 'dex_pool', label_name: 'Aries Markets', is_boundary: 1 },

  // Exchanges
  { address: '0xae1a6f3d3daccaf77b55044cea133379934bba04a11b5d3a4d28077f5a22e926', label_type: 'exchange', label_name: 'Binance Hot Wallet', is_boundary: 1 },
  { address: '0xd41c7a54be894862d57e04a50a11e0e8fea67af078b3e2e2c3e1f57e0f67c32e', label_type: 'exchange', label_name: 'OKX Hot Wallet', is_boundary: 1 },
  { address: '0x5a97986a9d031c4567e15b797be516910cfcb4156312482efc6a19c0a30c948', label_type: 'exchange', label_name: 'Coinbase', is_boundary: 1 },

  // Bridges
  { address: '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa', label_type: 'bridge', label_name: 'LayerZero', is_boundary: 1 },
  { address: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625', label_type: 'bridge', label_name: 'Wormhole', is_boundary: 1 },
  { address: '0x8d87a65ba30e09357fa2edea2c80dbac296e5dec2b18287113500b902942929d', label_type: 'bridge', label_name: 'Celer cBridge', is_boundary: 1 },

  // Protocols
  { address: '0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387', label_type: 'contract', label_name: 'Econia', is_boundary: 1 },
  { address: '0xc0deb00c405f84c85dc13442e305df75d1288100cdd82675695f6148c7ece51c', label_type: 'contract', label_name: 'Econia v2', is_boundary: 1 },
];

/**
 * Seed the database with known DEX, exchange, and bridge addresses.
 * Only inserts if the address doesn't already have a label.
 */
export function seedKnownAddresses(): number {
  let seeded = 0;
  for (const entry of SEED_DATA) {
    const existing = getLabel(entry.address);
    if (!existing) {
      upsertLabel(entry.address, {
        label_type: entry.label_type,
        label_name: entry.label_name,
        is_boundary: entry.is_boundary,
        source: 'seed',
        confidence: 1.0,
      });
      seeded++;
    }
  }
  return seeded;
}
