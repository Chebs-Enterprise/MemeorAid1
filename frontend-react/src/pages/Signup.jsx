/**
 * Registration page (public) — FR-01 Register Account.
 *
 * Two-panel card layout matching the reference design:
 *   Left  — full-bleed photo panel with teal gradient and tagline
 *   Right — form: Full Name, Email, Password, Confirm Password,
 *            Friendly Age Group dropdown, Terms checkbox card, Create my account button
 * Footer — copyright and legal links
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FormMessage } from '../lib/ui.jsx';

function PwField({ id, label, value, onChange, autoComplete, placeholder = '••••••••' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="ap-form-group">
      <label htmlFor={id} className="ap-label">{label}</label>
      <div className="ap-pw-wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="ap-input"
          required
        />
        <button
          type="button"
          className="ap-pw-toggle"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((s) => !s)}
        >
          {show ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullname: '',
    email: '',
    password: '',
    confirmPassword: '',
    agegroup: '',
    checkintime: '08:00',
    family_contact_email: '',
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const setRaw = (key) => (e) => set(key)(e.target.value);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Please choose a password of at least 8 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match. Please check both fields.');
      return;
    }
    if (!form.agegroup) {
      setError('Please select your age group so we can personalise your experience.');
      return;
    }
    if (!agreed) {
      setError('Please agree to the Terms of Service to continue.');
      return;
    }
    setBusy(true);
    try {
      const { confirmPassword: _c, ...payload } = form;
      await register(payload);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ap-page ap-page--signup">
      <div className="ap-card ap-card--signup">

        {/* ── Left illustrated/photo panel with teal overlay ── */}
        <div className="ap-panel ap-panel--signup">
          <img
            src="/signup-photo.jpg"
            alt="Elderly woman smiling warmly, just like the portrait on the sign-in page."
            className="ap-signup-img"
          />
          <div className="ap-panel-overlay" aria-hidden="true" />
          <div className="ap-panel-content">
            <span className="ap-panel-badge">✦ Gentle Cognitive Care</span>
            <p className="ap-panel-quote">
              Stay connected with the moments and loved ones that matter most.
            </p>
            <p className="ap-panel-author">
              Empathetic AI Companion • SM-2 Spaced Recall • Caregiver Peace of Mind
            </p>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="ap-form-panel">
          <div className="ap-form-inner">
            <div className="ap-header-center">
              <Link to="/" className="ap-brand">MemorAid</Link>
              <h1 className="ap-title">Let's get you started</h1>
              <p className="ap-subtitle">Create your account in two minutes</p>
            </div>

            <form onSubmit={submit} noValidate className="ap-form">
              <div className="ap-form-group">
                <label htmlFor="fullname" className="ap-label">Full Name</label>
                <input
                  id="fullname"
                  type="text"
                  value={form.fullname}
                  onChange={setRaw('fullname')}
                  placeholder="Enter your full name"
                  autoComplete="name"
                  className="ap-input"
                  required
                />
              </div>

              <div className="ap-form-group">
                <label htmlFor="email" className="ap-label">Email Address</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={setRaw('email')}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                  className="ap-input"
                  required
                />
              </div>

              <div className="ap-pw-row">
                <PwField
                  id="password"
                  label="Password"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="new-password"
                />
                <PwField
                  id="confirmPassword"
                  label="Confirm Password"
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  autoComplete="new-password"
                />
              </div>

              <div className="ap-form-group">
                <label htmlFor="agegroup" className="ap-label">Friendly Age Group</label>
                <div className="ap-select-wrap">
                  <select
                    id="agegroup"
                    value={form.agegroup}
                    onChange={setRaw('agegroup')}
                    className="ap-input ap-select"
                    required
                  >
                    <option value="">Select your age group</option>
                    <option value="51-65">51 – 65</option>
                    <option value="above-65">Above 65</option>
                  </select>
                  <span className="ap-select-arrow" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
              </div>

              <label className="ap-check-row ap-check-row--terms">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="ap-checkbox"
                />
                <span className="ap-check-terms-text">
                  I agree to the{' '}
                  <a href="#" className="ap-terms-link" onClick={(e) => e.preventDefault()}>Terms of Service</a>
                  {' '}and acknowledge that my family data is kept private and secure.
                </span>
              </label>

              {error && <FormMessage className="is-error">{error}</FormMessage>}

              <button
                type="submit"
                className="ap-btn-primary"
                disabled={busy}
              >
                {busy ? 'Creating your account…' : 'Create my account'}
              </button>
            </form>

            <p className="ap-switch-text">
              Already have an account?{' '}
              <Link to="/login" className="ap-switch-link">Log in here</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
