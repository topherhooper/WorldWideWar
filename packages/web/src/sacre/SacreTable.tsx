import { useState } from 'react';
import type { SacreAction, SacreGameView } from '@www/server/api-types';
import { cardName, maxCycleQuantity } from '@www/engine/sacre';

import { Hand } from './Hand.js';

/**
 * The table.
 *
 * The thing this screen is scored against is the one sentence at the top of
 * CLAUDE.md: somebody opens it and acts without asking anyone how. So it says
 * what you must do right now in one line at the top, and it offers only the
 * options the engine says are legal -- five buttons and a rules sheet is
 * exactly the failure docs/onboarding-gaps.md records three times out of four.
 */
export function SacreTable({
  view,
  onAct,
  busy,
}: {
  view: SacreGameView;
  onAct: (action: SacreAction) => void;
  busy: boolean;
}) {
  const game = view.game;
  const [picked, setPicked] = useState<string[]>([]);
  const [option, setOption] = useState<string | null>(null);

  const mine = game.you !== null && game.active === game.you;
  const owes = game.pending?.youOwe === true;
  const toggle = (id: string) =>
    setPicked((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  const clear = () => {
    setPicked([]);
    setOption(null);
  };
  const send = (action: SacreAction) => {
    onAct(action);
    clear();
  };

  return (
    <div className="sacre-table">
      <p className="sacre-prompt" data-testid="sacre-prompt">
        {promptFor(view)}
      </p>

      <ol className="sacre-seats">
        {game.seats.map((seat) => (
          <li
            key={seat.slot}
            className={`sacre-seat${seat.slot === game.active ? ' is-active' : ''}${
              seat.out ? ' is-out' : ''
            }`}
          >
            <strong>{view.seats[seat.slot]?.name || `Player ${seat.slot + 1}`}</strong>
            <span className="muted">
              {seat.score} pts · {seat.cards} card{seat.cards === 1 ? '' : 's'}
              {seat.out ? ' · out' : ''}
            </span>
            {seat.hand !== undefined && seat.slot !== game.you && (
              <span className="sacre-faceup">{seat.hand.map(cardName).join(' ')}</span>
            )}
          </li>
        ))}
      </ol>

      {game.you !== null && (
        <>
          <h3>Your hand</h3>
          <Hand
            cards={game.yourHand}
            selected={picked}
            onToggle={mine || owes ? toggle : undefined}
            disabled={busy}
          />
        </>
      )}

      {owes && game.pending !== null && (
        <AnswerPanel view={view} picked={picked} busy={busy} send={send} />
      )}

      {mine && game.turnPhase === 'choosing' && (
        <div className="sacre-options">
          {game.options.map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`option-${opt}`}
              className={option === opt ? 'is-picked' : ''}
              disabled={busy}
              onClick={() => setOption(option === opt ? null : opt)}
            >
              {LABEL[opt]}
            </button>
          ))}
          {option !== null && (
            <OptionPanel
              option={option}
              view={view}
              picked={picked}
              busy={busy}
              send={send}
              cancel={clear}
            />
          )}
        </div>
      )}

      <details className="sacre-log">
        <summary>What has happened</summary>
        <ol>
          {game.log
            .slice()
            .reverse()
            .map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
        </ol>
      </details>
    </div>
  );
}

const LABEL: Record<string, string> = {
  score: 'Score a run',
  advertise: 'Advertise a card',
  cycle: 'Cycle the table',
  return: 'Return to the deck',
  exchange: 'Exchange with someone',
};

/** One line saying what this viewer does now. Never a rules recap. */
function promptFor(view: SacreGameView): string {
  const game = view.game;
  if (game.phase === 'over') {
    const name = view.seats[game.winner ?? 0]?.name || `Player ${(game.winner ?? 0) + 1}`;
    return game.winner === game.you ? 'You win!' : `${name} wins. Sacré bleu!`;
  }
  if (game.you === null) return 'You are watching this game.';
  if (game.seats[game.you].out) return 'You are under 3 cards, so your game is over. Watch it out.';

  if (game.pending?.youOwe === true) {
    return game.pending.kind === 'advertise'
      ? `Put down a card worth ${game.pending.floor} or more, face down. If you have none, say so.`
      : `Choose ${game.pending.quantity} card${game.pending.quantity === 1 ? '' : 's'} to pass.`;
  }
  if (game.pending !== null) {
    const waiting = game.pending.owed.length;
    return waiting > 0
      ? `Waiting for ${waiting} player${waiting === 1 ? '' : 's'} to answer.`
      : 'Settling…';
  }
  if (game.active === game.you) return 'Your turn — pick one thing to do.';

  const name = view.seats[game.active]?.name || `Player ${game.active + 1}`;
  return `${name} is taking their turn.`;
}

function AnswerPanel({
  view,
  picked,
  busy,
  send,
}: {
  view: SacreGameView;
  picked: string[];
  busy: boolean;
  send: (action: SacreAction) => void;
}) {
  const pending = view.game.pending;
  if (pending === null) return null;

  if (pending.kind === 'advertise') {
    return (
      <div className="sacre-answer">
        <p>
          On offer: <strong>{cardName(pending.offered as never)}</strong>
        </p>
        <button
          type="button"
          data-testid="respond"
          disabled={busy || picked.length !== 1}
          onClick={() => send({ type: 'respond', card: picked[0] })}
        >
          Put this card down
        </button>
        {/* The rules have you prove an empty hand by showing it — to the
            advertiser alone, which is why the engine takes a viewer. */}
        <button
          type="button"
          data-testid="prove-empty"
          disabled={busy}
          onClick={() => send({ type: 'respond', card: '' })}
        >
          I have nothing that answers
        </button>
      </div>
    );
  }

  return (
    <div className="sacre-answer">
      <button
        type="button"
        data-testid="pass"
        disabled={busy || picked.length !== pending.quantity}
        onClick={() => send({ type: 'pass', cards: picked })}
      >
        Pass {pending.quantity} card{pending.quantity === 1 ? '' : 's'}
      </button>
    </div>
  );
}

function OptionPanel({
  option,
  view,
  picked,
  busy,
  send,
  cancel,
}: {
  option: string;
  view: SacreGameView;
  picked: string[];
  busy: boolean;
  send: (action: SacreAction) => void;
  cancel: () => void;
}) {
  const game = view.game;
  const [quantity, setQuantity] = useState(1);
  const [offset, setOffset] = useState(1);
  const [target, setTarget] = useState<number | null>(null);
  const max = maxCycleQuantity(game.seats.length);

  const others = game.seats.filter((s) => s.slot !== game.you && !s.out && s.cards > 0);

  return (
    <div className="sacre-do">
      {option === 'score' && (
        <>
          <p className="muted">
            Pick at least 3 cards of one suit in order. Tap them in the order they run.
          </p>
          <button
            type="button"
            data-testid="do-score"
            disabled={busy || picked.length < 3}
            onClick={() => send({ type: 'score', cards: picked })}
          >
            Score these {picked.length}
          </button>
        </>
      )}

      {option === 'advertise' && (
        <>
          <p className="muted">Pick one card to offer face up. Everyone owes you one worth more.</p>
          <button
            type="button"
            data-testid="do-advertise"
            disabled={busy || picked.length !== 1}
            onClick={() => send({ type: 'advertise', card: picked[0] })}
          >
            Offer it
          </button>
        </>
      )}

      {option === 'return' && (
        <>
          <p className="muted">
            {game.round >= game.rounds
              ? 'Put cards under the deck, then take any you like from it.'
              : 'Put cards under the deck and draw the same number, unseen.'}
          </p>
          <button
            type="button"
            data-testid="do-return"
            disabled={busy || picked.length === 0}
            onClick={() => send({ type: 'return', cards: picked })}
          >
            Return {picked.length}
          </button>
        </>
      )}

      {option === 'exchange' && (
        <>
          <p className="muted">Give one card away, then take one of theirs.</p>
          <select
            data-testid="exchange-target"
            value={target ?? ''}
            onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Choose a player…</option>
            {others.map((s) => (
              <option key={s.slot} value={s.slot}>
                {view.seats[s.slot]?.name || `Player ${s.slot + 1}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="do-exchange"
            disabled={busy || picked.length !== 1 || target === null}
            onClick={() => send({ type: 'exchange', target: target as number, card: picked[0] })}
          >
            Give and take
          </button>
        </>
      )}

      {option === 'cycle' && (
        <>
          <p className="muted">Everyone with enough cards passes at the same time.</p>
          <label>
            How many
            <input
              type="number"
              min={1}
              max={max}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            Seats to the left
            <input
              type="number"
              min={1}
              max={Math.max(1, game.seats.length - 1)}
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            data-testid="do-cycle"
            disabled={busy}
            onClick={() => send({ type: 'cycle', quantity, offset })}
          >
            Call it
          </button>
        </>
      )}

      <button type="button" className="link" onClick={cancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}
