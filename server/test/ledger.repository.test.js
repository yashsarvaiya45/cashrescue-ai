import { describe, expect, it, vi } from 'vitest';
import { readEnv } from '../src/config/env.js';
import { createDemoLedger, createMemoryRepository, createMongoRepository } from '../src/ledger/repository.js';
import { amountInput, formatDate, formatPaise, readAmount } from '../../client/src/format.js';

describe('ledger storage and configuration', () => {
  it('formats year boundaries and exact Indian currency without shifting business dates', () => {
    expect(formatDate('2026-12-31', true)).toBe('31 December 2026');
    expect(formatDate('2027-01-01', true)).toBe('1 January 2027');
    expect(formatDate('2027-01-01', 4)).toBe('1 Jan');
    expect(formatPaise(-12_345_601)).toBe('−₹1,23,456.01');
  });
  it('isolates memory repositories and rejects a stale atomic replacement', async () => {
    const initial = createDemoLedger();
    const a = createMemoryRepository(initial);
    const b = createMemoryRepository(initial);
    const edited = { ...createDemoLedger(), invoices: [] };
    expect(await a.replace(initial.revision, edited)).toBe(true);
    expect(await a.replace(initial.revision, initial)).toBe(false);
    expect((await a.read()).invoices).toEqual([]);
    expect((await b.read()).invoices).toHaveLength(2);
  });

  it('initializes an empty database workspace and compares revisions on Mongo updates', async () => {
    const findOneAndUpdate = vi.fn((_filter, { $setOnInsert }) => ({
      lean: async () => $setOnInsert,
    }));
    const model = {
      findById: vi.fn(() => ({ lean: async () => null })),
      findOneAndUpdate,
      updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 }),
    };
    const repository = createMongoRepository({ connection: { readyState: 1 }, model });
    const initial = await repository.read();
    expect(initial).toMatchObject({ business: { openingBalancePaise: 0, currency: 'INR' }, invoices: [], expenses: [] });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'cashrescue-ledger' }, { $setOnInsert: { snapshot: initial } }, expect.objectContaining({ upsert: true }),
    );
    const next = createDemoLedger();
    expect(await repository.replace(initial.revision, next)).toBe(true);
    expect(await repository.replace(initial.revision, next)).toBe(false);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: 'cashrescue-ledger', 'snapshot.revision': initial.revision }, { $set: { snapshot: next } }, { runValidators: true },
    );
  });

  it('reads existing Mongo data without reseeding and fails cleanly when offline', async () => {
    const ledger = createDemoLedger();
    const connection = { readyState: 1 };
    const model = { findById: vi.fn(() => ({ lean: async () => ({ snapshot: ledger }) })) };
    const repository = createMongoRepository({ connection, model });
    expect(await repository.read()).toEqual(ledger);
    connection.readyState = 0;
    await expect(repository.read()).rejects.toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    await expect(repository.replace(ledger.revision, ledger)).rejects.toMatchObject({ status: 503 });
    expect(model.findById).toHaveBeenCalledTimes(1);
  });

  it('refuses an externally bound editable server and permits public demo', () => {
    expect(() => readEnv({ HOST: '0.0.0.0', MONGODB_URI: 'mongodb://localhost/ledger' })).toThrow();
    expect(readEnv({ HOST: '0.0.0.0', PUBLIC_DEMO: 'true' }).PUBLIC_DEMO).toBe(true);
    expect(readEnv({}).HOST).toBe('127.0.0.1');
  });

  it('converts decimal rupees exactly and rejects invalid financial input', () => {
    expect(readAmount('0.29')).toBe(29);
    expect(readAmount('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(readAmount('90071992547409.92')).toBeNull();
    expect(readAmount('-0.01')).toBeNull();
    expect(readAmount('-0.01', { signed: true })).toBe(-1);
    expect(amountInput(-1)).toBe('-0.01');
    for (const invalid of ['1.001', 'Infinity', 'NaN', '1e3', '']) expect(readAmount(invalid)).toBeNull();
  });
});
