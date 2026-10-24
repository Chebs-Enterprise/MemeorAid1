/**
 * Dashboard — the signed-in home screen.
 *
 * Pulls together the morning check-in message (FR-14), today's key numbers and
 * the most recent memories. Notification messages live on their own page
 * (`/notifications`), linked from the header bell — the dashboard deliberately
 * no longer repeats that feed.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import {
  categoryBadge,
  Loading,
  relativeDay,
  Toast,
  useToast,
} from '../lib/ui.jsx';

/** Icon per memory category, so each row carries a glanceable cue. */
const CATEGORY_ICON = {
  names: 'profile',
  appointments: 'calendar',
  tasks: 'check',
  conversations: 'chat',
  medications: 'log-memory',
};

function categoryIcon(category) {
  return CATEGORY_ICON[(category || '').toLowerCase()] || 'brain';
}

/** Today's date, e.g. "Tuesday, 20 October". */
function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [checkin, setCheckin] = useState(null);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const { message, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        api.getCheckin(),
        api.getMemories(),
      ]);
      setCheckin(c);
      setMemories(m.memories || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const completeCheckin = async () => {
    try {
      await api.completeCheckin();
      showToast('Good morning! Your check-in is recorded.');
      load();
    } catch (err) {
      showToast(err.message);
    }
  };

  if (loading) return <Loading label="Getting your day ready…" />;

  const firstName = (user?.fullname || '').split(' ')[0] || 'there';
  const dueCount = checkin?.due_count ?? 0;
  const nextMemory = memories[0];

  return (
    <>
      <Toast message={message} />

      <div className="banner-bleed">
      <section className="greeting-card">
        <div className="greeting-inner">
          <div className="greeting-copy">
            <span className="greeting-eyebrow">{todayLabel()}</span>
            <h2>Good day, {firstName}</h2>
          </div>
          <div className="greeting-side">
            {checkin && checkin.checked_in_today ? (
              <span className="checkin-done">
                <Icon name="check" size={20} />
                Checked in today
              </span>
            ) : (
              <button type="button" className="btn btn-primary" onClick={completeCheckin}>
                <Icon name="check" size={20} />
                Check in for today
              </button>
            )}
          </div>
        </div>
      </section>
      </div>

      <div className="stage-inner">
      <section className="stat-grid" aria-label="Today at a glance">
        <div className={`stat-card${dueCount > 0 ? ' is-due' : ''}`}>
          <span className="stat-icon">
            <Icon name="recall" size={22} />
          </span>
          <div className="stat-body">
            <div className="stat-value">{dueCount}</div>
            <div className="stat-label">Reviews due today</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <Icon name="brain" size={22} />
          </span>
          <div className="stat-body">
            <div className="stat-value">{checkin?.recall_streak ?? 0}</div>
            <div className="stat-label">Day recall streak</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <Icon name="exercises" size={22} />
          </span>
          <div className="stat-body">
            <div className="stat-value">{checkin?.exercise_streak ?? 0}</div>
            <div className="stat-label">Day exercise streak</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <Icon name="analytics" size={22} />
          </span>
          <div className="stat-body">
            <div className="stat-value">{memories.length}</div>
            <div className="stat-label">Memories kept</div>
          </div>
        </div>
      </section>

      <section className="next-up">
        <div className="next-up-icon">
          <Icon name="recall" size={26} />
        </div>
        <div className="next-up-body">
          <h3>{dueCount > 0 ? 'You have reviews waiting' : 'Nothing due right now'}</h3>
          <p>
            {dueCount === 1
              ? 'One memory is ready to revisit — it will only take a moment.'
              : dueCount > 1
                ? `${dueCount} memories are ready to revisit. Let's take them one at a time.`
                : 'Your memories are resting. Come back tomorrow, or add something new today.'}
          </p>
        </div>
        {dueCount > 0 ? (
          <Link to="/recall" className="btn btn-primary">Start recall session</Link>
        ) : (
          <Link to="/exercises" className="btn btn-secondary">Try an exercise</Link>
        )}
      </section>

      <section className="dash-section">
        <div className="section-head">
          <h2>Your recent memories</h2>
          <Link to="/log-memory" className="btn btn-secondary">
            <Icon name="log-memory" size={20} />
            Log a memory
          </Link>
        </div>

        {memories.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing saved yet</h3>
            <p>
              Start with something small — a name, a routine, a moment you want
              to keep.
            </p>
            <Link to="/log-memory" className="btn btn-primary">Log your first memory</Link>
          </div>
        ) : (
          <div className="memory-list">
            {memories.slice(0, 6).map((m) => (
              <article key={m.memoryid} className="memory-item">
                <span className="memory-icon">
                  <Icon name={categoryIcon(m.category)} size={22} />
                </span>
                <div className="content">{m.content}</div>
                <div className="meta">
                  <span className={`badge ${categoryBadge(m.category)}`}>{m.category}</span>
                  <span className="badge badge-dim">
                    Next: {relativeDay(m.nextreviewdate)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {nextMemory && (
        <section className="dash-section">
          <div className="section-head">
            <h2>Up next</h2>
            <Link to="/recall" className="section-link">Start a session</Link>
          </div>
          <article className="upnext-card">
            <span className="upnext-icon">
              <Icon name={categoryIcon(nextMemory.category)} size={24} />
            </span>
            <div className="upnext-body">
              <span className="upnext-category">{nextMemory.category}</span>
              <p className="upnext-text">{nextMemory.content}</p>
            </div>
            <div className="upnext-when">
              <span className="upnext-when-label">Comes back</span>
              <span className="upnext-when-value">{relativeDay(nextMemory.nextreviewdate)}</span>
            </div>
          </article>
        </section>
      )}
      </div>
    </>
  );
}
