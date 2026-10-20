/**
 * Icon set.
 *
 * Hand-written inline SVGs rather than an icon font or a dependency. Each icon
 * is a single path drawn on a 24x24 viewBox with `stroke="currentColor"` and no
 * hard-coded fill, so it inherits the colour of whatever contains it — which is
 * what lets the sidebar icons flip from grey to white when a link is active.
 *
 * All icons are decorative: they are marked aria-hidden by default, because the
 * adjacent text label already conveys the meaning. Pass a `title` to expose one
 * to assistive technology when it stands alone.
 */

const PATHS = {
  // Navigation
  dashboard: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.8 20v-5.2h4.4V20',
  'log-memory': 'M12 5v14M5 12h14',
  recall: 'M12 3a6 6 0 0 0-3.6 10.8V17h7.2v-3.2A6 6 0 0 0 12 3ZM9.6 20.5h4.8',
  exercises: 'M4.5 9v6M7.5 6.5v11M16.5 6.5v11M19.5 9v6M7.5 12h9',
  chat: 'M20.5 12a8.5 8.5 0 0 1-8.5 8.5 8.9 8.9 0 0 1-3.4-.7L4 21l1.3-4.2A8.5 8.5 0 1 1 20.5 12Z',
  analytics: 'M4 20V9.5M9.3 20V4.5M14.7 20v-8.4M20 20V7',
  profile: 'M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
  signout: 'M15 8.5V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h6.6a2.2 2.2 0 0 0 2.2-2.2v-2.3M20 12H9.5M16.8 8.8 20 12l-3.2 3.2',

  // Actions
  check: 'M5 12.8 9.6 17.4 19 8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bell: 'M18 9a6 6 0 0 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9ZM10.3 19a2 2 0 0 0 3.4 0',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  send: 'm4.5 12 15-7.5-4.3 15-3.4-6.3L4.5 12Z',
  reveal: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4.5V9h-4.5',

  // Feature cards
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3',
  calendar: 'M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9ZM8 3.5V7M16 3.5V7M4.5 10.5h15',
  brain: 'M12 5a3 3 0 0 0-5.9-.7A2.8 2.8 0 0 0 4 7.1 2.9 2.9 0 0 0 5.4 9.5 2.9 2.9 0 0 0 4.3 13a2.9 2.9 0 0 0 2.6 2.9A3 3 0 0 0 12 18V5ZM12 5a3 3 0 0 1 5.9-.7A2.8 2.8 0 0 1 20 7.1a2.9 2.9 0 0 1-1.4 2.4 2.9 2.9 0 0 1 1.1 3.5 2.9 2.9 0 0 1-2.6 2.9A3 3 0 0 1 12 18V5Z',
};

export default function Icon({ name, size = 22, title, className = '' }) {
  const d = PATHS[name];
  if (!d) return null;

  const decorative = !title;
  return (
    <svg
      className={`icon-svg ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {/* A multi-subpath icon is written as one string, so `d` covers it all. */}
      <path d={d} />
    </svg>
  );
}
