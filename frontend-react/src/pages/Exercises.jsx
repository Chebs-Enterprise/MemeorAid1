/**
 * Exercise session — FR-08.
 *
 * The backend chooses one of the six validated techniques (least recently
 * used, aimed at the user's weakest recall category). This page then runs it
 * as a tutor-guided session: one instruction or question at a time, with
 * feedback, examples, hints, pause/resume and a completion summary.
 *
 * The session is only recorded as complete after the user has worked through
 * every step and reached the summary — opening the page is not enough.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Loading, Toast, useToast } from '../lib/ui.jsx';
import { buildTutorSession } from '../lib/exerciseTutor.js';

const ALL_TECHNIQUES = [
  ['method_of_loci', 'Method of Loci'],
  ['elaborative_encoding', 'Elaborative Encoding'],
  ['spaced_retrieval', 'Spaced Retrieval'],
  ['face_name_association', 'Face–Name Association'],
  ['chunking', 'Chunking'],
  ['active_observation', 'Active Observation'],
];

function resolve(value) {
  return typeof value === 'function' ? value() : value;
}

function performanceMessage(result) {
  if (result.recallTotal > 0) {
    if (result.correct === result.recallTotal) {
      return 'You recalled every detail on your own. That is excellent work.';
    }
    if (result.score >= 60) {
      return 'Good effort. Each time you practise, the details come back a little more easily.';
    }
    return 'Thank you for practising. This one was tricky — it will feel easier next time.';
  }
  return 'You worked through every step. The more you use these techniques, the more natural they become.';
}

export default function Exercises() {
  const [exercise, setExercise] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('intro');
  const [stepIndex, setStepIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [hintShown, setHintShown] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState('idle');
  const { message, showToast } = useToast();

  const session = useMemo(
    () => (exercise ? buildTutorSession(exercise) : null),
    [exercise],
  );
  const steps = session?.steps || [];
  const step = steps[stepIndex] || null;
  const totalSteps = steps.length;
  const askTotal = session?.askTotal || 0;
  const recallTotal = session?.recallTotal || 0;

  const resetSession = useCallback(() => {
    setPhase('intro');
    setStepIndex(0);
    setAnswer('');
    setAnswerError('');
    setFeedback(null);
    setHintShown(false);
    setAnswered(0);
    setCorrect(0);
    setResult(null);
    setSaving('idle');
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [next, hist] = await Promise.all([
        api.getNextExercise(),
        api.getExerciseHistory(),
      ]);
      setExercise(next.exercise);
      setHistory(hist.exercises || []);
      resetSession();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [resetSession, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const start = () => {
    // A fresh exercise object rebuilds the tutor script, so a repeat starts
    // with clean answers even though the backend session id is reused.
    setExercise((current) => (current ? { ...current } : current));
    setPhase('running');
    setStepIndex(0);
    setAnswer('');
    setAnswerError('');
    setFeedback(null);
    setHintShown(false);
    setAnswered(0);
    setCorrect(0);
    setResult(null);
    setSaving('idle');
  };

  const pause = () => {
    if (phase === 'running') setPhase('paused');
  };

  const saveCompletion = async (score) => {
    if (!exercise) return;
    setSaving('saving');
    try {
      const res = await api.completeExercise({
        exerciseid: exercise.exerciseid,
        technique: exercise.technique,
        score,
      });
      setSaving('saved');
      setResult((current) =>
        current ? { ...current, streak: res.exercise_streak } : current,
      );
      showToast(res.message);
      api.getExerciseHistory()
        .then((hist) => setHistory(hist.exercises || []))
        .catch(() => {});
    } catch (err) {
      setSaving('error');
      showToast(err.message);
    }
  };

  const finish = () => {
    if (!exercise || !session) return;
    const score = recallTotal > 0
      ? Math.round((100 * correct) / recallTotal)
      : askTotal > 0
        ? Math.round((100 * answered) / askTotal)
        : 100;
    setResult({
      score,
      answered,
      correct,
      recallTotal,
      totalSteps,
      streak: null,
    });
    setPhase('summary');
    saveCompletion(score);
  };

  const advance = () => {
    if (stepIndex + 1 >= totalSteps) {
      finish();
      return;
    }
    setStepIndex((index) => index + 1);
    setAnswer('');
    setAnswerError('');
    setFeedback(null);
    setHintShown(false);
  };

  const submit = () => {
    if (!step || step.kind !== 'ask' || feedback) return;
    if (!answer.trim()) {
      setAnswerError(
        'Take your time. Even a guess is a good start — write whatever comes to mind.',
      );
      return;
    }
    let outcome = {};
    try {
      outcome = step.evaluate(answer) || {};
    } catch {
      outcome = {
        tone: 'info',
        feedback: 'Thank you for trying. Let’s keep going.',
      };
    }
    const isCorrect = Boolean(outcome.correct);
    setAnswerError('');
    setFeedback({
      tone: outcome.tone || (isCorrect ? 'success' : 'info'),
      text: outcome.feedback || 'Thank you.',
    });
    setAnswered((count) => count + 1);
    if (step.counted && isCorrect) setCorrect((count) => count + 1);
    if (step.counted && !isCorrect && step.hint) setHintShown(true);
  };

  const changeAnswer = (value) => {
    setAnswer(value);
    if (answerError) setAnswerError('');
  };

  if (loading) return <Loading label="Choosing today's exercise…" />;

  if (!exercise) {
    return (
      <>
        <Toast message={message} />
        <div className="stage-inner">
          <header className="stage-header">
            <h1>Memory exercises</h1>
          </header>
          <div className="empty-state">
            <h3>We could not choose an exercise just now</h3>
            <p>Please try again in a moment. Your other memories are safe.</p>
            <button type="button" className="btn btn-primary" onClick={load} disabled={busy}>
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  const guidance = exercise.guidance_text
    ? exercise.guidance_text.split('\n').filter(Boolean)
    : exercise.steps || [];

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
              className={`technique-chip${exercise.technique === key ? ' is-current' : ''}`}
            >
              {label}
              {exercise.technique === key && <small>Today's exercise</small>}
            </div>
          ))}
        </section>

        {phase === 'intro' && (
          <section className="card">
            <span className="badge badge-teal">Today's technique</span>
            <h2 style={{ margin: '16px 0 10px' }}>{exercise.name}</h2>
            <p>{exercise.summary}</p>

            {exercise.weak_category && (
              <p style={{ marginTop: '14px' }}>
                <span className="badge badge-gold">
                  Focus area: {exercise.weak_category}
                </span>
              </p>
            )}

            <h3 style={{ marginTop: '28px' }}>How it works</h3>
            <ol className="steps-list">
              {guidance.map((item, index) => (
                <li key={index}>{item.replace(/^\s*\d+[.)]\s*/, '')}</li>
              ))}
            </ol>

            <div className="form-message is-info" style={{ marginBottom: '24px' }}>
              This is a guided session. You will answer one step at a time, and
              you can pause whenever you like. MemorAid will only mark the
              exercise complete once you reach the end.
            </div>

            <div className="tutor-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={start}
                disabled={busy}
              >
                <Icon name="exercises" size={20} />
                Start exercise
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={load}
                disabled={busy}
              >
                <Icon name="refresh" size={20} />
                {busy ? 'Choosing…' : 'Show me a different one'}
              </button>
            </div>
          </section>
        )}

        {phase === 'running' && step && (
          <div className="recall-shell">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                marginBottom: '12px',
              }}
            >
              <span className="label-mono" style={{ color: 'var(--teal-text)' }}>
                {exercise.name}
              </span>
              <button type="button" className="btn btn-ghost" onClick={pause}>
                <Icon name="clock" size={19} />
                Pause
              </button>
            </div>

            <p style={{ marginBottom: '16px', color: 'var(--text-muted)' }}>
              Step {stepIndex + 1} of {totalSteps} — take your time.
            </p>

            <div className="recall-progress" aria-hidden="true">
              {steps.map((item, index) => (
                <span
                  key={item.id}
                  className={`dot${index < stepIndex ? ' is-done' : ''}${index === stepIndex ? ' is-current' : ''}`}
                  style={{
                    display: 'inline-block',
                    width: `${100 / totalSteps}%`,
                    background: index <= stepIndex ? 'var(--teal-forest)' : 'transparent',
                  }}
                />
              ))}
            </div>

            <article className="question-card">
              <span className={`badge ${step.kind === 'ask' ? 'badge-teal' : 'badge-green'}`}>
                {step.kind === 'ask' ? 'Your turn' : 'Read this first'}
              </span>
              <p className="question-text" aria-live="polite">
                {resolve(step.prompt)}
              </p>

              {step.example && (
                <div className="reveal-panel">
                  <h3>For example</h3>
                  <p>{resolve(step.example)}</p>
                </div>
              )}

              {step.kind === 'ask' && (
                <div className="form-group">
                  <label htmlFor="exercise-answer">Your answer</label>
                  <span className="form-hint" id="exercise-answer-hint">
                    Write whatever comes to mind — there is no wrong attempt
                    here.
                  </span>
                  <textarea
                    id="exercise-answer"
                    value={answer}
                    onChange={(event) => changeAnswer(event.target.value)}
                    aria-describedby="exercise-answer-hint"
                    placeholder={step.placeholder || 'Type your answer here'}
                    disabled={Boolean(feedback)}
                  />
                </div>
              )}

              {hintShown && step.hint && (
                <div className="form-message is-info" role="status">
                  <strong>A little help:</strong> {resolve(step.hint)}
                </div>
              )}

              {answerError && (
                <div className="form-message is-error" role="alert">
                  {answerError}
                </div>
              )}

              {feedback && (
                <div
                  className={`form-message ${feedback.tone === 'success' ? 'is-success' : 'is-info'}`}
                  role="status"
                  aria-live="polite"
                >
                  {feedback.text}
                </div>
              )}

              <div className="tutor-actions" style={{ marginTop: '22px' }}>
                {step.kind === 'ask' && !feedback ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={submit}
                    >
                      Check my answer
                    </button>
                    {step.hint && !hintShown && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setHintShown(true)}
                      >
                        Need a hint?
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={advance}
                  >
                    {stepIndex + 1 >= totalSteps ? (
                      <>
                        <Icon name="check" size={20} />
                        Finish and see my results
                      </>
                    ) : (
                      'Continue'
                    )}
                  </button>
                )}
              </div>
            </article>
          </div>
        )}

        {phase === 'paused' && (
          <div className="recall-shell">
            <section className="card" style={{ textAlign: 'center' }}>
              <span className="badge badge-gold">Paused</span>
              <h2 style={{ margin: '16px 0 10px' }}>Take your time</h2>
              <p style={{ maxWidth: '52ch', margin: '0 auto' }}>
                Your place is saved while this page stays open. You are on step{' '}
                {stepIndex + 1} of {totalSteps}.
              </p>
              <div
                className="tutor-actions"
                style={{ justifyContent: 'center', marginTop: '26px' }}
              >
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => setPhase('running')}
                >
                  <Icon name="check" size={20} />
                  Resume
                </button>
                <button type="button" className="btn btn-outline" onClick={start}>
                  Start again
                </button>
              </div>
            </section>
          </div>
        )}

        {phase === 'summary' && result && (
          <section className="card session-summary">
            <h1>Exercise complete</h1>
            <p style={{ marginTop: '10px' }}>You finished {exercise.name}.</p>

            <div className="animation" style={{ margin: '30px 0' }}>
              <div className="big">{result.score}%</div>
              <p>
                {result.recallTotal > 0
                  ? 'recalled on your own'
                  : 'of the session completed'}
              </p>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value">{result.totalSteps}</div>
                <div className="stat-label">Steps completed</div>
              </div>
              {result.recallTotal > 0 && (
                <div className="stat-card">
                  <div className="stat-value">
                    {result.correct} / {result.recallTotal}
                  </div>
                  <div className="stat-label">Recalled correctly</div>
                </div>
              )}
              {result.streak != null && (
                <div className="stat-card">
                  <div className="stat-value">{result.streak}</div>
                  <div className="stat-label">Exercise day streak</div>
                </div>
              )}
            </div>

            <p style={{ maxWidth: '52ch', margin: '24px auto 0' }}>
              {performanceMessage(result)}
            </p>

            <div
              className={`form-message ${saving === 'saved' ? 'is-success' : saving === 'error' ? 'is-error' : 'is-info'}`}
              role="status"
            >
              {saving === 'saving' && 'Saving your progress…'}
              {saving === 'saved' &&
                'Saved. This session counts towards your exercise streak.'}
              {saving === 'error' && (
                <>
                  We could not save this session just now. Your summary is
                  still here.{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => saveCompletion(result.score)}
                  >
                    Try saving again
                  </button>
                </>
              )}
            </div>

            <div
              className="tutor-actions"
              style={{ justifyContent: 'center', marginTop: '26px' }}
            >
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={load}
                disabled={busy || saving === 'saving'}
              >
                <Icon name="check" size={20} />
                {busy ? 'Choosing…' : 'Finish'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={start}>
                Repeat exercise
              </button>
            </div>

            <p style={{ marginTop: '20px' }}>
              <Link to="/dashboard" className="link-btn">
                Back to dashboard
              </Link>
            </p>
          </section>
        )}

        {history.length > 0 && (phase === 'intro' || phase === 'summary') && (
          <section style={{ marginTop: '40px' }}>
            <h2>Recent exercises</h2>
            <div className="memory-list" style={{ marginTop: '16px' }}>
              {history.slice(0, 8).map((entry) => (
                <article key={entry.exerciseid} className="memory-item">
                  <div className="content" style={{ textTransform: 'capitalize' }}>
                    {entry.technique.replace(/_/g, ' ')}
                  </div>
                  <div className="meta">
                    {entry.score != null && (
                      <span className="badge badge-teal">{entry.score}%</span>
                    )}
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
