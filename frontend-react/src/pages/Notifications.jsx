/**
 * Notifications — the full reminder history, on its own page.
 *
 * The header bell navigates here instead of opening a popover, so reminders
 * never sit on top of the dashboard. Rows can be marked read one at a time,
 * cleared in bulk, or removed: the backend soft-deletes a removed row so the
 * scheduler cannot recreate the same reminder minutes later.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { formatDate, Loading, Toast, useToast } from '../lib/ui.jsx';

/** Icon per notification type, so each row carries a glanceable cue. */
const TYPE_ICON = {
  morning_checkin: 'sun',
  due_review: 'recall',
  family_alert: 'users',
  inactivity: 'clock',
};

/** Plain-language name per type (no internal identifiers shown to the user). */
const TYPE_LABEL = {
  morning_checkin: 'Morning check-in',
  due_review: 'Review due',
  family_alert: 'Family alert',
  inactivity: 'Gentle nudge',
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const { message, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api.getNotifications({ limit: 100 });
      setNotifications(res.notifications || []);
      setUnread(res.unread_count ?? (res.notifications || []).filter((n) => n.unread).length);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const markAllRead = async () => {
    // Optimistic: the list and the count update immediately, then the server
    // confirms. On failure the page reloads the real state instead of lying.
    setNotifications((rows) => rows.map((r) => ({ ...r, unread: false })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      showToast(err.message);
      load();
    }
  };

  const markRead = async (id) => {
    setNotifications((rows) =>
      rows.map((r) => (r.notificationid === id ? { ...r, unread: false } : r)),
    );
    setUnread((n) => Math.max(0, n - 1));
    try {
      await api.markNotificationRead(id);
    } catch (err) {
      showToast(err.message);
      load();
    }
  };

  const remove = async (item) => {
    setNotifications((rows) => rows.filter((r) => r.notificationid !== item.notificationid));
    if (item.unread) setUnread((n) => Math.max(0, n - 1));
    try {
      await api.deleteNotification(item.notificationid);
    } catch (err) {
      showToast(err.message);
      load();
    }
  };

  if (loading) return <Loading label="Gathering your messages…" />;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
        <header className="stage-header">
          <h1>Notifications</h1>
          <p>
            Check-ins, reminders and messages from MemorAid. They stay here until
            you mark them read or remove them.
          </p>
        </header>

        <div className="section-head">
          <h2>
            {unread > 0
              ? `${unread} ${unread === 1 ? 'message' : 'messages'} to read`
              : 'All caught up'}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Link to="/profile" className="btn btn-secondary">
              <Icon name="settings" size={20} />
              Notification settings
            </Link>
            {unread > 0 && (
              <button type="button" className="btn btn-primary" onClick={markAllRead}>
                <Icon name="check" size={20} />
                Mark all as read
              </button>
            )}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing here yet</h3>
            <p>
              When there is a check-in, a memory to revisit, or a message from
              your family, it will appear on this page.
            </p>
            <Link to="/dashboard" className="btn btn-primary">Back to your dashboard</Link>
          </div>
        ) : (
          <div className="memory-list">
            {notifications.map((n) => (
              <article
                key={n.notificationid}
                className={`memory-item is-note${n.unread ? ' is-unread' : ''}`}
              >
                <span className="memory-icon is-note">
                  <Icon name={TYPE_ICON[n.type] || 'bell'} size={20} />
                </span>
                <div className="content">
                  {n.title && <strong>{n.title}. </strong>}
                  {n.message}
                </div>
                <div className="meta">
                  <span className="badge badge-dim">
                    {TYPE_LABEL[n.type] || 'Message'}
                  </span>
                  <span className="badge badge-dim">{formatDate(n.createdat)}</span>
                  {n.unread && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => markRead(n.notificationid)}
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => remove(n)}
                    aria-label="Remove this notification"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
