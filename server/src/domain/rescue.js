import { z } from 'zod';
import { addCalendarDays } from './calendar.js';
import { calculateForecast } from './forecast.js';
import { forecastInputSchema } from './models.js';
import { addPaise, positivePaiseSchema } from './money.js';

const LEAD_DAYS = 2;
const SEARCH_LIMIT = 10;
const RECOMMENDATION_LIMIT = 3;

export const rescueActionsSchema = z.array(z.strictObject({
  invoiceId: z.string().trim().min(1),
  amountPaise: positivePaiseSchema,
}));

function compareId(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareMetric(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sumDailyDeficits(forecast) {
  return forecast.days.reduce((total, { closingBalancePaise }) =>
    closingBalancePaise < 0 ? total - BigInt(closingBalancePaise) : total, 0n);
}

function rankScenarios(a, b) {
  const worstDeficit = compareMetric(a.forecast.maximumShortfallPaise, b.forecast.maximumShortfallPaise);
  const actionCount = a.actions.length - b.actions.length;
  const amount = compareMetric(a.totalEarlyPaise, b.totalEarlyPaise);
  const tie = compareId(a.id, b.id);
  if (worstDeficit) return worstDeficit;

  if (a.forecast.maximumShortfallPaise === 0) {
    return actionCount || amount
      || compareMetric(b.forecast.minimumCashBalancePaise, a.forecast.minimumCashBalancePaise)
      || tie;
  }

  return a.forecast.negativeDayCount - b.forecast.negativeDayCount
    || compareMetric(a.sumDailyDeficits, b.sumDailyDeficits)
    || actionCount || amount || tie;
}

function findCandidates(receivables, startDate, earlyDate, negativeDays) {
  return receivables.flatMap((invoice) => {
    const scheduledDate = invoice.expectedCollectionDate ?? invoice.dueDate;
    if (invoice.status !== 'open' || invoice.issueDate > startDate || scheduledDate <= earlyDate) return [];
    const affectedDays = negativeDays.filter(({ date }) => date >= earlyDate && date < scheduledDate);
    if (affectedDays.length === 0) return [];
    return [{
      invoiceId: invoice.id,
      outstandingBalancePaise: invoice.outstandingBalancePaise,
      scheduledDate,
      earlyDate,
      affectedDays,
    }];
  }).sort((a, b) => b.affectedDays.length - a.affectedDays.length
    || compareMetric(b.outstandingBalancePaise, a.outstandingBalancePaise)
    || compareId(a.invoiceId, b.invoiceId));
}

// Keep the coverage achieved on each shortage day, capped at the amount needed
// to reach zero. Trim in candidate order to produce one lean variant per subset.
// BigInt is internal so even the sum of several safe invoice balances is exact.
function trimCollectionAmounts(subset, negativeDays) {
  const coverage = new Map(negativeDays.map(({ date }) => [date, 0n]));
  for (const candidate of subset) {
    for (const { date } of candidate.affectedDays) {
      coverage.set(date, coverage.get(date) + BigInt(candidate.outstandingBalancePaise));
    }
  }
  const floors = new Map(negativeDays.map(({ date, closingBalancePaise }) => {
    const deficit = -BigInt(closingBalancePaise);
    const covered = coverage.get(date);
    return [date, deficit < covered ? deficit : covered];
  }));

  return subset.flatMap(({ invoiceId, outstandingBalancePaise, affectedDays }) => {
    let removable = BigInt(outstandingBalancePaise);
    for (const { date } of affectedDays) {
      const surplus = coverage.get(date) - floors.get(date);
      if (surplus < removable) removable = surplus;
    }
    for (const { date } of affectedDays) coverage.set(date, coverage.get(date) - removable);
    const amountPaise = outstandingBalancePaise - Number(removable);
    return amountPaise === 0 ? [] : [{ invoiceId, amountPaise }];
  });
}

function withEarlyCollections(input, actions) {
  const actionById = new Map(actions.map((action) => [action.invoiceId, action]));
  const sourceIds = new Map();
  const usedIds = new Set(input.receivables.map(({ id }) => id));

  const receivables = input.receivables.flatMap((invoice) => {
    const action = actionById.get(invoice.id);
    if (!action) return [invoice];

    const earlyReceipt = {
      ...invoice,
      expectedCollectionDate: action.earlyDate,
      outstandingBalancePaise: action.amountPaise,
    };
    if (action.remainingPaise === 0) return [earlyReceipt];

    // The forecast engine requires unique IDs. Keep the ledger receipt on its
    // original ID and translate the temporary early receipt back after replay.
    let earlyId = 'early:' + invoice.id;
    while (usedIds.has(earlyId)) earlyId = 'early:' + earlyId;
    usedIds.add(earlyId);
    sourceIds.set(earlyId, invoice.id);
    return [
      { ...earlyReceipt, id: earlyId },
      { ...invoice, outstandingBalancePaise: action.remainingPaise },
    ];
  });

  const forecast = calculateForecast({ ...input, receivables });
  for (const day of forecast.days) {
    for (const receipt of day.receipts) receipt.id = sourceIds.get(receipt.id) ?? receipt.id;
  }
  return forecast;
}

export function createRescueSolver(rawInput) {
  const input = forecastInputSchema.parse(rawInput);
  const baseline = calculateForecast(input);
  const earlyDate = addCalendarDays(baseline.forecastStartDate, LEAD_DAYS);
  const negativeDays = baseline.days.filter(({ closingBalancePaise }) => closingBalancePaise < 0);
  const candidates = findCandidates(input.receivables, baseline.forecastStartDate, earlyDate, negativeDays);
  const candidateById = new Map(candidates.map((candidate) => [candidate.invoiceId, candidate]));
  const baselineDeficitSum = sumDailyDeficits(baseline);

  const validatedActions = rescueActionsSchema.superRefine((actions, context) => {
    const seen = new Set();
    for (const [index, { invoiceId, amountPaise }] of actions.entries()) {
      const candidate = candidateById.get(invoiceId);
      if (!candidate || seen.has(invoiceId)) {
        context.addIssue({
          code: 'custom', path: [index, 'invoiceId'],
          message: candidate ? 'Select each invoice once.' : 'This invoice is ineligible for early collection.',
        });
      } else if (amountPaise > candidate.outstandingBalancePaise) {
        context.addIssue({
          code: 'custom', path: [index, 'amountPaise'],
          message: 'Early collection exceeds the outstanding balance.',
        });
      }
      seen.add(invoiceId);
    }
  });

  function replay(requestedActions) {
    const actions = requestedActions.map(({ invoiceId, amountPaise }) => {
      const { outstandingBalancePaise, scheduledDate } = candidateById.get(invoiceId);
      return {
        invoiceId, amountPaise, earlyDate, scheduledDate, outstandingBalancePaise,
        remainingPaise: outstandingBalancePaise - amountPaise,
      };
    }).sort((a, b) => compareId(a.invoiceId, b.invoiceId));
    const forecast = actions.length === 0 ? baseline : withEarlyCollections(input, actions);
    const firstShortageIndex = negativeDays.length === 0 ? -1
      : baseline.days.findIndex(({ date }) => date === baseline.firstNegativeBalanceDate);
    return {
      id: JSON.stringify(actions.map(({ invoiceId, amountPaise }) => [invoiceId, amountPaise])),
      actions,
      totalEarlyPaise: actions.reduce((sum, { amountPaise }) => addPaise(sum, amountPaise), 0),
      shortfallReductionPaise: baseline.maximumShortfallPaise - forecast.maximumShortfallPaise,
      baselineShortageDate: baseline.firstNegativeBalanceDate,
      baselineShortageClosingPaise: baseline.days[firstShortageIndex]?.closingBalancePaise ?? null,
      closingOnBaselineShortageDatePaise: forecast.days[firstShortageIndex]?.closingBalancePaise ?? null,
      forecast,
    };
  }

  function recommend() {
    const considered = candidates.slice(0, SEARCH_LIMIT);
    const seen = new Set();
    const results = [];
    let skippedForRange = 0;

    function evaluate(actions) {
      const key = JSON.stringify(actions.map(({ invoiceId, amountPaise }) => [invoiceId, amountPaise])
        .sort(([a], [b]) => compareId(a, b)));
      if (seen.has(key)) return;
      seen.add(key);
      let scenario;
      try {
        scenario = replay(actions);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        skippedForRange += 1;
        return;
      }
      const sumDailyDeficitsAfter = sumDailyDeficits(scenario.forecast);
      if (sumDailyDeficitsAfter < baselineDeficitSum) {
        results.push({ ...scenario, sumDailyDeficits: sumDailyDeficitsAfter });
      }
    }

    for (let mask = 1; mask < 2 ** considered.length; mask += 1) {
      const subset = considered.filter((_, index) => (mask & (1 << index)) !== 0);
      evaluate(subset.map(({ invoiceId, outstandingBalancePaise }) => ({ invoiceId, amountPaise: outstandingBalancePaise })));
      evaluate(trimCollectionAmounts(subset, negativeDays));
    }

    return {
      scenarios: results.sort(rankScenarios).slice(0, RECOMMENDATION_LIMIT)
        .map(({ sumDailyDeficits: _rankingMetric, ...scenario }) => scenario),
      search: {
        eligibleInvoiceCount: candidates.length,
        consideredInvoiceCount: considered.length,
        evaluatedScenarioCount: seen.size - skippedForRange,
        skippedForRange,
      },
    };
  }

  return {
    baseline,
    candidates: candidates.map(({ affectedDays, ...candidate }) => candidate),
    leadDays: LEAD_DAYS,
    earlyDate,
    recommend,
    simulate: (actions) => replay(validatedActions.parse(actions)),
  };
}
