import express from 'express';
import {
  expenseInputSchema, expensePatchSchema, invoiceInputSchema, invoicePatchSchema,
  ledgerIdSchema, revisionSchema, settingsInputSchema,
} from '../domain/ledger-input.js';

const recordInputs = [
  ['invoices', invoiceInputSchema, invoicePatchSchema],
  ['expenses', expenseInputSchema, expensePatchSchema],
];

function readRevision(req) {
  return revisionSchema.optional().parse(req.get('X-Ledger-Revision'));
}

export function createLedgerRouter(service) {
  const router = express.Router();
  const json = express.json({ limit: '8kb' });

  router.get('/settings', async (_req, res) => res.json(await service.settings()));
  router.put('/settings', json, async (req, res) => {
    res.json(await service.updateSettings(settingsInputSchema.parse(req.body), readRevision(req)));
  });

  for (const [type, createInput, patchInput] of recordInputs) {
    router.get('/' + type, async (_req, res) => res.json(await service.records(type)));
    router.post('/' + type, json, async (req, res) => {
      const result = await service.saveRecord(type, null, createInput.parse(req.body), readRevision(req));
      res.status(201).json(result);
    });
    router.patch('/' + type + '/:id', json, async (req, res) => {
      const id = ledgerIdSchema.parse(req.params.id);
      res.json(await service.saveRecord(type, id, patchInput.parse(req.body), readRevision(req)));
    });
    router.delete('/' + type + '/:id', async (req, res) => {
      const id = ledgerIdSchema.parse(req.params.id);
      res.json(await service.deleteRecord(type, id, readRevision(req)));
    });
  }

  router.post('/demo/reset', async (req, res) => res.json(await service.reset(readRevision(req))));
  return router;
}
