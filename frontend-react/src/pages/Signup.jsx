/**
 * Registration page (public) — FR-01 Register Account.
 *
 * Collects the details the backend validates: full name, email, password
 * (minimum 8 characters), age group, and the optional morning check-in time
 * and family contact used by the adherence features.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FormMessage, PasswordField } from '../lib/ui.jsx';

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullname: '',
    email: '',
    password: '',
    agegroup: '',
    checkintime: '08:00',
    family_contact_email: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Please choose a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await register(form);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <h1>Create your account</h1>
        <p style={{ margin: '10px 0 26px' }}>
          It only takes a minute. You can change any of this later.
        </p>

        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label htmlFor="fullname">Your full name</label>
            <input
              id="fullname"
              type="text"
              value={form.fullname}
              onChange={(e) => set('fullname')(e.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <PasswordField
            id="password"
            label="Choose a password"
            hint="At least 8 characters, please."
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />

          <div className="form-group">
            <label htmlFor="agegroup">Your age group</label>
            <select
              id="agegroup"
              value={form.agegroup}
              onChange={(e) => set('agegroup')(e.target.value)}
              required
            >
              <option value="">Please choose…</option>
              <option value="51-65">51–65</option>
              <option value="above-65">Above 65</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="checkintime">Preferred morning check-in time</label>
            <span className="form-hint" id="checkintime-hint">
              We will greet you around this time each day.
            </span>
            <input
              id="checkintime"
              type="time"
              value={form.checkintime}
              onChange={(e) => set('checkintime')(e.target.value)}
              aria-describedby="checkintime-hint"
            />
          </div>

          <div className="form-group">
            <label htmlFor="family">
              Family contact email (optional)
            </label>
            <span className="form-hint" id="family-hint">
              If you would like a loved one notified when you have not been
              active for a while.
            </span>
            <input
              id="family"
              type="email"
              value={form.family_contact_email}
              onChange={(e) => set('family_contact_email')(e.target.value)}
              aria-describedby="family-hint"
            />
          </div>

          <FormMessage>{error}</FormMessage>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: '22px' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>

      <div className="auth-aside">
        <h2>Built around you</h2>
        <p>
          Large, comfortable controls. Plain language throughout. Everything
          designed so that the technology stays out of your way.
        </p>
      </div>
    </section>
  );
}
