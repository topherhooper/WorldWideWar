// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  isSupported: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('./auth.js', () => ({ firebaseApp: {} }));
vi.mock('./api.js', () => ({ api: { registerPush: vi.fn(), unregisterPush: vi.fn() } }));

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

function setEnvironment(opts: { ua: string; standalone: boolean }) {
  vi.stubGlobal('navigator', {
    userAgent: opts.ua,
    maxTouchPoints: 5,
    serviceWorker: {},
    standalone: opts.standalone,
  });
  vi.stubGlobal('matchMedia', () => ({ matches: opts.standalone }));
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: opts.standalone }),
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default' });
}

describe('pushStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid');
    vi.stubEnv('VITE_USE_EMULATORS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('asks an iPhone Safari tab to install first', async () => {
    setEnvironment({ ua: IPHONE, standalone: false });
    const { pushStatus } = await import('./push.js');
    expect(await pushStatus()).toBe('needs-install');
  });

  it('does not ask an installed iPhone app to install', async () => {
    setEnvironment({ ua: IPHONE, standalone: true });
    const { pushStatus } = await import('./push.js');
    expect(await pushStatus()).not.toBe('needs-install');
    expect(await pushStatus()).toBe('off');
  });

  it('is unsupported under the emulators', async () => {
    vi.stubEnv('VITE_USE_EMULATORS', '1');
    setEnvironment({ ua: IPHONE, standalone: true });
    const { pushStatus } = await import('./push.js');
    expect(await pushStatus()).toBe('unsupported');
  });

  it('is unsupported while no VAPID key is configured', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', '');
    setEnvironment({ ua: IPHONE, standalone: true });
    const { pushStatus } = await import('./push.js');
    expect(await pushStatus()).toBe('unsupported');
  });
});
