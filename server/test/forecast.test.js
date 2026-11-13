import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  business,
  expenses,
  expectedForecast,
  forecastInput,
  invoices,
} from '../fixtures/synthetic-business.js';
import { calculateForecast } from '../src/domain/forecast.js';
import { businessSchema, expenseSchema, forecastSchema, invoiceSchema } from '../src/domain/models.js';

const maxPaise = Number.MAX_SAFE_INTEGER;

function forecast(overrides = {}) {
  return calculateForecast({
    forecastStartDate: '2026-11-13',
    openingBalancePaise: 1_000,
    receivables: [],
    expenses: [],
    ...overrides,
  });
}

function invoice(id, dueDate, amountPaise, overrides = {}) {
  return {
    id, dueDate, amountPaise,
    issueDate: '2026-11-01',
    outstandingBalancePaise: amountPaise,
    status: 'open',
    ...overrides,
  };
}

function expense(id, dueDate, amountPaise, status = 'scheduled') {
  return { id, dueDate, amountPaise, status };
}

describe('30-day cash-flow forecast', () => {
  it('carries the opening balance through 30 empty days', () => {
    const result = forecast();
    expect(result.days).toHaveLength(30);
    expect(result.days.every(({ incomingPaise, outgoingPaise, closingBalancePaise }) =>
      incomingPaise === 0 && outgoingPaise === 0 && closingBalancePaise === 1_000)).toBe(true);
    expect(result.minimumCashBalancePaise).toBe(1_000);
  });

  it('reports no shortfall when every close is positive', () => {
    const result = forecast({
      receivables: [invoice('sale', '2026-11-14', 400)],
      expenses: [expense('freight', '2026-11-13', 300)],
    });
    expect(result).toMatchObject({
      firstNegativeBalanceDate: null,
      maximumShortfallPaise: 0,
      negativeDayCount: 0,
      minimumCashBalancePaise: 700,
    });
  });

  it('reports an opening negative balance when day one closes below zero', () => {
    const result = forecast({ openingBalancePaise: -125 });
    expect(result).toMatchObject({
      firstNegativeBalanceDate: '2026-11-13',
      maximumShortfallPaise: 125,
      minimumCashBalancePaise: -125,
      negativeDayCount: 30,
    });
  });

  it('uses the day-one close when a receipt covers negative opening cash', () => {
    const result = forecast({
      openingBalancePaise: -125,
      receivables: [invoice('sale', '2026-11-13', 125)],
    });
    expect(result.firstNegativeBalanceDate).toBeNull();
    expect(result.minimumCashBalancePaise).toBe(0);
  });

  it('nets distinct transactions on the same day and keeps their evidence', () => {
    const result = forecast({
      receivables: [invoice('sale-a', '2026-11-13', 800), invoice('sale-b', '2026-11-13', 500)],
      expenses: [expense('rent', '2026-11-13', 1_700), expense('freight', '2026-11-13', 300)],
    });
    expect(result.days[0]).toMatchObject({
      incomingPaise: 1_300,
      outgoingPaise: 2_000,
      closingBalancePaise: 300,
      receipts: [{ id: 'sale-a', amountPaise: 800 }, { id: 'sale-b', amountPaise: 500 }],
      expenses: [{ id: 'rent', amountPaise: 1_700 }, { id: 'freight', amountPaise: 300 }],
    });
    expect(result.firstNegativeBalanceDate).toBeNull();
  });

  it('uses the expected date and outstanding balance for a later receipt', () => {
    const result = forecast({
      receivables: [invoice('sale', '2026-11-13', 1_400, {
        expectedCollectionDate: '2026-11-16',
        outstandingBalancePaise: 900,
      })],
      expenses: [expense('rent', '2026-11-14', 1_500)],
    });
    expect(result.days.slice(0, 4).map((day) => day.closingBalancePaise)).toEqual([1_000, -500, -500, 400]);
    expect(result.days.map((day) => day.incomingPaise).filter(Boolean)).toEqual([900]);
    expect(result.firstNegativeBalanceDate).toBe('2026-11-14');
    expect(result.nextReceiptDateAfterFirstShortfall).toBe('2026-11-16');
  });

  it('does not count an exact zero close as a shortfall', () => {
    const result = forecast({ expenses: [expense('rent', '2026-11-13', 1_000)] });
    expect(result.minimumCashBalancePaise).toBe(0);
    expect(result.maximumShortfallPaise).toBe(0);
    expect(result.firstNegativeBalanceDate).toBeNull();
  });

  it('rolls forward multiple expenses on separate days', () => {
    const result = forecast({
      expenses: [expense('rent', '2026-11-13', 100), expense('freight', '2026-11-15', 200)],
    });
    expect(result.days.slice(0, 3).map((day) => day.outgoingPaise)).toEqual([100, 0, 200]);
    expect(result.days.slice(0, 3).map((day) => day.closingBalancePaise)).toEqual([900, 900, 700]);
  });

  it('includes both boundaries and excludes day 31 across a leap day', () => {
    const result = forecast({
      forecastStartDate: '2028-02-28',
      receivables: [
        invoice('start', '2028-02-28', 100),
        invoice('end', '2028-03-28', 200),
        invoice('later', '2028-03-29', 300),
      ],
      expenses: [expense('end-expense', '2028-03-28', 150), expense('later-expense', '2028-03-29', 500)],
    });
    expect(result.days).toHaveLength(30);
    expect(new Set(result.days.map((day) => day.date)).size).toBe(30);
    expect(result.days[1].date).toBe('2028-02-29');
    expect(result.days[0]).toMatchObject({ date: '2028-02-28', incomingPaise: 100 });
    expect(result.days.at(-1)).toMatchObject({
      date: '2028-03-28', incomingPaise: 200, outgoingPaise: 150, closingBalancePaise: 1_150,
    });
  });

  it('reports the worst shortfall when it occurs after the first negative day', () => {
    const result = forecast({
      expenses: [expense('rent', '2026-11-14', 1_250), expense('freight', '2026-11-17', 650)],
      receivables: [invoice('sale', '2026-11-19', 1_000)],
    });
    expect(result).toMatchObject({
      firstNegativeBalanceDate: '2026-11-14',
      maximumShortfallPaise: 900,
      minimumCashBalancePaise: -900,
      negativeDayCount: 5,
    });
  });

  it('flags overdue open invoices and expenses and excludes settled records', () => {
    const result = forecast({
      receivables: [
        invoice('overdue-sale', '2026-11-12', 600),
        invoice('rescheduled-sale', '2026-11-12', 200, { expectedCollectionDate: '2026-11-13' }),
        invoice('paid-sale', '2026-11-13', 500, { status: 'paid', outstandingBalancePaise: 0 }),
        invoice('cancelled-sale', '2026-11-13', 500, { status: 'cancelled', outstandingBalancePaise: 0 }),
      ],
      expenses: [
        expense('overdue-rent', '2026-11-10', 300),
        expense('paid-rent', '2026-11-13', 500, 'paid'),
        expense('cancelled-rent', '2026-11-13', 500, 'cancelled'),
      ],
    });
    expect(result.unscheduledReceivableIds).toEqual(['overdue-sale']);
    expect(result.overdueExpenseIds).toEqual(['overdue-rent']);
    expect(result.days[0]).toMatchObject({ incomingPaise: 200, outgoingPaise: 300, closingBalancePaise: 900 });
  });

  it('nets safe same-day totals before adding them to a large opening balance', () => {
    const result = forecast({
      openingBalancePaise: maxPaise,
      receivables: [invoice('sale', '2026-11-13', 1)],
      expenses: [expense('rent', '2026-11-13', 1)],
    });
    expect(result.days[0].closingBalancePaise).toBe(maxPaise);
  });

  it('matches the hand-calculated synthetic ledger and leaves inputs untouched', () => {
    const snapshot = structuredClone(forecastInput);
    const result = calculateForecast(forecastInput);
    const { closingBalanceChanges, ...metrics } = expectedForecast;
    const changes = new Map(closingBalanceChanges);
    let closingBalance;
    expect(result).toMatchObject(metrics);
    for (const day of result.days) {
      closingBalance = changes.get(day.date) ?? closingBalance;
      expect(day.closingBalancePaise).toBe(closingBalance);
    }
    expect(forecastSchema.safeParse(result).success).toBe(true);
    expect(calculateForecast(forecastInput)).toEqual(result);
    expect(forecastInput).toEqual(snapshot);
  });
});

describe('financial input validation', () => {
  it.each([
    ['fractional paise', { openingBalancePaise: 0.01 }],
    ['unsafe paise', { openingBalancePaise: maxPaise + 1 }],
    ['nonfinite paise', { openingBalancePaise: Infinity }],
    ['string paise', { openingBalancePaise: '100' }],
    ['invalid calendar date', { forecastStartDate: '2026-02-29' }],
    ['non-calendar format', { forecastStartDate: '2026-11-13T00:00:00Z' }],
    ['year zero', { forecastStartDate: '0000-01-01' }],
    ['horizon outside four-digit dates', { forecastStartDate: '9999-12-04' }],
    ['unsafe expense amount', { expenses: [expense('rent', '2026-11-13', maxPaise + 1)] }],
    ['invoice due before issue', { receivables: [invoice('sale', '2026-10-31', 100)] }],
    ['collection before issue', {
      receivables: [invoice('sale', '2026-11-13', 100, { expectedCollectionDate: '2026-10-31' })],
    }],
    ['outstanding above face value', {
      receivables: [invoice('sale', '2026-11-13', 100, { outstandingBalancePaise: 101 })],
    }],
    ['paid invoice with outstanding balance', {
      receivables: [invoice('sale', '2026-11-13', 100, { status: 'paid' })],
    }],
    ['zero outstanding on an open invoice', {
      receivables: [invoice('sale', '2026-11-13', 100, { outstandingBalancePaise: 0 })],
    }],
    ['nonpositive expense', { expenses: [expense('rent', '2026-11-13', 0)] }],
    ['duplicate receivable ID', {
      receivables: [invoice('sale', '2026-11-13', 100), invoice('sale', '2026-11-14', 100)],
    }],
    ['duplicate expense ID', {
      expenses: [expense('rent', '2026-11-13', 100), expense('rent', '2026-11-14', 100)],
    }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => forecast(overrides)).toThrow(ZodError);
  });

  it('rejects a safe input set when the daily receipt total overflows', () => {
    expect(() => forecast({
      receivables: [invoice('a', '2026-11-13', maxPaise), invoice('b', '2026-11-13', 1)],
    })).toThrow(RangeError);
  });

  it('rejects a closing balance outside the safe paise range', () => {
    expect(() => forecast({
      openingBalancePaise: -maxPaise,
      expenses: [expense('rent', '2026-11-13', 1)],
    })).toThrow(RangeError);
  });

  it('validates the synthetic business and stored record shapes as INR domain models', () => {
    expect(businessSchema.parse(business)).toEqual(business);
    expect(businessSchema.safeParse({ ...business, currency: 'USD' }).success).toBe(false);
    for (const record of invoices) expect(invoiceSchema.parse(record)).toEqual(record);
    for (const record of expenses) expect(expenseSchema.parse(record)).toEqual(record);
  });
});
