import { Router } from 'express';
import {
  addTrackedAddress,
  listTrackedAddresses,
  removeTrackedAddress,
  updateTrackedAddressAlias,
} from '../../db/queries.js';

export function addressRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const addresses = listTrackedAddresses();
    res.json(addresses);
  });

  router.post('/', (req, res) => {
    const { address, alias } = req.body;
    if (!address) {
      res.status(400).json({ error: 'address is required' });
      return;
    }
    addTrackedAddress(address, alias);
    res.json({ ok: true, address, alias });
  });

  router.patch('/:address', (req, res) => {
    const { alias } = req.body;
    if (alias === undefined) {
      res.status(400).json({ error: 'alias is required' });
      return;
    }
    updateTrackedAddressAlias(req.params.address, alias || null);
    res.json({ ok: true });
  });

  router.delete('/:address', (req, res) => {
    removeTrackedAddress(req.params.address);
    res.json({ ok: true });
  });

  return router;
}
