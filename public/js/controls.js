// Controls initialization and event handling

function _initControls() {
  // Set default date range (last 30 days)
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  document.getElementById('date-from').value = thirtyDaysAgo
    .toISOString()
    .slice(0, 10);
  document.getElementById('date-to').value = now.toISOString().slice(0, 10);

  // Amount slider (log scale)
  const slider = document.getElementById('amount-slider');
  const display = document.getElementById('amount-display');
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    const amount = val === 0 ? 0 : 10 ** (val - 1);
    display.textContent = amount < 1 ? amount.toFixed(2) : formatAmount(amount);
  });

  // Load asset types
  loadAssetTypes();

  // Event listeners for all controls
  document.getElementById('date-from').addEventListener('change', refreshView);
  document.getElementById('date-to').addEventListener('change', refreshView);
  slider.addEventListener('change', refreshView);
  document
    .getElementById('asset-filter')
    .addEventListener('change', refreshView);
  document
    .getElementById('view-toggle')
    .addEventListener('change', refreshView);

  // Sync button
  document.getElementById('sync-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-btn');
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    try {
      await api.triggerSync();
      // Poll until done
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
  document.getElementById('refresh-btn').addEventListener('click', refreshView);

  // Address search
  const search = document.getElementById('address-search');
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      refreshView();
    }
  });
}

async function loadAssetTypes() {
  try {
    const assets = await api.getAssetTypes();
    const select = document.getElementById('asset-filter');
    for (const asset of assets) {
      const opt = document.createElement('option');
      opt.value = asset;
      // Display a short name if possible
      const parts = asset.split('::');
      opt.textContent = parts[parts.length - 1] || asset.slice(0, 20);
      select.appendChild(opt);
    }
  } catch (_e) {
    // No assets yet, that's fine
  }
}

function _getFilterParams() {
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  const sliderVal = parseFloat(document.getElementById('amount-slider').value);
  const minAmount = sliderVal === 0 ? undefined : 10 ** (sliderVal - 1);
  const assetType = document.getElementById('asset-filter').value || undefined;

  return {
    from: from || undefined,
    to: to ? `${to}T23:59:59` : undefined,
    min_amount: minAmount,
    asset_type: assetType,
  };
}

async function pollSyncStatus() {
  const statusEl = document.getElementById('sync-status');
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
