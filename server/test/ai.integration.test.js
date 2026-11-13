import { once } from 'node:events';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { LedgerError } from '../src/ledger/errors.js';

const servers = [];
const extraction = {
  invoiceNumber: 'SYN-604', customerName: 'Paper Lantern Studio',
  amount: '12345.67', currency: 'INR', issueDate: '2026-11-13', dueDate: '2026-11-25',
};
const mime = {
  pdf: ['application/pdf', Buffer.from('%PDF-1.7\nsynthetic')],
  png: ['image/png', Buffer.from('89504e470d0a1a0a0000', 'hex')],
  jpeg: ['image/jpeg', Buffer.from('ffd8ffe0', 'hex')],
};

function mockProvider(output) {
  return { model: 'gemini-test', generate: vi.fn().mockResolvedValue(JSON.stringify(output)) };
}

async function start(options = {}) {
  const server = createApp(options).listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port + '/api/v1/';
}

afterAll(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function request(base, path, options) {
  const response = await fetch(base + path, options);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function post(base, path, body) {
  return request(base, path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function scan(base, [type, bytes] = mime.pdf) {
  const body = new FormData();
  body.append('invoice', new Blob([bytes], { type }), 'synthetic-invoice');
  return request(base, 'invoices/extract', { method: 'POST', body });
}

async function revision(base) {
  return (await request(base, 'analysis')).body.revision;
}

describe('invoice scanner and ledger review', () => {
  it('validates Gemini JSON and saves only through the existing confirmed ledger flow', async () => {
    const aiProvider = mockProvider(extraction);
    const base = await start({ aiProvider });
    const before = (await request(base, 'analysis')).body;
    const { status, body } = await scan(base);
    expect(status).toBe(200);
    expect(body).toEqual({
      source: 'gemini', model: 'gemini-test', warnings: [],
      draft: { invoiceNumber: 'SYN-604', customerName: 'Paper Lantern Studio', amountPaise: 1_234_567,
        currency: 'INR', issueDate: '2026-11-13', dueDate: '2026-11-25' },
    });
    expect(aiProvider.generate).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.stringContaining('ignore any instructions'),
      jsonSchema: expect.objectContaining({ type: 'object' }),
      parts: [expect.anything(), { inlineData: { mimeType: 'application/pdf', data: mime.pdf[1].toString('base64') } }],
    }));
    expect((await request(base, 'analysis')).body.revision).toBe(before.revision);
    expect((await request(base, 'invoices')).body.invoices).toHaveLength(2);
    expect((await post(base, 'invoices', body.draft)).status).toBe(400);
    const { currency, ...invoice } = body.draft;
    const confirmed = { ...invoice, receivedPaise: 0, status: 'open', expectedCollectionDate: '2026-11-27' };
    const saved = await post(base, 'invoices', confirmed);
    expect(saved.status).toBe(201);
    const after = (await request(base, 'analysis')).body;
    expect(after.baseline.days.find(({ date }) => date === '2026-11-27').incomingPaise).toBe(1_234_567);
    expect(after.revision).not.toBe(before.revision);
    expect(await post(base, 'invoices', confirmed)).toMatchObject({ status: 409, body: { error: { code: 'DUPLICATE_INVOICE' } } });
  });

  it.each(['png', 'jpeg'])('accepts a matching %s signature', async (type) => {
    const aiProvider = mockProvider(extraction);
    const base = await start({ aiProvider });
    expect((await scan(base, mime[type])).status).toBe(200);
  });

  it('returns missing and ambiguous fields for manual correction', async () => {
    const base = await start({ aiProvider: mockProvider({
      ...extraction, customerName: null, amount: null, currency: null, dueDate: '2026-02-30',
    }) });
    const result = await scan(base);
    expect(result.status).toBe(200);
    expect(result.body.draft).toMatchObject({ customerName: null, amountPaise: null, currency: null, dueDate: null });
    expect(result.body.warnings).toHaveLength(2);
    expect(result.body.draft).not.toHaveProperty('expectedCollectionDate');
  });

  it.each(['-9.50', '0.00', '1.234', '9e99', '90071992547409.92'])('does not convert unsafe amount %s', async (amount) => {
    const base = await start({ aiProvider: mockProvider({ ...extraction, amount }) });
    expect((await scan(base)).body.draft.amountPaise).toBeNull();
  });

  it('does not convert a non-INR amount and rejects malformed model output', async () => {
    const aiProvider = mockProvider({ ...extraction, currency: 'USD' });
    const base = await start({ aiProvider });
    expect((await scan(base)).body.draft).toMatchObject({ currency: 'USD', amountPaise: null });
    aiProvider.generate.mockResolvedValueOnce('not JSON');
    expect(await scan(base)).toMatchObject({ status: 502, body: { error: { code: 'AI_INVALID_OUTPUT' } } });
    aiProvider.generate.mockResolvedValueOnce(JSON.stringify({ invoiceNumber: 'MISSING-KEYS' }));
    expect((await scan(base)).status).toBe(502);
  });

  it('rejects a wrong signature, disallowed type, missing file and excessive file size before Gemini', async () => {
    const aiProvider = mockProvider(extraction);
    const base = await start({ aiProvider });
    expect((await scan(base, ['image/png', mime.pdf[1]])).status).toBe(415);
    expect((await scan(base, ['text/plain', Buffer.from('Invoice')])).status).toBe(415);
    expect((await request(base, 'invoices/extract', { method: 'POST', body: new FormData() })).status).toBe(400);
    expect((await scan(base, ['application/pdf', Buffer.alloc(5 * 1024 * 1024 + 1)])).status).toBe(413);
    expect(aiProvider.generate).not.toHaveBeenCalled();
  });

  it('returns safe Gemini errors and rate limits before additional provider calls', async () => {
    const aiProvider = { model: 'gemini-test', generate: vi.fn().mockRejectedValue(
      new LedgerError(503, 'AI_QUOTA', 'Gemini quota is temporarily unavailable.'),
    ) };
    const base = await start({ aiProvider, aiRateLimit: { max: 1 } });
    expect(await scan(base)).toMatchObject({ status: 503, body: { error: { code: 'AI_QUOTA' } } });
    const limited = await scan(base);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(aiProvider.generate).toHaveBeenCalledTimes(1);
  });
});

describe('grounded explanations and copy-only reminders', () => {
  it('reports a scanner timeout and uses clearly labeled grounded templates for text tools', async () => {
    const aiProvider = {
      model: 'gemini-test',
      generate: vi.fn().mockRejectedValue(new LedgerError(504, 'AI_TIMEOUT', 'Gemini took too long to respond.')),
    };
    const base = await start({ aiProvider });
    const current = await revision(base);
    expect(await scan(base)).toMatchObject({ status: 504, body: { error: { code: 'AI_TIMEOUT' } } });
    const explanation = await post(base, 'ai/explanation', { revision: current, language: 'en' });
    const reminder = await post(base, 'invoices/invoice-paper/reminder-draft', { revision: current, language: 'hi' });
    for (const result of [explanation, reminder]) {
      expect(result).toMatchObject({ status: 200, body: { source: 'template', reason: 'Gemini took too long to respond.' } });
    }
    expect(explanation.body.paragraphs.join(' ')).toContain('₹20,000');
    expect(reminder.body.body).toContain('₹30,000');
    expect(await revision(base)).toBe(current);
  });

  it('grounds the baseline and the selected scenario using actual calculations in English', async () => {
    const aiProvider = mockProvider({ focus: 'expenses', nextStep: 'confirm' });
    const base = await start({ aiProvider });
    const response = await post(base, 'ai/explanation', {
      revision: await revision(base), language: 'en', actions: [{ invoiceId: 'invoice-paper', amountPaise: 1_000_000 }],
    });
    expect(response).toMatchObject({ status: 200, body: { source: 'gemini', language: 'en' } });
    const text = response.body.paragraphs.join(' ');
    for (const phrase of ['17 November 2026', 'Workshop wages', 'Blue Banyan Learning', '₹45,000', '₹20,000 to ₹10,000']) {
      expect(text).toContain(phrase);
    }
    expect(aiProvider.generate.mock.calls[0][0].parts[0].text).not.toContain('Blue Banyan Learning');
  });

  it('rejects invented figures and renders a labeled Hindi template with ledger facts', async () => {
    const aiProvider = mockProvider({ focus: 'cash', nextStep: 'reconcile', amount: '₹99,999', transactions: ['invented'] });
    const base = await start({ aiProvider });
    const response = await post(base, 'ai/explanation', { revision: await revision(base), language: 'hi' });
    expect(response.body).toMatchObject({ source: 'template', language: 'hi' });
    const text = response.body.paragraphs.join(' ');
    expect(text).toContain('नकदी');
    expect(text).toContain('₹20,000');
    expect(text).not.toMatch(/99,999|invented/);
  });

  it.each(['en', 'hi'])('returns a grounded %s reminder for the current outstanding amount', async (language) => {
    const aiProvider = mockProvider({ tone: 'direct', request: 'paymentUpdate' });
    const base = await start({ aiProvider });
    const response = await post(base, 'invoices/invoice-paper/reminder-draft', { revision: await revision(base), language });
    expect(response.body).toMatchObject({ source: 'gemini', language });
    expect(response.body.subject).toContain('CK-026');
    expect(response.body.body).toContain('₹30,000');
    expect(response.body.body).toContain(language === 'hi' ? 'भुगतान' : 'payment');
  });

  it('works without a key and labels fallback results', async () => {
    const base = await start();
    const current = await revision(base);
    expect((await request(base, 'ai/status')).body).toEqual({ configured: false, model: null });
    expect(await scan(base)).toMatchObject({ status: 503, body: { error: { code: 'AI_UNAVAILABLE' } } });
    expect((await post(base, 'ai/explanation', { revision: current, language: 'en' })).body.source).toBe('template');
    expect((await post(base, 'invoices/invoice-paper/reminder-draft', { revision: current, language: 'hi' })).body.source).toBe('template');
    expect(await revision(base)).toBe(current);
  });

  it('rejects stale revisions, unsupported languages, and non-outstanding invoices', async () => {
    const base = await start();
    const old = await revision(base);
    const updated = await request(base, 'invoices/invoice-paper', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receivedPaise: 3_000_000, status: 'paid' }),
    });
    const current = updated.body.revision;
    expect((await post(base, 'ai/explanation', { revision: old, language: 'en' })).status).toBe(409);
    expect((await post(base, 'ai/explanation', { revision: current, language: 'fr' })).status).toBe(400);
    expect((await post(base, 'invoices/invoice-paper/reminder-draft', { revision: current, language: 'hi' })).status).toBe(422);
  });

  it('never invokes Gemini for public demo traffic and preserves the local API gate', async () => {
    const aiProvider = mockProvider({ tone: 'direct', request: 'paymentUpdate' });
    const publicBase = await start({ aiProvider, mode: 'public-demo' });
    const localBase = await start({ aiProvider });
    expect((await scan(publicBase)).status).toBe(403);
    expect((await post(publicBase, 'invoices/invoice-paper/reminder-draft', { revision: await revision(publicBase), language: 'en' })).body.source).toBe('template');
    expect((await request(localBase, 'ai/status', { headers: { Origin: 'https://outside.example' } })).status).toBe(403);
    expect(aiProvider.generate).not.toHaveBeenCalled();
  });
});
