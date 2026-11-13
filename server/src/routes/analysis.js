import express from 'express';
import { z } from 'zod';
import { revisionSchema } from '../domain/ledger-input.js';
import { rescueActionsSchema } from '../domain/rescue.js';

const simulationRequest = z.strictObject({
  actions: rescueActionsSchema,
  revision: revisionSchema.optional(),
});

export function createAnalysisRouter(service) {
  const router = express.Router();
  router.get('/', async (_req, res) => res.json(await service.analysis()));
  router.post('/simulate', express.json({ limit: '8kb' }), async (req, res) => {
    const { actions, revision } = simulationRequest.parse(req.body);
    res.json(await service.simulate(actions, revision));
  });
  return router;
}
