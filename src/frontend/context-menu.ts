import { api, type ForceNode, type SankeyNode } from './api-client.js';

type NodeData = SankeyNode | ForceNode;

export interface TooltipPart {
  class?: string;
  text: string;
  style?: string;
}

let contextMenuAddress: string | null = null;
let contextMenuNodeData: NodeData | null = null;

export function showContextMenu(
  event: MouseEvent,
  address: string,
  nodeData: NodeData,
): void {
  contextMenuAddress = address;
  contextMenuNodeData = nodeData;

  const menu = document.getElementById('context-menu')!;
  menu.classList.remove('hidden');

  // Position, then adjust if it would overflow the viewport
  const { innerWidth: vw, innerHeight: vh } = window;
  const rect = menu.getBoundingClientRect();
  const left = event.clientX + rect.width > vw ? event.clientX - rect.width : event.clientX;
  const top = event.clientY + rect.height > vh ? event.clientY - rect.height : event.clientY;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  const boundaryItem = menu.querySelector(
    '[data-action="toggle-boundary"]',
  ) as HTMLElement;
  boundaryItem.textContent = nodeData?.is_boundary
    ? 'Remove Boundary'
    : 'Set as Boundary';
}

function hideContextMenu(): void {
  document.getElementById('context-menu')!.classList.add('hidden');
  contextMenuAddress = null;
  contextMenuNodeData = null;
}

export function showTooltip(
  event: MouseEvent,
  contentParts: TooltipPart[],
): void {
  const tip = document.getElementById('tooltip')!;
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

export function hideTooltip(): void {
  document.getElementById('tooltip')!.classList.add('hidden');
}

export function initContextMenu(onRefresh: () => void): void {
  // Close context menu on click elsewhere
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#context-menu')) {
      hideContextMenu();
    }
  });

  // Handle context menu actions
  document
    .getElementById('context-menu')!
    .addEventListener('click', async (e) => {
      const action = (e.target as HTMLElement).dataset.action;
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
        case 'label-staking':
          await api.setLabel(address, 'staking_pool', null, true);
          break;
        case 'label-lending':
          await api.setLabel(address, 'lending_pool', null, true);
          break;
        case 'toggle-boundary': {
          const newBoundary = !nodeData?.is_boundary;
          await api.setLabel(
            address,
            nodeData?.label_type || 'user',
            nodeData?.label_name ?? null,
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
              nodeData?.is_boundary ? true : false,
            );
          }
          break;
        }
        case 'copy-address':
          navigator.clipboard.writeText(address);
          break;
        case 'view-explorer':
          window.open(`https://explorer.aptoslabs.com/account/${address}?network=mainnet`, '_blank');
          break;
        case 'track': {
          const alias = prompt('Alias for this address (optional):', '');
          await api.addAddress(address, alias || undefined);
          break;
        }
      }

      hideContextMenu();

      if (action !== 'copy-address') {
        onRefresh();
      }
    });
}
