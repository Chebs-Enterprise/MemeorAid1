/**
 * Notification preferences — FR-02/FR-14/FR-15.
 *
 * Lets the user decide what MemorAid may nudge them about, when quiet hours
 * are, which local timezone those hours are measured in, whether a family
 * contact may be alerted (explicit consent, off until switched on) and whether
 * this device receives browser push.
 *
 * Nothing here creates notifications — the backend scheduler does that with
 * predefined text. This is purely the settings surface, and every control is
 * disabled with a plain explanation when the browser cannot support it.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { FormMessage, Toast, useToast } from '../lib/ui.jsx';
import {
  disablePush,
  enablePush,
  pushConfigured,
  pushPermission,
  pushSupported,
} from '../lib/push.js';

// A short, common list plus the browser's best guess as the current value.
const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Madrid',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
];

function minutesToTime(minutes) {
  const safe = Number.isFinite(minutes) ? minutes : 0;
  const h = String(Math.floor(safe / 60) % 24).padStart(2, '0');
  const m = String(safe % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function timeToMinutes(value) {
  const [h, m] = String(value).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState({
    supported: pushSupported(),
    permission: pushPermission(),
    configured: false,
  });
  const { message, showToast } = useToast();

  useEffect(() => {
    let alive = true;
    api
      .getNotificationPreferences()
      .then((res) => alive && setPrefs(res.preferences))
      .catch((err) => alive && setError(err.message));
    pushConfigured().then(
      (info) => alive && setPushState((s) => ({ ...s, configured: info.available })),
    );
    return () => {
      alive = false;
    };
  }, []);

  const save = async (patch) => {
    setBusy(true);
    setError('');
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      const res = await api.updateNotificationPreferences(patch);
      setPrefs(res.preferences);
      showToast('Your notification settings have been saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePush = async () => {
    setError('');
    if (prefs.push_enabled) {
      const res = await disablePush();
      if (res.ok) {
        await save({ push_enabled: false });
      } else {
        setError('We could not turn off notifications on this device.');
      }
      return;
    }
    const res = await enablePush();
    if (res.ok) {
      await save({ push_enabled: true });
    } else if (res.reason === 'denied') {
      setError('Your browser is blocking notifications. You can allow them in your browser settings.');
    } else if (res.reason === 'not-configured') {
      setError('Browser notifications are not set up on the server yet.');
    } else if (res.reason === 'unsupported') {
      setError('This browser does not support notifications.');
    } else {
      setError('We could not turn on notifications for this device.');
    }
  };

  if (!prefs) {
    return (
      <section className="card" style={{ marginTop: '26px' }}>
        <h2>Notifications</h2>
        <FormMessage>{error}</FormMessage>
      </section>
    );
  }

  const pushUsable = pushState.supported && pushState.configured;

  return (
    <section className="card" style={{ marginTop: '26px' }}>
      <Toast message={message} />
      <h2>Notifications</h2>
      <p className="form-hint" style={{ marginBottom: '18px' }}>
        Choose what MemorAid may remind you about. Reminders use your real
        review schedule and activity — never anything invented.
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.morning_checkin}
          disabled={busy}
          onChange={(e) => save({ morning_checkin: e.target.checked })}
        />
        <span>Morning check-in greeting</span>
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.due_review}
          disabled={busy}
          onChange={(e) => save({ due_review: e.target.checked })}
        />
        <span>Reminders when memories are due for review</span>
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.family_alerts}
          disabled={busy}
          onChange={(e) => save({ family_alerts: e.target.checked })}
        />
        <span>Gentle reminders if I have been quiet for a while</span>
      </label>

      <h3 style={{ marginTop: '22px' }}>Quiet hours</h3>
      <p className="form-hint" style={{ marginBottom: '12px' }}>
        MemorAid stays silent during these hours, in your local time.
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.quiet_hours_enabled}
          disabled={busy}
          onChange={(e) => save({ quiet_hours_enabled: e.target.checked })}
        />
        <span>Use quiet hours</span>
      </label>

      <div className="form-row" style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '1 1 160px' }}>
          <label htmlFor="quiet-start">Quiet from</label>
          <input
            id="quiet-start"
            type="time"
            value={minutesToTime(prefs.quiet_hours_start)}
            disabled={busy || !prefs.quiet_hours_enabled}
            onChange={(e) => save({ quiet_hours_start: timeToMinutes(e.target.value) })}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 160px' }}>
          <label htmlFor="quiet-end">Quiet until</label>
          <input
            id="quiet-end"
            type="time"
            value={minutesToTime(prefs.quiet_hours_end)}
            disabled={busy || !prefs.quiet_hours_enabled}
            onChange={(e) => save({ quiet_hours_end: timeToMinutes(e.target.value) })}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="timezone">Your timezone</label>
        <select
          id="timezone"
          value={prefs.timezone}
          disabled={busy}
          onChange={(e) => save({ timezone: e.target.value })}
        >
          {!TIMEZONES.includes(prefs.timezone) && (
            <option value={prefs.timezone}>{prefs.timezone}</option>
          )}
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <h3 style={{ marginTop: '22px' }}>Family alerts</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.family_consent}
          disabled={busy}
          onChange={(e) => save({ family_consent: e.target.checked })}
        />
        <span>
          I agree that my family contact may be sent a gentle check-in notice if I
          have been quiet for a long while.
        </span>
      </label>
      <p className="form-hint">
        This is off by default. Even when switched on, the notice never includes
        any of your saved memories.
      </p>

      <h3 style={{ marginTop: '22px' }}>Browser notifications</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={prefs.push_enabled}
          disabled={busy || !pushUsable}
          onChange={togglePush}
        />
        <span>Show reminders on this device</span>
      </label>
      <p className="form-hint">
        {!pushState.supported
          ? 'This browser does not support notifications.'
          : !pushState.configured
            ? 'Browser notifications are not set up on the server yet, so reminders appear in the app only.'
            : pushState.permission === 'denied'
              ? 'Your browser is currently blocking notifications for this site.'
              : 'You may need to allow notifications when your browser asks.'}
      </p>

      <FormMessage>{error}</FormMessage>
    </section>
  );
}
