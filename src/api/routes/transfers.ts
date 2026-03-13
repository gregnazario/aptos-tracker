import { Router } from 'express';
import { queryTransfers, getDistinctAssetTypes } from '../../db/queries.js';

export function transferRoutes(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { address, from, to, min_amount, asset_type, limit, offset } = req.query;
    const transfers = queryTransfers({
      address: address as string,
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(transfers);
  });

  router.get('/assets', (_req, res) => {
    const assets = getDistinctAssetTypes();
    res.json(assets);
  });

  return router;
}
