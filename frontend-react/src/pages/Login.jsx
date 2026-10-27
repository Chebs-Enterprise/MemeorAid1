/**
 * Sign-in page (public) — FR-01 Login.
 *
 * Two-panel card layout matching the reference design:
 *   Left  — warm cream panel with a portrait photo card of an older Black man
 *   Right — form: brand, "Welcome back", email, password, keep-me-logged-in, Login button
 * Footer — copyright and legal links
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Brand from '../components/Brand.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { FormMessage } from '../lib/ui.jsx';

function PwField({ id, label, value, onChange, autoComplete }) {
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
          placeholder="••••••••"
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

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLogged, setKeepLogged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ap-page">
      <div className="ap-card">

        {/* ── Left illustrated panel ── */}
        <div className="ap-panel ap-panel--login">
          <div className="ap-login-photo-box">
            <img
              src="/login-older-black-adult.jpg"
              alt="Older Black man doing a guided movement exercise with a caregiver"
              className="ap-login-img"
            />
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="ap-form-panel">
          <div className="ap-form-inner">
            <div className="ap-header-center">
              <Brand to="/" className="ap-brand" label="MemorAid home" />
              <h1 className="ap-title">Welcome back</h1>
              <p className="ap-subtitle">Good to see you again. Your memories are waiting.</p>
            </div>

            <form onSubmit={submit} noValidate className="ap-form">
              <div className="ap-form-group">
                <label htmlFor="email" className="ap-label">Email Address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                  className="ap-input"
                  required
                />
              </div>

              <PwField
                id="password"
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />

              <label className="ap-check-row">
                <input
                  type="checkbox"
                  checked={keepLogged}
                  onChange={(e) => setKeepLogged(e.target.checked)}
                  className="ap-checkbox"
                />
                <span className="ap-check-text">Keep me logged in</span>
              </label>

              {error && <FormMessage className="is-error">{error}</FormMessage>}

              <button
                type="submit"
                className="ap-btn-primary"
                disabled={busy}
              >
                {busy ? 'Signing you in…' : 'Login'}
              </button>
            </form>

            <p className="ap-switch-text">
              Don't have an account?{' '}
              <Link to="/signup" className="ap-switch-link">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
