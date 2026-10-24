/**
 * Browser push helpers.
 *
 * Everything here is best-effort and guarded: push is only available on a
 * secure context (https, or localhost) in a browser that supports service
 * workers and the Push API, and it still needs the user's permission. Every
 * failure path resolves to a plain value rather than throwing, so the
 * notification UI never breaks on a browser that cannot push.
 */
import { api } from './api.js';

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Whether the backend has push configured (keys + crypto library). */
export async function pushConfigured() {
  try {
    const res = await api.getPushPublicKey();
    return { available: !!res.available, publicKey: res.public_key || null };
  } catch {
    return { available: false, publicKey: null };
  }
}

/** Current browser permission: 'default' | 'granted' | 'denied' | 'unsupported'. */
export function pushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Ask for permission, subscribe, and register the subscription with the
 * backend. Returns { ok, reason? }.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const { available, publicKey } = await pushConfigured();
  if (!available || !publicKey) return { ok: false, reason: 'not-configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const json = sub.toJSON();
    await api.subscribePush(json);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'subscribe-failed' };
  }
}

/** Unsubscribe this device and tell the backend to stop pushing to it. */
export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  try {
    const sub = await getExistingSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await api.unsubscribePush(endpoint);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unsubscribe-failed' };
  }
}
