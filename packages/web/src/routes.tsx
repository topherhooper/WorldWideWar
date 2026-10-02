import { Outlet, type RouteObject } from 'react-router';

import { App } from './App.js';
import { RequireAuth } from './auth.js';
import { Game } from './pages/Game.js';
import { Home } from './pages/Home.js';
import { Settings } from './pages/Settings.js';
import { CalendarProbe } from './polls/CalendarProbe.js';
import { NewPoll } from './polls/NewPoll.js';
import { PollGate } from './polls/PollGate.js';
import { Polls } from './polls/Polls.js';

export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      // The one page a signed-out friend can reach: Q5 shows the poll's title and who
      // asked behind the sign-in button. It handles auth itself.
      { path: '/p/:id', element: <PollGate /> },
      {
        element: (
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        ),
        children: [
          { path: '/', element: <Home /> },
          { path: '/g/:id', element: <Game /> },
          { path: '/settings', element: <Settings /> },
          { path: '/p', element: <Polls /> },
          // A static segment, so it outranks /p/:id.
          { path: '/p/new', element: <NewPoll /> },
          { path: '/p/calendar', element: <CalendarProbe /> },
        ],
      },
    ],
  },
];
