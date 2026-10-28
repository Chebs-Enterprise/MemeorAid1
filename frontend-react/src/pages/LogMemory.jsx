/**
 * Log a memory — FR-03 / FR-04.
 *
 * Designed as a gentle, accessible step-by-step carousel for older adults:
 *   - Step 1: Which kind of memory is it? (Large visual category cards)
 *   - Step 2: What would you like to remember? (Spacious, stable text area)
 *   - Step 3: Any extra context? (Optional clues & quick suggestion chips)
 *   - Step 4: Review & Save (Clear preview before AI question generation)
 *
 * Eliminates form overwhelm by presenting one clear question per step.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { FormMessage, Loading, relativeDay, Toast, useToast } from '../lib/ui.jsx';

const CATEGORY_META = {
  Names: {
    icon: 'users',
    emoji: '👥',
    hint: 'People you meet — grandchildren, doctors, neighbours, friends.',
    examples: ['Grandchild Chioma’s birthday', 'Dr. Okafor at the health centre', 'New neighbour next door'],
  },
  Appointments: {
    icon: 'calendar',
    emoji: '🗓️',
    hint: 'Doctor visits, family gatherings, clinic dates and times to keep.',
    examples: ['Dental check-up on Tuesday at 10 AM', 'Sunday family dinner at 2 PM', 'Eye clinic next week'],
  },
  Medications: {
    icon: 'heart',
    emoji: '💊',
    hint: 'Daily prescriptions, dosages, pill instructions, and times.',
    examples: ['Blood pressure tablet after breakfast', 'Eye drops before sleep', 'Pick up prescription refill'],
  },
  Tasks: {
    icon: 'check',
    emoji: '✅',
    hint: 'Important errands, chores, shopping items, and things to do.',
    examples: ['Water the garden in the evening', 'Call the electrician about the porch light', 'Buy whole wheat bread'],
  },
  Conversations: {
    icon: 'chat',
    emoji: '💬',
    hint: 'Meaningful talks, special news, stories, and advice given to you.',
    examples: ['Sarah mentioned she got the job', 'Grandson loved the childhood story', 'Neighbour offered to help on Saturday'],
  },
};

const CONTEXT_CHIPS = [
  'At home',
  'With family',
  'At the clinic / hospital',
  'In the morning',
  'During a phone call',
  'With friends',
];

export default function LogMemory() {
  const [categories, setCategories] = useState([]);
  const [step, setStep] = useState(1);
  const [categoryid, setCategoryid] = useState('');
  const [content, setContent] = useState('');
  const [contextnote, setContextnote] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { message, showToast } = useToast();

  useEffect(() => {
    api
      .getCategories()
      .then((res) => {
        const cats = res.categories || [];
        setCategories(cats);
        if (cats.length && !categoryid) {
          setCategoryid(String(cats[0].categoryid));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedCategory = categories.find((c) => String(c.categoryid) === String(categoryid)) || categories[0];
  const meta = selectedCategory ? (CATEGORY_META[selectedCategory.categoryname] || {
    icon: 'brain',
    emoji: '🧠',
    hint: selectedCategory.description || 'Important moments and facts you want to keep.',
    examples: [],
  }) : null;

  const goToStep = (nextStep) => {
    setError('');
    if (nextStep > 1 && !categoryid) {
      setError('Please select a memory category first.');
      return;
    }
    if (nextStep > 2 && !content.trim()) {
      setError('Please write what you would like to remember.');
      return;
    }
    setStep(nextStep);
  };

  const handleCategorySelect = (id) => {
    setCategoryid(String(id));
    setError('');
  };

  const handleAppendContext = (chip) => {
    setContextnote((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip;
      if (trimmed.includes(chip)) return trimmed;
      return `${trimmed}, ${chip.toLowerCase()}`;
    });
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    if (!content.trim()) {
      setError('Please write the memory you would like to keep.');
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const res = await api.createMemory({
        content: content.trim(),
        contextnote: contextnote.trim(),
        categoryid: Number(categoryid),
      });
      setSaved(res);
      setContent('');
      setContextnote('');
      setStep(1);
      showToast('Your memory has been saved safely.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => {
    setSaved(null);
    setContent('');
    setContextnote('');
    setStep(1);
    setError('');
  };

  if (loading) return <Loading label="Setting up your memory journal…" />;

  const progressPercent = step === 1 ? 25 : step === 2 ? 50 : step === 3 ? 75 : 100;

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
        <header className="stage-header">
          <h1>Log a memory</h1>
          <p>A step-by-step guide to help you save and strengthen what matters most.</p>
        </header>

        {saved ? (
          <section className="card">
            <span className="badge badge-green">Saved Successfully</span>
            <h2 style={{ margin: '16px 0 8px' }}>Your memory is safe and secure</h2>
            <p style={{ marginBottom: '22px' }}>
              We have generated a personalized practice question for you. MemorAid will bring it back to you{' '}
              <strong>{relativeDay(saved.nextreviewdate).toLowerCase()}</strong> to help keep it fresh in your mind.
            </p>

            <div className="reveal-panel">
              <h3>The practice question we will ask you</h3>
              <p>{saved.question?.questiontext || 'How would you describe this memory?'}</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                <Icon name="log-memory" size={20} />
                Log another memory
              </button>
              <Link to="/dashboard" className="btn btn-primary">
                Back to dashboard
              </Link>
            </div>
          </section>
        ) : (
          <div className="memory-wizard-card">
            {/* Step Progress Bar & Tabs */}
            <nav className="memory-stepper" aria-label="Memory logging progress">
              <div className="stepper-progress-bar">
                <div
                  className="stepper-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>

              <div className="stepper-tabs" role="tablist">
                <button
                  type="button"
                  className={`stepper-tab ${step === 1 ? 'is-active' : ''} ${step > 1 ? 'is-completed' : ''}`}
                  onClick={() => goToStep(1)}
                  aria-current={step === 1 ? 'step' : undefined}
                >
                  <span className="stepper-num">{step > 1 ? '✓' : '1'}</span>
                  <span>Kind of memory</span>
                </button>

                <button
                  type="button"
                  className={`stepper-tab ${step === 2 ? 'is-active' : ''} ${step > 2 ? 'is-completed' : ''}`}
                  onClick={() => goToStep(2)}
                  disabled={!categoryid}
                  aria-current={step === 2 ? 'step' : undefined}
                >
                  <span className="stepper-num">{step > 2 ? '✓' : '2'}</span>
                  <span>What to remember</span>
                </button>

                <button
                  type="button"
                  className={`stepper-tab ${step === 3 ? 'is-active' : ''} ${step > 3 ? 'is-completed' : ''}`}
                  onClick={() => goToStep(3)}
                  disabled={!content.trim()}
                  aria-current={step === 3 ? 'step' : undefined}
                >
                  <span className="stepper-num">{step > 3 ? '✓' : '3'}</span>
                  <span>Extra clues</span>
                </button>

                <button
                  type="button"
                  className={`stepper-tab ${step === 4 ? 'is-active' : ''}`}
                  onClick={() => goToStep(4)}
                  disabled={!content.trim()}
                  aria-current={step === 4 ? 'step' : undefined}
                >
                  <span className="stepper-num">4</span>
                  <span>Review & Save</span>
                </button>
              </div>
            </nav>

            {/* Error Message Display */}
            {error && <FormMessage className="is-error" style={{ marginBottom: '20px' }}>{error}</FormMessage>}

            {/* STEP 1: KIND OF MEMORY */}
            {step === 1 && (
              <div className="wizard-slide" key="step-1">
                <div className="wizard-title-area">
                  <span className="wizard-step-tag">Step 1 of 4</span>
                  <h2 className="wizard-heading">Which kind of memory is it?</h2>
                  <p className="wizard-subtitle">
                    Select a topic below. This helps MemorAid organize and time your spaced practice.
                  </p>
                </div>

                <div className="category-card-grid" role="radiogroup" aria-label="Memory categories">
                  {categories.map((c) => {
                    const isSelected = String(c.categoryid) === String(categoryid);
                    const catMeta = CATEGORY_META[c.categoryname] || {
                      icon: 'brain',
                      emoji: '🧠',
                      hint: c.description,
                    };
                    return (
                      <div
                        key={c.categoryid}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        className={`category-select-card ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleCategorySelect(c.categoryid)}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            handleCategorySelect(c.categoryid);
                          }
                        }}
                      >
                        <span className="category-card-icon" aria-hidden="true">
                          <Icon name={catMeta.icon} size={26} />
                        </span>
                        <div className="category-card-content">
                          <span className="category-card-name">
                            {c.categoryname}
                          </span>
                          <span className="category-card-desc">
                            {catMeta.hint || c.description}
                          </span>
                        </div>
                        {isSelected && (
                          <span className="category-card-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="wizard-actions">
                  <div className="wizard-actions-left">
                    <span className="form-hint" style={{ alignSelf: 'center' }}>
                      Selected:{' '}
                      <strong style={{ color: 'var(--teal-forest)' }}>
                        {selectedCategory?.categoryname}
                      </strong>
                    </span>
                  </div>
                  <div className="wizard-actions-right">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={() => goToStep(2)}
                    >
                      Next: What to remember →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: WHAT WOULD YOU LIKE TO REMEMBER? */}
            {step === 2 && (
              <div className="wizard-slide" key="step-2">
                <div className="wizard-title-area">
                  <span className="wizard-step-tag">Step 2 of 4</span>
                  <h2 className="wizard-heading">What would you like to remember?</h2>
                  <p className="wizard-subtitle">
                    Write it in your own words. Take your time — there is no rush, and spelling doesn't have to be perfect.
                  </p>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <span
                    className="badge badge-teal"
                    style={{ textTransform: 'none', fontSize: '15px', padding: '6px 14px' }}
                  >
                    Category: {selectedCategory?.categoryname}
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="memory-content" style={{ fontWeight: 600, color: 'var(--teal-forest)' }}>
                    Your memory
                  </label>
                  <textarea
                    id="memory-content"
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="Type what you want to remember here... (e.g. Dr. Okafor said my blood pressure is doing well, next appointment is Thursday at 10 AM)"
                    style={{ minHeight: '160px', fontSize: '19px', lineHeight: '1.6' }}
                    autoFocus
                    required
                  />
                </div>

                {meta?.examples?.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <span className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                      Need an idea? Here are common {selectedCategory?.categoryname.toLowerCase()}:
                    </span>
                    <div className="wizard-chips">
                      {meta.examples.map((ex, i) => (
                        <button
                          key={i}
                          type="button"
                          className="wizard-chip"
                          onClick={() => setContent(ex)}
                        >
                          + {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="wizard-actions">
                  <div className="wizard-actions-left">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => goToStep(1)}
                    >
                      ← Back: Category
                    </button>
                  </div>
                  <div className="wizard-actions-right">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={() => goToStep(3)}
                      disabled={!content.trim()}
                    >
                      Next: Extra clues →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: ANY HELPFUL CONTEXT? (OPTIONAL) */}
            {step === 3 && (
              <div className="wizard-slide" key="step-3">
                <div className="wizard-title-area">
                  <span className="wizard-step-tag">Step 3 of 4 · Optional</span>
                  <h2 className="wizard-heading">Where or when did this happen?</h2>
                  <p className="wizard-subtitle">
                    Extra context helps trigger natural recall later on. If you don't have extra details, you can freely skip this step.
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="memory-context" style={{ fontWeight: 600, color: 'var(--teal-forest)' }}>
                    Context note (optional)
                  </label>
                  <textarea
                    id="memory-context"
                    value={contextnote}
                    onChange={(e) => setContextnote(e.target.value)}
                    placeholder="e.g. This was at Sunday lunch with the grandchildren, sitting on the veranda..."
                    style={{ minHeight: '120px', fontSize: '18px', lineHeight: '1.55' }}
                    autoFocus
                  />
                </div>

                <div>
                  <span className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                    Quick helpful tags (click to add):
                  </span>
                  <div className="wizard-chips">
                    {CONTEXT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className="wizard-chip"
                        onClick={() => handleAppendContext(chip)}
                      >
                        + {chip}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wizard-actions">
                  <div className="wizard-actions-left">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => goToStep(2)}
                    >
                      ← Back to memory
                    </button>
                  </div>
                  <div className="wizard-actions-right">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => goToStep(4)}
                    >
                      Skip extra clues
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={() => goToStep(4)}
                    >
                      Next: Review & Save →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: REVIEW & CONFIRM */}
            {step === 4 && (
              <div className="wizard-slide" key="step-4">
                <div className="wizard-title-area">
                  <span className="wizard-step-tag">Step 4 of 4</span>
                  <h2 className="wizard-heading">Review your memory</h2>
                  <p className="wizard-subtitle">
                    Please take a moment to look over your memory. When you save, MemorAid will write a friendly recall prompt for you.
                  </p>
                </div>

                <div className="wizard-review-box">
                  <div className="review-item">
                    <span className="review-item-label">Category</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                      <span className="badge badge-teal" style={{ fontSize: '15px', textTransform: 'none' }}>
                        {selectedCategory?.categoryname}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '2px 8px', fontSize: '13px', height: 'auto' }}
                        onClick={() => goToStep(1)}
                      >
                        Change
                      </button>
                    </div>
                  </div>

                  <div className="review-item">
                    <span className="review-item-label">Your Memory</span>
                    <p className="review-item-value" style={{ fontWeight: 600 }}>
                      "{content}"
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ alignSelf: 'flex-start', padding: '2px 8px', fontSize: '13px', height: 'auto' }}
                      onClick={() => goToStep(2)}
                    >
                      Edit text
                    </button>
                  </div>

                  <div className="review-item">
                    <span className="review-item-label">Helpful Context</span>
                    <p className="review-item-value" style={{ fontStyle: contextnote ? 'normal' : 'italic', color: contextnote ? 'var(--text-main)' : 'var(--text-dim)' }}>
                      {contextnote ? `"${contextnote}"` : 'None added'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ alignSelf: 'flex-start', padding: '2px 8px', fontSize: '13px', height: 'auto' }}
                      onClick={() => goToStep(3)}
                    >
                      {contextnote ? 'Edit context' : '+ Add context'}
                    </button>
                  </div>

                  <div className="review-ai-notice">
                    <Icon name="sparkles" size={20} />
                    <span>
                      MemorAid will automatically generate a custom spaced-repetition question and schedule your first review for tomorrow.
                    </span>
                  </div>
                </div>

                <div className="wizard-actions">
                  <div className="wizard-actions-left">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => goToStep(3)}
                      disabled={busy}
                    >
                      ← Back
                    </button>
                  </div>
                  <div className="wizard-actions-right">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      onClick={submit}
                      disabled={busy}
                      style={{ minWidth: '200px' }}
                    >
                      {busy ? (
                        <>
                          <Icon name="refresh" size={18} className="spin-slow" />
                          Saving your memory…
                        </>
                      ) : (
                        <>
                          <Icon name="check" size={20} />
                          Save this memory
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
