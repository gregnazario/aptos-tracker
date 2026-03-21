import { Router } from 'express';
import {
  deleteLabel,
  getLabel,
  listCategories,
  listLabels,
  upsertCategory,
  upsertLabel,
} from '../../db/queries.js';

export function labelRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const labels = listLabels();
    res.json(labels);
  });

  // Export all labels + entry function categories as JSON
  router.get('/export', (_req, res) => {
    const addressLabels = listLabels();
    const entryFunctionCategories = listCategories();
    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      address_labels: addressLabels.map(({ updated_at, ...rest }) => rest),
      entry_function_categories: entryFunctionCategories.map(
        ({ id, updated_at, ...rest }) => rest,
      ),
    });
  });

  // Import labels + categories from JSON (upsert)
  router.post('/import', (req, res) => {
    const { address_labels, entry_function_categories } = req.body;
    let labelsCount = 0;
    let categoriesCount = 0;

    if (Array.isArray(address_labels)) {
      for (const l of address_labels) {
        if (!l.address) continue;
        upsertLabel(l.address, {
          label_type: l.label_type,
          label_name: l.label_name,
          is_boundary: l.is_boundary,
          source: l.source,
          confidence: l.confidence,
        });
        labelsCount++;
      }
    }

    if (Array.isArray(entry_function_categories)) {
      for (const c of entry_function_categories) {
        if (!c.pattern || !c.tax_category) continue;
        upsertCategory({
          pattern: c.pattern,
          match_type: c.match_type,
          tax_category: c.tax_category,
          label: c.label,
          source: c.source,
          confidence: c.confidence,
        });
        categoriesCount++;
      }
    }

    res.json({ ok: true, imported: { labels: labelsCount, categories: categoriesCount } });
  });

  router.get('/:address', (req, res) => {
    const label = getLabel(req.params.address);
    if (!label) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }
    res.json(label);
  });

  router.put('/:address', (req, res) => {
    const { label_type, label_name, is_boundary, source, confidence } =
      req.body;
    upsertLabel(req.params.address, {
      label_type,
      label_name,
      is_boundary:
        is_boundary !== undefined ? (is_boundary ? 1 : 0) : undefined,
      source: source || 'manual',
      confidence,
    });
    res.json({ ok: true });
  });

  router.delete('/:address', (req, res) => {
    deleteLabel(req.params.address);
    res.json({ ok: true });
  });

  return router;
}
