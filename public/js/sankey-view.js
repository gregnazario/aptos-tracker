// Asset color palette
const ASSET_COLORS = {
  'APT': '#4393e5',
  'USDC': '#2775ca',
  'USDT': '#26a17b',
  'WETH': '#627eea',
};

function getAssetColor(assetName) {
  if (ASSET_COLORS[assetName]) return ASSET_COLORS[assetName];
  // Generate a consistent color from the asset name
  let hash = 0;
  for (let i = 0; i < (assetName || '').length; i++) {
    hash = assetName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return d3.interpolateRainbow(Math.abs(hash % 360) / 360);
}

function getNodeColor(labelType) {
  const colors = {
    user: '#3fb950',
    dex_pool: '#58a6ff',
    exchange: '#d29922',
    bridge: '#a371f7',
    contract: '#8b949e',
    unknown: '#484f58',
  };
  return colors[labelType] || colors.unknown;
}

function renderSankey(container, data) {
  const svg = d3.select(container);
  svg.selectAll('*').remove();

  const rect = svg.node().parentNode.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (!data.nodes.length) {
    svg.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('No data. Add addresses and sync first.');
    return;
  }

  const margin = { top: 20, right: 150, bottom: 20, left: 150 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth < 50 || innerHeight < 50) return;

  // Clone data — d3-sankey mutates in place
  // d3-sankey cannot handle circular links (A→B and B→A).
  // Resolve by netting: keep only the dominant direction per pair, with value = |A→B - B→A|
  const rawLinks = data.links.filter(l => l.source !== l.target && l.value > 0).map(d => ({ ...d }));

  const netted = new Map();
  for (const link of rawLinks) {
    const fwdKey = `${link.source}|${link.target}|${link.asset_type}`;
    const revKey = `${link.target}|${link.source}|${link.asset_type}`;

    if (netted.has(revKey)) {
      const rev = netted.get(revKey);
      if (link.value > rev.value) {
        // Forward dominates — replace reverse with net forward
        netted.delete(revKey);
        netted.set(fwdKey, { ...link, value: link.value - rev.value, transfer_count: link.transfer_count + rev.transfer_count });
      } else if (link.value < rev.value) {
        // Reverse dominates — reduce it
        rev.value -= link.value;
        rev.transfer_count += link.transfer_count;
      } else {
        // Equal — remove both (net zero)
        netted.delete(revKey);
      }
    } else {
      netted.set(fwdKey, { ...link });
    }
  }

  const nettedLinks = Array.from(netted.values()).filter(l => l.value > 0);

  // Only keep nodes that are referenced by remaining links
  const usedNodeIndices = new Set();
  for (const l of nettedLinks) {
    usedNodeIndices.add(l.source);
    usedNodeIndices.add(l.target);
  }

  // Build new node array and remap link indices
  const filteredNodes = [];
  const indexMap = new Map();
  data.nodes.forEach((d, i) => {
    if (usedNodeIndices.has(i)) {
      indexMap.set(i, filteredNodes.length);
      filteredNodes.push({ ...d });
    }
  });

  const graphData = {
    nodes: filteredNodes,
    links: nettedLinks.map(l => ({ ...l, source: indexMap.get(l.source), target: indexMap.get(l.target) })),
  };

  if (graphData.links.length === 0) {
    svg.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('No transfers match current filters.');
    return;
  }

  let graph;
  try {
    const sankeyLayout = d3.sankey()
      .nodeWidth(16)
      .nodePadding(12)
      .nodeAlign(d3.sankeyLeft)
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);
    graph = sankeyLayout(graphData);
  } catch (e) {
    console.error('Sankey layout error:', e);
    svg.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8b949e')
      .text('Unable to render Sankey layout.');
    return;
  }

  // Links
  const link = svg.append('g')
    .selectAll('.sankey-link')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', d => getAssetColor(d.asset_name))
    .attr('stroke-width', d => Math.max(1, d.width))
    .on('mouseover', (event, d) => {
      showTooltip(event, [
        { class: 'tip-label', text: d.asset_name || d.asset_type },
        { class: 'tip-amount', text: formatAmount(d.value) },
        { class: 'tip-detail', text: `${d.transfer_count} transfer(s)` },
        { class: 'tip-detail', text: `${d.source.name} → ${d.target.name}` },
      ]);
    })
    .on('mouseout', hideTooltip);

  // Nodes
  const node = svg.append('g')
    .selectAll('.sankey-node')
    .data(graph.nodes)
    .join('g')
    .attr('class', 'sankey-node')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  node.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('fill', d => getNodeColor(d.label_type))
    .attr('class', d => d.is_boundary ? 'boundary-node' : '')
    .attr('rx', 2)
    .on('mouseover', (event, d) => {
      const parts = [
        { class: 'tip-label', text: d.name },
        { class: 'tip-detail', text: d.id },
        { class: 'tip-detail', text: `Type: ${d.label_type}${d.label_name ? ' (' + d.label_name + ')' : ''}` },
        { class: 'tip-detail', text: `Volume: ${formatAmount(d.total_volume)}` },
      ];
      if (d.is_boundary) parts.push({ class: 'tip-detail', text: 'Boundary', style: 'color:#f85149' });
      showTooltip(event, parts);
    })
    .on('mouseout', hideTooltip)
    .on('contextmenu', (event, d) => {
      event.preventDefault();
      showContextMenu(event, d.id, d);
    });

  // Node labels
  node.append('text')
    .attr('x', d => (d.x1 - d.x0) + 6)
    .attr('y', d => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'start')
    .text(d => d.name)
    .filter(d => d.x0 > width / 2)
    .attr('x', -6)
    .attr('text-anchor', 'end');
}

function formatAmount(val) {
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K';
  return val.toFixed(4);
}
