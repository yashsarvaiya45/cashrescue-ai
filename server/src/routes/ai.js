import express from 'express';
import { z } from 'zod';
import { draftReminder, explainCrisis, languageSchema } from '../ai/drafts.js';
import { extractInvoice } from '../ai/extraction.js';
import { readInvoiceUpload } from '../ai/upload.js';
import { ledgerIdSchema, revisionSchema } from '../domain/ledger-input.js';
import { rescueActionsSchema } from '../domain/rescue.js';
import { LedgerError } from '../ledger/errors.js';

const draftInput = z.strictObject({ revision: revisionSchema, language: languageSchema });
const explainInput = draftInput.extend({ actions: rescueActionsSchema.default([]) });

// This process serves one local workspace. A shared window bounds provider
// usage and the concurrent limit caps memory held by multipart uploads.
function limitAi({ max = 12, windowMs = 60_000, concurrent = 2 } = {}) {
  let resetAt = 0;
  let used = 0;
  let active = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now >= resetAt) {
      resetAt = now + windowMs;
      used = 0;
    }
    if (active >= concurrent || used >= max) {
      res.set('Retry-After', String(active >= concurrent ? 3 : Math.max(1, Math.ceil((resetAt - now) / 1000))));
      return next(new LedgerError(429, 'AI_RATE_LIMIT', 'Too many AI requests. Try again shortly.'));
    }
    used += 1;
    active += 1;
    res.once('close', () => { active -= 1; });
    return next();
  };
}

export function createAiRouter(service, { mode, provider, rateLimit }) {
  const router = express.Router();
  const activeProvider = mode === 'public-demo' ? null : provider;
  const json = express.json({ limit: '8kb' });
  const limited = limitAi(rateLimit);

  router.get('/ai/status', (_req, res) => res.json({
    configured: Boolean(activeProvider), model: activeProvider?.model ?? null,
  }));
  router.post('/invoices/extract', (_req, _res, next) => {
    if (mode === 'public-demo') return next(new LedgerError(403, 'READ_ONLY', 'Invoice upload is unavailable in the public demo.'));
    if (!activeProvider) return next(new LedgerError(503, 'AI_UNAVAILABLE', 'Gemini scanning is unavailable. Enter the invoice manually.'));
    return next();
  }, limited, readInvoiceUpload, async (req, res) => res.json(await extractInvoice(activeProvider, req.file)));
  router.post('/ai/explanation', limited, json, async (req, res) => {
    res.json(await explainCrisis(service, activeProvider, explainInput.parse(req.body)));
  });
  router.post('/invoices/:id/reminder-draft', limited, json, async (req, res) => {
    res.json(await draftReminder(service, activeProvider, ledgerIdSchema.parse(req.params.id), draftInput.parse(req.body)));
  });
  return router;
}
