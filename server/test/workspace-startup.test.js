import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '../../client/src/api.js';

const publicAnalysis = { mode: 'public-demo' };
const seed = {
  ledger: { business: { name: 'Copper Kite Stationery' } },
  analysis: { mode: 'public-demo', business: { name: 'Copper Kite Stationery' } },
};

function stubFetch() {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('dashboard workspace startup', () => {
  it('automatically opens the public sandbox and uses its snapshot for both editing and analysis', async () => {
    const fetch = stubFetch()
      .mockResolvedValueOnce(Response.json(publicAnalysis))
      .mockResolvedValueOnce(Response.json(seed));
    const { signal } = new AbortController();

    await expect(loadWorkspace(signal)).resolves.toEqual(seed);
    expect(fetch.mock.calls).toEqual([
      ['/api/v1/analysis', { signal }],
      ['/api/v1/sandbox', { signal }],
    ]);
  });

  it.each(['demo', 'database'])('loads the existing %s ledger directly', async (mode) => {
    const analysis = { ...seed.analysis, mode };
    const fetch = stubFetch().mockResolvedValueOnce(Response.json(analysis));
    const { signal } = new AbortController();

    await expect(loadWorkspace(signal)).resolves.toEqual({ analysis, ledger: null });
    expect(fetch.mock.calls).toEqual([['/api/v1/analysis', { signal }]]);
  });

  it('reports sandbox startup failure and succeeds on a fresh attempt', async () => {
    stubFetch()
      .mockResolvedValueOnce(Response.json(publicAnalysis))
      .mockRejectedValueOnce(new TypeError('Network failure'))
      .mockResolvedValueOnce(Response.json(publicAnalysis))
      .mockResolvedValueOnce(Response.json(seed));

    await expect(loadWorkspace(new AbortController().signal)).rejects.toMatchObject({
      code: 'SANDBOX_LOAD_FAILED',
      message: 'The public demo could not load. Try again.',
    });
    await expect(loadWorkspace(new AbortController().signal)).resolves.toEqual(seed);
  });

  it('keeps the existing sandbox rate limit guidance', async () => {
    const error = { code: 'SANDBOX_RATE_LIMIT', message: 'The demo is busy. Wait a moment and try again.' };
    stubFetch()
      .mockResolvedValueOnce(Response.json(publicAnalysis))
      .mockResolvedValueOnce(Response.json({ error }, { status: 429 }));

    await expect(loadWorkspace(new AbortController().signal)).rejects.toMatchObject({
      code: 'SANDBOX_LOAD_FAILED', message: error.message,
    });
  });

  it('skips the sandbox request when the initial effect has been cancelled', async () => {
    const controller = new AbortController();
    const fetch = stubFetch().mockImplementationOnce(async () => {
      controller.abort();
      return Response.json(publicAnalysis);
    });

    await expect(loadWorkspace(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
