/**
 * Recall session — FR-05 / FR-06 / FR-07.
 *
 * Implements the document's recall activity diagram (figure 3.4) as a small
 * state machine:
 *
 *   loading -> asking -> revealed -> (next question | summary)
 *
 * The original memory is NEVER shown while the question is on screen; it is
 * disclosed only when the user presses Reveal. One question is presented at a
 * time (section 3.5.2), and afterwards the backend's SM-2 result determines
 * when each memory returns.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';

const RATINGS = [
  { q: 0, word: 'No recall' },
  { q: 1, word: 'Very hard' },
  { q: 2, word: 'Hard' },
  { q: 3, word: 'Okay' },
  { q: 4, word: 'Good' },
  { q: 5, word: 'Easy' },
];

export default function Recall() {
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [reveal, setReveal] = useState(null);
  const [quality, setQuality] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { message, showToast } = useToast();

  const loadDue = useCallback(async () => {
    try {
      const res = await api.getDueReviews();
      setQueue(res.questions || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDue();
  }, [loadDue]);

  const current = queue[index];

  const doReveal = async () => {
    if (!current) return;
    try {
      const res = await api.revealAnswer(current.questionid);
      setReveal(res);
    } catch (err) {
      showToast(err.message);
    }
  };

  const submitRating = async () => {
    if (quality === null || !current) return;
    setBusy(true);
    try {
      const res = await api.submitRecall({
        questionid: current.questionid,
        response: answer,
        quality,
      });
      setFeedback(res);

      if (index + 1 < queue.length) {
        setTimeout(() => {
          setIndex((i) => i + 1);
          setAnswer('');
          setReveal(null);
          setQuality(null);
          setFeedback(null);
        }, 2200);
      } else {
        const s = await api.getRecallSummary();
        setSummary(s);
      }
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Finding today's reviews…" />;

  if (queue.length === 0) {
    return (
      <div className="stage-inner">
        <header className="stage-header">
          <h1>Recall session</h1>
        </header>
        <div className="empty-state">
          <h3>Nothing is due just now</h3>
          <p>
            You are all caught up. MemorAid will bring memories back as each one
            becomes due — that spacing is what makes them stick.
          </p>
          <Link to="/dashboard" className="btn btn-primary">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (summary) {
    const accuracy = summary.attempted
      ? Math.round((100 * summary.passed) / summary.attempted)
      : 0;
    return (
      <>
        <Toast message={message} />
        <div className="stage-inner">
        <section className="card session-summary">
          <h1>Session complete</h1>
          <p style={{ marginTop: '10px' }}>Here is how today went.</p>
          <div className="animation" style={{ margin: '30px 0' }}>
            <div className="big">{accuracy}%</div>
            <p>recalled correctly today</p>
          </div>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{summary.attempted}</div>
              <div className="stat-label">Questions answered</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.passed}</div>
              <div className="stat-label">Recalled well</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.recall_streak}</div>
              <div className="stat-label">Day streak</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '26px' }}>
            <Link to="/dashboard" className="btn btn-primary">Back to dashboard</Link>
            <Link to="/exercises" className="btn btn-secondary">Try an exercise</Link>
          </div>
        </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <div className="recall-shell">
        <header className="stage-header">
          <h1>Recall session</h1>
          <p>
            Question {index + 1} of {queue.length} — take your time.
          </p>
        </header>

        <div className="recall-progress" aria-hidden="true">
          {queue.map((q, i) => (
            <span
              key={q.questionid}
              className={`dot${i < index ? ' is-done' : ''}${i === index ? ' is-current' : ''}`}
              style={{
                display: 'inline-block',
                width: `${100 / queue.length}%`,
                background: i <= index ? 'var(--teal-forest)' : 'transparent',
              }}
            />
          ))}
        </div>

        <article className="question-card">
          <span className="badge badge-teal">{current.category}</span>
          <p className="question-text">{current.questiontext}</p>

          <div className="form-group">
            <label htmlFor="answer">Your answer</label>
            <span className="form-hint" id="answer-hint">
              Write whatever comes to mind — there is no wrong attempt here.
            </span>
            <textarea
              id="answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              aria-describedby="answer-hint"
              disabled={Boolean(feedback)}
            />
          </div>

          {!reveal ? (
            <button
              type="button"
              className="btn btn-outline btn-lg btn-block"
              onClick={doReveal}
              disabled={Boolean(feedback)}
            >
              <Icon name="reveal" size={22} />
              Reveal the answer
            </button>
          ) : (
            <>
              <div className="reveal-panel">
                <h3>The original memory</h3>
                <p>{reveal.content}</p>
              </div>

              {!feedback ? (
                <div className="form-group">
                  <label id="rating-label">How did that feel?</label>
                  <span className="form-hint" id="rating-hint">
                    Choose the answer that fits best — be honest, it helps
                    MemorAid time the next review.
                  </span>
                  <div
                    className="rating-scale"
                    role="radiogroup"
                    aria-labelledby="rating-label"
                    aria-describedby="rating-hint"
                  >
                    {RATINGS.map((r) => (
                      <button
                        key={r.q}
                        type="button"
                        role="radio"
                        aria-checked={quality === r.q}
                        className={`rating-btn${quality === r.q ? ' is-selected' : ''}`}
                        onClick={() => setQuality(r.q)}
                      >
                        <span className="num">{r.q}</span>
                        <span className="word">{r.word}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!feedback ? (
                <button
                  type="button"
                  className="btn btn-primary btn-lg btn-block"
                  onClick={submitRating}
                  disabled={quality === null || busy}
                >
                  {busy ? 'Recording…' : 'Save my answer'}
                </button>
              ) : (
                <div className={`form-message ${feedback.passed ? 'is-success' : 'is-error'}`} role="status">
                  {feedback.passed
                    ? 'Well done — that one is getting stronger.'
                    : 'Thank you for trying. This memory will come back sooner to help it settle.'}
                  {' '}
                  Next review {feedback.nextreviewdate}.
                </div>
              )}
            </>
          )}
        </article>
      </div>
      </div>
    </>
  );
}
