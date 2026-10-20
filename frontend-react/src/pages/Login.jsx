/**
 * Sign-in page (public) — FR-01 Login.
 *
 * Uses the shared PasswordField (show/hide toggle) and shows the backend's
 * friendly message on failure. On success the auth context stores the session
 * and we return the visitor to wherever they were headed.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { FormMessage, PasswordField } from '../lib/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <section className="auth-shell">
      <div className="auth-panel">
        <h1>Welcome back</h1>
        <p style={{ margin: '10px 0 26px' }}>
          Sign in to pick up where you left off.
        </p>

        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <PasswordField
            id="password"
            label="Your password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />

          <FormMessage>{error}</FormMessage>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Signing you in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: '22px' }}>
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>

      <div className="auth-aside">
        <h2>A gentle start</h2>
        <p>
          Sign in and MemorAid will greet you each morning with what is due, how
          your streak is going, and one small thing to focus on today.
        </p>
      </div>
    </section>
  );
}
