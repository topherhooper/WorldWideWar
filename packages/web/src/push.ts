import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';

import { api } from './api.js';
import { firebaseApp } from './auth.js';

export type PushStatus =
  | 'unsupported' // this browser cannot receive web push at all
  | 'needs-install' // iPhone/iPad Safari tab: only a home-screen app can get push
  | 'blocked' // the person (or the OS) denied permission
  | 'off' // supported, not yet enabled on this device
  | 'on'; // a token is registered with the server from this device

const TOKEN_KEY = 'www.pushToken';
const vapidKey = (): string =>
  (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) ?? '';
const usingEmulators = (): boolean => import.meta.env.VITE_USE_EMULATORS === '1';

/** localStorage throws in some private modes, so every touch is wrapped. */
function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* nothing to do: the token still reached the server */
  }
}

/** A Safari tab on an iPhone has no PushManager at all, so this is checked before features. */
function isIosTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (!ios) return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export async function pushStatus(): Promise<PushStatus> {
  if (usingEmulators() || vapidKey() === '') return 'unsupported';
  if (isIosTab()) return 'needs-install';
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !(await isSupported().catch(() => false))
  ) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  return storedToken() !== null ? 'on' : 'off';
}

/** Must be called from a click handler: iOS only shows the prompt for a user gesture. */
export async function enablePush(): Promise<PushStatus> {
  if ((await Notification.requestPermission()) !== 'granted') return pushStatus();
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(firebaseApp), {
    vapidKey: vapidKey(),
    serviceWorkerRegistration: reg,
  });
  await api.registerPush(token);
  storeToken(token);
  return 'on';
}

/** Best-effort: a failure in any one step must not stop the others. */
export async function disablePush(): Promise<PushStatus> {
  const token = storedToken();
  if (token !== null) {
    await deleteToken(getMessaging(firebaseApp)).catch(() => undefined);
    await api.unregisterPush(token).catch(() => undefined);
    storeToken(null);
  }
  return pushStatus();
}
