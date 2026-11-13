import { randomUUID } from 'node:crypto';
import { invoiceForDisplay, invoiceForForecast, invoiceInputSchema, expenseInputSchema, normalizeInvoiceNumber } from '../domain/ledger-input.js';
import { addPaise } from '../domain/money.js';
import { createRescueSolver } from '../domain/rescue.js';
import { LedgerError, staleLedger } from './errors.js';
import { createDemoLedger } from './repository.js';

function prepare(ledger) {
  try {
    const { business, invoices, expenses } = ledger;
    const solver = createRescueSolver({
      forecastStartDate: business.forecastStartDate,
      openingBalancePaise: business.openingBalancePaise,
      receivables: invoices.map(invoiceForForecast),
      expenses: expenses.map(({ id, dueDate, amountPaise, status }) => ({ id, dueDate, amountPaise, status })),
    });
    const totals = {
      openingBalancePaise: business.openingBalancePaise,
      expectedReceivablesPaise: solver.baseline.days.reduce((sum, day) => addPaise(sum, day.incomingPaise), 0),
      upcomingExpensesPaise: solver.baseline.days.reduce((sum, day) => addPaise(sum, day.outgoingPaise), 0),
    };
    return { solver, totals };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new LedgerError(422, 'PAISE_RANGE', 'The ledger totals exceed the supported paise range.');
  }
}

const recordSchema = { invoices: invoiceInputSchema, expenses: expenseInputSchema };
const displayRecords = (ledger, type) => type === 'invoices' ? ledger.invoices.map(invoiceForDisplay) : ledger.expenses;

export function createLedgerService(repository, mode) {
  let cached;

  function getPrepared(ledger) {
    if (cached?.revision !== ledger.revision) {
      cached = { revision: ledger.revision, ...prepare(ledger) };
    }
    return cached;
  }

  async function change(expectedRevision, apply) {
    if (mode === 'public-demo') throw new LedgerError(403, 'READ_ONLY', 'The public demo is read-only.');
    const current = await repository.read();
    if (expectedRevision && current.revision !== expectedRevision) throw staleLedger();
    const next = { ...apply(current), revision: randomUUID() };
    const prepared = prepare(next);
    if (!await repository.replace(current.revision, next)) throw staleLedger();
    cached = { revision: next.revision, ...prepared };
    return next;
  }

  async function saveRecord(type, id, values, revision) {
    const recordId = id ?? randomUUID();
    const next = await change(revision, (ledger) => {
      const previous = ledger[type].find((record) => record.id === id);
      if (id && !previous) throw new LedgerError(404, 'RECORD_NOT_FOUND', 'This record no longer exists.');
      const { id: _id, businessId, createdAt, updatedAt, ...oldFields } = previous ?? {};
      const fields = recordSchema[type].parse({ ...oldFields, ...values });
      if (type === 'invoices' && ledger.invoices.some((invoice) =>
        invoice.id !== recordId && normalizeInvoiceNumber(invoice.invoiceNumber) === normalizeInvoiceNumber(fields.invoiceNumber))) {
        throw new LedgerError(409, 'DUPLICATE_INVOICE', 'This invoice number is already in the ledger.', [
          { field: 'invoiceNumber', message: 'Use a unique invoice number.' },
        ]);
      }
      const timestamp = new Date().toISOString();
      const record = { ...fields, id: recordId, businessId: ledger.business.id, createdAt: createdAt ?? timestamp, updatedAt: timestamp };
      const records = previous
        ? ledger[type].map((item) => item.id === recordId ? record : item)
        : [...ledger[type], record];
      return { ...ledger, [type]: records };
    });
    return { record: displayRecords(next, type).find((entry) => entry.id === recordId), revision: next.revision };
  }

  return {
    async analysis() {
      const ledger = await repository.read();
      const prepared = getPrepared(ledger);
      const { solver, totals } = prepared;
      const { baseline, candidates, earlyDate, leadDays } = solver;
      prepared.recommendations ??= solver.recommend();
      return {
        business: ledger.business, invoices: displayRecords(ledger, 'invoices'), expenses: ledger.expenses,
        revision: ledger.revision, mode, baseline, totals,
        rescue: {
          candidates, earlyDate, leadDays,
          hasShortage: baseline.maximumShortfallPaise > 0,
          baselineShortfallPaise: baseline.maximumShortfallPaise,
          ...prepared.recommendations,
        },
      };
    },
    async simulate(actions, revision) {
      const ledger = await repository.read();
      if (revision && revision !== ledger.revision) throw staleLedger();
      try {
        return { scenario: getPrepared(ledger).solver.simulate(actions), revision: ledger.revision };
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new LedgerError(422, 'PAISE_RANGE', 'The scenario exceeds the supported paise range.');
      }
    },
    async settings() {
      const { business, revision } = await repository.read();
      return { business, revision, mode };
    },
    async records(type) {
      const ledger = await repository.read();
      return { [type]: displayRecords(ledger, type), revision: ledger.revision };
    },
    saveRecord,
    async updateSettings(values, revision) {
      const next = await change(revision, (ledger) => ({ ...ledger, business: { ...ledger.business, ...values } }));
      return { business: next.business, revision: next.revision };
    },
    async deleteRecord(type, id, revision) {
      const next = await change(revision, (ledger) => {
        const records = ledger[type].filter((entry) => entry.id !== id);
        if (records.length === ledger[type].length) throw new LedgerError(404, 'RECORD_NOT_FOUND', 'This record no longer exists.');
        return { ...ledger, [type]: records };
      });
      return { revision: next.revision };
    },
    async reset(revision) {
      if (mode !== 'demo') throw new LedgerError(403, 'RESET_DISABLED', 'Reset is available in local demo mode only.');
      const next = await change(revision, createDemoLedger);
      return { revision: next.revision };
    },
  };
}
