import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// After a new deploy, a page you haven't visited yet in this tab is a JS
// chunk under a filename that no longer exists on the server (each deploy
// hashes filenames fresh) - the click does nothing instead of navigating,
// and only a manual refresh (which re-fetches the current index.html and
// its now-current filenames) fixes it. This reloads automatically instead.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
