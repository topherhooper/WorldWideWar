import { useParams } from 'react-router';

import { useGame } from '../useGame.js';
import { Lobby } from './Lobby.js';

export function Game() {
  const { id } = useParams<{ id: string }>();
  if (id === undefined) throw new Error('missing game id');
  return <GameInner id={id} />;
}

function GameInner({ id }: { id: string }) {
  const { view, error, refresh } = useGame(id);

  if (view === null) {
    return <main className="panel">{error ?? 'Loading…'}</main>;
  }
  if (view.status === 'lobby') {
    return <Lobby view={view} onChanged={refresh} />;
  }
  return (
    <main className="panel">
      <h2>Turn {view.turn}</h2>
      <p className="muted">Game screen lands in the next task.</p>
    </main>
  );
}
