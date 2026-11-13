export async function requestApi(path, options) {
  const response = await fetch('/api/v1/' + path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = data?.error;
    throw Object.assign(new Error(problem?.fields?.[0]?.message ?? problem?.message ?? 'The request failed.'), {
      code: problem?.code, fields: problem?.fields,
    });
  }
  if (!data) throw new Error('The server returned an invalid response.');
  return data;
}

export async function loadWorkspace(signal) {
  const analysis = await requestApi('analysis', { signal });
  if (analysis.mode !== 'public-demo') return { analysis, ledger: null };

  signal.throwIfAborted();
  try {
    return await requestApi('sandbox', { signal });
  } catch (error) {
    signal.throwIfAborted();
    const message = error.code === 'SANDBOX_RATE_LIMIT' || error.code === 'SANDBOX_ORIGIN'
      ? error.message : 'The public demo could not load. Try again.';
    throw Object.assign(new Error(message, { cause: error }), { code: 'SANDBOX_LOAD_FAILED' });
  }
}

export function sendApi(path, method, revision, body) {
  return requestApi(path, {
    method,
    headers: { 'X-Ledger-Revision': revision, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
}

export function calculateSandbox(ledger, operation, signal) {
  return requestApi('sandbox', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ synthetic: true, ledger, operation }),
  });
}
