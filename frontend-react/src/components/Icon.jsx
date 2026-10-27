/**
 * Icon set.
 *
 * Hand-written inline SVGs rather than an icon font or a dependency. Each icon
 * is a single path drawn on a 24x24 viewBox with `stroke="currentColor"` and no
 * hard-coded fill, so it inherits the colour of whatever contains it — which is
 * what lets the sidebar icons flip from grey to white when a link is active.
 *
 * The landing-page set follows the Lucide geometry (24x24, 1.9 stroke, round
 * joins) so the marketing page and the signed-in app read as one system.
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
  copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z M4 16c-1.1 0-2-.9-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
  share:
    'M8.7 10.7 15.3 6.9 M8.7 13.3l6.6 3.8 M18 8.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z M6 15.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z M18 21.4a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  trash:
    'M3.5 6h17 M9 6V4.2a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 4.2V6 M18.5 6l-.9 13a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6 M10 10.5v6 M14 10.5v6',
  reveal: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M5.5 11v.5a6.5 6.5 0 0 0 13 0V11 M12 18v3',
  'mic-off': 'M9 9v2a3 3 0 0 0 4.6 2.6M15 11.5V6a3 3 0 0 0-5.4-1.8 M5.5 11v.5a6.5 6.5 0 0 0 10 5.6M12 18v3 M4 4l16 16',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4.5V9h-4.5',

  // Feature cards
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3',
  calendar: 'M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9ZM8 3.5V7M16 3.5V7M4.5 10.5h15',
  brain: 'M12 5a3 3 0 0 0-5.9-.7A2.8 2.8 0 0 0 4 7.1 2.9 2.9 0 0 0 5.4 9.5 2.9 2.9 0 0 0 4.3 13a2.9 2.9 0 0 0 2.6 2.9A3 3 0 0 0 12 18V5ZM12 5a3 3 0 0 1 5.9-.7A2.8 2.8 0 0 1 20 7.1a2.9 2.9 0 0 1-1.4 2.4 2.9 2.9 0 0 1 1.1 3.5 2.9 2.9 0 0 1-2.6 2.9A3 3 0 0 1 12 18V5Z',

  // Landing page — how it works, families, trust bar
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6.5V12l3.6 1.9',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  bot: 'M12 8V4H8 M9 2.2h6 M7 4v4 M12 18a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4Z M9 13v1.6 M15 13v1.6 M12 18v3.8',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  'calendar-check': 'M8 2.5v4 M16 2.5v4 M3 10h18 M3.5 6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z M9 16l2 2 4-4',
  'shield-check': 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z M9 12l2 2 4-4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1.5v2 M12 20.5v2 M4.4 4.4l1.5 1.5 M18.1 18.1l1.5 1.5 M1.5 12h2 M20.5 12h2 M4.4 19.6l1.5-1.5 M18.1 5.9l1.5-1.5',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  star: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.774a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
  sparkles: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z M20 3v4 M22 5h-4 M4 17v2 M5 18H3',
  close: 'M18 6 6 18 M6 6l12 12',
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
