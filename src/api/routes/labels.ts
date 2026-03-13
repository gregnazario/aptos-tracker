import { Router } from 'express';
import {
  deleteLabel,
  getLabel,
  listLabels,
  upsertLabel,
} from '../../db/queries.js';

export function labelRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const labels = listLabels();
    res.json(labels);
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
