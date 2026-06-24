/**
 * Tests for the env-gated frontend error reporter.
 *
 * The module captures VITE_ERROR_REPORTING_DSN at load time, so the
 * enabled/disabled paths are exercised by stubbing the env var and
 * re-importing a fresh module instance via vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DSN = 'https://collector.test/ingest';

async function loadEnabled() {
  vi.resetModules();
  vi.stubEnv('VITE_ERROR_REPORTING_DSN', DSN);
  return import('./errorReporter');
}

async function loadDisabled() {
  vi.resetModules();
  vi.stubEnv('VITE_ERROR_REPORTING_DSN', '');
  return import('./errorReporter');
}

describe('errorReporter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no sendBeacon — define one we can control. Return false so
    // the reporter falls through to fetch by default; individual tests
    // flip it to true to assert the beacon path.
    beaconMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beaconMock,
      configurable: true,
      writable: true,
    });
    // Silence the dev console.error path.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { Sentry?: unknown }).Sentry;
  });

  it('is disabled and transmits nothing when no DSN is configured', async () => {
    const mod = await loadDisabled();
    expect(mod.isErrorReportingEnabled()).toBe(false);
    mod.reportError(new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it('is enabled and POSTs a scrubbed envelope when a DSN is configured', async () => {
    const mod = await loadEnabled();
    expect(mod.isErrorReportingEnabled()).toBe(true);

    mod.reportError(new Error('kaboom'), { source: 'manual' });

    expect(beaconMock).toHaveBeenCalledTimes(1);
    // beacon returned false → falls through to fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DSN);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    const body = JSON.parse(init.body);
    expect(body.message).toBe('kaboom');
    expect(body.source).toBe('manual');
    // URL must be scrubbed of query string.
    expect(body.url).not.toContain('?');
  });

  it('prefers navigator.sendBeacon when it succeeds (no fetch fallback)', async () => {
    beaconMock.mockReturnValue(true);
    const mod = await loadEnabled();

    mod.reportError(new Error('beacon-path'));

    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dedupes identical errors within the flood window', async () => {
    const mod = await loadEnabled();
    const err = new Error('repeat');
    err.stack = 'Error: repeat\n  at x (a.ts:1:1)';

    mod.reportError(err);
    mod.reportError(err); // same signature → suppressed

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('delegates to window.Sentry.captureException when present', async () => {
    const captureException = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = { captureException };
    const mod = await loadEnabled();

    mod.reportError(new Error('via-sentry'));

    expect(captureException).toHaveBeenCalledTimes(1);
    // Sentry path short-circuits the beacon/fetch transport.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  describe('reportApiError', () => {
    it('reports 5xx server errors', async () => {
      const mod = await loadEnabled();
      mod.reportApiError({ response: { status: 503 }, config: { url: '/x', method: 'get' }, message: 'down' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports network errors (no response)', async () => {
      const mod = await loadEnabled();
      mod.reportApiError({ config: { url: '/x', method: 'get' }, message: 'Network Error' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT report 4xx client errors', async () => {
      const mod = await loadEnabled();
      mod.reportApiError({ response: { status: 404 }, config: { url: '/x', method: 'get' } });
      mod.reportApiError({ response: { status: 401 }, config: { url: '/y', method: 'post' } });
      mod.reportApiError({ response: { status: 422 }, config: { url: '/z', method: 'put' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('reportBoundaryError forwards the component stack', async () => {
    const mod = await loadEnabled();
    mod.reportBoundaryError(new Error('render-throw'), { componentStack: '\n  at <App>' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source).toBe('error-boundary');
    expect(body.componentStack).toContain('<App>');
  });
});
