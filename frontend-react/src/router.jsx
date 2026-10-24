/**
 * Application routes.
 *
 * Central route table for the whole SPA. Public routes render inside
 * <PublicLayout>; everything else is wrapped in <RequireAuth> so an expired or
 * missing session redirects to sign-in. Each screen is a separate page
 * component under src/pages/.
 */
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';

/* Bare layout — renders the child page with no surrounding chrome */
function BareLayout() { return <Outlet />; }

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LogMemory from './pages/LogMemory.jsx';
import Recall from './pages/Recall.jsx';
import Exercises from './pages/Exercises.jsx';
import Chat from './pages/Chat.jsx';
import Analytics from './pages/Analytics.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import NotFound from './pages/NotFound.jsx';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Landing — owns its own nav, no PublicLayout chrome */}
      <Route element={<BareLayout />}>
        <Route index element={<Landing />} />
      </Route>

      {/* Auth pages — own their full viewport, no surrounding chrome */}
      <Route element={<BareLayout />}>
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
      </Route>

      {/* Signed-in application */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="log-memory" element={<LogMemory />} />
          <Route path="recall" element={<Recall />} />
          <Route path="exercises" element={<Exercises />} />
          <Route path="chat" element={<Chat />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>

      <Route path="/home" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
