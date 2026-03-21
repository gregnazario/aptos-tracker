import { api } from './api-client.js';
import { formatAmount } from './sankey-view.js';

interface Transfer {
  id: number;
  sender: string;
  receiver: string;
  amount: string;
  amount_decimal: number;
  asset_type: string;
  asset_name: string | null;
  transaction_version: number;
  timestamp: string;
  entry_function: string | null;
}

interface CategorizedEntryFunction {
  entry_function: string;
  count: number;
  tax_category: string;
  confidence: number;
  matched_rule: string | null;
}

const TAX_CATEGORIES = [
  'swap', 'transfer', 'staking', 'unstaking',
  'lp_add', 'lp_remove', 'bridge', 'income', 'expense', 'unknown',
] as const;

let modal: HTMLElement | null = null;
let categoryLookup: Map<string, CategorizedEntryFunction> = new Map();

async function loadCategoryLookup(): Promise<void> {
  try {
    const categorized = await api.getCategorizedEntryFunctions();
    categoryLookup = new Map(categorized.map((c) => [c.entry_function, c]));
  } catch {
    // Categories not available yet
  }
}

function getOrCreateModal(): HTMLElement {
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'tx-modal';
  modal.className = 'hidden';

  const overlay = document.createElement('div');
  overlay.className = 'tx-modal-overlay';
  overlay.addEventListener('click', closeTxModal);

  const dialog = document.createElement('div');
  dialog.className = 'tx-modal-dialog';

  const header = document.createElement('div');
  header.className = 'tx-modal-header';

  const title = document.createElement('h3');
  title.id = 'tx-modal-title';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  closeBtn.className = 'tx-modal-close';
  closeBtn.addEventListener('click', closeTxModal);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.id = 'tx-modal-body';
  body.className = 'tx-modal-body';

  dialog.appendChild(header);
  dialog.appendChild(body);
  modal.appendChild(overlay);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  return modal;
}

export function closeTxModal(): void {
  if (modal) modal.classList.add('hidden');
}

/**
 * Extract short function name from full entry_function_id_str.
 * e.g. "0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::scripts_v2::swap"
 *   → "scripts_v2::swap"
 */
function shortEntryFunction(entryFn: string): string {
  const parts = entryFn.split('::');
  if (parts.length >= 3) {
    return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
  }
  return entryFn;
}

function createCategoryBadge(entryFunction: string | null, tr: HTMLTableRowElement): HTMLElement {
  const td = document.createElement('td');
  const badge = document.createElement('span');

  const cat = entryFunction ? categoryLookup.get(entryFunction) : null;
  const category = cat?.tax_category ?? 'unknown';
  badge.className = `tax-badge tax-badge-${category} tax-badge-clickable`;
  badge.textContent = category.replace(/_/g, ' ');

  if (entryFunction) {
    badge.title = 'Click to change category';
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      const choice = prompt(
        `Classify "${shortEntryFunction(entryFunction)}" as:\n\n${TAX_CATEGORIES.join(', ')}`,
        category === 'unknown' ? 'swap' : category,
      );
      if (choice && (TAX_CATEGORIES as readonly string[]).includes(choice)) {
        await api.upsertTaxCategory(entryFunction, choice, 'exact', shortEntryFunction(entryFunction));
        await loadCategoryLookup();
        badge.className = `tax-badge tax-badge-${choice} tax-badge-clickable`;
        badge.textContent = choice.replace(/_/g, ' ');
      }
    });
  }

  td.appendChild(badge);
  return td;
}

export async function showTxModal(
  sourceId: string,
  targetId: string,
  sourceName: string,
  targetName: string,
  assetType?: string,
): Promise<void> {
  const el = getOrCreateModal();
  const title = document.getElementById('tx-modal-title')!;
  const body = document.getElementById('tx-modal-body')!;

  title.textContent = `${sourceName} \u2192 ${targetName}`;
  body.textContent = 'Loading...';
  el.classList.remove('hidden');

  try {
    // Load categories in parallel with transfers
    const qs = new URLSearchParams({ sender: sourceId, receiver: targetId });
    if (assetType) qs.set('asset_type', assetType);
    qs.set('limit', '100');

    const [transfers] = await Promise.all([
      api.get(`/transfers?${qs}`) as Promise<Transfer[]>,
      loadCategoryLookup(),
    ]);
    body.textContent = '';

    if (transfers.length === 0) {
      body.textContent = 'No transfers found.';
      return;
    }

    const table = document.createElement('table');
    table.className = 'tx-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of ['Time', 'Amount', 'Asset', 'Category', 'Entry Function', 'Tx Version']) {
      const th = document.createElement('th');
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const tx of transfers) {
      const tr = document.createElement('tr');
      tr.className = 'tx-row';
      tr.addEventListener('click', () => {
        window.open(
          `https://explorer.aptoslabs.com/txn/${tx.transaction_version}?network=mainnet`,
          '_blank',
        );
      });

      const tdTime = document.createElement('td');
      tdTime.textContent = new Date(tx.timestamp).toLocaleString();
      tr.appendChild(tdTime);

      const tdAmount = document.createElement('td');
      tdAmount.className = 'tx-amount';
      tdAmount.textContent = formatAmount(tx.amount_decimal);
      tr.appendChild(tdAmount);

      const tdAsset = document.createElement('td');
      const parts = tx.asset_type.split('::');
      tdAsset.textContent = tx.asset_name || parts[parts.length - 1] || tx.asset_type;
      tr.appendChild(tdAsset);

      tr.appendChild(createCategoryBadge(tx.entry_function, tr));

      const tdFn = document.createElement('td');
      tdFn.className = 'tx-entry-fn';
      tdFn.textContent = tx.entry_function ? shortEntryFunction(tx.entry_function) : '—';
      if (tx.entry_function) {
        tdFn.title = tx.entry_function;
      }
      tr.appendChild(tdFn);

      const tdVersion = document.createElement('td');
      tdVersion.className = 'tx-version';
      tdVersion.textContent = String(tx.transaction_version);
      tr.appendChild(tdVersion);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    if (transfers.length === 100) {
      const more = document.createElement('div');
      more.className = 'tx-more';
      more.textContent = 'Showing first 100 transfers';
      body.appendChild(more);
    }
  } catch (e) {
    console.error('Failed to load transfers:', e);
    body.textContent = 'Failed to load transfers.';
  }
}
