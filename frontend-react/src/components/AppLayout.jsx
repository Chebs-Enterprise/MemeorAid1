/**
 * The signed-in application shell: sidebar + header + content area.
 *
 * Every authenticated page renders inside this layout (see router.jsx), so the
 * navigation exists exactly once. This is the single biggest structural
 * improvement over the vanilla build, where all ten pages repeated the same
 * ~60 lines of sidebar and topbar markup.
 */
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import A11yBar from './A11yBar.jsx';
import AppHeader from './AppHeader.jsx';
import Icon from './Icon.jsx';

const NAV_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/log-memory', icon: 'log-memory', label: 'Log a memory' },
  { to: '/recall', icon: 'recall', label: 'Recall session' },
  { to: '/exercises', icon: 'exercises', label: 'Exercises' },
  { to: '/chat', icon: 'chat', label: 'Companion' },
  { to: '/analytics', icon: 'analytics', label: 'Progress' },
  { to: '/profile', icon: 'profile', label: 'Profile' },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside
        className={`app-sidebar${menuOpen ? ' is-open' : ''}`}
        id="app-sidebar"
        aria-label="Main navigation"
      >
        <NavLink to="/dashboard" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark" aria-hidden="true">M</span>
          MemorAid
        </NavLink>

        <nav aria-label="Sections">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <Icon name={item.icon} size={22} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <A11yBar />
          <button type="button" className="sidebar-link" onClick={handleLogout}>
            <Icon name="signout" size={22} />
            Sign out
          </button>
        </div>
      </aside>

        <div
          className={`sidebar-backdrop${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />

        <div className="app-main">
          <AppHeader />

          {/* The mobile menu button stays its own slim strip: the header above
              carries only the avatar, settings and notifications. */}
          <div className="app-menu-bar">
            <button
              type="button"
              className="menu-toggle"
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name="menu" size={24} />
            </button>
          </div>

          <main className="app-stage" id="main-content">
            <Outlet />
          </main>
        </div>
    </div>
  );
}
