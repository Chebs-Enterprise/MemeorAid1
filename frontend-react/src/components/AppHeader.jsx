/**
 * The signed-in page header.
 *
 * Holds exactly three things, as requested: the avatar, a settings control and
 * a notifications control. Nothing else lives here — no page title, no brand,
 * no name or role label beside the avatar. It anchors to the right-hand side of
 * the content area, above the page's own content.
 *
 * The notifications and avatar controls open small popovers rather than
 * navigating away, so the header stays a utility strip and never becomes a
 * place you have to leave the page from. Both close on outside click and on
 * Escape.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import A11yBar from './A11yBar.jsx';
import Icon from './Icon.jsx';
import { initials } from '../lib/ui.jsx';

export default function AppHeader() {
  const { user, logout } = useAuth();
  const [openPanel, setOpenPanel] = useState(null); // 'notify' | 'account' | 'settings'
  const [notifications, setNotifications] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api
      .getNotifications()
      .then((n) => {
        if (alive) setNotifications(n.notifications || []);
      })
      .catch(() => {
        /* The header is not essential chrome: if this call fails the page
           below still works, so the badge simply stays empty. */
      });
    return () => {
      alive = false;
    };
  }, []);

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
        {/* Notifications ------------------------------------------------- */}
        <div className="header-slot">
          <button
            type="button"
            className={`header-btn${openPanel === 'notify' ? ' is-open' : ''}`}
            aria-label={
              notifications.length
                ? `Notifications, ${notifications.length} unread`
                : 'Notifications'
            }
            aria-expanded={openPanel === 'notify'}
            aria-haspopup="true"
            onClick={() => toggle('notify')}
          >
            <Icon name="bell" size={22} />
            {notifications.length > 0 && (
              <span className="header-dot" aria-hidden="true">
                {notifications.length > 9 ? '9+' : notifications.length}
              </span>
            )}
          </button>

          {openPanel === 'notify' && (
            <div className="header-panel header-panel-wide" role="group" aria-label="Notifications">
              <span className="header-panel-title">Notifications</span>
              {notifications.length === 0 ? (
                <p className="header-empty">Nothing new just now.</p>
              ) : (
                <ul className="header-list">
                  {notifications.slice(0, 6).map((n) => (
                    <li key={n.notificationid || n.id} className="header-list-item">
                      {n.message}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/dashboard" className="header-panel-link" onClick={() => setOpenPanel(null)}>
                See all on your dashboard
              </Link>
            </div>
          )}
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
