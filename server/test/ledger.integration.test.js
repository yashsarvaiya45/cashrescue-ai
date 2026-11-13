import { once } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const servers = [];
let base;

async function start(options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port + '/api/v1/';
}

async function call(path, { body, method = 'GET', revision, headers, url = base } = {}) {
  const response = await fetch(url + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(revision && { 'X-Ledger-Revision': revision }), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const invoice = {
  invoiceNumber: 'TRIAL-001', customerName: 'Mango Grove Books', issueDate: '2026-11-13',
  dueDate: '2026-11-23', amountPaise: 1_500_075, receivedPaise: 0, status: 'open',
};
const expense = {
  label: 'Paper delivery', category: 'Supplies', dueDate: '2026-11-16', amountPaise: 1_500_000, status: 'scheduled',
};
const settings = {
  name: 'Paper Trail Stationery', currency: 'INR', forecastStartDate: '2026-11-13', openingBalancePaise: 1_000_000,
};

beforeAll(async () => { base = await start(); });
beforeEach(async () => { expect((await call('demo/reset', { method: 'POST' })).status).toBe(200); });
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('editable demo ledger API', () => {
  it('creates, lists and edits an invoice with partial receipts and a distinct expected date', async () => {
    const created = await call('invoices', { method: 'POST', body: invoice });
    expect(created.status).toBe(201);
    const { id } = created.body.record;
    expect(created.body.record.outstandingBalancePaise).toBe(1_500_075);
    const updated = await call('invoices/' + id, {
      method: 'PATCH', revision: created.body.revision,
      body: { receivedPaise: 500_050, expectedCollectionDate: '2026-11-24' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.record).toMatchObject({
      id, status: 'open', outstandingBalancePaise: 1_000_025, dueDate: '2026-11-23',
      expectedCollectionDate: '2026-11-24', receivedPaise: 500_050,
    });
    const analysis = (await call('analysis')).body;
    expect(analysis.baseline.days.find(({ date }) => date === '2026-11-24').incomingPaise).toBe(1_000_025);
    expect((await call('invoices')).body.invoices).toContainEqual(updated.body.record);
    const paid = await call('invoices/' + id, {
      method: 'PATCH', body: { status: 'paid', receivedPaise: 1_500_075, expectedCollectionDate: null },
    });
    expect(paid.body.record.outstandingBalancePaise).toBe(0);
    expect(paid.body.record.expectedCollectionDate).toBeUndefined();
    expect((await call('analysis')).body.baseline.days.find(({ date }) => date === '2026-11-23').incomingPaise).toBe(0);
  });

  it('deletes invoices and removes their forecast receipts', async () => {
    const { record, revision } = (await call('invoices', { method: 'POST', body: invoice })).body;
    expect((await call('invoices/' + record.id, { method: 'DELETE', revision })).status).toBe(200);
    expect((await call('invoices')).body.invoices.some(({ id }) => id === record.id)).toBe(false);
    const analysis = (await call('analysis')).body;
    expect(analysis.baseline.days.find(({ date }) => date === invoice.dueDate).incomingPaise).toBe(0);
    expect((await call('invoices/' + record.id, { method: 'DELETE' })).status).toBe(404);
  });

  it('creates, edits and deletes expenses and refreshes the shortage and KPIs', async () => {
    const created = await call('expenses', { method: 'POST', body: expense });
    expect(created.status).toBe(201);
    const { id } = created.body.record;
    const analysis = (await call('analysis')).body;
    expect(analysis.totals.upcomingExpensesPaise).toBe(7_625_025);
    expect(analysis.baseline.maximumShortfallPaise).toBe(3_500_000);
    expect((await call('expenses/' + id, { method: 'PATCH', body: { status: 'paid' } })).status).toBe(200);
    expect((await call('analysis')).body.totals.upcomingExpensesPaise).toBe(6_125_025);
    expect((await call('expenses/' + id, { method: 'DELETE' })).status).toBe(200);
    expect((await call('expenses')).body.expenses.some((entry) => entry.id === id)).toBe(false);
  });

  it('updates cash settings and invalidates old simulations and edits', async () => {
    const before = (await call('analysis')).body;
    const action = [{ invoiceId: 'invoice-paper', amountPaise: 1_000_000 }];
    const live = await call('analysis/simulate', { method: 'POST', body: { actions: action, revision: before.revision } });
    expect(live.body.scenario.forecast.maximumShortfallPaise).toBe(1_000_000);

    const changed = await call('settings', { method: 'PUT', revision: before.revision, body: { ...settings, openingBalancePaise: 6_000_000 } });
    expect(changed.status).toBe(200);
    const after = (await call('analysis')).body;
    expect(after.revision).toBe(changed.body.revision);
    expect(after.business.name).toBe(settings.name);
    expect(after.totals.openingBalancePaise).toBe(6_000_000);
    expect(after.baseline.firstNegativeBalanceDate).toBeNull();
    expect(after.rescue.scenarios).toEqual([]);
    const stale = await call('analysis/simulate', { method: 'POST', body: { actions: action, revision: before.revision } });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'STALE_LEDGER' } } });
    expect((await call('expenses', { method: 'POST', revision: before.revision, body: expense })).status).toBe(409);
  });

  it('rejects duplicate numbers across customers, including case and whitespace variants', async () => {
    const created = (await call('invoices', { method: 'POST', body: invoice })).body;
    const duplicate = await call('invoices', {
      method: 'POST', body: { ...invoice, invoiceNumber: ' trial-001 ', customerName: 'New customer' },
    });
    expect(duplicate).toMatchObject({ status: 409, body: { error: { code: 'DUPLICATE_INVOICE', fields: [{ field: 'invoiceNumber' }] } } });
    expect((await call('invoices/' + created.record.id, { method: 'PATCH', body: { invoiceNumber: 'CK-026' } })).status).toBe(409);
    expect((await call('invoices')).body.invoices).toHaveLength(3);
  });

  it.each([
    ['negative amount', { amountPaise: -1 }],
    ['fractional amount', { amountPaise: 1.25 }],
    ['unsafe amount', { amountPaise: Number.MAX_SAFE_INTEGER + 1 }],
    ['string amount', { amountPaise: 'Infinity' }],
    ['non-finite JSON amount', { amountPaise: Infinity }],
    ['received amount above total', { receivedPaise: 1_500_076 }],
    ['inconsistent paid status', { status: 'paid' }],
    ['invalid date', { dueDate: '2026-02-30' }],
    ['due before issue', { dueDate: '2026-11-12' }],
  ])('rejects %s without changing the revision', async (_label, values) => {
    const before = (await call('settings')).body.revision;
    const response = await call('invoices', { method: 'POST', body: { ...invoice, ...values } });
    expect(response).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect((await call('settings')).body.revision).toBe(before);
  });

  it('rejects aggregate overflow before saving and enforces INR', async () => {
    const before = (await call('settings')).body;
    expect((await call('settings', { method: 'PUT', body: { ...settings, currency: 'USD' } })).status).toBe(400);
    const response = await call('invoices', { method: 'POST', body: { ...invoice, amountPaise: Number.MAX_SAFE_INTEGER } });
    expect(response).toMatchObject({ status: 422, body: { error: { code: 'PAISE_RANGE' } } });
    expect((await call('settings')).body.revision).toBe(before.revision);
  });

  it('returns actionable errors for bad IDs and missing records', async () => {
    expect(await call('invoices/invalid%20id', { method: 'DELETE' })).toMatchObject({
      status: 400, body: { error: { code: 'VALIDATION_ERROR' } },
    });
    expect(await call('expenses/missing', { method: 'PATCH', body: expense })).toMatchObject({
      status: 404, body: { error: { code: 'RECORD_NOT_FOUND' } },
    });
  });

  it('serializes conflicting edits and catches simultaneous duplicate writes', async () => {
    const { revision } = (await call('settings')).body;
    const responses = await Promise.all([
      call('invoices', { method: 'POST', body: invoice, revision }),
      call('invoices', { method: 'POST', body: invoice, revision }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect((await call('invoices')).body.invoices.filter(({ invoiceNumber }) => invoiceNumber === invoice.invoiceNumber)).toHaveLength(1);
  });

  it('supports an empty forecast and restores the original demo on reset', async () => {
    const initial = (await call('analysis')).body;
    for (const kind of ['invoices', 'expenses']) {
      for (const { id } of initial[kind]) expect((await call(kind + '/' + id, { method: 'DELETE' })).status).toBe(200);
    }
    await call('settings', { method: 'PUT', body: { ...settings, openingBalancePaise: 0 } });
    const empty = (await call('analysis')).body;
    expect(empty.invoices).toEqual([]);
    expect(empty.expenses).toEqual([]);
    expect(empty.baseline.days).toHaveLength(30);
    expect(empty.baseline.days.every(({ closingBalancePaise }) => closingBalancePaise === 0)).toBe(true);
    expect(empty.rescue.scenarios).toEqual([]);
    const reset = await call('demo/reset', { method: 'POST', revision: empty.revision });
    expect(reset.status).toBe(200);
    const restored = (await call('analysis')).body;
    expect(restored.business).toEqual(initial.business);
    expect(restored.baseline).toEqual(initial.baseline);
    expect(restored.revision).not.toBe(initial.revision);
  });

  it('blocks untrusted browser origins for local ledgers', async () => {
    expect(await call('analysis', { headers: { Origin: 'https://outside.example' } })).toMatchObject({
      status: 403, body: { error: { code: 'LOCAL_ONLY' } },
    });
    expect((await call('analysis', { headers: { Origin: 'http://127.0.0.1:5174' } })).status).toBe(200);
    expect((await call('analysis', { headers: { 'X-Forwarded-For': '192.0.2.5' } })).status).toBe(403);
  });

  it('serves only synthetic data in public mode even if a database repository is passed', async () => {
    const url = await start({
      mode: 'public-demo',
      getDatabaseStatus: () => 'connected',
      repository: { read() { throw new Error('Public demo accessed the database'); } },
    });
    expect(await call('health', { url })).toMatchObject({ status: 200, body: { database: 'disabled' } });
    const { body } = await call('analysis', { url, headers: { Origin: 'https://outside.example' } });
    expect(body).toMatchObject({ mode: 'public-demo', business: { name: 'Copper Kite Stationery' } });
    expect(await call('invoices', { url, method: 'POST', body: invoice })).toMatchObject({ status: 403, body: { error: { code: 'READ_ONLY' } } });
    expect((await call('demo/reset', { url, method: 'POST' })).status).toBe(403);
    expect((await call('analysis/simulate', { url, method: 'POST', body: { actions: [], revision: body.revision } })).status).toBe(200);
  });
});
