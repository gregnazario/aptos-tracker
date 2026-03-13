function renderForce(container, data) {
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

  // Build node map for link references
  const nodeMap = new Map(data.nodes.map(n => [n.id, n]));

  // Scale for node radius based on volume
  const maxVol = Math.max(...data.nodes.map(n => n.total_volume), 1);
  const radiusScale = d3.scaleSqrt().domain([0, maxVol]).range([5, 30]);

  // Scale for link width
  const maxAmt = Math.max(...data.links.map(l => l.total_amount), 1);
  const linkWidthScale = d3.scaleLinear().domain([0, maxAmt]).range([1, 8]);

  // Create zoom behavior
  const g = svg.append('g');
  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  // Build simulation
  const simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links)
      .id(d => d.id)
      .distance(100))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => radiusScale(d.total_volume) + 5));

  // Links
  const link = g.append('g')
    .selectAll('.force-link')
    .data(data.links)
    .join('line')
    .attr('class', 'force-link')
    .attr('stroke', d => getAssetColor(d.asset_name))
    .attr('stroke-width', d => linkWidthScale(d.total_amount))
    .on('mouseover', (event, d) => {
      showTooltip(event, [
        { class: 'tip-label', text: d.asset_name || d.asset_type },
        { class: 'tip-amount', text: formatAmount(d.total_amount) },
        { class: 'tip-detail', text: `${d.transfer_count} transfer(s)` },
      ]);
    })
    .on('mouseout', hideTooltip);

  // Arrow markers
  svg.append('defs').selectAll('marker')
    .data(['arrow'])
    .join('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#8b949e');

  link.attr('marker-end', 'url(#arrow)');

  // Nodes
  const node = g.append('g')
    .selectAll('.force-node')
    .data(data.nodes)
    .join('circle')
    .attr('class', d => `force-node ${d.is_boundary ? 'boundary-node' : ''}`)
    .attr('r', d => radiusScale(d.total_volume))
    .attr('fill', d => getNodeColor(d.label_type))
    .on('mouseover', (event, d) => {
      const parts = [
        { class: 'tip-label', text: d.name || d.id.slice(0, 10) + '...' },
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
    })
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }));

  // Labels
  const label = g.append('g')
    .selectAll('.force-label')
    .data(data.nodes)
    .join('text')
    .attr('class', 'force-label')
    .attr('text-anchor', 'middle')
    .attr('dy', d => -radiusScale(d.total_volume) - 4)
    .text(d => d.name || d.id.slice(0, 8) + '...');

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    label
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });
}
