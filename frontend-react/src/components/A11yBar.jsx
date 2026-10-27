/**
 * Display settings control.
 *
 * Implements the document's section 3.5.2 accessibility requirements:
 * text-size presets and high-contrast mode. The choice is persisted so it
 * survives reloads, and applied via data-attributes on <body> that the CSS in
 * global.css responds to.
 *
 * The requirement is that the controls exist and are reachable on every page —
 * not that they occupy a permanent strip above the content. They used to sit in
 * a bar pinned to the top of all ten screens, which pushed every page down and
 * read as chrome the user could not dismiss. They now live behind a single
 * "Display settings" button in the page chrome, so the page itself starts at
 * the top while the controls stay one click away everywhere.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const SIZE_KEY = 'memoraid_font_size';
const CONTRAST_KEY = 'memoraid_high_contrast';

const SIZES = [
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'Extra large' },
];

export default function A11yBar() {
  const [size, setSize] = useState(() => localStorage.getItem(SIZE_KEY) || 'normal');
  const [contrast, setContrast] = useState(() => localStorage.getItem(CONTRAST_KEY) === 'true');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    document.body.dataset.fontSize = size;
    localStorage.setItem(SIZE_KEY, size);
  }, [size]);

  useEffect(() => {
    document.body.dataset.highContrast = String(contrast);
    localStorage.setItem(CONTRAST_KEY, String(contrast));
  }, [contrast]);

  // Close on outside click or Escape, so the panel never traps attention.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="a11y-menu" ref={wrapRef}>
      <button
        type="button"
        className={`a11y-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="reveal" size={20} />
        Display settings
      </button>

      {open && (
        <div className="a11y-panel" role="group" aria-label="Display settings">
          <span className="a11y-panel-label">Text size</span>
          <div className="a11y-seg" role="group" aria-label="Text size">
            {SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`a11y-opt${size === s.id ? ' is-active' : ''}`}
                aria-pressed={size === s.id}
                onClick={() => setSize(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <span className="a11y-panel-label">Theme</span>
          <button
            type="button"
            className={`a11y-opt a11y-opt-wide${contrast ? ' is-active' : ''}`}
            aria-pressed={contrast}
            onClick={() => setContrast((c) => !c)}
          >
            <Icon name={contrast ? 'check' : 'reveal'} size={18} />
            Dark high contrast
          </button>
        </div>
      )}
    </div>
  );
}
