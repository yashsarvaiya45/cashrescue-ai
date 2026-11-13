import { addCalendarDays } from './calendar.js';
import { CURRENCY, FORECAST_DAYS, forecastInputSchema } from './models.js';
import { addPaise } from './money.js';

function addEvent(eventsByDate, date, event) {
  if (!eventsByDate.has(date)) eventsByDate.set(date, []);
  eventsByDate.get(date).push(event);
}

function sumEvents(events) {
  return events.reduce((total, { amountPaise }) => addPaise(total, amountPaise), 0);
}

/**
 * Calculate 30 daily closes from the opening cash before day-one movements.
 * The result follows forecastSchema in models.js. Cash movements on each day
 * are netted together, and only negative daily closes count as shortfalls.
 */
export function calculateForecast(input) {
  const { forecastStartDate, openingBalancePaise, receivables, expenses } = forecastInputSchema.parse(input);
  const forecastEndDate = addCalendarDays(forecastStartDate, FORECAST_DAYS - 1);
  const receiptsByDate = new Map();
  const expensesByDate = new Map();
  const unscheduledReceivableIds = [];
  const overdueExpenseIds = [];

  for (const invoice of receivables) {
    if (invoice.status !== 'open') continue;
    const date = invoice.expectedCollectionDate ?? invoice.dueDate;
    if (date < forecastStartDate) {
      unscheduledReceivableIds.push(invoice.id);
      continue;
    }
    addEvent(receiptsByDate, date, { id: invoice.id, amountPaise: invoice.outstandingBalancePaise });
  }

  for (const expense of expenses) {
    if (expense.status !== 'scheduled' || expense.dueDate > forecastEndDate) continue;
    const overdue = expense.dueDate < forecastStartDate;
    if (overdue) overdueExpenseIds.push(expense.id);
    const date = overdue ? forecastStartDate : expense.dueDate;
    addEvent(expensesByDate, date, { id: expense.id, amountPaise: expense.amountPaise });
  }

  const days = [];
  let balance = openingBalancePaise;
  for (let offset = 0; offset < FORECAST_DAYS; offset += 1) {
    const date = addCalendarDays(forecastStartDate, offset);
    const receipts = receiptsByDate.get(date) ?? [];
    const scheduledExpenses = expensesByDate.get(date) ?? [];
    const incomingPaise = sumEvents(receipts);
    const outgoingPaise = sumEvents(scheduledExpenses);
    // Both daily totals are nonnegative safe integers, so their difference is exact.
    const closingBalancePaise = addPaise(balance, incomingPaise - outgoingPaise);
    days.push({
      date,
      openingBalancePaise: balance,
      incomingPaise,
      outgoingPaise,
      closingBalancePaise,
      receipts,
      expenses: scheduledExpenses,
    });
    balance = closingBalancePaise;
  }

  const negativeDays = days.filter((day) => day.closingBalancePaise < 0);
  const firstNegativeBalanceDate = negativeDays[0]?.date ?? null;
  const minimumCashBalancePaise = Math.min(...days.map((day) => day.closingBalancePaise));
  const nextReceiptDateAfterFirstShortfall = firstNegativeBalanceDate === null
    ? null
    : [...receiptsByDate.keys()].sort().find((date) => date > firstNegativeBalanceDate) ?? null;

  return {
    currency: CURRENCY,
    forecastStartDate,
    forecastEndDate,
    days,
    firstNegativeBalanceDate,
    negativeDayCount: negativeDays.length,
    maximumShortfallPaise: Math.max(0, -minimumCashBalancePaise),
    minimumCashBalancePaise,
    nextReceiptDateAfterFirstShortfall,
    unscheduledReceivableIds,
    overdueExpenseIds,
  };
}
