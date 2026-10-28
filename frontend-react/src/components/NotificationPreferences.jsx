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
import ToggleSwitch from './ToggleSwitch.jsx';
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

      <div className="pref-toggle-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '18px' }}>
        <ToggleSwitch
          id="pref-morning-checkin"
          checked={Boolean(prefs.morning_checkin)}
          disabled={busy}
          onChange={(checked) => save({ morning_checkin: checked })}
          label="Morning check-in greeting"
          description="A gentle, friendly greeting each morning to start your day with warmth."
        />

        <ToggleSwitch
          id="pref-due-review"
          checked={Boolean(prefs.due_review)}
          disabled={busy}
          onChange={(checked) => save({ due_review: checked })}
          label="Reminders when memories are due for review"
          description="Timely prompts based on your personalized spaced-repetition memory schedule."
        />

        <ToggleSwitch
          id="pref-family-alerts"
          checked={Boolean(prefs.family_alerts)}
          disabled={busy}
          onChange={(checked) => save({ family_alerts: checked })}
          label="Gentle check-ins if quiet for a while"
          description="A soft, supportive nudge if you have not checked in to MemorAid recently."
        />
      </div>

      <h3 style={{ marginTop: '22px' }}>Quiet hours</h3>
      <p className="form-hint" style={{ marginBottom: '12px' }}>
        MemorAid stays silent during these hours, in your local time.
      </p>

      <ToggleSwitch
        id="pref-quiet-hours"
        checked={Boolean(prefs.quiet_hours_enabled)}
        disabled={busy}
        onChange={(checked) => save({ quiet_hours_enabled: checked })}
        label="Use quiet hours"
        description="MemorAid stays completely silent and peaceful during these scheduled hours."
      />

      <div className="form-row" style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '12px' }}>
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
      <ToggleSwitch
        id="pref-family-consent"
        checked={Boolean(prefs.family_consent)}
        disabled={busy}
        onChange={(checked) => save({ family_consent: checked })}
        label="Consent for family check-in notices"
        description="I agree that my family contact may be sent a gentle check-in notice if I have been quiet for a long while. MemorAid never shares the contents of your memories."
      />
      <p className="form-hint" style={{ marginTop: '4px' }}>
        This is off by default. Even when switched on, the notice never includes
        any of your saved memories.
      </p>

      <h3 style={{ marginTop: '22px' }}>Browser notifications</h3>
      <ToggleSwitch
        id="pref-push-notifications"
        checked={Boolean(prefs.push_enabled)}
        disabled={busy || !pushUsable}
        onChange={() => togglePush()}
        label="Show reminders on this device"
        description="Display browser notifications directly on this screen when a reminder is ready."
      />
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
