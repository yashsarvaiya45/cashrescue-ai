import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { limitPublicCalculations } from '../src/routes/sandbox.js';

const origin = 'https://cashrescue-demo.example';
let server;
let base;

beforeAll(async () => {
  server = createApp({ mode: 'public-demo', publicOrigin: origin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});

afterAll(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
});

describe('production public service', () => {
  it('supports an exact hosted origin behind an ingress and rejects other browser origins', async () => {
    const seed = await fetch(base + '/api/v1/sandbox', { headers: { Origin: origin, 'X-Forwarded-Host': 'ignored.example' } });
    expect(seed.status).toBe(200);
    const { ledger } = await seed.json();
    const body = JSON.stringify({ synthetic: true, ledger, operation: { type: 'simulate', actions: [] } });
    const run = (headers) => fetch(base + '/api/v1/sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body,
    });
    expect((await run({ Origin: origin })).status).toBe(200);
    const forbidden = await run({ Origin: 'https://outside.example', 'X-Forwarded-Host': 'outside.example' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('access-control-allow-origin')).toBeNull();
    expect(await forbidden.json()).toMatchObject({ error: { code: 'SANDBOX_ORIGIN' } });
    expect((await run({ Origin: origin, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });

  it('applies the same public origin restriction to legacy template and simulation POSTs', async () => {
    for (const path of ['analysis/simulate', 'ai/explanation', 'invoices/invoice-paper/reminder-draft']) {
      const response = await fetch(base + '/api/v1/' + path, { method: 'POST', headers: { Origin: 'null' } });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'SANDBOX_ORIGIN' } });
    }
  });

  it('keeps health private from caches and sends browser security headers', async () => {
    const response = await fetch(base + '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'disabled' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('keeps unknown API routes and malformed JSON as sanitized JSON errors', async () => {
    const missing = await fetch(base + '/api/v1/missing', { headers: { Accept: 'text/html' } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
    const invalid = await fetch(base + '/api/v1/sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sensitive-test-value":',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: 'INVALID_JSON', message: 'Send a valid JSON request.' } });
  });

  it('validates the public origin and refuses non-loopback editable hosts', () => {
    expect(readEnv({ PUBLIC_DEMO: 'true', HOST: '0.0.0.0', PORT: '10000', PUBLIC_ORIGIN: origin })).toMatchObject({
      PUBLIC_DEMO: true, HOST: '0.0.0.0', PORT: 10000, PUBLIC_ORIGIN: origin,
    });
    expect(() => readEnv({ PUBLIC_ORIGIN: origin })).toThrow();
    expect(() => readEnv({ HOST: '0.0.0.0' })).toThrow();
    for (const value of [origin + '/foo', origin + '/', 'https://user@example.com', 'file:///demo']) {
      expect(() => readEnv({ PUBLIC_DEMO: 'true', PUBLIC_ORIGIN: value })).toThrow();
    }
  });

  it('bounds concurrent work and releases a slot when the response closes', () => {
    const limit = limitPublicCalculations({ concurrent: 1 });
    const req = { ip: '127.0.0.1' };
    let release;
    const res = { set() {}, once(_event, callback) { release = callback; } };
    let accepted = 0;
    const next = () => { accepted += 1; };
    limit(req, res, next);
    expect(() => limit(req, res, next)).toThrow(expect.objectContaining({ status: 429, code: 'SANDBOX_RATE_LIMIT' }));
    release();
    limit(req, res, next);
    expect(accepted).toBe(2);
  });
});
