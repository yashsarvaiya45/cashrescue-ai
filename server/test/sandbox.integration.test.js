import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const servers = [];
const repository = { read: vi.fn(), replace: vi.fn() };
const aiProvider = { model: 'gemini-test', generate: vi.fn() };
let base;

async function start(options = {}) {
  const server = createApp({ mode: 'public-demo', repository, aiProvider, ...options }).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port + '/api/v1/';
}

beforeAll(async () => { base = await start({ sandboxRateLimit: { perAddress: 150 } }); });
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function request(path, options, url = base) {
  const response = await fetch(url + path, options);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function seed() {
  const result = await request('sandbox');
  expect(result.status).toBe(200);
  return result.body;
}

function post(body, url, headers = {}) {
  return request('sandbox', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, url);
}

async function apply(ledger, operation) {
  const result = await post({ synthetic: true, ledger, operation });
  expect(result.status, JSON.stringify(result.body.error)).toBe(200);
  return result.body;
}

const invoice = {
  invoiceNumber: 'SANDBOX-105', customerName: 'Paper Finch Books', issueDate: '2026-11-13',
  dueDate: '2026-11-22', expectedCollectionDate: '2026-11-16', amountPaise: 1_200_075,
  receivedPaise: 200_050, status: 'open',
};
const expense = {
  label: 'Demo delivery deposit', category: 'Logistics', dueDate: '2026-11-17', amountPaise: 1_200_000, status: 'scheduled',
};

describe('public demo sandbox', () => {
  it('isolates concurrent visitors, recalculates edits and supports independent reset', async () => {
    const [visitorA, visitorB] = await Promise.all([seed(), seed()]);
    expect(visitorA.ledger.revision).not.toBe(visitorB.ledger.revision);
    const [a, b] = await Promise.all([
      apply(visitorA.ledger, { type: 'addInvoice', values: invoice }),
      apply(visitorB.ledger, { type: 'addExpense', values: expense }),
    ]);
    expect(a.analysis.totals.expectedReceivablesPaise).toBe(5_850_075);
    expect(a.analysis.baseline.maximumShortfallPaise).toBe(999_975);
    expect(b.analysis.totals.upcomingExpensesPaise).toBe(7_325_025);
    expect(b.analysis.baseline.maximumShortfallPaise).toBe(3_200_000);
    expect(a.ledger.expenses).toHaveLength(3);
    expect(b.ledger.invoices).toHaveLength(2);
    const fresh = await seed();
    expect(fresh.ledger.invoices).toHaveLength(2);
    expect(fresh.ledger.expenses).toHaveLength(3);
    expect(fresh.analysis.baseline).toEqual(visitorA.analysis.baseline);
    const stillB = await apply(b.ledger, { type: 'simulate', actions: [] });
    expect(stillB.scenario.forecast.maximumShortfallPaise).toBe(3_200_000);
    expect(repository.read).not.toHaveBeenCalled();
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it('edits dates, deletes invoices and expenses, and updates opening cash', async () => {
    const initial = await seed();
    const a = await apply(initial.ledger, { type: 'addInvoice', values: invoice });
    const id = a.ledger.invoices.at(-1).id;
    const b = await apply(a.ledger, { type: 'editInvoice', id, values: { expectedCollectionDate: '2026-11-24' } });
    expect(b.analysis.baseline.maximumShortfallPaise).toBe(2_000_000);
    expect(b.analysis.baseline.days.find(({ date }) => date === '2026-11-24').incomingPaise).toBe(1_000_025);
    expect(b.analysis.rescue.candidates.map(({ invoiceId }) => invoiceId)).toContain(id);
    const c = await apply(b.ledger, { type: 'delete', kind: 'invoices', id });
    expect(c.analysis.totals.expectedReceivablesPaise).toBe(initial.analysis.totals.expectedReceivablesPaise);
    const d = await apply(c.ledger, { type: 'editExpense', id: 'expense-payroll', values: { amountPaise: 5_000_000 } });
    expect(d.analysis.baseline.maximumShortfallPaise).toBe(2_500_000);
    const e = await apply(d.ledger, { type: 'delete', kind: 'expenses', id: 'expense-payroll' });
    expect(e.analysis.baseline.firstNegativeBalanceDate).toBeNull();
    const { id: _businessId, ...values } = e.ledger.business;
    const f = await apply(e.ledger, { type: 'settings', values: { ...values, openingBalancePaise: 100_000 } });
    expect(f.analysis.totals.openingBalancePaise).toBe(100_000);
  });

  it('runs the existing solver, using the visitor ledger, with exact partial collection math', async () => {
    const { ledger } = await seed();
    const edited = await apply(ledger, { type: 'addExpense', values: expense });
    const result = await apply(edited.ledger, { type: 'simulate', actions: [
      { invoiceId: 'invoice-paper', amountPaise: 2_000_000 },
    ] });
    expect(result.scenario.forecast.maximumShortfallPaise).toBe(1_200_000);
    expect(result.scenario.forecast.days[8].incomingPaise).toBe(1_000_000);
    expect(edited.analysis.rescue.scenarios[0].forecast.maximumShortfallPaise).toBe(0);
    expect(edited.analysis.baseline.days[8].incomingPaise).toBe(3_000_000);
  });

  it('uses templates grounded in edits and keeps Gemini and MongoDB unused', async () => {
    const { ledger } = await seed();
    const edited = await apply(ledger, { type: 'addExpense', values: expense });
    const explanation = await apply(edited.ledger, { type: 'explain', language: 'en', actions: [] });
    expect(explanation.source).toBe('template');
    expect(explanation.paragraphs.join(' ')).toContain('Demo delivery deposit');
    expect(explanation.paragraphs.join(' ')).toContain('₹32,000');
    const reminder = await apply(edited.ledger, { type: 'reminder', language: 'hi', id: 'invoice-paper' });
    expect(reminder).toMatchObject({ source: 'template', language: 'hi' });
    expect(reminder.body).toContain('₹30,000');
    expect(aiProvider.generate).not.toHaveBeenCalled();
    expect(repository.read).not.toHaveBeenCalled();
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it('rejects non-synthetic markers, cross-business records, invalid dates and unsafe numbers', async () => {
    const { ledger } = await seed();
    const operation = { type: 'simulate', actions: [] };
    const wrongWorkspace = { ...ledger, business: { ...ledger.business, id: 'private-business' } };
    const wrongRecord = { ...ledger, invoices: [{ ...ledger.invoices[0], businessId: 'private-business' }] };
    for (const body of [
      { synthetic: false, ledger, operation },
      { synthetic: true, ledger: wrongWorkspace, operation },
      { synthetic: true, ledger: wrongRecord, operation },
      { synthetic: true, ledger, operation: { type: 'addInvoice', values: { ...invoice, dueDate: '2026-02-31' } } },
      { synthetic: true, ledger, operation: { type: 'addInvoice', values: { ...invoice, amountPaise: Number.MAX_SAFE_INTEGER + 1 } } },
    ]) {
      expect(await post(body)).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    }
    const malformedAction = await post({ synthetic: true, ledger, operation: { ...operation, actions: [{ invoiceId: 'private-id', amountPaise: 100 }] } });
    expect(malformedAction.status).toBe(400);
  });

  it('rejects duplicate invoice numbers in both edits and submitted snapshots', async () => {
    const { ledger } = await seed();
    const duplicate = await post({ synthetic: true, ledger, operation: { type: 'addInvoice', values: { ...invoice, invoiceNumber: ' ck-026 ' } } });
    expect(duplicate).toMatchObject({ status: 409, body: { error: { code: 'DUPLICATE_INVOICE' } } });
    const tampered = { ...ledger, invoices: [ledger.invoices[0], { ...ledger.invoices[1], invoiceNumber: 'ck-026' }] };
    expect((await post({ synthetic: true, ledger: tampered, operation: { type: 'simulate', actions: [] } })).status).toBe(400);
  });

  it('bounds request size, record counts and compressed bodies', async () => {
    const { ledger } = await seed();
    const payload = { synthetic: true, ledger, operation: { type: 'simulate', actions: [] } };
    expect(await post({ ...payload, padding: 'x'.repeat(33 * 1024) })).toMatchObject({
      status: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE' } },
    });
    const bounded = { ...ledger, invoices: Array.from({ length: 20 }, (_, index) => ({
      ...ledger.invoices[0], id: 'sample-' + index, invoiceNumber: 'SAMPLE-' + index,
    })) };
    const atLimit = await post({ ...payload, ledger: bounded, operation: { type: 'addInvoice', values: invoice } });
    expect(atLimit).toMatchObject({ status: 422, body: { error: { code: 'SANDBOX_CAPACITY' } } });
    const tooMany = { ...bounded, invoices: [...bounded.invoices, ledger.invoices[0]] };
    expect((await post({ ...payload, ledger: tooMany })).status).toBe(400);
    expect(await request('sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: gzipSync(JSON.stringify(payload)),
    })).toMatchObject({ status: 415, body: { error: { code: 'UNSUPPORTED_ENCODING' } } });
  });

  it('protects private ledger routes and rate limits public calculations', async () => {
    for (const path of ['settings', 'invoices', 'expenses', 'demo/reset']) {
      expect((await request(path)).status).toBe(403);
      expect((await request(path, { method: 'POST' })).status).toBe(403);
    }
    expect((await request('invoices/extract', { method: 'POST' })).status).toBe(403);
    expect((await request('sandbox', { headers: { Origin: 'https://outside.example' } })).status).toBe(403);
    const url = await start({ sandboxRateLimit: { perAddress: 1 } });
    expect((await request('sandbox', {}, url)).status).toBe(200);
    const limited = await request('sandbox', {}, url);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('preserves local edits and local Gemini configuration while keeping sandbox routes private to demo mode', async () => {
    const url = await start({ mode: 'demo', repository: undefined });
    expect((await request('sandbox', {}, url)).status).toBe(404);
    expect((await request('ai/status', {}, url)).body.configured).toBe(true);
    const added = await request('invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice),
    }, url);
    expect(added.status).toBe(201);
    expect((await request('invoices', {}, url)).body.invoices).toHaveLength(3);
    expect((await request('invoices', { headers: { Origin: 'https://outside.example' } }, url)).status).toBe(403);
  });
});
