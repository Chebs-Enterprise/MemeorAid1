/**
 * Landing page — redesigned to match the reference design.
 *
 * Sections:
 *   1. Public nav (sticky; links scroll to the sections below)
 *   2. Hero (headline + CTA left; app-preview mockup right)
 *   3. Trust bar
 *   4. How it works (four steps)
 *   5. Features ("A gentle hand when you need it")
 *   6. For families
 *   7. Testimonial (Grace, 71)
 *   8. Footer
 *
 * Every navbar entry points at a real section id on this page — see NAV_LINKS
 * below, which is the single source of truth for both the links and the
 * sections they target.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

/* The navbar and the sections it scrolls to. Keeping them together means a
 * link can never point at an id that does not exist. */
const NAV_LINKS = [
  { label: 'How it works', id: 'how-it-works' },
  { label: 'Features', id: 'features' },
  { label: 'For Families', id: 'families' },
];

const FEATURES = [
  {
    icon: 'brain',
    title: 'Remembers with you',
    body: 'MemorAid keeps the details that matter — a medication, an appointment, the name of a neighbour — and brings them back in your own words, so recognition does the work that recall cannot.',
  },
  {
    icon: 'clock',
    title: 'Learns your rhythm',
    body: 'MemorAid notices when you are most comfortable — your morning check-in, the sessions you finish, the categories you find hardest — and shapes the day around you rather than the other way round.',
  },
  {
    icon: 'users',
    title: 'Family stays connected',
    body: 'One shared view for the people who care about you. Loved ones can see how you are doing without you having to report in, and you stay in control of who hears what.',
  },
];

const STEPS = [
  {
    icon: 'pencil',
    title: 'Capture what matters',
    body: 'Write the memory in your own words — a name, a routine, an appointment, a moment worth keeping. Add any context that makes it easier to picture later.',
  },
  {
    icon: 'bot',
    title: 'AI writes the questions',
    body: 'As soon as you save it, MemorAid reads the memory and writes a gentle question that pulls the details back out. You never have to invent a test for yourself.',
  },
  {
    icon: 'target',
    title: 'Practise your recall',
    body: 'Answer one question at a time, at your own pace. Reveal the original whenever you want to, then say how it felt so the next question is sized to you.',
  },
  {
    icon: 'calendar-check',
    title: 'Reviews, spaced over time',
    body: 'Every memory is rescheduled using proven spaced repetition. Easy memories drift further apart; tricky ones return sooner, right when the extra reinforcement helps most.',
  },
];

const FAMILIES = [
  {
    icon: 'sun',
    title: 'Morning check-ins',
    body: 'Your relative chooses the time, and MemorAid greets them with what is due and one small thing to focus on — a routine that holds even on a difficult morning.',
  },
  {
    icon: 'bell',
    title: 'Quiet activity alerts',
    body: 'If a check-in is missed for longer than you agreed, the one family contact you chose is notified. Nothing loud and nothing public, just a nudge to call.',
  },
  {
    icon: 'analytics',
    title: 'Progress you can share',
    body: 'See recall accuracy, current streaks and the categories that need more care in plain language, so a phone call can go straight to what matters.',
  },
  {
    icon: 'shield-check',
    title: 'Privacy by default',
    body: 'Only the contact you name is ever notified, and only after the threshold you set. Everything else stays between you and the person you care for.',
  },
];

const TRUST = [
  { icon: 'heart', label: 'BUILT FOR PEOPLE, NOT SCREENS' },
  { icon: 'star', label: 'TRUSTED BY FAMILIES' },
  { icon: 'sparkles', label: 'DESIGNED WITH CARE' },
];

export default function Landing() {
  const [navOpen, setNavOpen] = useState(false);

  /**
   * Scrolls to a section and keeps the URL in step.
   *
   * `scrollIntoView` is used rather than a bare fragment jump so the movement
   * is smooth (and instant when the visitor has asked for reduced motion),
   * and the sticky header is cleared by the `scroll-margin-top` set in
   * global.css. Focus is moved to the section so keyboard and screen-reader
   * users land where sighted users are looking.
   */
  const scrollToSection = useCallback((event, id) => {
    const target = document.getElementById(id);
    setNavOpen(false);
    if (!target) return; // No target — let the browser handle the fragment.

    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

    if (window.history.replaceState) {
      window.history.replaceState(null, '', `#${id}`);
    }
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, []);

  /* Supports deep links such as /#families after a reload. */
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return undefined;
    const raf = requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="lp-root">

      {/* 1. NAV */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo">MemorAid</Link>
          <nav className={`lp-nav-links${navOpen ? ' is-open' : ''}`} id="lp-nav-links" aria-label="Main navigation">
            {NAV_LINKS.map(({ label, id }) => (
              <a
                key={id}
                href={`#${id}`}
                className="lp-nav-link"
                onClick={(e) => scrollToSection(e, id)}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-actions">
            <Link to="/login" className="lp-nav-login">Login</Link>
            <Link to="/signup" className="btn btn-primary lp-nav-cta">Get Started</Link>
            <button
              type="button"
              className="lp-nav-toggle"
              aria-expanded={navOpen}
              aria-controls="lp-nav-links"
              onClick={() => setNavOpen((v) => !v)}
            >
              <Icon name={navOpen ? 'close' : 'menu'} size={22} />
              <span className="visually-hidden">{navOpen ? 'Close menu' : 'Open menu'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. HERO */}
      <section className="lp-hero" aria-labelledby="hero-heading">
        <div className="lp-hero-inner">

          <div className="lp-hero-copy">
            <h1 id="hero-heading" className="lp-hero-h1">
              Because forgetting shouldn't get in the way of living
            </h1>
            <p className="lp-hero-sub">
              MemorAid keeps the things you want to hold on to — a name, a routine,
              a medication — and brings them back just before they slip. A gentle
              digital companion designed to preserve dignity and independence for
              anyone living with early-stage memory loss.
            </p>
            <div className="lp-hero-btns">
              <Link to="/signup" className="btn btn-primary lp-btn-lg">Get Started</Link>
              <Link to="/login" className="btn btn-outline lp-btn-lg">Learn how it works</Link>
            </div>
          </div>

          <div className="lp-hero-mockup" aria-hidden="true">
            <div className="lp-mockup-card">
              <div className="lp-mockup-photo">
                <img
                  src="/landing-hero-senior.jpg"
                  alt=""
                  width="1000"
                  height="667"
                  fetchPriority="high"
                />
              </div>
              <div className="lp-mockup-ui">
                <div className="lp-mockup-greeting">
                  <span className="lp-mockup-avatar">😊</span>
                  <div>
                    <div className="lp-mockup-name">Good morning, Margaret</div>
                    <div className="lp-mockup-sub-text">Your day is looking beautiful.</div>
                  </div>
                </div>
                <div className="lp-mockup-stats">
                  <div className="lp-mockup-stat">
                    <span>📋</span>
                    <span>3 memories due</span>
                  </div>
                  <div className="lp-mockup-stat">
                    <span>🔥</span>
                    <span>12 day streak</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 3. TRUST BAR */}
      <div className="lp-trust-bar" role="list">
        {TRUST.map(({ icon, label }) => (
          <div key={label} className="lp-trust-item" role="listitem">
            <span className="lp-trust-icon" aria-hidden="true">
              <Icon name={icon} size={14} />
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* 4. HOW IT WORKS */}
      <section className="lp-how" id="how-it-works" aria-labelledby="how-heading">
        <div className="lp-section-inner">
          <h2 id="how-heading" className="lp-section-title">How it works</h2>
          <p className="lp-section-lede">
            Four small steps, repeated every day. MemorAid turns a memory you want
            to keep into a question you answer today — then brings it back before
            it fades.
          </p>
          <div className="lp-section-rule" aria-hidden="true" />
          <ol className="lp-step-grid">
            {STEPS.map((step, index) => (
              <li key={step.title} className="lp-step-card">
                <div className="lp-step-head">
                  <span className="lp-step-number" aria-hidden="true">{index + 1}</span>
                  <span className="lp-step-icon-wrap" aria-hidden="true">
                    <Icon name={step.icon} size={22} />
                  </span>
                </div>
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 5. FEATURES */}
      <section className="lp-features" id="features" aria-labelledby="features-heading">
        <div className="lp-section-inner">
          <h2 id="features-heading" className="lp-section-title">A gentle hand when you need it</h2>
          <p className="lp-section-lede">
            Everything MemorAid does is built around one idea: you should never
            have to chase your own memory.
          </p>
          <div className="lp-section-rule" aria-hidden="true" />
          <div className="lp-feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon-wrap" aria-hidden="true">
                  <span className="lp-feature-icon">
                    <Icon name={f.icon} size={22} />
                  </span>
                </div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-body">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 6. FOR FAMILIES */}
      <section className="lp-families" id="families" aria-labelledby="families-heading">
        <div className="lp-section-inner">
          <h2 id="families-heading" className="lp-section-title">For families</h2>
          <p className="lp-section-lede">
            Caring for someone with early-stage memory loss is full of small
            worries. MemorAid answers a few of them quietly, so the rest of your
            attention can stay where it belongs.
          </p>
          <div className="lp-section-rule" aria-hidden="true" />
          <div className="lp-family-grid">
            {FAMILIES.map((f) => (
              <article key={f.title} className="lp-family-card">
                <div className="lp-family-icon-wrap" aria-hidden="true">
                  <Icon name={f.icon} size={22} />
                </div>
                <h3 className="lp-family-title">{f.title}</h3>
                <p className="lp-family-body">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 7. TESTIMONIAL */}
      <section className="lp-testimonial" aria-label="User testimonial">
        <div className="lp-section-inner lp-testimonial-inner">
          <div className="lp-testimonial-photo" aria-hidden="true">
            <img
              src="/landing-testimonial-senior.jpg"
              alt=""
              width="480"
              height="480"
              loading="lazy"
            />
          </div>
          <div className="lp-testimonial-content">
            <span className="lp-quote-mark" aria-hidden="true">"</span>
            <blockquote className="lp-quote-text">
              "For the first time in years, I don't wake up feeling anxious about what I might
              forget today. MemorAid is the quiet friend I never knew I needed."
            </blockquote>
            <div className="lp-quote-author">
              <span className="lp-author-name">Grace, 71</span>
              <span className="lp-author-detail">Living with Mild Cognitive Impairment</span>
            </div>
          </div>
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo">MemorAid</span>
            <small className="lp-footer-copy">© 2026 MemorAid. Dignity in every interaction.</small>
          </div>
          <nav className="lp-footer-links" aria-label="Footer navigation">
            <a href="#" className="lp-footer-link">Privacy</a>
            <a href="#" className="lp-footer-link">About</a>
            <a href="#" className="lp-footer-link">Contact</a>
          </nav>
        </div>
      </footer>

    </div>
  );
}
