import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';
import './styles/auth.css';

// Apply saved display preferences before React paints. The controls that edit
// these values live inside a settings popover, so relying on that component to
// mount caused dark mode to disappear after a page reload until the popover was
// opened again.
document.body.dataset.fontSize = localStorage.getItem('memoraid_font_size') || 'normal';
document.body.dataset.highContrast = String(
  localStorage.getItem('memoraid_high_contrast') === 'true',
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the service worker that receives browser push notifications.
// Push is optional and only active after the user opts in from Profile, but
// the worker itself can be registered up front; it does nothing until a push
// arrives. Guarded so unsupported/insecure contexts never throw.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Push simply stays unavailable; the in-app bell still works. */
    });
  });
}
