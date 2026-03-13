// Main application controller

let _currentView = 'sankey';

async function refreshView() {
  const params = getFilterParams();
  const viewType = document.getElementById('view-toggle').value;
  _currentView = viewType;

  const container = document.getElementById('chart');

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
    const rect = svg.node().parentNode.getBoundingClientRect();
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
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(refreshView, 250);
});

// --- Address Panel ---

function openAddressPanel() {
  document.getElementById('address-panel').classList.remove('hidden');
  loadAddressList();
}

function closeAddressPanel() {
  document.getElementById('address-panel').classList.add('hidden');
}

async function loadAddressList() {
  const list = document.getElementById('address-list');
  list.textContent = '';

  try {
    const addresses = await api.get('/addresses');
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

function startAliasEdit(aliasRow, addr) {
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

async function saveAlias(input, addr) {
  const newAlias = input.value.trim();
  try {
    await api.updateAddressAlias(addr.address, newAlias);
    loadAddressList();
    refreshView();
  } catch (e) {
    console.error('Failed to update alias:', e);
  }
}

async function handleAddAddress() {
  const addrInput = document.getElementById('new-address');
  const aliasInput = document.getElementById('new-alias');
  const address = addrInput.value.trim();
  const alias = aliasInput.value.trim() || undefined;

  if (!address) return;
  if (!address.startsWith('0x')) {
    addrInput.style.borderColor = '#f85149';
    return;
  }

  addrInput.style.borderColor = '';
  try {
    await api.addAddress(address, alias);
    addrInput.value = '';
    aliasInput.value = '';
    loadAddressList();
  } catch (e) {
    console.error('Failed to add address:', e);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initControls();
  refreshView();

  // Address panel
  document
    .getElementById('manage-addresses-btn')
    .addEventListener('click', openAddressPanel);
  document
    .getElementById('close-panel-btn')
    .addEventListener('click', closeAddressPanel);
  document
    .getElementById('add-address-btn')
    .addEventListener('click', handleAddAddress);
  document.getElementById('new-address').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddAddress();
  });
});
