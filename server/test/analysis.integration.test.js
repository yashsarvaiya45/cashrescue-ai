import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let server;
let base;

beforeAll(async () => {
  server = createApp({ getDatabaseStatus: () => 'disabled' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});

afterAll(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const simulate = (body) => fetch(base + '/api/v1/analysis/simulate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});

describe('credential-free analysis API', () => {
  it('serves the existing health endpoint', async () => {
    const response = await fetch(base + '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: 'disabled' });
  });

  it('returns the fixture with the crisis, totals and ranked rescue', async () => {
    const response = await fetch(base + '/api/v1/analysis');
    expect(response.status).toBe(200);
    const analysis = await response.json();
    expect(analysis.totals).toEqual({
      openingBalancePaise: 2_500_000, expectedReceivablesPaise: 4_850_050, upcomingExpensesPaise: 6_125_025,
    });
    expect(analysis.baseline).toMatchObject({ firstNegativeBalanceDate: '2026-11-17', maximumShortfallPaise: 2_000_000 });
    expect(analysis.rescue.scenarios[0].forecast.maximumShortfallPaise).toBe(0);
    expect(analysis.rescue.scenarios[0].forecast.days).toHaveLength(30);
  });

  it('applies a custom collection and keeps the demo baseline unchanged', async () => {
    const response = await simulate(JSON.stringify({ actions: [{ invoiceId: 'invoice-paper', amountPaise: 1_000_000 }] }));
    expect(response.status).toBe(200);
    const { scenario } = await response.json();
    expect(scenario.forecast.maximumShortfallPaise).toBe(1_000_000);
    expect(scenario.forecast.days[8].incomingPaise).toBe(2_000_000);
    const analysis = await fetch(base + '/api/v1/analysis').then((value) => value.json());
    expect(analysis.baseline.days[8].incomingPaise).toBe(3_000_000);
  });

  it('rejects an oversized collection with a field error', async () => {
    const response = await simulate(JSON.stringify({ actions: [{ invoiceId: 'invoice-paper', amountPaise: 3_000_001 }] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', fields: [{ field: '0.amountPaise' }] },
    });
  });

  it('rejects malformed and oversized JSON with the correct error status', async () => {
    const malformed = await simulate('{');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
    const oversized = await simulate(JSON.stringify({ unused: 'x'.repeat(9_000) }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});
