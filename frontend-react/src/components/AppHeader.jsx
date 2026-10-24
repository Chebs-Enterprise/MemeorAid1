/**
 * The signed-in page header.
 *
 * Holds exactly three things, as requested: the avatar, a settings control and
 * a notifications control. Nothing else lives here — no page title, no brand,
 * no name or role label beside the avatar. It anchors to the right-hand side of
 * the content area, above the page's own content.
 *
 * The bell is a link to the dedicated /notifications page, so reminders are
 * read on their own screen rather than in a panel over the dashboard. Only the
 * settings and avatar controls open popovers; both close on outside click and
 * on Escape.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import A11yBar from './A11yBar.jsx';
import Icon from './Icon.jsx';
import { initials } from '../lib/ui.jsx';

export default function AppHeader() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [openPanel, setOpenPanel] = useState(null); // 'account' | 'settings'
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await api.getUnreadCount();
      setUnread(res.unread_count ?? 0);
    } catch {
      /* The header is not essential chrome: if this call fails the page below
         still works, so the badge simply stays as it was. */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (alive) loadUnread();
    };
    load();
    // The scheduler creates reminders in the background independent of the
    // frontend, so poll so the badge appears without a manual reload.
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loadUnread]);

  // Re-read the badge whenever the page changes: reading notifications on the
  // notifications page must clear the count as soon as the user navigates on.
  useEffect(() => {
    loadUnread();
  }, [location.pathname, loadUnread]);

  // Close whichever popover is open on outside click or Escape.
  useEffect(() => {
    if (!openPanel) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenPanel(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenPanel(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openPanel]);

  const toggle = (panel) => setOpenPanel((cur) => (cur === panel ? null : panel));

  return (
    <header className="app-header" ref={wrapRef}>
      <div className="header-actions">
        {/* Notifications — a link to their own page ----------------------- */}
        <div className="header-slot">
          <NavLink
            to="/notifications"
            className={({ isActive }) => `header-btn${isActive ? ' is-open' : ''}`}
            aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <Icon name="bell" size={22} />
            {unread > 0 && (
              <span className="header-dot" aria-hidden="true">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>
        </div>

        {/* Settings ------------------------------------------------------ */}
        <div className="header-slot">
          <button
            type="button"
            className={`header-btn${openPanel === 'settings' ? ' is-open' : ''}`}
            aria-label="Settings"
            aria-expanded={openPanel === 'settings'}
            aria-haspopup="true"
            onClick={() => toggle('settings')}
          >
            <Icon name="settings" size={22} />
          </button>

          {openPanel === 'settings' && (
            <div className="header-panel" role="group" aria-label="Settings">
              <span className="header-panel-title">Display</span>
              {/* The document requires text-size presets and high contrast to
                  be reachable; they live here and in the sidebar. */}
              <A11yBar />
              <span className="header-panel-title">Account</span>
              <Link to="/profile" className="header-panel-link" onClick={() => setOpenPanel(null)}>
                Profile and details
              </Link>
              <button
                type="button"
                className="header-panel-link is-danger"
                onClick={() => {
                  setOpenPanel(null);
                  logout();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Avatar -------------------------------------------------------- */}
        <div className="header-slot">
          <button
            type="button"
            className={`header-avatar${openPanel === 'account' ? ' is-open' : ''}`}
            aria-label="Your account"
            aria-expanded={openPanel === 'account'}
            aria-haspopup="true"
            onClick={() => toggle('account')}
          >
            <span aria-hidden="true">{initials(user?.fullname)}</span>
          </button>

          {openPanel === 'account' && (
            <div className="header-panel" role="group" aria-label="Your account">
              <span className="header-panel-title">Signed in as</span>
              <p className="header-account-name">{user?.fullname || 'MemorAid member'}</p>
              <Link to="/profile" className="header-panel-link" onClick={() => setOpenPanel(null)}>
                Profile
              </Link>
              <button
                type="button"
                className="header-panel-link is-danger"
                onClick={() => {
                  setOpenPanel(null);
                  logout();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
