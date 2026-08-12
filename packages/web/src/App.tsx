import { Link, Outlet } from 'react-router';

import { useAuth } from './auth.js';

export function App() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          World Wide War
        </Link>
        <span className="topbar-user">
          {user?.displayName ?? user?.email}{' '}
          <button onClick={() => void signOut()}>Sign out</button>
        </span>
      </header>
      <Outlet />
    </div>
  );
}
