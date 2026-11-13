import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, ChartNoAxesCombined, CircleCheck, FlaskConical,
  LayoutDashboard, LifeBuoy, ReceiptText, RotateCcw, ScrollText, Settings2, TriangleAlert, Wallet,
} from 'lucide-react';
import { calculateSandbox, requestApi } from './api.js';
import { formatDate, formatPaise, readAmount } from './format.js';
import { LedgerWorkspace, ResetDemoDialog } from './components/LedgerWorkspace.jsx';
import { CrisisAdvisor } from './components/AiTools.jsx';
import { draftFor, RescueSimulator } from './components/RescueSimulator.jsx';
import { Badge, Button, Panel, SectionIcon } from './components/ui.jsx';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'forecast', label: 'Cash flow', icon: ChartNoAxesCombined },
  { id: 'rescue', label: 'Rescue simulator', icon: LifeBuoy },
  { id: 'invoices', label: 'Invoices', icon: ReceiptText },
  { id: 'expenses', label: 'Expenses', icon: ScrollText },
  { id: 'settings', label: 'Business settings', icon: Settings2 },
];

const ForecastChart = lazy(() => import('./components/ForecastChart.jsx'));

function currentSection() {
  return window.location.hash.slice(1) || 'overview';
}

function Sidebar({ business, activeSection, mode }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview">
        <span className="brand-mark"><Activity size={24} aria-hidden="true" /></span>
        <span>CashRescue <span className="brand-ai">AI</span></span>
      </a>
      <nav aria-label="Workspace">
        <span className="nav-caption">Workspace</span>
        {navigation.map(({ id, label, icon: Icon }) => (
          <a href={'#' + id} key={id} aria-current={activeSection === id ? 'location' : undefined}>
            <Icon size={18} aria-hidden="true" /><span>{label}</span>
          </a>
        ))}
      </nav>
      {business && <div className="workspace">
        <span className="workspace-icon"><Building2 size={18} aria-hidden="true" /></span>
        <div><strong>{business.name}</strong><small>{mode === 'database' ? 'Local database' : 'Synthetic workspace'}</small></div>
      </div>}
    </aside>
  );
}

function Kpis({ totals, baseline }) {
  const metrics = [
    { label: 'Opening cash balance', value: totals.openingBalancePaise, icon: Wallet, tone: 'blue', context: 'At forecast start' },
    { label: 'Expected receivables', value: totals.expectedReceivablesPaise, icon: ArrowDownLeft, tone: 'emerald', context: 'Scheduled over 30 days' },
    { label: 'Upcoming expenses', value: totals.upcomingExpensesPaise, icon: ArrowUpRight, tone: 'amber', context: 'Scheduled over 30 days' },
    {
      label: 'Maximum projected shortfall', value: baseline.maximumShortfallPaise, icon: TriangleAlert,
      tone: baseline.maximumShortfallPaise > 0 ? 'risk' : 'emerald',
      context: baseline.negativeDayCount + ' projected negative days',
    },
  ];
  return (
    <div className="kpi-grid" aria-label="30-day forecast metrics">
      {metrics.map(({ label, value, icon, tone, context }) => (
        <Panel className={'kpi-card ' + (tone === 'risk' ? 'kpi-risk' : '')} key={label}>
          <SectionIcon icon={icon} tone={tone} />
          <div><p>{label}</p><strong>{formatPaise(value)}</strong><small>{context}</small></div>
        </Panel>
      ))}
    </div>
  );
}

function CrisisAlert({ baseline, expenses, invoices, recommendation, empty, onRescue }) {
  const date = baseline.firstNegativeBalanceDate;
  if (!date) return (
    <section className="crisis-alert crisis-clear" aria-labelledby="crisis-title">
      <SectionIcon icon={CircleCheck} />
      <div className="min-w-0 flex-1">
        <h2 id="crisis-title">{empty ? 'Your ledger is empty' : 'No cash shortfall projected'}</h2>
        <p>{empty ? 'Add invoices and expenses to build a forecast.' : 'Daily closing cash stays at or above zero over the next 30 days.'}</p>
      </div>
      {empty && <a className="alert-link" href="#invoices">View invoices <ArrowUpRight size={16} aria-hidden="true" /></a>}
    </section>
  );
  const day = baseline.days.find((item) => item.date === date);
  const contributors = [
    ...day.expenses.map((event) => ({ ...event, label: expenses.find(({ id }) => id === event.id)?.label, type: 'Payment' })),
    ...day.receipts.map((event) => ({ ...event, label: invoices.find(({ id }) => id === event.id)?.customerName, type: 'Receipt' })),
  ];
  return (
    <section className="crisis-alert" aria-labelledby="crisis-title">
      <SectionIcon icon={TriangleAlert} tone="risk" />
      <div className="min-w-0 flex-1">
        <h2 id="crisis-title">First projected shortfall <span>· <time dateTime={date}>{formatDate(date, true)}</time></span></h2>
        <p>Closing cash drops to <strong>{formatPaise(day.closingBalancePaise)}</strong>.
          {recommendation && <> Test collecting <strong>{formatPaise(recommendation.totalEarlyPaise)}</strong> early on {formatDate(recommendation.actions[0].earlyDate)}.</>}</p>
        <details className="crisis-drivers">
          <summary>What drives this shortfall?</summary>
          <dl className="crisis-breakdown">
            <div><dt>Cash at start of day</dt><dd>{formatPaise(day.openingBalancePaise)}</dd></div>
            <div><dt>Receipts</dt><dd>{formatPaise(day.incomingPaise)}</dd></div>
            <div><dt>Payments</dt><dd>{formatPaise(day.outgoingPaise)}</dd></div>
          </dl>
          {contributors.length > 0 && <ul>{contributors.map(({ type, id, label, amountPaise }) => (
            <li key={type + id}><span>{type} · {label ?? 'Ledger entry'}</span><strong>{formatPaise(amountPaise)}</strong></li>
          ))}</ul>}
        </details>
      </div>
      <a className="button button-primary crisis-cta" href="#rescue" onClick={onRescue}>
        Explore rescue <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </section>
  );
}

export function Dashboard() {
  const [activeSection, setActiveSection] = useState(currentSection);
  const [analysis, setAnalysis] = useState(null);
  const [mode, setMode] = useState(null);
  const [sandboxLedger, setSandboxLedger] = useState(null);
  const [startingDemo, setStartingDemo] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [scenario, setScenario] = useState(null);
  const [draft, setDraft] = useState({});
  const [simulationError, setSimulationError] = useState('');
  const [pending, setPending] = useState(false);
  const simulationRequest = useRef(null);
  const showRecommendation = useRef(true);

  useEffect(() => {
    const updateSection = () => setActiveSection(currentSection());
    window.addEventListener('hashchange', updateSection);
    return () => window.removeEventListener('hashchange', updateSection);
  }, []);

  function selectScenario(next) {
    setScenario(next);
    setDraft(draftFor(next));
    setSimulationError('');
  }

  useEffect(() => {
    if (!analysis) return;
    if (activeSection === 'rescue' || activeSection === 'forecast') {
      const section = document.getElementById(activeSection);
      section?.focus({ preventScroll: true });
      section?.scrollIntoView();
    } else if (activeSection !== 'main-content') {
      window.scrollTo(0, 0);
    }
  }, [activeSection, analysis]);

  useEffect(() => {
    if (['overview', 'invoices', 'expenses', 'settings'].includes(activeSection)) {
      document.querySelector('.page-content h1')?.focus({ preventScroll: true });
    }
  }, [activeSection]);

  useEffect(() => {
    const controller = new AbortController();
    requestApi('analysis', { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setMode(data.mode);
      if (data.mode === 'public-demo') return;
      setAnalysis(data);
      const recommended = showRecommendation.current ? data.rescue.scenarios[0] ?? null : null;
      setScenario(recommended);
      setDraft(draftFor(recommended));
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setLoadError(error.code === 'DATABASE_UNAVAILABLE' ? error.message : 'The ledger could not load. Check that the API is running and try again.');
      }
    });
    return () => controller.abort();
  }, [loadVersion]);

  useEffect(() => () => simulationRequest.current?.abort(), []);

  function reloadLedger(message = '', recommended = false) {
    simulationRequest.current?.abort();
    showRecommendation.current = recommended;
    setNotice(message);
    setPending(false);
    setLoadError('');
    setAnalysis(null);
    selectScenario(null);
    setLoadVersion((version) => version + 1);
  }

  function applySandbox(data, message) {
    simulationRequest.current?.abort();
    setPending(false);
    setSandboxLedger(data.ledger);
    setAnalysis(data.analysis);
    setNotice(message);
    selectScenario(null);
  }

  async function loadSandbox(message) {
    const data = await requestApi('sandbox');
    applySandbox(data, message);
  }

  async function tryDemo() {
    setStartingDemo(true);
    setLoadError('');
    try {
      await loadSandbox('Demo loaded.');
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setStartingDemo(false);
    }
  }

  function handleSaved(message, result) {
    if (result) applySandbox(result, message);
    else reloadLedger(message);
  }

  const sandboxRequest = sandboxLedger
    ? (operation, signal) => calculateSandbox(sandboxLedger, operation, signal)
    : undefined;

  async function runSimulation(event) {
    event.preventDefault();
    setSimulationError('');
    const actions = [];
    for (const candidate of analysis.rescue.candidates) {
      const { invoiceId, outstandingBalancePaise } = candidate;
      const amountPaise = readAmount(draft[invoiceId]?.trim() || '0');
      if (amountPaise === null || amountPaise > outstandingBalancePaise) {
        const customer = invoiceById.get(invoiceId).customerName;
        setSimulationError('Enter an amount from ₹0 to ' + formatPaise(outstandingBalancePaise) + ' for ' + customer + ', with up to two decimal places.');
        return;
      }
      if (amountPaise > 0) actions.push({ invoiceId, amountPaise });
    }
    if (actions.length === 0) {
      selectScenario(null);
      return;
    }

    simulationRequest.current?.abort();
    const controller = new AbortController();
    simulationRequest.current = controller;
    setPending(true);
    try {
      const data = sandboxRequest
        ? await sandboxRequest({ type: 'simulate', actions }, controller.signal)
        : await requestApi('analysis/simulate', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions, revision: analysis.revision }),
        });
      if (!controller.signal.aborted) selectScenario(data.scenario);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error.code === 'STALE_LEDGER') reloadLedger('The ledger changed. Review the refreshed forecast and choose a new scenario.');
        else setSimulationError(error.message);
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const invoiceById = new Map(analysis?.invoices.map((invoice) => [invoice.id, invoice]));
  const page = ['invoices', 'expenses', 'settings'].includes(activeSection) ? activeSection : 'dashboard';
  const modeLabel = { demo: 'Local demo · temporary', database: 'Local database', 'public-demo': 'Public sandbox' };
  const handleStale = () => reloadLedger('The ledger changed. Review the refreshed records before editing again.');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar business={analysis?.business} activeSection={activeSection} mode={mode} />
      <div className="workspace-main">
        <header className="topbar">
          <div><span>Workspace</span><span className="breadcrumb-divider" aria-hidden="true">/</span><strong>{navigation.find(({ id }) => id === activeSection)?.label ?? 'Overview'}</strong></div>
          {mode && <Badge tone="emerald"><span className="status-dot" aria-hidden="true" />{modeLabel[mode]}</Badge>}
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          <div role="status" className={notice ? 'workspace-notice' : 'sr-only'}>{notice}</div>
          {analysis && mode === 'demo' && <p className="mode-note">Use synthetic data only. Local demo edits are lost when the server restarts.</p>}
          {analysis && mode === 'database' && <p className="mode-note">Local database workspace. Use synthetic data only.</p>}
          {mode === 'public-demo' && <p className="mode-note">Use fictional data only. Edits stay in this tab and clear on refresh. Forecasts are illustrative.</p>}
          {!analysis && mode === 'public-demo' ? (
            <Panel className="demo-welcome">
              <SectionIcon icon={FlaskConical} />
              <h1>Try CashRescue AI</h1>
              <p>Edit a fictional business ledger, then see how collecting an invoice early could cover a cash shortfall.</p>
              {loadError && <p className="form-error" role="alert">{loadError}</p>}
              <Button type="button" variant="primary" onClick={tryDemo} disabled={startingDemo}>
                {startingDemo ? 'Loading demo…' : 'Try Demo'}<ArrowUpRight size={16} aria-hidden="true" />
              </Button>
            </Panel>
          ) : !analysis ? (
            <Panel className="load-state">
              <p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading ledger…'}</p>
              {loadError && <Button onClick={() => reloadLedger()}>Retry</Button>}
            </Panel>
          ) : page === 'dashboard' ? (
            <>
              <div id="overview" className="overview-heading dashboard-hero">
                <div>
                  <div className="hero-date"><CalendarDays size={15} aria-hidden="true" /><span>{formatDate(analysis.baseline.forecastStartDate)} – {formatDate(analysis.baseline.forecastEndDate, true)}</span></div>
                  <h1 tabIndex={-1}>Cash flow overview</h1>
                  <p>See cash shortages up to 30 days ahead and test which invoices could cover them.</p>
                </div>
                {mode !== 'database' && <Button type="button" className="hero-reset" onClick={() => setResetOpen(true)}>
                  <RotateCcw size={16} aria-hidden="true" />Reset demo
                </Button>}
              </div>
              <CrisisAlert baseline={analysis.baseline} expenses={analysis.expenses} invoices={analysis.invoices}
                empty={analysis.invoices.length === 0 && analysis.expenses.length === 0}
                recommendation={analysis.rescue.scenarios[0]}
                onRescue={() => {
                  if (!scenario && analysis.rescue.scenarios[0] && !Object.keys(draft).length && !pending) {
                    selectScenario(analysis.rescue.scenarios[0]);
                  }
                  document.getElementById('rescue')?.focus({ preventScroll: true });
                }} />
              <Kpis totals={analysis.totals} baseline={analysis.baseline} />
              <div className="analysis-grid">
                <Suspense fallback={<Panel id="forecast" className="load-state"><p role="status">Loading cash-flow chart…</p></Panel>}>
                  <ForecastChart baseline={analysis.baseline} scenario={scenario} active={activeSection === 'forecast'} />
                </Suspense>
                <RescueSimulator rescue={analysis.rescue} invoiceById={invoiceById} scenario={scenario}
                  draft={draft} setDraft={(id, value) => {
                    setDraft((previous) => ({ ...previous, [id]: value }));
                    setSimulationError('');
                  }}
                  selectScenario={selectScenario} runSimulation={runSimulation} pending={pending} error={simulationError} />
              </div>
              {mode === 'public-demo' && <nav className="ledger-shortcuts" aria-label="Edit the demo ledger">
                <strong>Try your own scenario</strong>
                <a href="#invoices">Edit invoices</a>
                <a href="#expenses">Edit expenses</a>
                <a href="#settings">Change opening cash</a>
              </nav>}
              {analysis.baseline.firstNegativeBalanceDate && <CrisisAdvisor
                key={analysis.revision + ':' + (scenario?.id ?? 'baseline')}
                revision={analysis.revision} scenario={scenario} onStale={handleStale} sandboxRequest={sandboxRequest} />}
            </>
          ) : <LedgerWorkspace key={page} kind={page} analysis={analysis} onSaved={handleSaved}
            onStale={handleStale} sandboxRequest={sandboxRequest} modeLabel={modeLabel[mode]}
            onResetDemo={mode !== 'database' ? () => setResetOpen(true) : undefined} />}
          {analysis && resetOpen && <ResetDemoDialog analysis={analysis} onClose={() => setResetOpen(false)}
            onSaved={reloadLedger} onStale={handleStale}
            resetSandbox={sandboxRequest ? () => loadSandbox('Synthetic ledger restored.') : undefined} />}
        </main>
      </div>
    </div>
  );
}
