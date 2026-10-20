/**
 * Exercise session — FR-08.
 *
 * Shows the six validated techniques, presents the one MemorAid has chosen
 * (the least-recently-used, targeted at the weakest recall category), and
 * records completion so the exercise streak advances.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';

const ALL_TECHNIQUES = [
  ['method_of_loci', 'Method of Loci'],
  ['elaborative_encoding', 'Elaborative Encoding'],
  ['spaced_retrieval', 'Spaced Retrieval'],
  ['face_name_association', 'Face–Name Association'],
  ['chunking', 'Chunking'],
  ['active_observation', 'Active Observation'],
];

export default function Exercises() {
  const [exercise, setExercise] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const { message, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const [next, hist] = await Promise.all([
        api.getNextExercise(),
        api.getExerciseHistory(),
      ]);
      setExercise(next.exercise);
      setHistory(hist.exercises || []);
      setDone(false);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const complete = async () => {
    if (!exercise) return;
    setBusy(true);
    try {
      const res = await api.completeExercise({
        exerciseid: exercise.exerciseid,
        technique: exercise.technique,
      });
      showToast(res.message);
      setDone(true);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Choosing today's exercise…" />;

  const steps = exercise?.guidance_text
    ? exercise.guidance_text.split('\n').filter(Boolean)
    : exercise?.steps || [];

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <header className="stage-header">
        <h1>Memory exercises</h1>
        <p>
          A short, guided practice using one of six techniques proven to
          strengthen memory.
        </p>
      </header>

      <section className="technique-grid" aria-label="The six techniques">
        {ALL_TECHNIQUES.map(([key, label]) => (
          <div
            key={key}
            className={`technique-chip${exercise?.technique === key ? ' is-current' : ''}`}
          >
            {label}
            {exercise?.technique === key && <small>Today's exercise</small>}
          </div>
        ))}
      </section>

      <section className="card">
        <span className="badge badge-teal">Today's technique</span>
        <h2 style={{ margin: '16px 0 10px' }}>{exercise?.name}</h2>
        <p>{exercise?.summary}</p>

        {exercise?.weak_category && (
          <p style={{ marginTop: '14px' }}>
            <span className="badge badge-gold">Focus area: {exercise.weak_category}</span>
          </p>
        )}

        <h3 style={{ marginTop: '28px' }}>How to do it</h3>
        <ol className="steps-list">
          {steps.map((step, i) => (
            <li key={i}>{step.replace(/^\s*\d+[.)]\s*/, '')}</li>
          ))}
        </ol>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={complete}
            disabled={busy || done}
          >
            {done ? (
              <>
                <Icon name="check" size={20} />
                Exercise complete
              </>
            ) : busy ? (
              'Saving…'
            ) : (
              'Mark as complete'
            )}
          </button>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <Icon name="refresh" size={20} />
            Show me a different one
          </button>
        </div>
      </section>

      {history.length > 0 && (
        <section style={{ marginTop: '40px' }}>
          <h2>Recent exercises</h2>
          <div className="memory-list" style={{ marginTop: '16px' }}>
            {history.slice(0, 8).map((h) => (
              <article key={h.exerciseid} className="memory-item">
                <div className="content" style={{ textTransform: 'capitalize' }}>
                  {h.technique.replace(/_/g, ' ')}
                </div>
                <div className="meta">
                  <span className="badge badge-green">Completed</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      </div>
    </>
  );
}
