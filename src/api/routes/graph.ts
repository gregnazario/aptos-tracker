import { Router } from 'express';
import { type GraphNode, getGraphData } from '../../db/queries.js';
import { getAssetDisplayName } from '../../tokens/registry.js';

const TYPE_TAGS: Record<string, string> = {
  dex_pool: 'DEX',
  exchange: 'Exchange',
  bridge: 'Bridge',
  contract: 'Contract',
  staking_pool: 'Staking',
  lending_pool: 'Lending',
};

function buildNodeName(n: GraphNode): string {
  const tag = TYPE_TAGS[n.label_type];
  const base = n.alias || n.label_name || `${n.id.slice(0, 10)}...`;
  if (tag) {
    return `${base} [${tag}]`;
  }
  return base;
}

export function graphRoutes(): Router {
  const router = Router();

  router.get('/sankey', (req, res) => {
    const { from, to, min_amount, asset_type, direction } = req.query;
    const data = getGraphData({
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
      direction: direction as string,
      verified_only: true,
    });

    // Transform for d3-sankey format
    const nodeIndex = new Map<string, number>();
    for (const [i, n] of data.nodes.entries()) {
      nodeIndex.set(n.id, i);
    }

    const sankey = {
      nodes: data.nodes.map((n) => ({
        id: n.id,
        name: buildNodeName(n),
        label_type: n.label_type,
        label_name: n.label_name,
        is_boundary: n.is_boundary,
        total_volume: n.total_volume,
      })),
      links: data.links
        .filter((l) => nodeIndex.has(l.source) && nodeIndex.has(l.target))
        .map((l) => ({
          source: nodeIndex.get(l.source)!,
          target: nodeIndex.get(l.target)!,
          value: l.total_amount,
          asset_type: l.asset_type,
          asset_name: getAssetDisplayName(l.asset_type),
          transfer_count: l.transfer_count,
        })),
    };

    res.json(sankey);
  });

  router.get('/force', (req, res) => {
    const { from, to, min_amount, asset_type, direction } = req.query;
    const data = getGraphData({
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
      direction: direction as string,
      verified_only: true,
    });

    const nodes = data.nodes.map((n) => ({
      ...n,
      name: buildNodeName(n),
    }));

    const links = data.links.map((l) => ({
      ...l,
      asset_name: getAssetDisplayName(l.asset_type),
    }));

    res.json({ nodes, links });
  });

  return router;
}
