import * as d3 from 'd3';
import {
  sankey as d3Sankey,
  sankeyLeft,
  sankeyLinkHorizontal,
} from 'd3-sankey';
import type { SankeyData, SankeyLink, SankeyNode } from './api-client.js';
import {
  hideTooltip,
  showContextMenu,
  showTooltip,
  type TooltipPart,
} from './context-menu.js';
import { showTxModal } from './tx-modal.js';

const ASSET_COLORS: Record<string, string> = {
  APT: '#4393e5',
  USDC: '#2775ca',
  USDT: '#26a17b',
  WETH: '#627eea',
};

export function getAssetColor(assetName: string | null): string {
  if (assetName && ASSET_COLORS[assetName]) return ASSET_COLORS[assetName];
  let hash = 0;
  for (let i = 0; i < (assetName || '').length; i++) {
    hash = assetName!.charCodeAt(i) + ((hash << 5) - hash);
  }
  return d3.interpolateRainbow(Math.abs(hash % 360) / 360);
}

export function getNodeColor(labelType: string): string {
  const colors: Record<string, string> = {
    user: '#3fb950',
    dex_pool: '#58a6ff',
    exchange: '#d29922',
    bridge: '#a371f7',
    contract: '#8b949e',
    unknown: '#484f58',
  };
  return colors[labelType] || colors.unknown;
}

export function formatAmount(val: number): string {
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
  return val.toFixed(4);
}

export function renderSankey(container: SVGSVGElement, data: SankeyData): void {
  const svg = d3.select(container);
  svg.selectAll('*').remove();

  const rect = (svg.node()!.parentNode as HTMLElement).getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (!data.nodes.length) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('No data. Add addresses and sync first.');
    return;
  }

  const margin = { top: 20, right: 150, bottom: 20, left: 150 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth < 50 || innerHeight < 50) return;

  // d3-sankey cannot handle circular links (A→B and B→A).
  // Resolve by netting: keep only the dominant direction per pair, with value = |A→B - B→A|
  const rawLinks = data.links
    .filter((l) => l.source !== l.target && l.value > 0)
    .map((d) => ({ ...d }));

  const netted = new Map<string, SankeyLink>();
  for (const link of rawLinks) {
    const fwdKey = `${link.source}|${link.target}|${link.asset_type}`;
    const revKey = `${link.target}|${link.source}|${link.asset_type}`;

    if (netted.has(revKey)) {
      const rev = netted.get(revKey)!;
      if (link.value > rev.value) {
        netted.delete(revKey);
        netted.set(fwdKey, {
          ...link,
          value: link.value - rev.value,
          transfer_count: link.transfer_count + rev.transfer_count,
        });
      } else if (link.value < rev.value) {
        rev.value -= link.value;
        rev.transfer_count += link.transfer_count;
      } else {
        netted.delete(revKey);
      }
    } else {
      netted.set(fwdKey, { ...link });
    }
  }

  const nettedLinks = Array.from(netted.values()).filter((l) => l.value > 0);

  // Only keep nodes that are referenced by remaining links
  const usedNodeIndices = new Set<number>();
  for (const l of nettedLinks) {
    usedNodeIndices.add(l.source as number);
    usedNodeIndices.add(l.target as number);
  }

  // Build new node array and remap link indices
  const filteredNodes: SankeyNode[] = [];
  const indexMap = new Map<number, number>();
  for (const [i, d] of data.nodes.entries()) {
    if (usedNodeIndices.has(i)) {
      indexMap.set(i, filteredNodes.length);
      filteredNodes.push({ ...d });
    }
  }

  const graphData = {
    nodes: filteredNodes,
    links: nettedLinks.map((l) => ({
      ...l,
      source: indexMap.get(l.source as number)!,
      target: indexMap.get(l.target as number)!,
    })),
  };

  if (graphData.links.length === 0) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('No transfers match current filters.');
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: d3-sankey returns loosely typed layout
  let graph: any;
  try {
    const sankeyLayout = d3Sankey()
      .nodeWidth(16)
      .nodePadding(12)
      .nodeAlign(sankeyLeft)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ]);
    graph = sankeyLayout(graphData as never);
  } catch (e) {
    console.error('Sankey layout error:', e);
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('Unable to render Sankey layout.');
    return;
  }

  const links = graph.links as SankeyLink[];
  const nodes = graph.nodes as SankeyNode[];

  // Links
  svg
    .append('g')
    .selectAll<SVGPathElement, SankeyLink>('.sankey-link')
    .data(links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', sankeyLinkHorizontal() as unknown as string)
    .attr('stroke', (d) => getAssetColor(d.asset_name))
    .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
    .on('mouseover', (event: MouseEvent, d) => {
      showTooltip(event, [
        { class: 'tip-label', text: d.asset_name || d.asset_type },
        { class: 'tip-amount', text: formatAmount(d.value) },
        { class: 'tip-detail', text: `${d.transfer_count} transfer(s)` },
        {
          class: 'tip-detail',
          text: `${(d.source as SankeyNode).name} → ${(d.target as SankeyNode).name}`,
        },
      ]);
    })
    .on('mouseout', hideTooltip)
    .on('contextmenu', (event: MouseEvent, d) => {
      event.preventDefault();
      const source = d.source as SankeyNode;
      const target = d.target as SankeyNode;
      showTxModal(source.id, target.id, source.name, target.name, d.asset_type);
    });

  // Nodes
  const node = svg
    .append('g')
    .selectAll<SVGGElement, SankeyNode>('.sankey-node')
    .data(nodes)
    .join('g')
    .attr('class', 'sankey-node')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

  node
    .append('rect')
    .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
    .attr('height', (d) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
    .attr('fill', (d) => getNodeColor(d.label_type))
    .attr('class', (d) => (d.is_boundary ? 'boundary-node' : ''))
    .attr('rx', 2)
    .on('mouseover', (event: MouseEvent, d) => {
      const parts: TooltipPart[] = [
        { class: 'tip-label', text: d.name },
        { class: 'tip-detail', text: d.id },
        {
          class: 'tip-detail',
          text: `Type: ${d.label_type}${d.label_name ? ` (${d.label_name})` : ''}`,
        },
        {
          class: 'tip-detail',
          text: `Volume: ${formatAmount(d.total_volume)}`,
        },
      ];
      if (d.is_boundary)
        parts.push({
          class: 'tip-detail',
          text: 'Boundary',
          style: 'color:#f85149',
        });
      showTooltip(event, parts);
    })
    .on('mouseout', hideTooltip)
    .on('contextmenu', (event: MouseEvent, d) => {
      event.preventDefault();
      showContextMenu(event, d.id, d);
    });

  // Node labels
  node
    .append('text')
    .attr('x', (d) => (d.x1 ?? 0) - (d.x0 ?? 0) + 6)
    .attr('y', (d) => ((d.y1 ?? 0) - (d.y0 ?? 0)) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'start')
    .text((d) => d.name)
    .filter((d) => (d.x0 ?? 0) > width / 2)
    .attr('x', -6)
    .attr('text-anchor', 'end');
}
