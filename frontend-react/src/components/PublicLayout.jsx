/**
 * Chrome for the public (signed-out) pages: landing, sign in, sign up.
 * Mirrors the top navigation of the vanilla build but defined once.
 */
import { NavLink, Outlet } from 'react-router-dom';
import A11yBar from './A11yBar.jsx';

export default function PublicLayout() {
  return (
    <>
      <header className="top-nav">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          MemorAid
        </NavLink>
        <nav className="nav-links" aria-label="Site">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Home
          </NavLink>
          <NavLink to="/login" className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Sign in
          </NavLink>
          <A11yBar />
          <NavLink to="/signup" className="btn btn-primary">
            Get started
          </NavLink>
        </nav>
      </header>
      <main className="public-main" id="main-content">
        <Outlet />
      </main>
    </>
  );
}
