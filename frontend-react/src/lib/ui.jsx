/**
 * Small presentational helpers shared across pages.
 *
 * Keeping these in one module avoids the copy-paste that the vanilla build
 * suffered from (every page re-declared its own toast, error box, etc.).
 */
import { useEffect, useState } from 'react';

/** Formats an ISO timestamp as a friendly, non-technical date. */
export function formatDate(iso) {
  if (!iso) return 'Not yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not yet';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Formats an ISO timestamp as a short relative description. */
export function relativeDay(iso) {
  if (!iso) return 'Not yet';
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((d - new Date(today.toDateString())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < 0) return `${Math.abs(days)} days ago`;
  return formatDate(iso);
}

/** Initials for the avatar circle, e.g. "Eleanor Rigby" -> "ER". */
export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Colour-coded badge class per memory category. */
export function categoryBadge(category) {
  switch ((category || '').toLowerCase()) {
    case 'episodic':
      return 'badge-teal';
    case 'semantic':
      return 'badge-green';
    case 'procedural':
      return 'badge-gold';
    case 'prospective':
      return 'badge-dim';
    default:
      return 'badge-teal';
  }
}

/**
 * A tiny toast notification.
 *
 * The vanilla build duplicated a toast on every page; here it is one hook and
 * one component used everywhere.
 */
export function useToast() {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(t);
  }, [message]);

  return { message, showToast: setMessage };
}

export function Toast({ message }) {
  return (
    <div className={`toast${message ? ' is-visible' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

/** Friendly inline message box matching the document's plain-language rule. */
export function FormMessage({ kind = 'error', children }) {
  if (!children) return null;
  const cls = kind === 'success' ? 'form-message is-success' : 'form-message is-error';
  return (
    <p className={cls} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** Password field with the show/hide toggle the document requires. */
export function PasswordField({ id, label, value, onChange, hint, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="form-hint" id={`${id}-hint`}>{hint}</span>}
      <div className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

/** Loading placeholder shown while a page fetches its data. */
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <h3>{label}</h3>
      <p>Just a moment.</p>
    </div>
  );
}
