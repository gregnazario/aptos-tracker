import { Router } from 'express';
import {
  deleteCategory,
  getDistinctTaxCategories,
  listCategories,
  upsertCategory,
} from '../../db/queries.js';

export function taxRoutes(): Router {
  const router = Router();

  router.get('/categories', (_req, res) => {
    res.json(listCategories());
  });

  router.get('/categories/distinct', (_req, res) => {
    res.json(getDistinctTaxCategories());
  });

  router.put('/categories/:pattern', (req, res) => {
    const pattern = decodeURIComponent(req.params.pattern);
    const { match_type, tax_category, label, source, confidence } = req.body;
    if (!tax_category) {
      res.status(400).json({ error: 'tax_category is required' });
      return;
    }
    upsertCategory({
      pattern,
      match_type: match_type || 'exact',
      tax_category,
      label: label ?? null,
      source: source || 'manual',
      confidence: confidence ?? 1.0,
    });
    res.json({ ok: true });
  });

  router.delete('/categories/:pattern', (req, res) => {
    const pattern = decodeURIComponent(req.params.pattern);
    deleteCategory(pattern);
    res.json({ ok: true });
  });

  return router;
}
