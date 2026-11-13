import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { forecastInput } from '../fixtures/synthetic-business.js';
import { calculateForecast } from '../src/domain/forecast.js';
import { createRescueSolver } from '../src/domain/rescue.js';

const payment = (invoiceId, amountPaise) => ({ invoiceId, amountPaise });

function receivable(id, dueDate, outstandingBalancePaise, overrides = {}) {
  return {
    id, issueDate: '2026-11-01', dueDate, amountPaise: outstandingBalancePaise,
    outstandingBalancePaise, status: 'open', ...overrides,
  };
}

function expense(id, dueDate, amountPaise) {
  return { id, dueDate, amountPaise, status: 'scheduled' };
}

function input(overrides = {}) {
  return {
    forecastStartDate: '2026-11-13', openingBalancePaise: 100, receivables: [],
    expenses: [expense('wages', '2026-11-17', 200)], ...overrides,
  };
}

const day = (forecast, date) => forecast.days.find((entry) => entry.date === date);

describe('reverse cash-flow rescue solver', () => {
  it('restores the baseline curve after the original date of a partial receipt', () => {
    const solver = createRescueSolver(forecastInput);
    const scenario = solver.simulate([payment('invoice-paper', 1_234_567)]);
    const action = scenario.actions[0];
    expect(action.amountPaise + action.remainingPaise).toBe(action.outstandingBalancePaise);
    for (const [index, baselineDay] of solver.baseline.days.entries()) {
      const moved = baselineDay.date >= action.earlyDate && baselineDay.date < action.scheduledDate;
      expect(scenario.forecast.days[index].closingBalancePaise - baselineDay.closingBalancePaise)
        .toBe(moved ? action.amountPaise : 0);
    }
  });
  it('recommends the necessary partial collection for the synthetic fixture', () => {
    const snapshot = structuredClone(forecastInput);
    const solver = createRescueSolver(forecastInput);
    const best = solver.recommend().scenarios[0];

    expect(solver.baseline).toEqual(calculateForecast(forecastInput));
    expect(solver.earlyDate).toBe('2026-11-15');
    expect(best.actions).toEqual([{
      invoiceId: 'invoice-paper', amountPaise: 2_000_000, remainingPaise: 1_000_000,
      outstandingBalancePaise: 3_000_000, earlyDate: '2026-11-15', scheduledDate: '2026-11-21',
    }]);
    expect(best).toMatchObject({
      totalEarlyPaise: 2_000_000, shortfallReductionPaise: 2_000_000,
      baselineShortageDate: '2026-11-17', baselineShortageClosingPaise: -2_000_000,
      closingOnBaselineShortageDatePaise: 0,
      forecast: { maximumShortfallPaise: 0, negativeDayCount: 0 },
    });
    expect(day(best.forecast, '2026-11-15').receipts).toEqual([{ id: 'invoice-paper', amountPaise: 2_000_000 }]);
    expect(day(best.forecast, '2026-11-21').receipts).toEqual([{ id: 'invoice-paper', amountPaise: 1_000_000 }]);
    expect(day(best.forecast, '2026-11-21').closingBalancePaise).toBe(1_000_000);
    expect(best.forecast.days.at(-1).closingBalancePaise).toBe(solver.baseline.days.at(-1).closingBalancePaise);
    expect(forecastInput).toEqual(snapshot);
  });

  it('moves the full outstanding amount and removes the later receipt', () => {
    const result = createRescueSolver(forecastInput).simulate([payment('invoice-paper', 3_000_000)]);
    expect(day(result.forecast, '2026-11-15').incomingPaise).toBe(3_000_000);
    expect(day(result.forecast, '2026-11-21').incomingPaise).toBe(0);
    expect(day(result.forecast, '2026-11-17').closingBalancePaise).toBe(1_000_000);
    expect(day(result.forecast, '2026-11-21').closingBalancePaise).toBe(1_000_000);
  });

  it('collects two invoices when neither can rescue the business alone', () => {
    const solver = createRescueSolver(input({
      receivables: [receivable('a', '2026-11-20', 60), receivable('b', '2026-11-24', 70)],
    }));
    const { scenarios } = solver.recommend();
    expect(scenarios[0].actions).toHaveLength(2);
    expect(scenarios[0].totalEarlyPaise).toBe(100);
    expect(scenarios[0].forecast.maximumShortfallPaise).toBe(0);
    expect(solver.simulate([payment('a', 60)]).forecast.maximumShortfallPaise).toBe(40);
    expect(solver.simulate([payment('b', 70)]).forecast.maximumShortfallPaise).toBe(30);
  });

  it('reports the later shortfall after the accelerated invoice would have arrived', () => {
    const solver = createRescueSolver(input({
      receivables: [receivable('a', '2026-11-20', 140)],
      expenses: [expense('wages', '2026-11-17', 200), expense('rent', '2026-11-22', 80)],
    }));
    const { scenarios } = solver.recommend();
    const best = scenarios[0];
    expect(day(best.forecast, '2026-11-17').closingBalancePaise).toBe(0);
    expect(day(best.forecast, '2026-11-22').closingBalancePaise).toBe(-40);
    expect(best.forecast.firstNegativeBalanceDate).toBe('2026-11-22');
    expect(best.forecast.maximumShortfallPaise).toBe(40);
    expect(best.forecast.negativeDayCount).toBe(21);
    expect(best.forecast.days.every((entry, index) => entry.closingBalancePaise >= solver.baseline.days[index].closingBalancePaise)).toBe(true);
  });

  it('keeps an unavoidable first shortage before the two-day lead time', () => {
    const solver = createRescueSolver(input({
      forecastStartDate: '2026-11-30', openingBalancePaise: -50,
      receivables: [receivable('a', '2026-12-06', 50)], expenses: [],
    }));
    const best = solver.recommend().scenarios[0];
    expect(solver.earlyDate).toBe('2026-12-02');
    expect(best.forecast.firstNegativeBalanceDate).toBe('2026-11-30');
    expect(best.forecast.maximumShortfallPaise).toBe(50);
    expect(best.forecast.negativeDayCount).toBe(2);
  });

  it('can accelerate a receipt beyond day 30 and caps the amount at outstanding', () => {
    const solver = createRescueSolver(input({
      receivables: [receivable('a', '2026-12-13', 40, { amountPaise: 150 })],
    }));
    const best = solver.recommend().scenarios[0];
    expect(best.totalEarlyPaise).toBe(40);
    expect(best.forecast.maximumShortfallPaise).toBe(60);
    expect(best.forecast.days.at(-1).closingBalancePaise).toBe(-60);
  });

  it('uses the expected date and excludes settled, overdue, future-issued and non-helpful invoices', () => {
    const solver = createRescueSolver(input({
      receivables: [
        receivable('expected', '2026-11-14', 10, { expectedCollectionDate: '2026-11-20' }),
        receivable('same', '2026-11-15', 20),
        receivable('overdue', '2026-11-10', 20),
        receivable('before-shortage', '2026-11-16', 20),
        receivable('future', '2026-11-23', 20, { issueDate: '2026-11-14' }),
        receivable('paid', '2026-11-23', 20, { status: 'paid', outstandingBalancePaise: 0 }),
        receivable('cancelled', '2026-11-23', 20, { status: 'cancelled', outstandingBalancePaise: 0 }),
      ],
    }));
    expect(solver.candidates).toEqual([{
      invoiceId: 'expected', outstandingBalancePaise: 10, scheduledDate: '2026-11-20', earlyDate: '2026-11-15',
    }]);
    expect(day(solver.simulate([payment('expected', 3)]).forecast, '2026-11-20').incomingPaise).toBe(7);
  });

  it('returns the baseline for an empty simulation and skips search without a shortage', () => {
    const solver = createRescueSolver(input({ openingBalancePaise: 300 }));
    expect(solver.simulate([]).forecast).toEqual(solver.baseline);
    expect(solver.recommend()).toEqual({
      scenarios: [], search: { eligibleInvoiceCount: 0, consideredInvoiceCount: 0, evaluatedScenarioCount: 0, skippedForRange: 0 },
    });
  });

  it('ranks equally effective scenarios deterministically by action count, amount and invoice ID', () => {
    const receivables = ['c', 'b', 'a'].map((id) => receivable(id, '2026-11-20', 140));
    const first = createRescueSolver(input({ receivables })).recommend().scenarios;
    const second = createRescueSolver(input({ receivables: receivables.toReversed() })).recommend().scenarios;
    expect(first.map(({ actions }) => actions.map(({ invoiceId, amountPaise }) => [invoiceId, amountPaise]))).toEqual([
      [['a', 100]], [['b', 100]], [['c', 100]],
    ]);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
  });

  it('reports the cap and still allows manual simulation of an eligible invoice outside it', () => {
    const receivables = Array.from({ length: 11 }, (_, index) =>
      receivable('invoice-' + String(index).padStart(2, '0'), '2026-11-25', 1));
    const solver = createRescueSolver(input({ receivables }));
    expect(solver.recommend().search).toMatchObject({
      eligibleInvoiceCount: 11, consideredInvoiceCount: 10, evaluatedScenarioCount: 1023,
    });
    expect(solver.simulate([payment('invoice-10', 1)]).totalEarlyPaise).toBe(1);
  });

  it.each([
    ['unknown invoices', [payment('unknown', 1)]],
    ['duplicate actions', [payment('invoice-paper', 1), payment('invoice-paper', 2)]],
    ['excess collection', [payment('invoice-paper', 3_000_001)]],
    ['fractional paise', [payment('invoice-paper', 0.5)]],
    ['negative amounts', [payment('invoice-paper', -1)]],
    ['unsafe integers', [payment('invoice-paper', Number.MAX_SAFE_INTEGER + 1)]],
    ['unapproved dates', [{ ...payment('invoice-paper', 10), earlyDate: '2026-11-13' }]],
  ])('rejects %s', (_label, actions) => {
    expect(() => createRescueSolver(forecastInput).simulate(actions)).toThrow(ZodError);
  });
});
