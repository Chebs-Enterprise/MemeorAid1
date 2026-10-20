/** Fallback page for unknown URLs. */
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="public-main" id="main-content">
      <div className="empty-state">
        <h1>We couldn't find that page</h1>
        <p>The link may have changed, or it may have been a typo.</p>
        <Link to="/" className="btn btn-primary">Back to the home page</Link>
      </div>
    </main>
  );
}
