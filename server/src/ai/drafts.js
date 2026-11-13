import { z } from 'zod';
import { LedgerError, staleLedger } from '../ledger/errors.js';
import { structuredResult } from './extraction.js';

export const languageSchema = z.enum(['en', 'hi']);

const advice = {
  confirm: ['Confirm collection timing with customers before relying on early payments.', 'जल्दी भुगतान पर निर्भर होने से पहले ग्राहकों से भुगतान की तारीख की पुष्टि करें।'],
  expenses: ['Review which upcoming expenses can be rescheduled by agreement.', 'देखें कि आपसी सहमति से किन आगामी खर्चों की तारीख बदली जा सकती है।'],
  reconcile: ['Reconcile opening cash and review any invoices without a current expected payment date.', 'शुरुआती नकदी का मिलान करें और उन चालानों की समीक्षा करें जिनकी अपेक्षित भुगतान तारीख तय नहीं है।'],
};
const adviceKeys = Object.keys(advice);
const explanationChoice = z.strictObject({
  focus: z.enum(['cash', 'expenses', 'receipts', 'rescue']),
  nextStep: z.enum(adviceKeys),
});
const reminderChoice = z.strictObject({
  tone: z.enum(['courteous', 'direct']),
  request: z.enum(['paymentTiming', 'paymentUpdate']),
});
const date = (value, locale) => new Intl.DateTimeFormat(locale, {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value + 'T00:00:00Z'));
const wholeRupees = new Intl.NumberFormat('en-IN');
function money(paise) {
  const amount = BigInt(paise);
  const magnitude = amount < 0n ? -amount : amount;
  const fraction = magnitude % 100n;
  return (amount < 0n ? '−' : '') + '₹' + wholeRupees.format(magnitude / 100n)
    + (fraction ? '.' + fraction.toString().padStart(2, '0') : '');
}

async function choose(provider, schema, instruction, input, fallback) {
  if (provider) {
    try {
      const choice = await structuredResult(provider, schema, instruction, [{ text: JSON.stringify(input) }]);
      return { choice, source: 'gemini', model: provider.model };
    } catch (error) {
      if (!(error instanceof LedgerError) || !error.code.startsWith('AI_')) throw error;
      return { choice: fallback, source: 'template', reason: error.message };
    }
  }
  return { choice: fallback, source: 'template', reason: 'Gemini is unavailable for this workspace.' };
}

export async function explainCrisis(service, provider, { revision, language, actions }) {
  const analysis = await service.analysis();
  if (revision !== analysis.revision) throw staleLedger();
  const { baseline, expenses, invoices, rescue } = analysis;
  const firstDate = baseline.firstNegativeBalanceDate;
  if (!firstDate) throw new LedgerError(422, 'NO_CRISIS', 'There is no projected cash shortfall to explain.');

  const first = baseline.days.find((day) => day.date === firstDate);
  const lastReceipt = baseline.days.find((day) => day.date === baseline.nextReceiptDateAfterFirstShortfall);
  const recommendation = rescue.scenarios[0];
  const proposal = actions.length ? (await service.simulate(actions, revision)).scenario : recommendation;
  const focus = first.outgoingPaise > 0 ? 'expenses' : 'cash';
  const nextStep = recommendation ? 'confirm' : 'expenses';
  // The model sees calculated summaries and counts. It never supplies figures
  // or transaction descriptions. Its output can only select approved wording.
  const { choice, ...metadata } = await choose(provider, explanationChoice,
    'Choose a focus for this forecast and the most relevant next step. Use the supplied facts. No calculations, extra fields, or free text.',
    {
      language, firstShortageDate: firstDate, openingPaise: first.openingBalancePaise,
      incomingPaise: first.incomingPaise, outgoingPaise: first.outgoingPaise,
      scheduledExpenses: first.expenses.length, laterReceipts: lastReceipt?.receipts.length ?? 0,
      recommendedActions: recommendation?.actions.length ?? 0, remainingShortfallPaise: proposal?.forecast.maximumShortfallPaise,
    }, { focus, nextStep });

  const hindi = language === 'hi';
  const showDate = (value) => date(value, hindi ? 'hi-IN' : 'en-IN');
  const named = (events, records, name) => {
    const list = events.slice(0, 6).map((event) => records.find((record) => record.id === event.id)?.[name]).filter(Boolean);
    return list.length ? list.join(', ') + (events.length > list.length ? (hindi ? ' और अन्य' : ' and others') : '') : null;
  };
  const bills = named(first.expenses, expenses, 'label');
  const receipts = named(first.receipts, invoices, 'customerName');
  const later = lastReceipt && named(lastReceipt.receipts, invoices, 'customerName');
  const summary = hindi
    ? showDate(firstDate) + ' को दिन के अंत में नकदी ' + money(first.closingBalancePaise) + ' रहने का अनुमान है। अधिकतम कमी ' + money(baseline.maximumShortfallPaise) + ' है।'
    : 'On ' + showDate(firstDate) + ', projected closing cash is ' + money(first.closingBalancePaise) + '. The largest projected shortfall is ' + money(baseline.maximumShortfallPaise) + '.';
  const flows = hindi
    ? 'उस दिन शुरुआती नकदी ' + money(first.openingBalancePaise) + ', आने वाली राशि ' + money(first.incomingPaise) + ' और भुगतान ' + money(first.outgoingPaise) + ' हैं।'
    : 'That day starts with ' + money(first.openingBalancePaise) + ', with ' + money(first.incomingPaise) + ' in receipts and ' + money(first.outgoingPaise) + ' in expenses.';
  const expensesText = bills && (hindi ? 'उस दिन के खर्च: ' : 'Expenses that day: ') + bills + '.';
  const receiptsText = [
    receipts && (hindi ? 'उस दिन के ग्राहक भुगतान: ' : 'Customer receipts that day: ') + receipts + '.',
    baseline.nextReceiptDateAfterFirstShortfall && (hindi ? 'अगली निर्धारित प्राप्ति: ' : 'Next scheduled receipt: ')
      + showDate(baseline.nextReceiptDateAfterFirstShortfall) + (later ? ' · ' + later : '') + '.',
  ].filter(Boolean).join(' ');
  const recommendationText = recommendation ? recommendation.actions.map(({ invoiceId, amountPaise, earlyDate }) => {
    const invoice = invoices.find(({ id }) => id === invoiceId);
    const label = invoice.customerName + ' (' + invoice.invoiceNumber + ')';
    return hindi
      ? label + ' से ' + showDate(earlyDate) + ' को ' + money(amountPaise) + ' का अनुरोध करें।'
      : 'Request ' + money(amountPaise) + ' from ' + label + ' on ' + showDate(earlyDate) + '.';
  }).join(' ') : (hindi ? 'इन मान्यताओं पर सॉल्वर को कोई उपयोगी जल्दी भुगतान नहीं मिला।' : 'The solver found no improving early collection under the current assumptions.');
  const proposalText = proposal && (hindi
    ? 'इस परिदृश्य में जल्दी प्राप्ति ' + money(proposal.totalEarlyPaise) + ' है और अधिकतम कमी ' + money(baseline.maximumShortfallPaise) + ' से ' + money(proposal.forecast.maximumShortfallPaise) + ' हो जाती है। यह समय पर भुगतान मिलने पर निर्भर है।'
    : 'The proposed scenario moves ' + money(proposal.totalEarlyPaise) + ' in receipts earlier and changes the maximum shortfall from ' + money(baseline.maximumShortfallPaise) + ' to ' + money(proposal.forecast.maximumShortfallPaise) + '. This depends on customers paying as assumed.');
  const sections = { cash: flows, expenses: expensesText, receipts: receiptsText, rescue: recommendationText };
  return {
    ...metadata, language, revision,
    paragraphs: [summary, ...new Set([sections[choice.focus], flows, expensesText, receiptsText, recommendationText, proposalText, advice[choice.nextStep][Number(hindi)]].filter(Boolean))],
  };
}

export async function draftReminder(service, provider, invoiceId, { revision, language }) {
  const records = await service.records('invoices');
  if (records.revision !== revision) throw staleLedger();
  const invoice = records.invoices.find(({ id }) => id === invoiceId);
  if (!invoice) throw new LedgerError(404, 'RECORD_NOT_FOUND', 'This invoice no longer exists.');
  if (invoice.status !== 'open' || invoice.outstandingBalancePaise <= 0) {
    throw new LedgerError(422, 'NO_OUTSTANDING_BALANCE', 'Reminders are available for outstanding invoices.');
  }
  const { choice, ...metadata } = await choose(provider, reminderChoice,
    'Choose the tone and call to action for a professional invoice reminder. Prefer paymentUpdate for a part-paid invoice and paymentTiming for a first reminder. Return only the options in the schema.',
    { language, partlyPaid: invoice.receivedPaise > 0 }, { tone: 'courteous', request: 'paymentTiming' });
  const hindi = language === 'hi';
  const total = money(invoice.outstandingBalancePaise);
  const due = date(invoice.dueDate, hindi ? 'hi-IN' : 'en-IN');
  const subject = (hindi ? 'भुगतान अनुस्मारक · ' : 'Payment reminder · ') + invoice.invoiceNumber;
  const opening = choice.tone === 'direct'
    ? (hindi ? 'कृपया इस चालान का बकाया भुगतान देखें।' : 'Please review the outstanding payment below.')
    : (hindi ? 'यह आपके चालान के लिए एक विनम्र भुगतान अनुस्मारक है।' : 'This is a friendly reminder about your invoice.');
  const requestText = choice.request === 'paymentUpdate'
    ? (hindi ? 'कृपया बकाया भुगतान की स्थिति बताएं।' : 'Please share an update on the remaining payment.')
    : (hindi ? 'कृपया बताएं कि भुगतान कब किया जा सकता है।' : 'Please let us know when payment can be made.');
  const body = hindi
    ? ['नमस्कार ' + invoice.customerName + ',', opening,
      'चालान ' + invoice.invoiceNumber + ' पर ' + total + ' बकाया है। भुगतान की नियत तारीख ' + due + ' है।',
      requestText + ' यदि आपने भुगतान कर दिया है, तो कृपया उसका विवरण साझा करें।', 'धन्यवाद।']
    : ['Hello ' + invoice.customerName + ',', opening,
      'Invoice ' + invoice.invoiceNumber + ' has an outstanding balance of ' + total + '. The invoice due date is ' + due + '.',
      requestText + ' If you have already paid, please share the payment reference.', 'Thank you.'];
  return { ...metadata, language, revision, subject, body: body.join('\n\n') };
}
