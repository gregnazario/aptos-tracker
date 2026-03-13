#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { createServer } from './api/server.js';
import { config } from './config.js';
import { closeDb, getDb } from './db/connection.js';
import {
  addTrackedAddress,
  listTrackedAddresses,
  queryTransfers,
  removeTrackedAddress,
} from './db/queries.js';
import { syncAddress, syncAll } from './ingestion/sync.js';
import { detectBoundaries } from './labels/detector.js';
import { listLabels, setLabel } from './labels/manager.js';
import { seedKnownAddresses } from './labels/seed.js';

const program = new Command();

program
  .name('aptos-tracker')
  .description('Track Aptos fund flows across addresses')
  .version('0.1.0');

program
  .command('add <address>')
  .description('Add an address to track')
  .option('--alias <name>', 'Friendly name for this address')
  .action((address: string, opts: { alias?: string }) => {
    // Initialize DB (seeds known addresses on first use)
    getDb();
    seedKnownAddresses();

    addTrackedAddress(address, opts.alias);
    console.log(`Added ${address}${opts.alias ? ` (${opts.alias})` : ''}`);
    closeDb();
  });

program
  .command('remove <address>')
  .description('Stop tracking an address')
  .action((address: string) => {
    getDb();
    removeTrackedAddress(address);
    console.log(`Removed ${address}`);
    closeDb();
  });

program
  .command('list')
  .description('List tracked addresses')
  .action(() => {
    getDb();
    const addresses = listTrackedAddresses();
    if (addresses.length === 0) {
      console.log(
        'No tracked addresses. Add one with: aptos-tracker add <address>',
      );
    } else {
      console.log(`\n  Tracked Addresses (${addresses.length}):\n`);
      for (const a of addresses) {
        const alias = a.alias ? ` (${a.alias})` : '';
        const status = a.is_active ? 'active' : 'inactive';
        console.log(`  ${a.address}${alias} [${status}]`);
      }
      console.log();
    }
    closeDb();
  });

program
  .command('sync')
  .description('Sync activities for tracked addresses')
  .option('--address <addr>', 'Sync only this address')
  .option('--full', 'Full re-sync from beginning', false)
  .option(
    '--auto-expand',
    'Auto-track discovered non-boundary addresses',
    false,
  )
  .action(
    async (opts: { address?: string; full: boolean; autoExpand: boolean }) => {
      getDb();
      seedKnownAddresses();

      try {
        if (opts.address) {
          const result = await syncAddress(opts.address, {
            full: opts.full,
            autoExpand: opts.autoExpand,
          });
          console.log(
            `\nDone. ${result.transfersFound} transfers found, ${result.boundariesHit.length} boundaries hit.`,
          );
        } else {
          const results = await syncAll({
            full: opts.full,
            autoExpand: opts.autoExpand,
          });
          const totalTransfers = results.reduce(
            (sum, r) => sum + r.transfersFound,
            0,
          );
          console.log(
            `\nDone. ${totalTransfers} total transfers across ${results.length} address(es).`,
          );
        }
      } catch (err: any) {
        console.error(`Sync error: ${err.message}`);
        process.exit(1);
      } finally {
        closeDb();
      }
    },
  );

program
  .command('label <address>')
  .description('Label an address')
  .requiredOption(
    '--type <type>',
    'Label type: dex_pool, exchange, bridge, contract, user',
  )
  .option('--name <name>', 'Label name (e.g., "LiquidSwap")')
  .option('--boundary', 'Mark as boundary (stops expansion)', false)
  .action(
    (
      address: string,
      opts: { type: string; name?: string; boundary: boolean },
    ) => {
      getDb();
      setLabel(address, opts.type, opts.name, opts.boundary);
      console.log(
        `Labeled ${address} as ${opts.type}${opts.name ? ` (${opts.name})` : ''}${opts.boundary ? ' [boundary]' : ''}`,
      );
      closeDb();
    },
  );

program
  .command('labels')
  .description('List all address labels')
  .action(() => {
    getDb();
    const labels = listLabels();
    if (labels.length === 0) {
      console.log('No labels. Run sync first or add labels manually.');
    } else {
      console.log(`\n  Address Labels (${labels.length}):\n`);
      for (const l of labels) {
        const boundary = l.is_boundary ? ' [BOUNDARY]' : '';
        const name = l.label_name ? ` "${l.label_name}"` : '';
        const conf = l.confidence < 1 ? ` (confidence: ${l.confidence})` : '';
        console.log(
          `  ${l.address.slice(0, 14)}...  ${l.label_type}${name}${boundary}${conf}  [${l.source}]`,
        );
      }
      console.log();
    }
    closeDb();
  });

program
  .command('detect')
  .description('Run auto-detection heuristics on unlabeled addresses')
  .action(async () => {
    getDb();
    try {
      const results = await detectBoundaries();
      if (results.length === 0) {
        console.log('No new boundaries detected.');
      } else {
        console.log(`\nDetected ${results.length} address(es):\n`);
        for (const r of results) {
          console.log(
            `  ${r.address.slice(0, 14)}...  ${r.label_type} (confidence: ${r.confidence}) — ${r.reason}`,
          );
        }
      }
    } finally {
      closeDb();
    }
  });

program
  .command('serve')
  .description('Start the web UI server')
  .option('--port <port>', 'Port number', String(config.port))
  .action((opts: { port: string }) => {
    getDb();
    seedKnownAddresses();

    const port = parseInt(opts.port, 10);
    const app = createServer();
    app.listen(port, () => {
      console.log(`Aptos Tracker running at http://localhost:${port}`);
    });
  });

program
  .command('export')
  .description('Export transfers to CSV')
  .option('-o, --output <file>', 'Output file', 'transfers.csv')
  .action((opts: { output: string }) => {
    getDb();
    const transfers = queryTransfers({ limit: 100000 });
    if (transfers.length === 0) {
      console.log('No transfers to export. Run sync first.');
      closeDb();
      return;
    }

    const header =
      'sender,receiver,amount,amount_decimal,asset_type,asset_name,token_standard,transaction_version,timestamp\n';
    const rows = transfers
      .map(
        (t) =>
          `${t.sender},${t.receiver},${t.amount},${t.amount_decimal},${t.asset_type},${t.asset_name || ''},${t.token_standard || ''},${t.transaction_version},${t.timestamp}`,
      )
      .join('\n');

    writeFileSync(opts.output, header + rows);
    console.log(`Exported ${transfers.length} transfers to ${opts.output}`);
    closeDb();
  });

program.parse();
