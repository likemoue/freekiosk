/**
 * React Native dispatches JS timers from a Choreographer frame, and with another app in front and the
 * screen off those frames stop, even during a headless task. whatwg-fetch resolved through
 * setTimeout(0), so a command the tablet had fetched was never run until someone lit the screen:
 * checked on a real SM-X210, stuck for over a minute. Hence patches/whatwg-fetch+3.6.20.patch.
 */
describe('fetch with JS timers stopped', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realXhr = (globalThis as any).XMLHttpRequest;
  const realFetch = (globalThis as any).fetch;
  let timersAsked = 0;

  class FakeXhr {
    status = 200;
    statusText = 'OK';
    responseURL = 'https://example.com/';
    response = '{"ok":true}';
    responseText = '{"ok":true}';
    responseType = '';
    withCredentials = false;
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    onabort?: () => void;
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
    abort() {}
    send() { Promise.resolve().then(() => FakeXhr.answer(this)); }
    static answer: (xhr: FakeXhr) => void = (xhr) => xhr.onload?.();
  }

  const load = () => {
    jest.resetModules();
    return require('whatwg-fetch').fetch as typeof fetch;
  };

  beforeEach(() => {
    timersAsked = 0;
    (globalThis as any).XMLHttpRequest = FakeXhr;
    // A timer that never fires, as on the tablet
    (globalThis as any).setTimeout = () => {
      timersAsked += 1;
      return 0;
    };
  });

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    (globalThis as any).XMLHttpRequest = realXhr;
    (globalThis as any).fetch = realFetch;
    FakeXhr.answer = (xhr) => xhr.onload?.();
  });

  it('gives its answer', async () => {
    const response = await load()('https://example.com/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(timersAsked).toBe(0);
  });

  it('gives its failure', async () => {
    FakeXhr.answer = (xhr) => xhr.onerror?.();
    await expect(load()('https://example.com/')).rejects.toThrow('Network request failed');
    expect(timersAsked).toBe(0);
  });
});
