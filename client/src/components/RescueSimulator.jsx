import { ArrowRight, CircleCheck, Info, LifeBuoy, RotateCcw, TriangleAlert } from 'lucide-react';
import { amountInput, formatDate, formatPaise, readAmount } from '../format.js';
import { Badge, Button, Panel, SectionIcon } from './ui.jsx';

export function draftFor(scenario) {
  return Object.fromEntries((scenario?.actions ?? []).map(({ invoiceId, amountPaise }) =>
    [invoiceId, amountInput(amountPaise)]));
}

export function RescueSimulator({
  rescue, invoiceById, scenario, draft, setDraft, selectScenario, runSimulation, pending, error,
}) {
  const selectedIndex = rescue.scenarios.findIndex(({ id }) => id === scenario?.id);
  const changed = rescue.candidates.some(({ invoiceId }) =>
    readAmount(draft[invoiceId]?.trim() || '0') !== (scenario?.actions.find((action) => action.invoiceId === invoiceId)?.amountPaise ?? 0));
  const remaining = scenario?.forecast.maximumShortfallPaise;
  const successful = remaining === 0;
  const firstCrisisResolved = scenario?.baselineShortageDate && scenario.closingOnBaselineShortageDatePaise >= 0;
  const ResultIcon = successful ? CircleCheck : TriangleAlert;

  return (
    <Panel id="rescue" tabIndex={-1} aria-labelledby="rescue-title" className="rescue-panel">
      <div className="panel-heading">
        <div className="flex min-w-0 items-center gap-3">
          <SectionIcon icon={LifeBuoy} />
          <div><h2 id="rescue-title">Rescue simulator</h2><p>Reverse Cash-Flow Rescue Solver</p></div>
        </div>
        <Button variant="quiet" className="reset-button" onClick={() => selectScenario(null)}
          disabled={(!scenario && !changed) || pending} aria-label="Reset simulation">
          <RotateCcw size={15} aria-hidden="true" /><span>Reset</span>
        </Button>
      </div>

      {rescue.scenarios.length > 0 && (
        <div className="rescue-options" role="group" aria-label="Suggested scenarios">
          {rescue.scenarios.map((option, index) => (
            <button type="button" key={option.id} aria-pressed={!changed && index === selectedIndex}
              disabled={pending} onClick={() => selectScenario(option)}>
              {index === 0 ? 'Recommended' : 'Option ' + (index + 1)}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite">
        {scenario && (
          <div className={'rescue-result ' + (successful ? 'result-positive' : 'result-risk')}>
            <ResultIcon size={19} aria-hidden="true" />
            <div>
              <div className="result-header">
                <strong>{successful ? 'No projected shortfalls over 30 days' : 'Shortfalls remain in this scenario'}</strong>
              </div>
              {scenario.baselineShortageDate && <p><b>{firstCrisisResolved ? 'First cash crisis resolved' : 'First cash crisis remains'}</b> on{' '}
                {formatDate(scenario.baselineShortageDate)}. Closing cash moves from <b>{formatPaise(scenario.baselineShortageClosingPaise)}</b>{' '}
                to <b>{formatPaise(scenario.closingOnBaselineShortageDatePaise)}</b>.</p>}
              <dl className="rescue-comparison">
                <div><dt>Baseline peak shortfall</dt><dd>{formatPaise(rescue.baselineShortfallPaise)}</dd></div>
                <div><dt>Max remaining shortfall</dt><dd>{formatPaise(remaining)}</dd></div>
              </dl>
              <p>{formatPaise(scenario.totalEarlyPaise)} collected early across {scenario.actions.length}{' '}
                {scenario.actions.length === 1 ? 'invoice' : 'invoices'}.
                {!successful && <> First negative close in this scenario is <b>{formatDate(scenario.forecast.firstNegativeBalanceDate)}</b>.</>}
              </p>
            </div>
          </div>
        )}
        {changed && <p className="rescue-pending">Amounts edited. Run the simulation to update the forecast.</p>}
      </div>

      {rescue.candidates.length ? (
        <form onSubmit={runSimulation} className="rescue-form">
          <div className="rescue-date">
            <span>Modelled collection date</span><strong>{formatDate(rescue.earlyDate, true)}</strong>
          </div>
          <fieldset disabled={pending} className="collection-list">
            <legend className="sr-only">Early invoice collection amounts in rupees</legend>
            {rescue.candidates.map(({ invoiceId, outstandingBalancePaise, scheduledDate }) => {
              const invoice = invoiceById.get(invoiceId);
              const action = scenario?.actions.find((entry) => entry.invoiceId === invoiceId);
              return (
                <label className="collection-row" key={invoiceId}>
                  <span className="collection-info">
                    <strong>{invoice.customerName}</strong>
                    <small>{invoice.invoiceNumber} · {formatPaise(outstandingBalancePaise)} outstanding</small>
                    <small>Expected {formatDate(scheduledDate, true)}</small>
                    {action && <small>{formatPaise(action.remainingPaise)} stays on the original date in this scenario</small>}
                  </span>
                  <span className="amount-field">
                    <span aria-hidden="true">₹</span>
                    <input type="text" inputMode="decimal" placeholder="0.00" maxLength={17}
                      aria-label={'Early collection for ' + invoice.customerName + ', ' + invoice.invoiceNumber + ', in rupees'}
                      value={draft[invoiceId] ?? ''} onChange={(event) => setDraft(invoiceId, event.target.value)} />
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button variant="primary" type="submit" className="w-full justify-center" disabled={pending}>
            {pending ? 'Simulating…' : 'Run simulation'}<ArrowRight size={16} aria-hidden="true" />
          </Button>
        </form>
      ) : <p className="rescue-empty">{rescue.hasShortage
        ? 'No eligible invoices can improve the forecast under these assumptions.'
        : 'The baseline has no projected shortfall.'}</p>}

      {rescue.hasShortage && !scenario && <p className="rescue-empty">Baseline shortfall <strong>{formatPaise(rescue.baselineShortfallPaise)}</strong></p>}

      <p className="rescue-note"><Info size={15} aria-hidden="true" /><span>Assumes early payments arrive {rescue.leadDays} calendar days after the forecast starts. The same amount is deducted from the original receipt. Payments depend on customer agreement.</span></p>
      {rescue.search.consideredInvoiceCount < rescue.search.eligibleInvoiceCount && (
        <Badge>Ranked using {rescue.search.consideredInvoiceCount} of {rescue.search.eligibleInvoiceCount} eligible invoices</Badge>
      )}
      {rescue.search.skippedForRange > 0 && <p className="rescue-note">Some scenarios exceeded the supported paise range.</p>}
    </Panel>
  );
}
