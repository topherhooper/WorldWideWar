import { Link, Outlet, useLocation } from 'react-router';

import { useAuth } from './auth.js';

export function App() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  // Poll pages are Quorum (Q18); everything else keeps the game's name.
  const quorum = pathname === '/p' || pathname.startsWith('/p/');
  return (
    <div className="shell">
      <header className="topbar">
        <Link to={quorum ? '/p' : '/'} className="brand">
          {quorum ? 'Quorum' : 'World Wide War'}
        </Link>
        {/* This layout now renders for signed-out visitors too, on the poll link. */}
        {user !== null && user !== undefined && (
          <span className="topbar-user">
            {user.displayName ?? user.email} <Link to="/p">Polls</Link>{' '}
            <Link to="/settings">Settings</Link>{' '}
            <button onClick={() => void signOut()}>Sign out</button>
          </span>
        )}
      </header>
      <Outlet />
    </div>
  );
}
