import { fileURLToPath } from 'node:url';
import express from 'express';
import { ZodError } from 'zod';
import { createAnalysisRouter } from './routes/analysis.js';
import { createAiRouter } from './routes/ai.js';
import { createLedgerRouter } from './routes/ledger.js';
import { checkPublicRequestOrigin, createSandboxRouter, limitPublicCalculations } from './routes/sandbox.js';
import { isLoopbackHost } from './config/env.js';
import { LedgerError } from './ledger/errors.js';
import { createMemoryRepository } from './ledger/repository.js';
import { createLedgerService } from './ledger/service.js';

export const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function allowedOrigin(origin) {
  if (!origin) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return ['http:', 'https:'].includes(protocol) && isLoopbackHost(hostname);
  } catch {
    return false;
  }
}

export function createApp({
  getDatabaseStatus, mode = 'demo', repository, aiProvider, aiRateLimit, sandboxRateLimit, publicOrigin,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (mode === 'database' && !repository) throw new Error('Database mode requires a database repository.');
  const service = createLedgerService(mode === 'public-demo' ? createMemoryRepository() : repository ?? createMemoryRepository(), mode);

  app.use((_req, res, next) => {
    res.set(securityHeaders);
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const forwarded = req.get('Forwarded') || req.get('X-Forwarded-Host') || req.get('X-Forwarded-For');
    if (mode !== 'public-demo' && (!isLoopbackHost(req.hostname)
      || !allowedOrigin(req.get('Origin')) || req.get('Sec-Fetch-Site') === 'cross-site' || forwarded)) {
      throw new LedgerError(403, 'LOCAL_ONLY', 'This ledger is accessible from the local workspace only.');
    }
    next();
  });
  if (mode === 'public-demo') {
    const checkOrigin = checkPublicRequestOrigin(publicOrigin);
    app.use('/api', (req, res, next) => {
      if (req.method === 'POST' || /^\/v1\/sandbox(?:\/|$)/i.test(req.path)) return checkOrigin(req, res, next);
      return next();
    });
  }

  app.get(['/api/health', '/api/v1/health'], (_req, res) => {
    const database = mode === 'public-demo' ? 'disabled' : getDatabaseStatus?.() ?? 'disabled';
    const ready = database !== 'unavailable';

    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      database,
    });
  });

  // On managed ingress all clients may appear under one socket address. Keep
  // the process-wide budget and avoid trusting spoofable forwarding headers.
  const publicLimit = mode === 'public-demo'
    ? limitPublicCalculations({ ...(publicOrigin && { perAddress: 160 }), ...sandboxRateLimit })
    : null;
  if (publicLimit) app.post('/api/v1/analysis/simulate', publicLimit);
  app.use('/api/v1/analysis', createAnalysisRouter(service));
  app.use('/api/v1', createAiRouter(service, { mode, provider: aiProvider, rateLimit: aiRateLimit }));
  if (publicLimit) {
    app.use('/api/v1/sandbox', createSandboxRouter(publicLimit));
    app.use(['/api/v1/settings', '/api/v1/invoices', '/api/v1/expenses', '/api/v1/demo/reset'], () => {
      throw new LedgerError(403, 'READ_ONLY', 'Private ledger routes are unavailable. Use the public sandbox.');
    });
  } else {
    app.use('/api/v1', createLedgerRouter(service));
  }
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });
  app.use('/assets', express.static(fileURLToPath(new URL('../../client/dist/assets/', import.meta.url)), {
    maxAge: '1y', immutable: true, index: false, redirect: false,
  }));
  app.use('/assets', (_req, res) => res.status(404).end());
  app.use(express.static(clientDist, {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
    redirect: false,
  }));
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } });
  });
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof LedgerError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, fields: error.fields },
      });
    }

    if (error instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the submitted fields.',
          fields: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
        },
      });
    }

    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      const tooLarge = error.type === 'entity.too.large';
      return res.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
          message: tooLarge ? 'The request is too large.' : 'Send a valid JSON request.',
        },
      });
    }

    if (error.type === 'encoding.unsupported') {
      return res.status(415).json({ error: { code: 'UNSUPPORTED_ENCODING', message: 'Send uncompressed JSON.' } });
    }

    console.error('Unhandled API request error.');
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  });

  return app;
}
