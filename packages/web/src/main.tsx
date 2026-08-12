import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AuthProvider, RequireAuth, useAuth } from './auth.js';
import './styles.css';

function Placeholder() {
  const { user, signOut } = useAuth();
  return (
    <main className="shell">
      <h1>World Wide War</h1>
      <p>
        Signed in as {user?.displayName ?? user?.email}{' '}
        <button onClick={() => void signOut()}>Sign out</button>
      </p>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <RequireAuth>
        <Placeholder />
      </RequireAuth>
    </AuthProvider>
  </StrictMode>,
);
