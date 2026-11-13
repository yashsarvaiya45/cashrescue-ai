import express from 'express';
import { z } from 'zod';
import { draftReminder, explainCrisis, languageSchema } from '../ai/drafts.js';
import {
  expenseInputSchema, expensePatchSchema, invoiceInputSchema, invoicePatchSchema, ledgerIdSchema,
  MAX_SANDBOX_RECORDS, sandboxLedgerSchema, settingsInputSchema,
} from '../domain/ledger-input.js';
import { rescueActionsSchema } from '../domain/rescue.js';
import { LedgerError } from '../ledger/errors.js';
import { createMemoryRepository } from '../ledger/repository.js';
import { createLedgerService } from '../ledger/service.js';

const actions = rescueActionsSchema.max(MAX_SANDBOX_RECORDS);
const operations = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('settings'), values: settingsInputSchema }),
  z.strictObject({ type: z.literal('addInvoice'), values: invoiceInputSchema }),
  z.strictObject({ type: z.literal('editInvoice'), id: ledgerIdSchema, values: invoicePatchSchema }),
  z.strictObject({ type: z.literal('addExpense'), values: expenseInputSchema }),
  z.strictObject({ type: z.literal('editExpense'), id: ledgerIdSchema, values: expensePatchSchema }),
  z.strictObject({ type: z.literal('delete'), kind: z.enum(['invoices', 'expenses']), id: ledgerIdSchema }),
  z.strictObject({ type: z.literal('simulate'), actions }),
  z.strictObject({ type: z.literal('explain'), actions, language: languageSchema }),
  z.strictObject({ type: z.literal('reminder'), id: ledgerIdSchema, language: languageSchema }),
]);
const requestSchema = z.strictObject({
  synthetic: z.literal(true), ledger: sandboxLedgerSchema, operation: operations,
});

export function limitPublicCalculations({ perAddress = 40, total = 160, concurrent = 8, windowMs = 60_000 } = {}) {
  let expires = 0;
  let count = 0;
  let active = 0;
  const addresses = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (now >= expires) {
      expires = now + windowMs;
      count = 0;
      addresses.clear();
    }
    const address = req.ip;
    const used = addresses.get(address) ?? 0;
    if (count >= total || used >= perAddress || active >= concurrent) {
      res.set('Retry-After', String(active >= concurrent ? 2 : Math.ceil((expires - now) / 1000)));
      throw new LedgerError(429, 'SANDBOX_RATE_LIMIT', 'The demo is busy. Wait a moment and try again.');
    }
    count += 1;
    active += 1;
    addresses.set(address, used + 1);
    res.once('close', () => { active -= 1; });
    next();
  };
}

export function checkPublicRequestOrigin(publicOrigin) {
  return (req, _res, next) => {
    if (req.get('Sec-Fetch-Site') === 'cross-site') {
      throw new LedgerError(403, 'SANDBOX_ORIGIN', 'Open the demo directly to use the sandbox.');
    }
    const origin = req.get('Origin');
    if (origin) {
      let valid = false;
      try {
        const url = new URL(origin);
        valid = publicOrigin ? origin === publicOrigin
          : ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === req.get('host');
      } catch { /* Reject malformed origins below. */ }
      if (!valid) throw new LedgerError(403, 'SANDBOX_ORIGIN', 'Open the demo directly to use the sandbox.');
    }
    next();
  };
}

function workspace(ledger) {
  // The repository belongs to this request only and is never shared or saved.
  const repository = createMemoryRepository(ledger);
  const service = createLedgerService(repository, 'demo');
  return {
    service,
    async response() {
      const [ledger, analysis] = await Promise.all([repository.read(), service.analysis()]);
      return { ledger, analysis: { ...analysis, mode: 'public-demo' } };
    },
  };
}

function checkCapacity(records) {
  if (records.length >= MAX_SANDBOX_RECORDS) {
    throw new LedgerError(422, 'SANDBOX_CAPACITY', 'The demo allows up to 20 invoices and 20 expenses.');
  }
}

export function createSandboxRouter(limited) {
  const router = express.Router();
  router.use(limited);
  router.get('/', async (_req, res) => res.json(await workspace().response()));
  router.post('/', express.json({ limit: '32kb', inflate: false }), async (req, res) => {
    if (!req.is('application/json')) throw new LedgerError(415, 'SANDBOX_CONTENT_TYPE', 'Send the sandbox snapshot as JSON.');
    const { ledger, operation } = requestSchema.parse(req.body);
    const current = workspace(ledger);
    const { service } = current;
    const { revision } = ledger;

    switch (operation.type) {
      case 'simulate':
        return res.json(await service.simulate(operation.actions, revision));
      case 'explain':
        return res.json(await explainCrisis(service, null, { ...operation, revision }));
      case 'reminder':
        return res.json(await draftReminder(service, null, operation.id, { ...operation, revision }));
      case 'settings':
        await service.updateSettings(operation.values, revision);
        break;
      case 'addInvoice':
        checkCapacity(ledger.invoices);
        await service.saveRecord('invoices', null, operation.values, revision);
        break;
      case 'editInvoice':
        await service.saveRecord('invoices', operation.id, operation.values, revision);
        break;
      case 'addExpense':
        checkCapacity(ledger.expenses);
        await service.saveRecord('expenses', null, operation.values, revision);
        break;
      case 'editExpense':
        await service.saveRecord('expenses', operation.id, operation.values, revision);
        break;
      case 'delete':
        await service.deleteRecord(operation.kind, operation.id, revision);
        break;
    }
    return res.json(await current.response());
  });
  return router;
}
