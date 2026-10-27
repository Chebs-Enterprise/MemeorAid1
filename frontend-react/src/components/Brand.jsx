import { Link } from 'react-router-dom';

/**
 * The single MemorAid brand signature used across public and signed-in pages.
 * The dashboard treatment is the source of truth: teal M mark + wordmark.
 */
export default function Brand({ to, className = '', label, onClick }) {
  const classes = `brand ${className}`.trim();
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">M</span>
      <span className="brand-wordmark">MemorAid</span>
    </>
  );

  if (!to) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <Link to={to} className={classes} aria-label={label} onClick={onClick}>
      {content}
    </Link>
  );
}
