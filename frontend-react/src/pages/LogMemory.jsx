/**
 * Log a memory — FR-03 / FR-04.
 *
 * The user writes a memory, picks a category, and may add a context note. On
 * save the backend generates a recall question and schedules the first review
 * for the following day; we then show what was created.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { FormMessage, Loading, relativeDay, Toast, useToast } from '../lib/ui.jsx';

export default function LogMemory() {
  const [categories, setCategories] = useState([]);
  const [content, setContent] = useState('');
  const [contextnote, setContextnote] = useState('');
  const [categoryid, setCategoryid] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { message, showToast } = useToast();

  useEffect(() => {
    api
      .getCategories()
      .then((res) => {
        setCategories(res.categories || []);
        if (res.categories?.length) setCategoryid(String(res.categories[0].categoryid));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!content.trim()) {
      setError('Please write the memory you would like to keep.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.createMemory({
        content,
        contextnote,
        categoryid: Number(categoryid),
      });
      setSaved(res);
      setContent('');
      setContextnote('');
      showToast('Your memory has been saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading your categories…" />;

  const selected = categories.find((c) => String(c.categoryid) === String(categoryid));

  return (
    <>
      <Toast message={message} />

      <div className="stage-inner">
      <header className="stage-header">
        <h1>Log a memory</h1>
        <p>Write it in your own words — that makes it easier to recall later.</p>
      </header>

      {saved ? (
        <section className="card">
          <span className="badge badge-green">Saved</span>
          <h2 style={{ margin: '16px 0 8px' }}>Your memory is safe</h2>
          <p style={{ marginBottom: '22px' }}>
            We have written a question to help you recall it, and it will come
            back to you {relativeDay(saved.nextreviewdate).toLowerCase()}.
          </p>

          <div className="reveal-panel">
            <h3>The question we'll ask you</h3>
            <p>{saved.question?.questiontext}</p>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
            <Link to="/log-memory" className="btn btn-secondary" onClick={() => setSaved(null)}>
              <Icon name="log-memory" size={20} />
              Log another
            </Link>
            <Link to="/dashboard" className="btn btn-primary">Back to dashboard</Link>
          </div>
        </section>
      ) : (
        <form onSubmit={submit} noValidate className="card">
          <div className="form-group">
            <label htmlFor="category" className="label-mono">WHICH KIND OF MEMORY IS IT?</label>
            <select
              id="category"
              value={categoryid}
              onChange={(e) => setCategoryid(e.target.value)}
              required
            >
              {categories.map((c) => (
                <option key={c.categoryid} value={c.categoryid}>
                  {c.categoryname}
                </option>
              ))}
            </select>
            {selected?.description && (
              <span className="form-hint" style={{ marginTop: '10px' }}>
                {selected.description}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="content" className="label-mono">WHAT WOULD YOU LIKE TO REMEMBER?</label>
            <span className="form-hint" id="content-hint">
              A person, a place, a task, an appointment — anything at all.
            </span>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              aria-describedby="content-hint"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="context" className="label-mono">
              ANY CONTEXT THAT WOULD HELP? (OPTIONAL)
            </label>
            <span className="form-hint" id="context-hint">
              For example: "This was at Ruth's birthday, in the back garden."
            </span>
            <textarea
              id="context"
              value={contextnote}
              onChange={(e) => setContextnote(e.target.value)}
              aria-describedby="context-hint"
              style={{ minHeight: '110px' }}
            />
          </div>

          <FormMessage>{error}</FormMessage>

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Saving…' : 'Save this memory'}
          </button>
        </form>
      )}
      </div>
    </>
  );
}
