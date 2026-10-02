import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { AuthProvider } from './auth.js';
import { routes } from './routes.js';
import './styles.css';

const router = createBrowserRouter(routes);

// Production only: a worker under the Vite dev server makes stale bundles confusing,
// and the emulators have no FCM anyway.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

// The sign-in wall lives inside the router now (see routes.tsx), so the poll link can show
// a signed-out friend what they are signing in for.
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
