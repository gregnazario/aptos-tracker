import { getCategory, upsertCategory } from '../db/queries.js';

interface SeedRule {
  pattern: string;
  match_type: 'exact' | 'suffix' | 'contains';
  tax_category: string;
  label: string;
}

const SEED_RULES: SeedRule[] = [
  // --- Swaps ---
  // LiquidSwap
  { pattern: '0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::scripts_v2::swap', match_type: 'exact', tax_category: 'swap', label: 'LiquidSwap swap' },
  { pattern: '0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::scripts_v2::swap_unchecked', match_type: 'exact', tax_category: 'swap', label: 'LiquidSwap swap unchecked' },
  // PancakeSwap
  { pattern: '0xc7efb4076dbe143cbcd98cfaaa929ecfc8f299203dfff63b95ccb6bfe19850fa::router::swap_exact_input', match_type: 'exact', tax_category: 'swap', label: 'PancakeSwap swap' },
  { pattern: '0xc7efb4076dbe143cbcd98cfaaa929ecfc8f299203dfff63b95ccb6bfe19850fa::router::swap_exact_output', match_type: 'exact', tax_category: 'swap', label: 'PancakeSwap swap' },
  // ThalaSwap
  { pattern: '0x48271d39d0b05bd6efca2278f22277d6fcc375504f9839fd73f74ace240861af::base_pool::swap_exact_in', match_type: 'exact', tax_category: 'swap', label: 'ThalaSwap swap' },
  { pattern: '0x48271d39d0b05bd6efca2278f22277d6fcc375504f9839fd73f74ace240861af::base_pool::swap_exact_out', match_type: 'exact', tax_category: 'swap', label: 'ThalaSwap swap' },
  { pattern: '0xa5d3ac4d429052674ed38adc62d010e52d7c24ca159194d17ddc196ddb7e480b::pool::swap_exact_in', match_type: 'exact', tax_category: 'swap', label: 'ThalaSwap V2 swap' },
  // Econia
  { pattern: '0xc0deb00c405f84c85dc13442e305df75d1288100cdd82675695f6148c7ece51c::market::swap_between_coinstores', match_type: 'exact', tax_category: 'swap', label: 'Econia swap' },
  // Cellana
  { pattern: '0x6547d9f1d481fdc5e0e0e78134a41b5e5217e979a87b9657325c32b26723b90b::router::swap_exact_input', match_type: 'exact', tax_category: 'swap', label: 'Cellana swap' },
  // Generic swap suffix patterns
  { pattern: 'scripts_v2::swap', match_type: 'suffix', tax_category: 'swap', label: 'Generic swap' },
  { pattern: 'router::swap_exact_input', match_type: 'suffix', tax_category: 'swap', label: 'Generic swap' },
  { pattern: 'router::swap_exact_output', match_type: 'suffix', tax_category: 'swap', label: 'Generic swap' },
  { pattern: '::swap', match_type: 'suffix', tax_category: 'swap', label: 'Generic swap' },

  // --- LP Add ---
  { pattern: 'scripts_v2::add_liquidity', match_type: 'suffix', tax_category: 'lp_add', label: 'Add liquidity' },
  { pattern: 'router::add_liquidity', match_type: 'suffix', tax_category: 'lp_add', label: 'Add liquidity' },
  { pattern: '::add_liquidity', match_type: 'suffix', tax_category: 'lp_add', label: 'Add liquidity' },

  // --- LP Remove ---
  { pattern: 'scripts_v2::remove_liquidity', match_type: 'suffix', tax_category: 'lp_remove', label: 'Remove liquidity' },
  { pattern: 'router::remove_liquidity', match_type: 'suffix', tax_category: 'lp_remove', label: 'Remove liquidity' },
  { pattern: '::remove_liquidity', match_type: 'suffix', tax_category: 'lp_remove', label: 'Remove liquidity' },

  // --- Staking ---
  { pattern: '0x1::delegation_pool::add_stake', match_type: 'exact', tax_category: 'staking', label: 'Delegation pool stake' },
  // Tortuga
  { pattern: '0x8f396e4246b2ba87b51c0739ef5ea4f26515a98375308c31ac2ec1e42142a57f::staked_aptos_coin::stake', match_type: 'exact', tax_category: 'staking', label: 'Tortuga stake' },
  // Ditto
  { pattern: '0xd11107bdf0d6d7040c6c0bfbdecb6545191fdf13e8d8d259952f53e1713f61b5::staking::stake', match_type: 'exact', tax_category: 'staking', label: 'Ditto stake' },
  // Thala
  { pattern: '0xfaf4e633ae9eb31366c9ca24214231760926576c7b625313b3688b5e900731f6::staking::stake', match_type: 'exact', tax_category: 'staking', label: 'Thala stake' },
  // Generic staking
  { pattern: '::stake', match_type: 'suffix', tax_category: 'staking', label: 'Generic stake' },
  { pattern: '::add_stake', match_type: 'suffix', tax_category: 'staking', label: 'Generic stake' },

  // --- Unstaking ---
  { pattern: '0x1::delegation_pool::unlock', match_type: 'exact', tax_category: 'unstaking', label: 'Delegation pool unstake' },
  { pattern: '0x8f396e4246b2ba87b51c0739ef5ea4f26515a98375308c31ac2ec1e42142a57f::staked_aptos_coin::unstake', match_type: 'exact', tax_category: 'unstaking', label: 'Tortuga unstake' },
  { pattern: '0xd11107bdf0d6d7040c6c0bfbdecb6545191fdf13e8d8d259952f53e1713f61b5::staking::unstake', match_type: 'exact', tax_category: 'unstaking', label: 'Ditto unstake' },
  { pattern: '0xfaf4e633ae9eb31366c9ca24214231760926576c7b625313b3688b5e900731f6::staking::unstake', match_type: 'exact', tax_category: 'unstaking', label: 'Thala unstake' },
  { pattern: '::unstake', match_type: 'suffix', tax_category: 'unstaking', label: 'Generic unstake' },
  { pattern: '::unlock', match_type: 'suffix', tax_category: 'unstaking', label: 'Generic unlock' },

  // --- Bridges ---
  { pattern: '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa', match_type: 'contains', tax_category: 'bridge', label: 'LayerZero' },
  { pattern: '0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625', match_type: 'contains', tax_category: 'bridge', label: 'Wormhole' },
  { pattern: '0x8d87a65ba30e09357fa2edea2c80dbac296e5dec2b18287113500b902942929d', match_type: 'contains', tax_category: 'bridge', label: 'Celer cBridge' },

  // --- Transfers ---
  { pattern: '0x1::aptos_account::transfer', match_type: 'exact', tax_category: 'transfer', label: 'APT transfer' },
  { pattern: '0x1::aptos_account::transfer_coins', match_type: 'exact', tax_category: 'transfer', label: 'Coin transfer' },
  { pattern: '0x1::coin::transfer', match_type: 'exact', tax_category: 'transfer', label: 'Coin transfer' },
  { pattern: '0x1::aptos_account::batch_transfer', match_type: 'exact', tax_category: 'transfer', label: 'Batch transfer' },
  { pattern: '0x1::aptos_account::batch_transfer_coins', match_type: 'exact', tax_category: 'transfer', label: 'Batch coin transfer' },
  { pattern: '0x1::primary_fungible_store::transfer', match_type: 'exact', tax_category: 'transfer', label: 'FA transfer' },
];

export function seedEntryFunctionCategories(): number {
  let seeded = 0;
  for (const rule of SEED_RULES) {
    const existing = getCategory(rule.pattern);
    if (!existing) {
      upsertCategory({
        pattern: rule.pattern,
        match_type: rule.match_type,
        tax_category: rule.tax_category,
        label: rule.label,
        source: 'seed',
        confidence: 1.0,
      });
      seeded++;
    }
  }
  return seeded;
}
