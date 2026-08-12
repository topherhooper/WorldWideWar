import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { App } from './App.js';
import { AuthProvider, RequireAuth } from './auth.js';
import { Game } from './pages/Game.js';
import { Home } from './pages/Home.js';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/g/:id', element: <Game /> },
    ],
  },
]);

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <RequireAuth>
        <RouterProvider router={router} />
      </RequireAuth>
    </AuthProvider>
  </StrictMode>,
);
