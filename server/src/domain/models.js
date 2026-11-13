import { z } from 'zod';
import { addCalendarDays, calendarDateSchema } from './calendar.js';
import { paiseSchema, positivePaiseSchema } from './money.js';

export const FORECAST_DAYS = 30;
export const CURRENCY = 'INR';

const idSchema = z.string().trim().min(1);
const labelSchema = z.string().trim().min(1);
const forecastStartDateSchema = calendarDateSchema.pipe(z.string().refine(
  (date) => calendarDateSchema.safeParse(addCalendarDays(date, FORECAST_DAYS - 1)).success,
  'The full forecast must fit within a four-digit calendar year.',
));
const openingCashFields = {
  forecastStartDate: forecastStartDateSchema,
  openingBalancePaise: paiseSchema,
};

export const businessSchema = z.strictObject({
  id: idSchema,
  name: labelSchema,
  currency: z.literal(CURRENCY),
  ...openingCashFields,
});

const receivableFields = z.strictObject({
  id: idSchema,
  issueDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  expectedCollectionDate: calendarDateSchema.optional(),
  amountPaise: positivePaiseSchema,
  outstandingBalancePaise: paiseSchema.pipe(z.number().min(0)),
  status: z.enum(['open', 'paid', 'cancelled']),
});

function validateReceivable(invoice, context) {
  if (invoice.dueDate < invoice.issueDate) {
    context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date precedes issue date.' });
  }
  if (invoice.expectedCollectionDate && invoice.expectedCollectionDate < invoice.issueDate) {
    context.addIssue({
      code: 'custom',
      path: ['expectedCollectionDate'],
      message: 'Expected collection date precedes issue date.',
    });
  }
  const outstanding = invoice.outstandingBalancePaise;
  if (outstanding > invoice.amountPaise || (invoice.status === 'open' ? outstanding === 0 : outstanding !== 0)) {
    context.addIssue({
      code: 'custom',
      path: ['outstandingBalancePaise'],
      message: 'An open invoice needs a positive outstanding balance up to its amount. Closed invoices require zero.',
    });
  }
}

export const receivableSchema = receivableFields.superRefine(validateReceivable);
export const invoiceSchema = receivableFields.extend({
  businessId: idSchema,
  invoiceNumber: labelSchema,
  customerName: labelSchema,
}).superRefine(validateReceivable);

const expenseFields = z.strictObject({
  id: idSchema,
  dueDate: calendarDateSchema,
  amountPaise: positivePaiseSchema,
  status: z.enum(['scheduled', 'paid', 'cancelled']),
});

export const expenseSchema = expenseFields.extend({
  businessId: idSchema,
  label: labelSchema,
  category: labelSchema,
});

function uniqueRecords(schema) {
  return z.array(schema).superRefine((records, context) => {
    const ids = new Set();
    for (const [index, { id }] of records.entries()) {
      if (ids.has(id)) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Duplicate transaction ID.' });
      }
      ids.add(id);
    }
  });
}

export const forecastInputSchema = z.strictObject({
  ...openingCashFields,
  receivables: uniqueRecords(receivableSchema),
  expenses: uniqueRecords(expenseFields),
});

const cashEventSchema = z.strictObject({
  id: idSchema,
  amountPaise: positivePaiseSchema,
});

const forecastDaySchema = z.strictObject({
  date: calendarDateSchema,
  openingBalancePaise: paiseSchema,
  incomingPaise: paiseSchema.pipe(z.number().min(0)),
  outgoingPaise: paiseSchema.pipe(z.number().min(0)),
  closingBalancePaise: paiseSchema,
  receipts: z.array(cashEventSchema),
  expenses: z.array(cashEventSchema),
});

export const forecastSchema = z.strictObject({
  currency: z.literal(CURRENCY),
  forecastStartDate: forecastStartDateSchema,
  forecastEndDate: calendarDateSchema,
  days: z.array(forecastDaySchema).length(FORECAST_DAYS),
  firstNegativeBalanceDate: calendarDateSchema.nullable(),
  negativeDayCount: z.number().int().min(0).max(FORECAST_DAYS),
  maximumShortfallPaise: paiseSchema.pipe(z.number().min(0)),
  minimumCashBalancePaise: paiseSchema,
  nextReceiptDateAfterFirstShortfall: calendarDateSchema.nullable(),
  unscheduledReceivableIds: z.array(idSchema),
  overdueExpenseIds: z.array(idSchema),
});
