/**
 * Route guard for authenticated areas.
 *
 * Replaces the vanilla build's approach of reading localStorage inside each
 * page and manually redirecting. Any route wrapped in <RequireAuth> sends the
 * visitor to the sign-in page when there is no valid session.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}
