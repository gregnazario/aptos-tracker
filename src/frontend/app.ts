import * as d3 from 'd3';
import { api, type TrackedAddress } from './api-client.js';
import { initContextMenu } from './context-menu.js';
import { getFilterParams, initControls } from './controls.js';
import { renderForce } from './force-view.js';
import { renderSankey } from './sankey-view.js';

let currentView = 'sankey';

async function refreshView(): Promise<void> {
  const params = getFilterParams();
  const viewType = (document.getElementById('view-toggle') as HTMLSelectElement)
    .value;
  currentView = viewType;

  const container = document.getElementById(
    'chart',
  ) as unknown as SVGSVGElement;

  try {
    if (viewType === 'sankey') {
      const data = await api.getSankeyData(params);
      renderSankey(container, data);
    } else {
      const data = await api.getForceData(params);
      renderForce(container, data);
    }
  } catch (e) {
    console.error('Failed to load graph data:', e);
    const svg = d3.select(container);
    svg.selectAll('*').remove();
    const rect = (
      svg.node()!.parentNode as HTMLElement
    ).getBoundingClientRect();
    svg
      .append('text')
      .attr('x', rect.width / 2)
      .attr('y', rect.height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('Failed to load data. Check console for details.');
  }
}

// Handle window resize
let resizeTimeout: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(refreshView, 250);
});

// --- Address Panel ---

function openAddressPanel(): void {
  document.getElementById('address-panel')!.classList.remove('hidden');
  loadAddressList();
}

function closeAddressPanel(): void {
  document.getElementById('address-panel')!.classList.add('hidden');
}

async function loadAddressList(): Promise<void> {
  const list = document.getElementById('address-list')!;
  list.textContent = '';

  try {
    const addresses = (await api.get('/addresses')) as TrackedAddress[];
    if (addresses.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'address-empty';
      empty.textContent = 'No tracked addresses yet. Add one above.';
      list.appendChild(empty);
      return;
    }

    for (const addr of addresses) {
      const item = document.createElement('div');
      item.className = 'address-item';

      const info = document.createElement('div');
      info.className = 'address-info';

      const aliasRow = document.createElement('div');
      aliasRow.className = 'address-alias-row';

      const aliasSpan = document.createElement('span');
      aliasSpan.className = 'address-alias';
      aliasSpan.textContent = addr.alias || 'No alias';
      if (!addr.alias) aliasSpan.style.color = '#484f58';
      aliasRow.appendChild(aliasSpan);

      const editBtn = document.createElement('button');
      editBtn.className = 'btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        startAliasEdit(aliasRow, addr);
      });
      aliasRow.appendChild(editBtn);

      info.appendChild(aliasRow);

      const hash = document.createElement('div');
      hash.className = 'address-hash';
      hash.textContent = addr.address;
      info.appendChild(hash);

      const actions = document.createElement('div');
      actions.className = 'address-actions';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        if (removeBtn.dataset.confirming) {
          api.del(`/addresses/${addr.address}`).then(() => {
            loadAddressList();
            refreshView();
          });
          return;
        }
        removeBtn.dataset.confirming = '1';
        removeBtn.textContent = 'Confirm?';
        removeBtn.classList.add('btn-danger-confirm');
        setTimeout(() => {
          removeBtn.textContent = 'Remove';
          removeBtn.classList.remove('btn-danger-confirm');
          delete removeBtn.dataset.confirming;
        }, 3000);
      });
      actions.appendChild(removeBtn);

      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    }
  } catch (e) {
    console.error('Failed to load addresses:', e);
  }
}

function startAliasEdit(aliasRow: HTMLElement, addr: TrackedAddress): void {
  aliasRow.textContent = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'alias-edit-input';
  input.value = addr.alias || '';
  input.placeholder = 'Enter alias...';
  aliasRow.appendChild(input);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'btn-save';
  saveBtn.addEventListener('click', () => saveAlias(input, addr));
  aliasRow.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => loadAddressList());
  aliasRow.appendChild(cancelBtn);

  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveAlias(input, addr);
    if (e.key === 'Escape') loadAddressList();
  });
}

async function saveAlias(
  input: HTMLInputElement,
  addr: TrackedAddress,
): Promise<void> {
  const newAlias = input.value.trim();
  try {
    await api.updateAddressAlias(addr.address, newAlias);
    loadAddressList();
    refreshView();
  } catch (e) {
    console.error('Failed to update alias:', e);
  }
}

async function handleAddAddress(): Promise<void> {
  const addrInput = document.getElementById('new-address') as HTMLInputElement;
  const aliasInput = document.getElementById('new-alias') as HTMLInputElement;
  const address = addrInput.value.trim();
  const alias = aliasInput.value.trim() || undefined;

  if (!address) return;

  addrInput.style.borderColor = '';
  try {
    await api.addAddress(address, alias);
    addrInput.value = '';
    aliasInput.value = '';
    loadAddressList();
  } catch (e) {
    addrInput.style.borderColor = '#f85149';
    console.error('Failed to add address:', e);
  }
}

// --- Well-Known Labels Panel ---

function openWellKnownPanel(): void {
  document.getElementById('well-known-panel')!.classList.remove('hidden');
  loadWellKnownList();
}

function closeWellKnownPanel(): void {
  document.getElementById('well-known-panel')!.classList.add('hidden');
}

let wkSearchTerm = '';
let wkCategoryFilter = '';

async function loadWellKnownList(): Promise<void> {
  const list = document.getElementById('wk-list')!;
  list.textContent = '';

  try {
    const { categories, entries } = await api.getWellKnownLabels();

    // Populate category filter on first load
    const catSelect = document.getElementById('wk-category-filter') as HTMLSelectElement;
    if (catSelect.options.length <= 1) {
      for (const cat of categories) {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        catSelect.appendChild(opt);
      }
    }

    // Filter entries
    const filtered = entries.filter((e) => {
      if (wkCategoryFilter && e.category !== wkCategoryFilter) return false;
      if (wkSearchTerm) {
        const term = wkSearchTerm.toLowerCase();
        return (
          e.label_name.toLowerCase().includes(term) ||
          e.address.toLowerCase().includes(term) ||
          (e.description?.toLowerCase().includes(term) ?? false)
        );
      }
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wk-empty';
      empty.textContent = wkSearchTerm || wkCategoryFilter
        ? 'No matching labels found.'
        : 'No well-known labels configured.';
      list.appendChild(empty);
      return;
    }

    // Group by category
    const grouped = new Map<string, typeof filtered>();
    for (const entry of filtered) {
      const group = grouped.get(entry.category) || [];
      group.push(entry);
      grouped.set(entry.category, group);
    }

    for (const [category, items] of grouped) {
      const header = document.createElement('div');
      header.className = 'wk-category-header';
      header.textContent = `${category} (${items.length})`;
      list.appendChild(header);

      for (const entry of items) {
        const row = document.createElement('div');
        row.className = 'wk-entry';

        const info = document.createElement('div');
        info.className = 'wk-entry-info';

        const name = document.createElement('div');
        name.className = 'wk-entry-name';
        name.textContent = entry.label_name;
        info.appendChild(name);

        if (entry.description) {
          const desc = document.createElement('div');
          desc.className = 'wk-entry-desc';
          desc.textContent = entry.description;
          info.appendChild(desc);
        }

        const addr = document.createElement('div');
        addr.className = 'wk-entry-address';
        addr.textContent = entry.address;
        info.appendChild(addr);

        row.appendChild(info);

        const badge = document.createElement('span');
        badge.className = `wk-type-badge wk-type-${entry.label_type}`;
        badge.textContent = entry.label_type.replace('_', ' ');
        row.appendChild(badge);

        if (entry.applied) {
          const applied = document.createElement('span');
          applied.className = 'wk-applied-badge';
          applied.textContent = 'Applied';
          row.appendChild(applied);
        }

        list.appendChild(row);
      }
    }
  } catch (e) {
    console.error('Failed to load well-known labels:', e);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initControls(refreshView);
  initContextMenu(refreshView);
  refreshView();

  // Well-Known Labels panel
  document
    .getElementById('well-known-btn')!
    .addEventListener('click', openWellKnownPanel);
  document
    .getElementById('close-wk-panel-btn')!
    .addEventListener('click', closeWellKnownPanel);
  document.getElementById('wk-search')!.addEventListener('input', (e) => {
    wkSearchTerm = (e.target as HTMLInputElement).value;
    loadWellKnownList();
  });
  document
    .getElementById('wk-category-filter')!
    .addEventListener('change', (e) => {
      wkCategoryFilter = (e.target as HTMLSelectElement).value;
      loadWellKnownList();
    });

  // Export / Import labels
  document
    .getElementById('export-labels-btn')!
    .addEventListener('click', async () => {
      try {
        await api.exportLabels();
      } catch (e) {
        console.error('Export failed:', e);
      }
    });

  const importFileInput = document.getElementById('import-file-input') as HTMLInputElement;
  document
    .getElementById('import-labels-btn')!
    .addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) return;
    try {
      const counts = await api.importLabels(file);
      alert(`Imported ${counts.labels} labels and ${counts.categories} category rules.`);
      refreshView();
    } catch (e) {
      console.error('Import failed:', e);
      alert('Import failed. Check console for details.');
    }
    importFileInput.value = '';
  });

  document
    .getElementById('manage-addresses-btn')!
    .addEventListener('click', openAddressPanel);
  document
    .getElementById('close-panel-btn')!
    .addEventListener('click', closeAddressPanel);
  document
    .getElementById('add-address-btn')!
    .addEventListener('click', handleAddAddress);
  document.getElementById('new-address')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddAddress();
  });
});

// Suppress unused variable warnings — these are used indirectly
void currentView;
