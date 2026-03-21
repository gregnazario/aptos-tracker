import { api, type FilterParams } from './api-client.js';

const STORAGE_KEY = 'aptos-tracker-filters';

interface SavedState {
  dateFrom?: string;
  dateTo?: string;
  minAmount?: string;
  sliderVal?: string;
  assetType?: string;
  direction?: string;
  taxCategory?: string;
  viewToggle?: string;
  addressSearch?: string;
}

function saveState(): void {
  const state: SavedState = {
    dateFrom: (document.getElementById('date-from') as HTMLInputElement).value,
    dateTo: (document.getElementById('date-to') as HTMLInputElement).value,
    minAmount: (document.getElementById('min-amount') as HTMLInputElement).value,
    sliderVal: (document.getElementById('amount-slider') as HTMLInputElement).value,
    assetType: (document.getElementById('asset-filter') as HTMLSelectElement).value,
    direction: (document.getElementById('direction-filter') as HTMLSelectElement).value,
    taxCategory: (document.getElementById('tax-category-filter') as HTMLSelectElement).value,
    viewToggle: (document.getElementById('view-toggle') as HTMLSelectElement).value,
    addressSearch: (document.getElementById('address-search') as HTMLInputElement).value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(): SavedState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedState;
  } catch {
    return null;
  }
}

export function initControls(refreshView: () => void): void {
  const saved = loadState();

  // Set date range — restore or default to last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  (document.getElementById('date-from') as HTMLInputElement).value =
    saved?.dateFrom || thirtyDaysAgo.toISOString().slice(0, 10);
  (document.getElementById('date-to') as HTMLInputElement).value =
    saved?.dateTo || now.toISOString().slice(0, 10);

  // Restore non-dropdown controls
  const slider = document.getElementById('amount-slider') as HTMLInputElement;
  const amountInput = document.getElementById('min-amount') as HTMLInputElement;
  if (saved?.sliderVal) slider.value = saved.sliderVal;
  if (saved?.minAmount) amountInput.value = saved.minAmount;
  if (saved?.viewToggle) {
    (document.getElementById('view-toggle') as HTMLSelectElement).value = saved.viewToggle;
  }
  if (saved?.addressSearch) {
    (document.getElementById('address-search') as HTMLInputElement).value = saved.addressSearch;
  }
  if (saved?.direction) {
    (document.getElementById('direction-filter') as HTMLSelectElement).value = saved.direction;
  }

  // Sync slider ↔ number input (log scale slider, linear number box)
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    const amount = val === 0 ? 0 : 10 ** (val - 1);
    amountInput.value = amount === 0 ? '' : String(parseFloat(amount.toPrecision(4)));
  });

  amountInput.addEventListener('input', () => {
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      slider.value = '0';
    } else {
      slider.value = String(Math.min(10, Math.log10(amount) + 1));
    }
  });

  // Load asset types and tax categories, then restore saved selections
  loadAssetTypes().then(() => {
    if (saved?.assetType) {
      (document.getElementById('asset-filter') as HTMLSelectElement).value = saved.assetType;
    }
  });
  loadTaxCategories().then(() => {
    if (saved?.taxCategory) {
      (document.getElementById('tax-category-filter') as HTMLSelectElement).value = saved.taxCategory;
    }
  });

  // Wrap refreshView to also save state
  const refreshAndSave = () => {
    saveState();
    refreshView();
  };

  // Event listeners for all controls
  document.getElementById('date-from')!.addEventListener('change', refreshAndSave);
  document.getElementById('date-to')!.addEventListener('change', refreshAndSave);
  slider.addEventListener('change', refreshAndSave);
  amountInput.addEventListener('change', refreshAndSave);
  document
    .getElementById('asset-filter')!
    .addEventListener('change', refreshAndSave);
  document
    .getElementById('direction-filter')!
    .addEventListener('change', refreshAndSave);
  document
    .getElementById('tax-category-filter')!
    .addEventListener('change', refreshAndSave);
  document
    .getElementById('view-toggle')!
    .addEventListener('change', refreshAndSave);

  // Sync button — passes current date range so only relevant data is fetched
  document.getElementById('sync-btn')!.addEventListener('click', async () => {
    const btn = document.getElementById('sync-btn') as HTMLButtonElement;
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    try {
      const from = (document.getElementById('date-from') as HTMLInputElement).value || undefined;
      const to = (document.getElementById('date-to') as HTMLInputElement).value
        ? `${(document.getElementById('date-to') as HTMLInputElement).value}T23:59:59`
        : undefined;
      await api.triggerSync(undefined, { from, to });
      await pollSyncStatus();
      refreshView();
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      btn.textContent = 'Sync Now';
      btn.disabled = false;
    }
  });

  // Refresh button
  document
    .getElementById('refresh-btn')!
    .addEventListener('click', refreshView);

  // Address search
  document
    .getElementById('address-search')!
    .addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveState();
        refreshView();
      }
    });
}

async function loadAssetTypes(): Promise<void> {
  try {
    const assets = await api.getAssetTypes();
    const select = document.getElementById('asset-filter')!;
    for (const asset of assets) {
      const opt = document.createElement('option');
      opt.value = asset.asset_type;
      opt.textContent = asset.display_name;
      select.appendChild(opt);
    }
  } catch {
    // No assets yet, that's fine
  }
}

async function loadTaxCategories(): Promise<void> {
  try {
    const categories = await api.getDistinctTaxCategories();
    const select = document.getElementById('tax-category-filter')!;
    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat.replace(/_/g, ' ');
      select.appendChild(opt);
    }
  } catch {
    // No categories yet
  }
}

export function getFilterParams(): FilterParams {
  const from = (document.getElementById('date-from') as HTMLInputElement).value;
  const to = (document.getElementById('date-to') as HTMLInputElement).value;
  const minAmountVal = (document.getElementById('min-amount') as HTMLInputElement).value;
  const minAmount = minAmountVal ? parseFloat(minAmountVal) : undefined;
  const assetType =
    (document.getElementById('asset-filter') as HTMLSelectElement).value ||
    undefined;
  const direction =
    (document.getElementById('direction-filter') as HTMLSelectElement).value ||
    undefined;
  const taxCategory =
    (document.getElementById('tax-category-filter') as HTMLSelectElement).value ||
    undefined;

  return {
    from: from || undefined,
    to: to ? `${to}T23:59:59` : undefined,
    min_amount: minAmount,
    asset_type: assetType,
    direction,
    tax_category: taxCategory,
  };
}

async function pollSyncStatus(): Promise<void> {
  const statusEl = document.getElementById('sync-status')!;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await api.getSyncStatus();
    if (!status.syncing) {
      statusEl.textContent = 'Sync complete';
      return;
    }
    statusEl.textContent = 'Syncing...';
  }
}
