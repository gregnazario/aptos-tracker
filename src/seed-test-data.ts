import { closeDb, getDb } from './db/connection.js';
import { addTrackedAddress, insertTransfersBatch } from './db/queries.js';
import { seedKnownAddresses } from './labels/seed.js';

const db = getDb();
seedKnownAddresses();

// Ensure we have tracked addresses
addTrackedAddress(
  '0x3d5dae3e9ad448b3d224d185622dfaa885a181484219b4fe6c1d3ce1a95d4047',
  'Active DEX User',
);
addTrackedAddress(
  '0x84b1675891d370d5de8f169031f9c3116d7add256ecf50b3c2e7bff3f83f96ad',
  'Active Wallet',
);

const now = new Date().toISOString();
const transfers = [
  {
    sender:
      '0x3d5dae3e9ad448b3d224d185622dfaa885a181484219b4fe6c1d3ce1a95d4047',
    receiver:
      '0x0bee0f8492f7d2365ce5cce81669d104f55cdea28b652358dc418c89ad2310c6',
    amount: '100000000',
    amount_decimal: 1.0,
    asset_type: '0x1::aptos_coin::AptosCoin',
    asset_name: 'APT',
    token_standard: 'v1',
    transaction_version: 2000001,
    event_index: 0,
    timestamp: now,
  },
  {
    sender:
      '0x0bee0f8492f7d2365ce5cce81669d104f55cdea28b652358dc418c89ad2310c6',
    receiver:
      '0x3d5dae3e9ad448b3d224d185622dfaa885a181484219b4fe6c1d3ce1a95d4047',
    amount: '50000000',
    amount_decimal: 0.5,
    asset_type: '0x1::aptos_coin::AptosCoin',
    asset_name: 'APT',
    token_standard: 'v1',
    transaction_version: 2000002,
    event_index: 0,
    timestamp: now,
  },
  {
    sender:
      '0x3d5dae3e9ad448b3d224d185622dfaa885a181484219b4fe6c1d3ce1a95d4047',
    receiver:
      '0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12',
    amount: '200000000',
    amount_decimal: 2.0,
    asset_type: '0x1::aptos_coin::AptosCoin',
    asset_name: 'APT',
    token_standard: 'v1',
    transaction_version: 2000003,
    event_index: 0,
    timestamp: now,
  },
  {
    sender:
      '0x3d5dae3e9ad448b3d224d185622dfaa885a181484219b4fe6c1d3ce1a95d4047',
    receiver:
      '0xae1a6f3d3daccaf77b55044cea133379934bba04a11b5d3a4d28077f5a22e926',
    amount: '500000000',
    amount_decimal: 5.0,
    asset_type: '0x1::aptos_coin::AptosCoin',
    asset_name: 'APT',
    token_standard: 'v1',
    transaction_version: 2000004,
    event_index: 0,
    timestamp: now,
  },
  {
    sender:
      '0xae1a6f3d3daccaf77b55044cea133379934bba04a11b5d3a4d28077f5a22e926',
    receiver:
      '0x84b1675891d370d5de8f169031f9c3116d7add256ecf50b3c2e7bff3f83f96ad',
    amount: '300000000',
    amount_decimal: 3.0,
    asset_type: '0x1::aptos_coin::AptosCoin',
    asset_name: 'APT',
    token_standard: 'v1',
    transaction_version: 2000005,
    event_index: 0,
    timestamp: now,
  },
];

insertTransfersBatch(transfers);
console.log(`Inserted ${transfers.length} test transfers`);
console.log(
  'Total transfers:',
  db.prepare('SELECT count(*) as c FROM transfers').get(),
);

closeDb();
