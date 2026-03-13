import { Router } from 'express';
import { getGraphData, type GraphNode } from '../../db/queries.js';

const TYPE_TAGS: Record<string, string> = {
  dex_pool: 'DEX',
  exchange: 'Exchange',
  bridge: 'Bridge',
  contract: 'Contract',
};

function buildNodeName(n: GraphNode): string {
  const tag = TYPE_TAGS[n.label_type];
  // Prefer: alias, then label_name, then truncated address
  const base = n.alias || n.label_name || n.id.slice(0, 10) + '...';
  // Append type tag if it's not a plain user/unknown
  if (tag && base !== n.label_name) {
    // alias exists and differs from label_name — show both
    return `${base} [${tag}]`;
  }
  if (tag) {
    return `${base} [${tag}]`;
  }
  return base;
}

export function graphRoutes(): Router {
  const router = Router();

  router.get('/sankey', (req, res) => {
    const { from, to, min_amount, asset_type } = req.query;
    const data = getGraphData({
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
    });

    // Transform for d3-sankey format
    const nodeIndex = new Map<string, number>();
    data.nodes.forEach((n, i) => nodeIndex.set(n.id, i));

    const sankey = {
      nodes: data.nodes.map(n => ({
        id: n.id,
        name: buildNodeName(n),
        label_type: n.label_type,
        label_name: n.label_name,
        is_boundary: n.is_boundary,
        total_volume: n.total_volume,
      })),
      links: data.links
        .filter(l => nodeIndex.has(l.source) && nodeIndex.has(l.target))
        .map(l => ({
          source: nodeIndex.get(l.source)!,
          target: nodeIndex.get(l.target)!,
          value: l.total_amount,
          asset_type: l.asset_type,
          asset_name: l.asset_name,
          transfer_count: l.transfer_count,
        })),
    };

    res.json(sankey);
  });

  router.get('/force', (req, res) => {
    const { from, to, min_amount, asset_type } = req.query;
    const data = getGraphData({
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
    });

    // Add display name to force nodes
    const nodes = data.nodes.map(n => ({
      ...n,
      name: buildNodeName(n),
    }));

    res.json({ nodes, links: data.links });
  });

  return router;
}
