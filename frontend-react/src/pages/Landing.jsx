/**
 * Landing page (public).
 *
 * Presents the product to a signed-out visitor: what MemorAid does, the six
 * exercise techniques from the document of proof, and the calls to action.
 */
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

const TECHNIQUES = [
  ['Method of Loci', 'Anchor items along a familiar route.'],
  ['Elaborative Encoding', 'Link new facts to what you already know.'],
  ['Spaced Retrieval', 'Recall the same fact at growing intervals.'],
  ['Face–Name Association', 'Hook a name to a distinctive feature.'],
  ['Chunking', 'Group long lists into small sets.'],
  ['Active Observation', 'Study, look away, and recall the details.'],
];

const FEATURES = [
  {
    icon: 'pencil',
    title: 'Log what matters',
    body: 'Save a memory in your own words, choose a category, and add any context that helps it make sense.',
  },
  {
    icon: 'brain',
    title: 'Gentle recall sessions',
    body: 'One question at a time. Reveal the answer when you are ready, then rate how it felt — no pressure.',
  },
  {
    icon: 'calendar',
    title: 'Reviews that space themselves',
    body: 'MemorAid schedules the next review using proven spaced-repetition, so memories surface just before they fade.',
  },
  {
    icon: 'analytics',
    title: 'Progress you can see',
    body: 'Accuracy over time, forgetting by category, and current streaks — presented in plain language.',
  },
];

export default function Landing() {
  return (
    <>
      <section className="auth-shell" style={{ alignItems: 'center' }}>
        <div className="auth-panel">
          <span className="badge badge-teal">Memory support, made kind</span>
          <h1 style={{ margin: '18px 0' }}>
            Keep your memories close and your recall strong
          </h1>
          <p style={{ fontSize: '19px', marginBottom: '28px' }}>
            MemorAid helps you record the things you want to hold on to, then
            gently brings them back at exactly the right moment — with a warm
            companion beside you the whole way.
          </p>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <Link to="/signup" className="btn btn-primary btn-lg">Create your account</Link>
            <Link to="/login" className="btn btn-outline btn-lg">I already have one</Link>
          </div>
        </div>

        <div className="auth-aside">
          <h2>Remembering is a skill</h2>
          <p>
            Every recall session and exercise strengthens the connections in
            your memory. MemorAid keeps track so you don't have to.
          </p>
          <div className="aside-stats">
            <div className="aside-stat">
              <span className="aside-stat-value">6</span>
              <span className="aside-stat-label">proven techniques</span>
            </div>
            <div className="aside-stat">
              <span className="aside-stat-value">24/7</span>
              <span className="aside-stat-label">here when you need</span>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: '64px' }}>
        <h2>What MemorAid does for you</h2>
        <div className="technique-grid" style={{ marginTop: '22px' }}>
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <span className="feature-icon" aria-hidden="true">
                <Icon name={f.icon} size={26} />
              </span>
              <h3 style={{ margin: '12px 0 8px' }}>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: '56px' }}>
        <h2>Six memory exercises, chosen for you</h2>
        <p style={{ marginTop: '8px' }}>
          MemorAid rotates through the techniques clinicians trust, and favours
          the one that targets where you are finding things hardest.
        </p>
        <ul className="steps-list" style={{ marginTop: '24px' }}>
          {TECHNIQUES.map(([name, blurb]) => (
            <li key={name}>
              <strong>{name}</strong> — {blurb}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
