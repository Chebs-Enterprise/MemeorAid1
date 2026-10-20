/**
 * MemorAid — application root.
 *
 * Composition, top to bottom:
 *   AuthProvider   who is signed in (single source of truth)
 *     BrowserRouter  client-side routing
 *       AppRoutes      the route table (public, guarded, fallback)
 *
 * The skip link is the first focusable element, satisfying the accessibility
 * requirement in section 3.5.2 for keyboard users.
 */
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import AppRoutes from './router.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
