import { Router } from 'express';
import { getDistinctAssetTypes, getDistinctEntryFunctions, listCategories, queryTransfers } from '../../db/queries.js';
import { resolveTaxCategory } from '../../tax/categories.js';
import { getAssetDisplayName } from '../../tokens/registry.js';

export function transferRoutes(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const { address, sender, receiver, from, to, min_amount, asset_type, tax_category, limit, offset } =
      req.query;
    let transfers = queryTransfers({
      address: address as string,
      sender: sender as string,
      receiver: receiver as string,
      from: from as string,
      to: to as string,
      min_amount: min_amount ? parseFloat(min_amount as string) : undefined,
      asset_type: asset_type as string,
      verified_only: req.query.verified_only !== 'false',
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    // Post-filter by tax_category if requested
    if (tax_category) {
      const rules = listCategories();
      transfers = transfers.filter((t) => {
        const resolved = resolveTaxCategory(t.entry_function, rules);
        return resolved.category === tax_category;
      });
    }

    res.json(transfers);
  });

  router.get('/assets', (_req, res) => {
    const assetTypes = getDistinctAssetTypes();
    const assets = assetTypes.map((type) => ({
      asset_type: type,
      display_name: getAssetDisplayName(type),
    }));
    res.json(assets);
  });

  router.get('/entry-functions', (_req, res) => {
    const fns = getDistinctEntryFunctions();
    res.json(fns);
  });

  router.get('/entry-functions/categorized', (_req, res) => {
    const fns = getDistinctEntryFunctions();
    const rules = listCategories();
    const categorized = fns.map((fn) => {
      const resolved = resolveTaxCategory(fn.entry_function, rules);
      return {
        entry_function: fn.entry_function,
        count: fn.count,
        tax_category: resolved.category,
        confidence: resolved.confidence,
        matched_rule: resolved.matched_rule,
      };
    });
    res.json(categorized);
  });

  return router;
}
