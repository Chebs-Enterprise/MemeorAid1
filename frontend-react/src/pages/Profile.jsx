/**
 * Profile and settings — FR-02.
 *
 * Lets the user update their details and the accessibility preferences that
 * the document calls for, including the morning check-in time, family contact
 * and inactivity threshold used by the alerting feature.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, Loading, FormMessage, Toast, useToast } from '../lib/ui.jsx';

export default function Profile() {
  const { refreshUser } = useAuth();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberSince, setMemberSince] = useState(null);
  const { message, showToast } = useToast();

  useEffect(() => {
    api
      .getProfile()
      .then((res) => {
        const u = res.user;
        setForm({
          fullname: u.fullname || '',
          email: u.email || '',
          agegroup: u.agegroup || '',
          checkintime: u.checkintime || '08:00',
          family_contact_email: u.family_contact_email || '',
          accessibilitypref: u.accessibilitypref || '',
          inactivity_threshold_hours: u.inactivity_threshold_hours || 24,
        });
        setMemberSince(u.createdat);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.updateProfile({
        ...form,
        inactivity_threshold_hours: Number(form.inactivity_threshold_hours),
      });
      await refreshUser();
      showToast('Your details have been saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading your details…" />;
  if (!form) return <Toast message={error} />;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <header className="stage-header">
        <h1>Your profile</h1>
        <p>Keep your details and preferences up to date.</p>
      </header>

      <form onSubmit={submit} noValidate className="card">
        <div className="form-group">
          <label htmlFor="fullname">Your full name</label>
          <input
            id="fullname"
            type="text"
            value={form.fullname}
            onChange={(e) => set('fullname')(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" value={form.email} disabled />
          <span className="form-hint" style={{ marginTop: '8px' }}>
            Your email is used to sign in and cannot be changed here.
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="agegroup">Your age group</label>
          <select
            id="agegroup"
            value={form.agegroup}
            onChange={(e) => set('agegroup')(e.target.value)}
          >
            <option value="51-65">51–65</option>
            <option value="above-65">Above 65</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="checkintime">Morning check-in time</label>
          <input
            id="checkintime"
            type="time"
            value={form.checkintime}
            onChange={(e) => set('checkintime')(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="family">Family contact email</label>
          <span className="form-hint" id="family-hint">
            Optional. Used only if you would like a loved one notified after a
            quiet spell.
          </span>
          <input
            id="family"
            type="email"
            value={form.family_contact_email}
            onChange={(e) => set('family_contact_email')(e.target.value)}
            aria-describedby="family-hint"
          />
        </div>

        <div className="form-group">
          <label htmlFor="inactivity">Inactivity alert after (hours)</label>
          <span className="form-hint" id="inactivity-hint">
            How long without activity before your family contact is notified.
          </span>
          <input
            id="inactivity"
            type="text"
            inputMode="numeric"
            value={form.inactivity_threshold_hours}
            onChange={(e) => set('inactivity_threshold_hours')(e.target.value)}
            aria-describedby="inactivity-hint"
          />
        </div>

        <div className="form-group">
          <label htmlFor="accessibility">
            Anything that helps you use MemorAid
          </label>
          <span className="form-hint" id="accessibility-hint">
            For example: "I prefer large text" or "Please speak slowly."
          </span>
          <textarea
            id="accessibility"
            value={form.accessibilitypref}
            onChange={(e) => set('accessibilitypref')(e.target.value)}
            aria-describedby="accessibility-hint"
            style={{ minHeight: '110px' }}
          />
        </div>

        <FormMessage>{error}</FormMessage>

        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Saving…' : 'Save my details'}
        </button>

        {memberSince && (
          <p style={{ marginTop: '22px' }}>
            You have been with MemorAid since {formatDate(memberSince)}.
          </p>
        )}
      </form>
      </div>
    </>
  );
}
