import { useState } from 'react';
import { CalendarDays, MessageSquareText, Pencil, Plus, ReceiptText, RotateCcw, ScanLine, ScrollText, Settings2, Trash2, Wallet } from 'lucide-react';
import {
  expenseInputSchema, invoiceInputSchema, outstandingPaise, settingsInputSchema,
} from '../../../server/src/domain/ledger-input.js';
import { sendApi } from '../api.js';
import { amountInput, formatDate, formatPaise, readAmount } from '../format.js';
import { Badge, Button, Panel, SectionIcon } from './ui.jsx';
import { InvoiceUpload, ReminderDialog } from './AiTools.jsx';
import { Modal } from './Modal.jsx';

const paymentOptions = [['open', 'Open'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const expenseOptions = [['scheduled', 'Scheduled'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const invoiceFields = [
  { name: 'invoiceNumber', label: 'Invoice number', maxLength: 64 },
  { name: 'customerName', label: 'Customer name', maxLength: 120 },
  { name: 'amountPaise', label: 'Invoice total (₹)', money: true },
  { name: 'receivedPaise', label: 'Amount received (₹)', money: true },
  { name: 'issueDate', label: 'Issue date', type: 'date' },
  { name: 'dueDate', label: 'Due date', type: 'date' },
  { name: 'expectedCollectionDate', label: 'Expected payment date', type: 'date', optional: true },
  { name: 'status', label: 'Payment status', options: paymentOptions },
];
const expenseFields = [
  { name: 'label', label: 'Expense title', maxLength: 120 },
  { name: 'category', label: 'Category', maxLength: 64 },
  { name: 'amountPaise', label: 'Amount (₹)', money: true },
  { name: 'dueDate', label: 'Due date', type: 'date' },
  { name: 'status', label: 'Payment status', options: expenseOptions },
];
const settingsFields = [
  { name: 'name', label: 'Business name', maxLength: 120 },
  { name: 'openingBalancePaise', label: 'Opening cash (₹)', money: true, signed: true },
  { name: 'forecastStartDate', label: 'Forecast start date', type: 'date' },
];

const configs = {
  invoices: { singular: 'invoice', fields: invoiceFields, schema: invoiceInputSchema },
  expenses: { singular: 'expense', fields: expenseFields, schema: expenseInputSchema },
  settings: { singular: 'settings', fields: settingsFields, schema: settingsInputSchema },
};

function initialValues(kind, record, forecastStartDate) {
  const defaults = kind === 'invoices'
    ? { issueDate: forecastStartDate, dueDate: forecastStartDate, status: 'open', receivedPaise: 0 }
    : { dueDate: forecastStartDate, status: 'scheduled' };
  const source = record ?? defaults;
  return Object.fromEntries(configs[kind].fields.map(({ name, money }) => [
    name, source[name] == null ? '' : money ? amountInput(source[name]) : source[name],
  ]));
}

function Field({ field, value, onChange, error, autoFocus }) {
  const { name, label, type, maxLength, money, options, optional } = field;
  const id = 'ledger-' + name;
  const attributes = {
    id, value, name, onChange: (event) => onChange(name, event.target.value),
    'aria-invalid': error ? true : undefined, 'aria-describedby': error ? id + '-error' : undefined,
    autoFocus,
  };
  return (
    <div className="ledger-field">
      <label htmlFor={id}>{label}{optional && <small>Optional</small>}</label>
      {options
        ? <select {...attributes}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
        : <input {...attributes} type={type ?? 'text'} maxLength={money ? 18 : maxLength} inputMode={money ? 'decimal' : undefined} />}
      {error && <p id={id + '-error'}>{error}</p>}
    </div>
  );
}

function sandboxOperation(kind, record, remove, values) {
  if (remove) return { type: 'delete', kind, id: record.id };
  if (kind === 'settings') return { type: 'settings', values };
  const name = kind === 'invoices' ? 'Invoice' : 'Expense';
  return record ? { type: 'edit' + name, id: record.id, values } : { type: 'add' + name, values };
}

function LedgerEditor({ editor, analysis, onClose, onSaved, onStale, sandboxRequest }) {
  const { kind, record, remove, extraction } = editor;
  const { singular, schema, fields } = configs[kind];
  const [values, setValues] = useState(() => initialValues(kind, extraction
    ? { ...extraction.draft, status: 'open', receivedPaise: 0 } : record, analysis.business.forecastStartDate));
  const [confirmed, setConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const settings = kind === 'settings';
  const title = extraction ? 'Review extracted invoice' : remove ? 'Delete ' + singular : settings ? 'Business settings' : (record ? 'Edit ' : 'Add ') + singular;

  function changeValue(name, value) {
    setValues((previous) => {
      const next = { ...previous, [name]: value };
      if (kind === 'invoices' && name === 'status' && value === 'paid') next.receivedPaise = next.amountPaise;
      if (kind === 'invoices' && (name === 'receivedPaise' || name === 'amountPaise') && next.status !== 'cancelled') {
        const total = readAmount(next.amountPaise);
        next.status = total > 0 && total === readAmount(next.receivedPaise) ? 'paid' : 'open';
      }
      return next;
    });
    setFieldErrors({});
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (extraction && !confirmed) return;
    const payload = {};
    const problems = {};
    if (!remove) {
      for (const { name, money, signed, optional } of fields) {
        const value = values[name].trim();
        payload[name] = money ? readAmount(value, { signed }) : optional && !value ? null : value;
        if (money && payload[name] === null) problems[name] = 'Enter a valid rupee amount with up to two decimal places.';
      }
      if (settings) payload.currency = 'INR';
      const result = schema.safeParse(payload);
      if (!result.success) {
        for (const issue of result.error.issues) problems[issue.path[0]] ??= issue.message;
        setFieldErrors(problems);
        const firstField = fields.find(({ name }) => problems[name]);
        if (firstField) document.getElementById('ledger-' + firstField.name)?.focus();
        return;
      }
    }

    const path = !settings && record ? kind + '/' + record.id : kind;
    const method = remove ? 'DELETE' : settings ? 'PUT' : record ? 'PATCH' : 'POST';
    setPending(true);
    setError('');
    try {
      const sandbox = sandboxRequest
        ? await sandboxRequest(sandboxOperation(kind, record, remove, payload))
        : undefined;
      if (!sandboxRequest) await sendApi(path, method, analysis.revision, remove ? undefined : payload);
      await onSaved(remove ? (kind === 'invoices' ? 'Invoice deleted.' : 'Expense deleted.')
        : settings ? 'Business settings saved.' : (kind === 'invoices' ? 'Invoice saved.' : 'Expense saved.'), sandbox);
    } catch (problem) {
      if (problem.code === 'STALE_LEDGER') {
        await onStale();
        return;
      }
      const errors = Object.fromEntries((problem.fields ?? []).map(({ field, message }) => [field, message]));
      setFieldErrors(errors);
      setError(problem.message);
    } finally {
      setPending(false);
    }
  }

  const total = !settings && kind === 'invoices' ? readAmount(values.amountPaise) : null;
  const received = !settings && kind === 'invoices' ? readAmount(values.receivedPaise) : null;
  const outstanding = total !== null && received !== null && received <= total
    ? outstandingPaise({ status: values.status, amountPaise: total, receivedPaise: received }) : null;

  return (
    <Modal title={title} onClose={onClose} pending={pending}>
      <form noValidate onSubmit={submit}>
        {remove ? <p className="dialog-copy">Delete {record.invoiceNumber ?? record.label}? The forecast will update immediately.</p> : (
          <>
            {settings && <p className="dialog-copy">Use the cash on hand at the start of the forecast date. Include payments already received or made in that cash balance.</p>}
            {extraction && <div className="extraction-review">
              <Badge tone="emerald">Live Gemini AI · Draft</Badge>
              <p>Detected currency: {extraction.draft.currency ?? 'Unclear'}. This ledger accepts INR only.</p>
              {extraction.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              <p>Enter the expected payment date separately. Leave it blank to use the invoice due date in the forecast.</p>
            </div>}
            <fieldset className="dialog-fields" disabled={pending}>
              {fields.map((field, index) => <Field key={field.name} field={field} value={values[field.name]}
                onChange={changeValue} error={fieldErrors[field.name]} autoFocus={index === 0} />)}
              {settings && <div className="ledger-field"><label htmlFor="ledger-currency">Currency</label><input id="ledger-currency" value="INR (Indian rupee)" readOnly /></div>}
            </fieldset>
            {kind === 'invoices' && <div className="form-outstanding"><span>Outstanding balance</span><output>{outstanding === null ? '—' : formatPaise(outstanding)}</output></div>}
            {extraction && <label className="confirm-extraction">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} />
              <span>I verified the invoice details and INR currency, and confirmed the expected payment date or use of the due date.</span>
            </label>}
            {!settings && (received > 0 || values.status === 'paid') && <p className="payment-note">Reconcile settled payments in the opening cash balance.</p>}
          </>
        )}
        {error && <p role="alert" className="form-error">{error}</p>}
        <footer>
          <Button type="button" onClick={onClose} disabled={pending} autoFocus={remove}>Cancel</Button>
          <Button type="submit" variant={remove ? 'danger' : 'primary'} disabled={pending || Boolean(extraction && !confirmed)}>
            {pending ? 'Saving…' : remove ? 'Delete ' + singular : 'Save ' + singular}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function Status({ record }) {
  if (record.status === 'cancelled') return <Badge>Cancelled</Badge>;
  if (record.status === 'paid') return <Badge tone="emerald">Paid</Badge>;
  if (record.receivedPaise > 0) return <Badge tone="blue">Part paid</Badge>;
  return <Badge>{record.status === 'scheduled' ? 'Scheduled' : 'Unpaid'}</Badge>;
}

const columns = {
  invoices: [
    ['Customer / invoice', (record) => <>{record.customerName}<small>{record.invoiceNumber}</small></>],
    ['Due', (record) => formatDate(record.dueDate)],
    ['Expected', (record, flagged) => flagged ? <Badge tone="risk">Unscheduled</Badge> : formatDate(record.expectedCollectionDate ?? record.dueDate)],
    ['Invoice total', (record) => formatPaise(record.amountPaise)],
    ['Received', (record) => formatPaise(record.receivedPaise)],
    ['Outstanding', (record) => formatPaise(record.outstandingBalancePaise)],
    ['Status', (record) => <Status record={record} />],
  ],
  expenses: [
    ['Expense', (record) => <>{record.label}<small>{record.category}</small></>],
    ['Due', (record, flagged) => flagged ? <Badge tone="risk">Overdue · {formatDate(record.dueDate)}</Badge> : formatDate(record.dueDate)],
    ['Amount', (record) => formatPaise(record.amountPaise)],
    ['Status', (record) => <Status record={record} />],
  ],
};

function RecordTable({ kind, analysis, openEditor, openReminder }) {
  const flags = new Set(kind === 'invoices' ? analysis.baseline.unscheduledReceivableIds : analysis.baseline.overdueExpenseIds);
  const records = analysis[kind];
  const singular = configs[kind].singular;
  const headers = columns[kind];
  if (records.length === 0) return (
    <Panel className="ledger-empty">
      <SectionIcon icon={kind === 'invoices' ? ReceiptText : ScrollText} tone="blue" />
      <h2>No {kind} yet</h2>
      <p>{kind === 'invoices' ? 'Add an invoice to forecast a customer payment.' : 'Add an expense to schedule an upcoming payment.'}</p>
      <Button variant="primary" onClick={() => openEditor({ kind })}><Plus size={16} aria-hidden="true" />Add {singular}</Button>
    </Panel>
  );

  return (
    <Panel>
      <div className="ledger-scroll" role="region" aria-label={kind === 'invoices' ? 'Invoices table' : 'Expenses table'} tabIndex={0}>
        <table className="ledger-table ledger-management-table" role="table">
          <caption className="sr-only">{kind === 'invoices' ? 'Invoice records' : 'Expense records'}</caption>
          <thead><tr>{headers.map(([heading]) => <th scope="col" key={heading}>{heading}</th>)}<th scope="col">Actions</th></tr></thead>
          <tbody role="rowgroup">{records.map((record) => {
            const identity = record.invoiceNumber ?? record.label;
            return (
              <tr key={record.id} role="row">
                {headers.map(([heading, render], index) => index === 0
                  ? <th key={heading} scope="row" role="rowheader">{render(record)}</th>
                  : <td key={heading} role="cell" className={heading === 'Outstanding' || heading === 'Amount' ? 'ledger-emphasis' : undefined}>
                    <span className="ledger-mobile-label" aria-hidden="true">{heading}</span>
                    <span>{render(record, flags.has(record.id))}</span>
                  </td>)}
                <td role="cell" className="ledger-action-cell"><div className="ledger-actions">
                  {kind === 'invoices' && record.outstandingBalancePaise > 0 && <Button variant="quiet" aria-label={'Draft reminder for ' + identity}
                    onClick={() => openReminder(record)}><MessageSquareText size={16} aria-hidden="true" /></Button>}
                  <Button variant="quiet" aria-label={'Edit ' + identity} onClick={() => openEditor({ kind, record })}><Pencil size={16} aria-hidden="true" /></Button>
                  <Button variant="quiet" className="ledger-delete" aria-label={'Delete ' + identity} onClick={() => openEditor({ kind, record, remove: true })}><Trash2 size={16} aria-hidden="true" /></Button>
                </div></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Panel>
  );
}

export function LedgerWorkspace({ kind, analysis, onSaved, onStale, sandboxRequest, modeLabel, onResetDemo }) {
  const [editor, setEditor] = useState(null);
  const [upload, setUpload] = useState(false);
  const [reminder, setReminder] = useState(null);
  const settings = kind === 'settings';
  const title = settings ? 'Business settings' : kind === 'invoices' ? 'Invoices' : 'Expenses';
  const icon = settings ? Settings2 : kind === 'invoices' ? ReceiptText : ScrollText;
  const business = analysis.business;
  const invoices = kind === 'invoices';
  const forecastTotal = invoices ? analysis.totals.expectedReceivablesPaise : analysis.totals.upcomingExpensesPaise;
  const flaggedCount = invoices ? analysis.baseline.unscheduledReceivableIds.length : analysis.baseline.overdueExpenseIds.length;
  return (
    <>
      <div className="overview-heading ledger-page-heading">
        <div><h1 tabIndex={-1}>{title}</h1><p>{settings ? 'Manage the business details and starting point for your forecast.'
          : invoices ? 'Track what customers owe and when cash is expected.' : 'Manage payments that may affect your cash position.'}</p></div>
        <div className="ledger-heading-actions">
          {invoices && !sandboxRequest && <Button onClick={() => setUpload(true)}><ScanLine size={17} aria-hidden="true" />AI invoice scanner</Button>}
          <Button variant="primary" onClick={() => setEditor({ kind, record: settings ? business : undefined })}>
            {settings ? <Pencil size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            {settings ? 'Edit settings' : 'Add ' + configs[kind].singular}
          </Button>
        </div>
      </div>
      {settings ? (
        <div className="settings-grid">
          <Panel className="settings-panel">
            <div className="panel-heading"><div className="flex items-center gap-3"><SectionIcon icon={icon} /><div><h2>{business.name}</h2><p>Forecast inputs</p></div></div></div>
            <dl>
              <div><dt>Opening cash balance</dt><dd>{formatPaise(business.openingBalancePaise)}</dd></div>
              <div><dt>Forecast start date</dt><dd><time dateTime={business.forecastStartDate}>{formatDate(business.forecastStartDate, true)}</time></dd></div>
              <div><dt>Currency</dt><dd>INR</dd></div>
            </dl>
            <p>Reconcile opening cash when recording money already received or paid, or when moving the forecast start date.</p>
          </Panel>
          <Panel className="settings-panel settings-mode">
            <div className="panel-heading"><h2>Workspace mode</h2></div>
            <Badge tone="emerald">{modeLabel}</Badge>
            <p>{sandboxRequest ? 'Changes stay in this tab until you refresh.' : onResetDemo
              ? 'Synthetic ledger changes are temporary and clear when the server restarts.' : 'The ledger is stored in the configured local database.'}</p>
            {onResetDemo && <Button onClick={onResetDemo}><RotateCcw size={16} aria-hidden="true" />Reset demo</Button>}
          </Panel>
        </div>
      ) : <>
        <Panel className="ledger-summary">
          <div><SectionIcon icon={Wallet} tone={invoices ? 'emerald' : 'amber'} /><div>
            <p>{invoices ? 'Expected receipts' : 'Scheduled payments'} in 30 days</p><strong>{formatPaise(forecastTotal)}</strong>
          </div></div>
          <div><SectionIcon icon={CalendarDays} tone="blue" /><div>
            <p>{invoices ? 'Unscheduled receivables' : 'Overdue scheduled expenses'}</p><strong>{flaggedCount}</strong>
          </div></div>
        </Panel>
        <div className="ledger-list-heading"><h2>{invoices ? 'Invoice ledger' : 'Expense ledger'}</h2><Badge>{analysis[kind].length} records</Badge></div>
        <RecordTable kind={kind} analysis={analysis} openEditor={setEditor} openReminder={setReminder} />
      </>}
      {upload && <InvoiceUpload onClose={() => setUpload(false)} onManual={() => {
        setUpload(false);
        setEditor({ kind });
      }} onReview={(extraction) => {
        setUpload(false);
        setEditor({ kind, extraction });
      }} />}
      {reminder && <ReminderDialog invoice={reminder} revision={analysis.revision} onClose={() => setReminder(null)}
        onStale={onStale} sandboxRequest={sandboxRequest} />}
      {editor && <LedgerEditor editor={editor} analysis={analysis} sandboxRequest={sandboxRequest} onClose={() => setEditor(null)} onSaved={async (message, sandbox) => {
        setEditor(null);
        await onSaved(message, sandbox);
      }} onStale={async () => {
        setEditor(null);
        await onStale();
      }} />}
    </>
  );
}

export function ResetDemoDialog({ analysis, onClose, onSaved, onStale, resetSandbox }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function reset(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (resetSandbox) await resetSandbox();
      else await sendApi('demo/reset', 'POST', analysis.revision);
      onClose();
      if (!resetSandbox) await onSaved('Synthetic ledger restored.', true);
    } catch (problem) {
      if (problem.code === 'STALE_LEDGER') {
        onClose();
        await onStale();
      } else setError(problem.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title="Reset synthetic demo" onClose={onClose} pending={pending}>
      <form onSubmit={reset}>
        <p className="dialog-copy">Replace your demo changes with the original synthetic invoices, expenses and opening cash.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer>
          <Button type="button" onClick={onClose} disabled={pending} autoFocus>Cancel</Button>
          <Button type="submit" variant="danger" disabled={pending}>{pending ? 'Resetting…' : 'Reset demo'}</Button>
        </footer>
      </form>
    </Modal>
  );
}
