import { z } from 'zod';
import { calendarDateSchema } from './calendar.js';
import { businessSchema, expenseSchema } from './models.js';
import { paiseSchema, positivePaiseSchema } from './money.js';

export const settingsInputSchema = businessSchema.omit({ id: true }).extend({
  name: z.string().trim().min(1, 'Enter a business name.').max(120),
});

const invoiceFields = z.strictObject({
  invoiceNumber: z.string().trim().min(1, 'Enter an invoice number.').max(64),
  customerName: z.string().trim().min(1, 'Enter a customer name.').max(120),
  issueDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  expectedCollectionDate: calendarDateSchema.nullable().optional(),
  amountPaise: positivePaiseSchema,
  receivedPaise: paiseSchema.pipe(z.number().min(0)),
  status: z.enum(['open', 'paid', 'cancelled']),
});

export const invoiceInputSchema = invoiceFields.superRefine((invoice, context) => {
  const issue = (field, message) => context.addIssue({ code: 'custom', path: [field], message });
  if (invoice.receivedPaise > invoice.amountPaise) {
    issue('receivedPaise', 'Amount received cannot exceed the invoice total.');
  } else if (invoice.status === 'paid' && invoice.receivedPaise !== invoice.amountPaise) {
    issue('status', 'A paid invoice requires the full amount received.');
  } else if (invoice.status === 'open' && invoice.receivedPaise === invoice.amountPaise) {
    issue('status', 'Mark a fully received invoice as paid.');
  }
  if (invoice.dueDate < invoice.issueDate) issue('dueDate', 'Due date precedes issue date.');
  if (invoice.expectedCollectionDate && invoice.expectedCollectionDate < invoice.issueDate) {
    issue('expectedCollectionDate', 'Expected payment date precedes issue date.');
  }
});

export const expenseInputSchema = expenseSchema.omit({ id: true, businessId: true }).extend({
  label: z.string().trim().min(1, 'Enter an expense title.').max(120),
  category: z.string().trim().min(1, 'Enter a category.').max(64),
});

export const invoicePatchSchema = invoiceFields.partial();
export const expensePatchSchema = expenseInputSchema.partial();
export const ledgerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i, 'Invalid record ID.');
export const revisionSchema = z.uuid();
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };

const invoiceRecordSchema = z.strictObject({
  ...invoiceFields.shape,
  id: ledgerIdSchema,
  businessId: ledgerIdSchema,
  ...timestamps,
}).superRefine((invoice, context) => {
  const { id, businessId, createdAt, updatedAt, ...fields } = invoice;
  const result = invoiceInputSchema.safeParse(fields);
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue(issue);
  }
});
const expenseRecordSchema = expenseSchema.extend(timestamps);

export const ledgerSchema = z.strictObject({
  revision: revisionSchema,
  business: businessSchema,
  invoices: z.array(invoiceRecordSchema),
  expenses: z.array(expenseRecordSchema),
});

export const MAX_SANDBOX_RECORDS = 20;
export const normalizeInvoiceNumber = (value) => value.normalize('NFKC').toUpperCase();

export const sandboxLedgerSchema = ledgerSchema.extend({
  business: settingsInputSchema.extend({ id: z.literal('demo-business') }),
  invoices: z.array(invoiceRecordSchema).max(MAX_SANDBOX_RECORDS),
  expenses: z.array(expenseInputSchema.extend({
    id: ledgerIdSchema, businessId: ledgerIdSchema, ...timestamps,
  })).max(MAX_SANDBOX_RECORDS),
}).superRefine(({ business, invoices, expenses }, context) => {
  const invoiceNumbers = new Set();
  for (const [kind, records] of [['invoices', invoices], ['expenses', expenses]]) {
    const ids = new Set();
    for (const [index, record] of records.entries()) {
      if (record.businessId !== business.id) {
        context.addIssue({ code: 'custom', path: [kind, index, 'businessId'], message: 'Use the synthetic demo workspace.' });
      }
      if (ids.has(record.id)) {
        context.addIssue({ code: 'custom', path: [kind, index, 'id'], message: 'Record IDs must be unique.' });
      }
      ids.add(record.id);
      if (kind === 'invoices') {
        const number = normalizeInvoiceNumber(record.invoiceNumber);
        if (invoiceNumbers.has(number)) {
          context.addIssue({ code: 'custom', path: [kind, index, 'invoiceNumber'], message: 'Use a unique invoice number.' });
        }
        invoiceNumbers.add(number);
      }
    }
  }
});

export function invoiceForForecast(invoice) {
  const { id, issueDate, dueDate, expectedCollectionDate, amountPaise, status } = invoice;
  return {
    id, issueDate, dueDate, expectedCollectionDate: expectedCollectionDate ?? undefined, amountPaise, status,
    outstandingBalancePaise: outstandingPaise(invoice),
  };
}

export function outstandingPaise({ status, amountPaise, receivedPaise }) {
  return status === 'open' ? amountPaise - receivedPaise : 0;
}

export function invoiceForDisplay(invoice) {
  const { outstandingBalancePaise } = invoiceForForecast(invoice);
  const { expectedCollectionDate, ...record } = invoice;
  // The existing response omits missing expected dates.
  return { ...record, ...(expectedCollectionDate && { expectedCollectionDate }), outstandingBalancePaise };
}
