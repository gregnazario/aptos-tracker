let contextMenuAddress = null;
let contextMenuNodeData = null;

function _escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function _showContextMenu(event, address, nodeData) {
  contextMenuAddress = address;
  contextMenuNodeData = nodeData;

  const menu = document.getElementById('context-menu');
  menu.classList.remove('hidden');
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  // Update boundary toggle text
  const boundaryItem = menu.querySelector('[data-action="toggle-boundary"]');
  if (nodeData?.is_boundary) {
    boundaryItem.textContent = 'Remove Boundary';
  } else {
    boundaryItem.textContent = 'Set as Boundary';
  }
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
  contextMenuAddress = null;
  contextMenuNodeData = null;
}

function _showTooltip(event, contentParts) {
  // contentParts is an array of { class, text } objects for safe rendering
  const tip = document.getElementById('tooltip');
  tip.textContent = '';
  for (const part of contentParts) {
    const div = document.createElement('div');
    if (part.class) div.className = part.class;
    if (part.style) div.style.cssText = part.style;
    div.textContent = part.text;
    tip.appendChild(div);
  }
  tip.classList.remove('hidden');
  tip.style.left = `${event.clientX + 12}px`;
  tip.style.top = `${event.clientY + 12}px`;
}

function _hideTooltip() {
  document.getElementById('tooltip').classList.add('hidden');
}

// Close context menu on click elsewhere
document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu')) {
    hideContextMenu();
  }
});

// Handle context menu actions
document.getElementById('context-menu').addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !contextMenuAddress) return;

  const address = contextMenuAddress;
  const nodeData = contextMenuNodeData;

  switch (action) {
    case 'label-dex':
      await api.setLabel(address, 'dex_pool', null, true);
      break;
    case 'label-exchange':
      await api.setLabel(address, 'exchange', null, true);
      break;
    case 'label-bridge':
      await api.setLabel(address, 'bridge', null, true);
      break;
    case 'label-user':
      await api.setLabel(address, 'user', null, false);
      break;
    case 'toggle-boundary': {
      const newBoundary = !nodeData?.is_boundary;
      await api.setLabel(
        address,
        nodeData?.label_type || 'user',
        nodeData?.label_name,
        newBoundary,
      );
      break;
    }
    case 'set-alias': {
      const name = prompt(
        'Enter label for this address:',
        nodeData?.label_name || '',
      );
      if (name !== null) {
        await api.setLabel(
          address,
          nodeData?.label_type || 'user',
          name,
          nodeData?.is_boundary || false,
        );
      }
      break;
    }
    case 'copy-address':
      navigator.clipboard.writeText(address);
      break;
    case 'track': {
      const alias = prompt('Alias for this address (optional):', '');
      await api.addAddress(address, alias || undefined);
      break;
    }
  }

  hideContextMenu();

  // Refresh the view after label changes
  if (action !== 'copy-address') {
    refreshView();
  }
});
