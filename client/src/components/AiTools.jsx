import { useEffect, useRef, useState } from 'react';
import { Clipboard, FileUp, MessageSquareText, ScanLine } from 'lucide-react';
import { requestApi, sendApi } from '../api.js';
import { Modal } from './Modal.jsx';
import { Badge, Button, Panel, SectionIcon } from './ui.jsx';

function Language({ value, onChange, disabled }) {
  return (
    <label className="ai-language">
      <span>Language</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="en">English</option><option value="hi">हिन्दी</option>
      </select>
    </label>
  );
}

function Source({ result }) {
  return <Badge tone={result.source === 'gemini' ? 'emerald' : 'neutral'}>
    {result.source === 'gemini' ? 'Live Gemini AI' : 'Demonstration template'}
  </Badge>;
}

export function InvoiceUpload({ onClose, onReview, onManual }) {
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(null);
  const scanRequest = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    requestApi('ai/status', { signal: controller.signal }).then((data) => setConfigured(data.configured)).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => () => scanRequest.current?.abort(), []);

  async function scan(event) {
    event.preventDefault();
    setError('');
    if (!file) { setError('Choose an invoice file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Invoice files must be 5 MiB or smaller.'); return; }
    const body = new FormData();
    body.append('invoice', file);
    const controller = new AbortController();
    scanRequest.current = controller;
    setPending(true);
    try {
      const result = await requestApi('invoices/extract', { method: 'POST', body, signal: controller.signal });
      if (!controller.signal.aborted) onReview(result);
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <Modal title="AI invoice scanner" onClose={onClose} pending={pending}>
      <form onSubmit={scan}>
        <p className="dialog-copy">Upload one synthetic invoice to Gemini. Review all extracted fields before saving.</p>
        {configured !== null && <div className="scanner-source"><Badge tone={configured ? 'emerald' : 'neutral'}>
          {configured ? 'Gemini configured' : 'Gemini unavailable'}
        </Badge></div>}
        <label className="upload-picker">
          <SectionIcon icon={FileUp} />
          <strong>Choose an invoice file</strong>
          <span>PDF, PNG or JPEG · up to 5 MiB</span>
          <input type="file" accept=".pdf,.png,.jpeg,.jpg,application/pdf,image/png,image/jpeg" disabled={pending}
            onChange={(event) => { setFile(event.target.files[0] ?? null); setError(''); }} />
        </label>
        {configured === false && <p className="payment-note">Gemini scanning is unavailable. Manual entry is available.</p>}
        {pending && <p className="payment-note" role="status">Reading invoice with Gemini…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer>
          <Button type="button" onClick={() => {
            scanRequest.current?.abort();
            onManual();
          }}>Enter manually</Button>
          <Button type="submit" variant="primary" disabled={!file || pending || configured === false}>
            <ScanLine size={16} aria-hidden="true" />{pending ? 'Scanning…' : 'Extract fields'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function CrisisAdvisor({ revision, scenario, onStale, sandboxRequest }) {
  const [language, setLanguage] = useState('en');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function explain() {
    setPending(true);
    setError('');
    setResult(null);
    const controller = new AbortController();
    request.current = controller;
    const actions = (scenario?.actions ?? []).map(({ invoiceId, amountPaise }) => ({ invoiceId, amountPaise }));
    try {
      const response = sandboxRequest
        ? await sandboxRequest({ type: 'explain', language, actions }, controller.signal)
        : await requestApi('ai/explanation', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, revision, actions }),
        });
      if (!controller.signal.aborted) setResult(response);
    } catch (problem) {
      if (!controller.signal.aborted) {
        if (problem.code === 'STALE_LEDGER') onStale();
        else setError(problem.message);
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <Panel className="advisor-panel" aria-labelledby="advisor-title">
      <div className="panel-heading flex-wrap">
        <div className="flex items-center gap-3"><SectionIcon icon={MessageSquareText} />
          <div><h2 id="advisor-title">AI cash crisis advisor</h2>
            <p>{sandboxRequest ? 'A demonstration template explains the selected forecast.'
              : 'Gemini can explain the forecast. Amounts and dates come from the financial calculation.'}</p></div>
        </div>
        <div className="ai-controls">
          <Language value={language} disabled={pending} onChange={(value) => { setLanguage(value); setResult(null); setError(''); }} />
          <Button type="button" variant="primary" disabled={pending} onClick={explain}>
            {pending ? 'Preparing explanation…' : 'Explain My Cash Crisis'}
          </Button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && <div className="advisor-result" aria-live="polite">
        <Source result={result} />
        {result.reason && <p className="payment-note">{result.reason}</p>}
        <div lang={result.language}>{result.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </div>}
    </Panel>
  );
}

export function ReminderDialog({ invoice, revision, onClose, onStale, sandboxRequest }) {
  const [language, setLanguage] = useState('en');
  const [result, setResult] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function generate(event) {
    event.preventDefault();
    setError('');
    setStatus('');
    setResult(null);
    setPending(true);
    try {
      const response = sandboxRequest ? await sandboxRequest({ type: 'reminder', id: invoice.id, language })
        : await sendApi('invoices/' + invoice.id + '/reminder-draft', 'POST', revision, { revision, language });
      setResult(response);
      setText(response.subject + '\n\n' + response.body);
      setStatus('Draft ready.');
    } catch (problem) {
      if (problem.code === 'STALE_LEDGER') { onClose(); onStale(); }
      else setError(problem.message);
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Draft copied.');
    } catch {
      setStatus('Select the draft text to copy it manually.');
    }
  }

  return (
    <Modal title="Payment reminder draft" onClose={onClose} pending={pending}>
      <form onSubmit={generate}>
        <p className="dialog-copy">{invoice.customerName} · {invoice.invoiceNumber}. Review and copy the draft when ready.</p>
        <Language value={language} disabled={pending} onChange={(value) => {
          setLanguage(value); setResult(null); setStatus(''); setError('');
        }} />
        {error && <p className="form-error" role="alert">{error}</p>}
        {result && <div className="reminder-preview">
          <Source result={result} />
          {result.reason && <p className="payment-note">{result.reason}</p>}
          <label htmlFor="reminder-draft">Editable draft</label>
          <textarea id="reminder-draft" rows={8} lang={result.language} value={text}
            onChange={(event) => { setText(event.target.value); setStatus(''); }} />
        </div>}
        <p className="payment-note" role="status">{status}</p>
        <footer>
          <Button type="submit" variant={result ? 'secondary' : 'primary'} disabled={pending}>{pending ? 'Preparing draft…' : 'Generate draft'}</Button>
          {result && <Button type="button" variant="primary" onClick={copy}><Clipboard size={16} aria-hidden="true" />Copy draft</Button>}
        </footer>
      </form>
    </Modal>
  );
}
