import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// The app does not use a service worker. A leftover SW (e.g. injected by a
// preview/host environment) can serve stale bundles and break navigation.
// Unregister any residual one so fresh code always loads.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => registrations.forEach((r) => r.unregister()))
    .catch(() => {
      /* ignore — nothing to clean up */
    });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
