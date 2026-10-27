/**
 * Exercise session — FR-08.
 *
 * The backend suggests one of the six validated techniques (least recently
 * used, aimed at the user's weakest recall category), but the user can open any
 * of them directly and move between them freely. Each technique keeps its own
 * board — question index, answers, feedback and result — so looking elsewhere
 * never discards progress. Within a board, Previous and Next let the user
 * revisit or temporarily skip a question.
 *
 * A question counts as done only once it has feedback, and an exercise is only
 * recorded as complete after every question has been answered and the user has
 * reached the summary — opening the page or switching exercises is not enough.
 */
import { useCallback, useEffect, useState } from 'react';
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

/** The saved state of one question, kept while the user looks elsewhere. */
const EMPTY_STEP_STATE = { answer: '', feedback: null };

/**
 * One independent exercise board. Keeping the built tutor session (and its
 * closure over earlier answers) is what lets a user leave an exercise and come
 * back without losing the context their later questions depend on.
 */
function createBoard(exercise) {
  return {
    exercise,
    session: buildTutorSession(exercise),
    phase: 'intro',
    stepIndex: 0,
    visited: {},
    steps: {},
    answered: 0,
    correct: 0,
    result: null,
    saving: 'idle',
  };
}

/** Questions not yet checked. They stay incomplete until answered. */
function unansweredSteps(board) {
  if (!board) return [];
  return board.session.steps.filter(
    (item) => item.kind === 'ask' && !board.steps[item.id]?.feedback,
  );
}

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
  // One board per technique. Switching exercises only changes which board is
  // shown; every board keeps its own question index and answers.
  const [boards, setBoards] = useState({});
  const [activeTechnique, setActiveTechnique] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [answerError, setAnswerError] = useState('');
  const { message, showToast } = useToast();

  const board = activeTechnique ? boards[activeTechnique] || null : null;
  const exercise = board?.exercise || null;
  const session = board?.session || null;
  const steps = session?.steps || [];
  const phase = board?.phase || 'intro';
  const stepIndex = board?.stepIndex || 0;
  const step = steps[stepIndex] || null;
  const totalSteps = steps.length;
  const askTotal = session?.askTotal || 0;
  const recallTotal = session?.recallTotal || 0;
  const stepState = step ? board?.steps[step.id] || EMPTY_STEP_STATE : EMPTY_STEP_STATE;
  const { answer, feedback } = stepState;
  const answered = board?.answered || 0;
  const correct = board?.correct || 0;
  const result = board?.result || null;
  const saving = board?.saving || 'idle';
  const unanswered = unansweredSteps(board);

  const updateBoard = useCallback((technique, updater) => {
    if (!technique) return;
    setBoards((previous) => {
      const current = previous[technique];
      if (!current) return previous;
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return next === current ? previous : { ...previous, [technique]: next };
    });
  }, []);

  const updateStep = useCallback(
    (technique, stepId, patch) => {
      updateBoard(technique, (current) => {
        const existing = current.steps[stepId] || EMPTY_STEP_STATE;
        return {
          ...current,
          steps: { ...current.steps, [stepId]: { ...existing, ...patch } },
        };
      });
    },
    [updateBoard],
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [next, hist] = await Promise.all([
        api.getNextExercise(),
        api.getExerciseHistory(),
      ]);
      setBoards((previous) => ({
        ...previous,
        [next.exercise.technique]: createBoard(next.exercise),
      }));
      setActiveTechnique(next.exercise.technique);
      setAnswerError('');
      setHistory(hist.exercises || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Open any of the six exercises directly. An exercise already visited is
  // shown exactly as it was left; a new one is fetched for that technique.
  const switchExercise = useCallback(
    async (technique) => {
      if (!technique || technique === activeTechnique) return;
      setAnswerError('');
      if (boards[technique]) {
        setActiveTechnique(technique);
        return;
      }

      setBusy(true);
      try {
        const res = await api.getNextExercise(technique);
        const opened = res.exercise;
        setBoards((previous) =>
          previous[opened.technique]
            ? previous
            : { ...previous, [opened.technique]: createBoard(opened) },
        );
        setActiveTechnique(opened.technique);
      } catch (err) {
        showToast(err.message);
      } finally {
        setBusy(false);
      }
    },
    [activeTechnique, boards, showToast],
  );

  // "Show me a different one" and the summary's Finish button both move to the
  // next exercise without discarding anything already done.
  const goToDifferentExercise = () => {
    const index = ALL_TECHNIQUES.findIndex(([key]) => key === activeTechnique);
    const nextKey = ALL_TECHNIQUES[(index + 1) % ALL_TECHNIQUES.length][0];
    switchExercise(nextKey);
  };

  const start = () => {
    if (!board) return;
    // A fresh exercise object rebuilds the tutor script, so a repeat starts
    // with clean answers even though the backend session id is reused.
    const fresh = createBoard({ ...board.exercise });
    fresh.phase = 'running';
    if (fresh.session.steps[0]) {
      fresh.visited[fresh.session.steps[0].id] = true;
    }
    updateBoard(activeTechnique, () => fresh);
    setAnswerError('');
  };

  const pause = () => {
    if (phase === 'running') updateBoard(activeTechnique, { phase: 'paused' });
  };

  const goToStep = (index) => {
    if (!board || !steps[index]) return;
    const target = steps[index];
    setAnswerError('');
    updateBoard(activeTechnique, (current) => ({
      ...current,
      stepIndex: index,
      visited: { ...current.visited, [target.id]: true },
    }));
  };

  const saveCompletion = async (technique, exerciseRecord, score) => {
    if (!exerciseRecord) return;
    updateBoard(technique, { saving: 'saving' });
    try {
      const res = await api.completeExercise({
        exerciseid: exerciseRecord.exerciseid,
        technique: exerciseRecord.technique,
        score,
      });
      updateBoard(technique, (current) => ({
        ...current,
        saving: 'saved',
        result: current.result
          ? { ...current.result, streak: res.exercise_streak }
          : current.result,
      }));
      showToast(res.message);
      api.getExerciseHistory()
        .then((hist) => setHistory(hist.exercises || []))
        .catch(() => {});
    } catch (err) {
      updateBoard(technique, { saving: 'error' });
      showToast(err.message);
    }
  };

  const finish = () => {
    if (!board || !session || unanswered.length > 0) return;
    const score = recallTotal > 0
      ? Math.round((100 * correct) / recallTotal)
      : askTotal > 0
        ? Math.round((100 * answered) / askTotal)
        : 100;
    const nextResult = {
      score,
      answered,
      correct,
      recallTotal,
      totalSteps,
      streak: null,
    };
    updateBoard(activeTechnique, {
      phase: 'summary',
      result: nextResult,
      saving: 'saving',
    });
    saveCompletion(activeTechnique, board.exercise, score);
  };

  const advance = () => {
    if (!board || !step) return;
    if (stepIndex + 1 < totalSteps) {
      goToStep(stepIndex + 1);
      return;
    }

    // Completion keeps the exercise's existing requirement: every question
    // has been answered. Skipped questions can never be counted as complete.
    if (unanswered.length > 0) {
      const firstIndex = steps.findIndex((item) => item.id === unanswered[0].id);
      goToStep(firstIndex);
      setAnswerError(
        unanswered.length === 1
          ? 'One question still needs an answer before this exercise can be complete. Here it is.'
          : `${unanswered.length} questions still need answers before this exercise can be complete. Here is the first one.`,
      );
      return;
    }
    finish();
  };

  const submit = () => {
    if (!board || !step || step.kind !== 'ask' || feedback) return;
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
    const nextFeedback = {
      tone: outcome.tone || (isCorrect ? 'success' : 'info'),
      text: outcome.feedback || 'Thank you.',
    };
    setAnswerError('');
    updateBoard(activeTechnique, (current) => {
      const currentStep = current.steps[step.id] || EMPTY_STEP_STATE;
      return {
        ...current,
        steps: {
          ...current.steps,
          [step.id]: {
            ...currentStep,
            answer,
            feedback: nextFeedback,
          },
        },
        answered: current.answered + 1,
        correct: current.correct + (step.counted && isCorrect ? 1 : 0),
      };
    });
  };

  const changeAnswer = (value) => {
    if (!step) return;
    updateStep(activeTechnique, step.id, { answer: value });
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
          {ALL_TECHNIQUES.map(([key, label]) => {
            const isCurrent = activeTechnique === key;
            const entry = boards[key];
            const status = entry?.phase === 'summary'
              ? 'Completed'
              : entry && (entry.phase === 'running' || entry.phase === 'paused')
                ? 'In progress'
                : null;
            return (
              <button
                key={key}
                type="button"
                className={`technique-chip${isCurrent ? ' is-current' : ''}`}
                onClick={() => switchExercise(key)}
                disabled={busy}
                aria-pressed={isCurrent}
              >
                {label}
                {isCurrent ? (
                  <small>Today's exercise</small>
                ) : status ? (
                  <small>{status}</small>
                ) : null}
              </button>
            );
          })}
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
              You can move between questions and exercises freely. MemorAid
              will only mark an exercise complete once every question has been
              answered.
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
                onClick={goToDifferentExercise}
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
              {steps.map((item, index) => {
                const complete = item.kind === 'ask'
                  ? Boolean(board?.steps[item.id]?.feedback)
                  : Boolean(board?.visited?.[item.id]);
                return (
                  <span
                    key={item.id}
                    className={`dot${complete ? ' is-done' : ''}${index === stepIndex ? ' is-current' : ''}`}
                    style={{
                      display: 'inline-block',
                      width: `${100 / totalSteps}%`,
                      background: complete ? 'var(--teal-forest)' : 'transparent',
                    }}
                  />
                );
              })}
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => goToStep(stepIndex - 1)}
                  disabled={stepIndex === 0}
                >
                  Previous
                </button>

                {step.kind === 'ask' && !feedback ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={submit}
                    >
                      Check my answer
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={advance}>
                      Next
                    </button>
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
                        {unanswered.length > 0
                          ? 'Review incomplete questions'
                          : 'Finish and see my results'}
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
                  onClick={() => updateBoard(activeTechnique, { phase: 'running' })}
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
                    onClick={() => saveCompletion(activeTechnique, exercise, result.score)}
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
                onClick={goToDifferentExercise}
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
