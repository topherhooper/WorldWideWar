/**
 * The client application.
 *
 * One rule holds the whole thing together: the server view is the only source
 * of truth, and every change — yours or somebody else's — arrives the same way,
 * by refetching it. The event stream carries nothing but a version number, so
 * there is no second, subtly different code path for "live" updates to drift
 * out of agreement with.
 *
 * The one thing held locally is the order draft in progress, because a
 * half-built order is not yet news.
 */

import type { GameState, GeneratedMap, Slot, TerritoryId } from '@www/engine';
import type { GameView, JoinResponse, LobbyEntry } from '@www/server';
import { api, ApiError, session } from './api.js';
import { h, replace } from './dom.js';
import { renderMap, type TargetMode } from './map.js';
import { OrderDraft } from './orders.js';
import {
  ordersPanel,
  playersPanel,
  pledgePanel,
  reportPanel,
  resultPanel,
  selectionPanel,
  type PanelActions,
} from './panels.js';
import { colourFor } from './palette.js';

const POLL_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

interface AppState {
  code: string | null;
  view: GameView | null;
  map: GeneratedMap | null;
  draft: OrderDraft | null;
  draftTurn: number;
  selected: TerritoryId | null;
  mode: TargetMode;
  error: string | null;
  /** Wall-clock reading paired with `view.serverTime`, for the countdown. */
  fetchedAt: number;
}

export function start(root: HTMLElement): void {
  const app = new App(root);
  app.begin();
}

class App {
  private state: AppState = {
    code: null,
    view: null,
    map: null,
    draft: null,
    draftTurn: -1,
    selected: null,
    mode: 'move',
    error: null,
    fetchedAt: 0,
  };

  private stream: EventSource | null = null;
  private poller: number | null = null;
  private saveTimer: number | null = null;
  private saving = false;

  constructor(private readonly root: HTMLElement) {}

  begin(): void {
    window.addEventListener('hashchange', () => void this.route());
    window.setInterval(() => this.updateClock(), 500);
    void this.route();
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  private async route(): Promise<void> {
    const match = /^#\/g\/([A-Za-z0-9]+)$/.exec(window.location.hash);
    const code = match ? match[1].toUpperCase() : null;

    if (code === this.state.code && code !== null) return;

    this.disconnect();
    this.state = {
      ...this.state,
      code,
      view: null,
      map: null,
      draft: null,
      draftTurn: -1,
      selected: null,
      error: null,
    };

    if (code === null) {
      await this.showHome();
      return;
    }

    await this.refresh();
    this.connect(code);
    this.poller = window.setInterval(() => void this.refresh(), POLL_MS);
  }

  private disconnect(): void {
    this.stream?.close();
    this.stream = null;
    if (this.poller !== null) window.clearInterval(this.poller);
    this.poller = null;
  }

  private connect(code: string): void {
    try {
      const stream = new EventSource(`/api/games/${encodeURIComponent(code)}/stream`);
      stream.addEventListener('version', (event) => {
        const version = Number((event as MessageEvent<string>).data);
        if (this.state.view && version === this.state.view.version) return;
        void this.refresh();
      });
      // A dead stream is not fatal — the poller is still there underneath.
      stream.onerror = (): void => undefined;
      this.stream = stream;
    } catch {
      this.stream = null;
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const code = this.state.code;
    if (code === null) return;

    try {
      const view = await api.view(code, session.tokenFor(code));
      if (this.state.code !== code) return;

      if (this.state.map === null && view.phase !== 'lobby') {
        this.state.map = await api.map(code);
      }

      this.apply(view);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.fail('That game no longer exists.');
        return;
      }
      this.fail(error instanceof Error ? error.message : 'lost contact with the server');
    }
  }

  /** Folds a fresh server view into local state and redraws. */
  private apply(view: GameView): void {
    this.state.view = view;
    this.state.fetchedAt = Date.now();
    this.state.error = null;

    const seated = view.you !== null && view.state !== null;
    if (!seated) {
      this.state.draft = null;
      this.state.draftTurn = -1;
    } else if (this.state.draft === null || this.state.draftTurn !== view.turn) {
      // A new turn discards the old sheet; the server's copy of this turn's
      // draft is what an interrupted session left behind.
      this.state.draft = new OrderDraft(
        view.state as GameState,
        this.state.map as GeneratedMap,
        (view.you as { slot: Slot }).slot,
        view.draft,
      );
      this.state.draftTurn = view.turn;
      this.state.selected = null;
    }

    this.render();
  }

  private fail(message: string): void {
    this.state.error = message;
    this.render();
  }

  // ── Home ───────────────────────────────────────────────────────────────────

  private async showHome(): Promise<void> {
    const list = h(
      'div',
      { class: 'lobby-list' },
      h('p', { class: 'hint' }, 'Looking for tables…'),
    );
    replace(
      this.root,
      homeScreen(
        list,
        (options) => void this.create(options),
        (code, name) => void this.joinByCode(code, name),
      ),
    );

    try {
      const games = await api.lobbies();
      replace(
        list,
        lobbyList(games, (code) => void this.joinByCode(code, nameField().value)),
      );
    } catch {
      replace(list, h('p', { class: 'hint' }, 'No open tables right now.'));
    }
  }

  private async create(options: {
    name: string;
    playerCount: number;
    humanSeats: number;
    turnSeconds: number;
    seed: string;
    difficulty: 'easy' | 'normal' | 'hard';
  }): Promise<void> {
    session.setName(options.name);
    try {
      const joined = await api.create({
        name: options.name,
        playerCount: options.playerCount,
        humanSeats: options.humanSeats,
        turnSeconds: options.turnSeconds,
        difficulty: options.difficulty,
        ...(options.seed ? { seed: options.seed } : {}),
      });
      this.enter(joined);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not create that game');
    }
  }

  private async joinByCode(code: string, name?: string): Promise<void> {
    const clean = code.trim().toUpperCase();
    if (!clean) return;

    // The name field is shared with the create form, so joining a table uses
    // whatever is typed there rather than silently seating you as "Player".
    const chosen = name?.trim() || session.name() || 'Player';
    session.setName(chosen);

    const held = session.tokenFor(clean);
    if (held) {
      window.location.hash = `#/g/${clean}`;
      return;
    }

    try {
      const joined = await api.join(clean, chosen, null);
      this.enter(joined);
    } catch (error) {
      // A full or already-running table is still worth opening — as a spectator.
      if (error instanceof ApiError && error.status === 409) {
        window.location.hash = `#/g/${clean}`;
        return;
      }
      this.fail(error instanceof Error ? error.message : 'could not join that game');
    }
  }

  private enter(joined: JoinResponse): void {
    session.remember(joined.code, joined.token);
    window.location.hash = `#/g/${joined.code}`;
  }

  // ── Order editing ──────────────────────────────────────────────────────────

  private get actions(): PanelActions {
    const edit = (change: (draft: OrderDraft) => void): void => {
      const draft = this.state.draft;
      if (!draft) return;
      change(draft);
      this.queueSave();
      this.render();
    };

    return {
      onPledge: (slot) => edit((draft) => draft.setPledge(slot)),
      onMode: (mode) => {
        this.state.mode = mode;
        this.render();
      },
      onSelect: (id) => {
        this.state.selected = id;
        this.render();
      },
      onTarget: (id) =>
        edit((draft) => {
          const from = this.state.selected;
          if (from === null) return;
          if (this.state.mode === 'move') {
            draft.move(from, id);
          } else {
            const [first] = draft.supportCandidates(id);
            draft.support(from, id, first ?? draft.slot);
          }
        }),
      onDeploy: (id, delta) => edit((draft) => draft.adjustDeploy(id, delta)),
      onMoveCount: (from, delta) =>
        edit((draft) => {
          const order = draft.orderFrom(from);
          if (order?.kind === 'MOVE') draft.setMoveCount(from, order.count + delta);
        }),
      onHold: (id) => edit((draft) => draft.hold(id)),
      onClearOrder: (id) => edit((draft) => draft.clearOrder(id)),
      onSupportFor: (from, slot) =>
        edit((draft) => {
          const order = draft.orderFrom(from);
          if (order?.kind === 'SUPPORT') draft.support(from, order.target, slot);
        }),
      onClearAll: () =>
        edit((draft) => {
          draft.clear();
          draft.setPledge(null);
        }),
      onLock: () => void this.save(true),
      onUnlock: () => void this.save(false),
      onResign: () => void this.resign(),
    };
  }

  private queueSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save(this.state.view?.locked ?? false);
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(locked: boolean): Promise<void> {
    const { code, draft } = this.state;
    const token = code ? session.tokenFor(code) : null;
    if (!code || !draft || !token || this.saving) return;

    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.saving = true;
    try {
      this.apply(await api.orders(code, token, draft.orders, locked));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not send those orders');
    } finally {
      this.saving = false;
    }
  }

  private async resign(): Promise<void> {
    const { code } = this.state;
    const token = code ? session.tokenFor(code) : null;
    if (!code || !token) return;
    if (!window.confirm('Resign this game? Your armies stay on the board but stop fighting.')) {
      return;
    }

    try {
      this.apply(await api.resign(code, token));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not resign');
    }
  }

  private async startNow(): Promise<void> {
    const { code } = this.state;
    const token = code ? session.tokenFor(code) : null;
    if (!code || !token) return;

    try {
      this.apply(await api.start(code, token));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not start the game');
    }
  }

  private async joinHere(): Promise<void> {
    const { code } = this.state;
    if (!code) return;
    try {
      const joined = await api.join(code, session.name() || 'Player', null);
      session.remember(joined.code, joined.token);
      await this.refresh();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'could not take a seat');
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    const { view, error } = this.state;

    if (this.state.code === null) return;
    if (!view) {
      replace(this.root, shell(banner(error), h('p', { class: 'loading' }, 'Loading…')));
      return;
    }

    replace(
      this.root,
      shell(
        banner(error),
        this.topBar(view),
        view.phase === 'lobby' ? this.lobbyScreen(view) : this.gameScreen(view),
      ),
    );
    this.updateClock();
  }

  private topBar(view: GameView): HTMLElement {
    return h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, 'World Wide War'),
      h('span', { class: 'code' }, 'Table ', h('strong', {}, view.code)),
      view.phase === 'lobby' ? null : h('span', {}, `Turn ${view.turn}`),
      view.phase === 'active' ? h('span', { class: 'clock', id: 'clock' }, '—') : null,
      view.phase === 'finished' ? h('span', { class: 'clock' }, 'final') : null,
      view.fog ? h('span', { class: 'tag is-warning' }, 'fog') : null,
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => void navigator.clipboard?.writeText(window.location.href),
        },
        'copy invite link',
      ),
    );
  }

  private lobbyScreen(view: GameView): HTMLElement {
    const seated = view.you !== null;
    const open = view.players.filter((player) => player.open).length;

    return h(
      'main',
      { class: 'lobby' },
      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Waiting for players'),
        h(
          'p',
          {},
          open === 0
            ? 'Everyone is here. Starting…'
            : `${open} of ${view.playerCount} seats still open. Share the table code — ${view.code} — or the link in the bar above.`,
        ),
        seated
          ? null
          : h(
              'button',
              { class: 'primary', type: 'button', onclick: () => void this.joinHere() },
              'Take a seat',
            ),
        view.you?.isHost
          ? h(
              'button',
              { class: 'secondary', type: 'button', onclick: () => void this.startNow() },
              'Start now, fill the rest with bots',
            )
          : null,
      ),
      playersPanel(view),
    );
  }

  private gameScreen(view: GameView): HTMLElement {
    const map = this.state.map;
    const state = view.state;
    if (!map || !state) return h('p', { class: 'loading' }, 'Loading the world…');

    const draft = this.state.draft;
    const playing =
      draft !== null && view.phase === 'active' && state.status[draft.slot] === 'active';

    const board = h(
      'div',
      { class: 'map-wrap' },
      renderMap({
        map,
        state,
        draft: playing ? draft : null,
        you: view.you?.slot ?? null,
        selected: this.state.selected,
        mode: this.state.mode,
        warned: view.warned,
        onSelect: (id) => this.actions.onSelect(id),
        onTarget: (id) => this.actions.onTarget(id),
      }),
    );

    const side = h(
      'aside',
      { class: 'side' },
      resultPanel(view),
      playing
        ? selectionPanel(view, draft, this.state.selected, this.state.mode, map, this.actions)
        : null,
      playing ? pledgePanel(view, draft, this.actions) : null,
      playing ? ordersPanel(view, draft, this.actions) : null,
      !playing && view.phase === 'active'
        ? h(
            'section',
            { class: 'panel' },
            h('h2', {}, 'Watching'),
            h(
              'p',
              { class: 'hint' },
              view.you === null
                ? 'You are not seated at this table. The war carries on without you.'
                : 'You are out of the fight, but the map keeps moving.',
            ),
          )
        : null,
      reportPanel(view, map),
      playersPanel(view),
    );

    return h('main', { class: 'board' }, board, side);
  }

  /** Rewrites just the countdown, so the map is not rebuilt twice a second. */
  private updateClock(): void {
    const node = document.getElementById('clock');
    const view = this.state.view;
    if (!node || !view || view.deadline === null) return;

    const elapsed = Date.now() - this.state.fetchedAt;
    const remaining = view.deadline - (view.serverTime + elapsed);
    node.textContent = formatDuration(remaining);
    node.classList.toggle('is-urgent', remaining <= 15_000);
  }
}

// ─── Static pieces ───────────────────────────────────────────────────────────

function shell(...children: (Node | null)[]): HTMLElement {
  return h('div', { class: 'app' }, ...children);
}

function banner(error: string | null): HTMLElement | null {
  return error === null ? null : h('div', { class: 'error-banner' }, error);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'resolving…';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function homeScreen(
  lobbies: HTMLElement,
  onCreate: (options: {
    name: string;
    playerCount: number;
    humanSeats: number;
    turnSeconds: number;
    seed: string;
    difficulty: 'easy' | 'normal' | 'hard';
  }) => void,
  onJoin: (code: string, name: string) => void,
): HTMLElement {
  const name = h('input', {
    id: 'name',
    value: session.name(),
    maxlength: 24,
    placeholder: 'Your name',
  });
  const players = numberField('players', 6, 2, 12);
  const humans = numberField('humans', 1, 1, 12);
  const seed = h('input', { id: 'seed', placeholder: 'optional' });

  const turn = h(
    'select',
    { id: 'turn' },
    option('60', '1 minute'),
    option('300', '5 minutes'),
    option('3600', '1 hour'),
    option('86400', '1 day', true),
  );
  const difficulty = h(
    'select',
    { id: 'difficulty' },
    option('easy', 'Easy'),
    option('normal', 'Normal', true),
    option('hard', 'Hard'),
  );

  const join = h('input', { id: 'code', placeholder: 'Table code', maxlength: 8 });

  return h(
    'div',
    { class: 'app home' },
    h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, 'World Wide War'),
      h('span', { class: 'hint' }, 'Simultaneous orders. Secret pacts. One winner, usually.'),
    ),
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Everyone moves at once.'),
      h(
        'p',
        {},
        'A Risk-shaped war for two to twelve, played asynchronously: submit your orders whenever you are online and the whole table resolves together. Armies that swap provinces bounce off each other. Three players into one empty province shred each other.',
      ),
      h(
        'p',
        {},
        'Combat strength does not come from dice. Each turn you pledge, secretly, to one rival — and what the two of you do with that pledge sets the multiplier on every battle you fight. Betrayal pays best, once. It is on your record forever.',
      ),
    ),
    h(
      'main',
      { class: 'home-grid' },
      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Start a table'),
        field('Your name', name),
        field('Players at the table', players),
        field('Human seats', humans),
        field('Turn length', turn),
        field('Bot difficulty', difficulty),
        field('Map seed', seed),
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () =>
              onCreate({
                name: name.value.trim() || 'Player',
                playerCount: Number(players.value),
                humanSeats: Math.min(Number(humans.value), Number(players.value)),
                turnSeconds: Number((turn as HTMLSelectElement).value),
                seed: seed.value.trim(),
                difficulty: (difficulty as HTMLSelectElement).value as 'easy' | 'normal' | 'hard',
              }),
          },
          'Create the world',
        ),
        h(
          'p',
          { class: 'hint' },
          'Every seat you do not fill with a person is played by a bot with its own temperament and its own grudges.',
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Join a table'),
        field('Table code', join),
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () => onJoin(join.value, name.value),
          },
          'Sit down',
        ),
        h('p', { class: 'hint' }, 'You will sit down under the name on the left.'),
        h('h2', {}, 'Open tables'),
        lobbies,
      ),
      h(
        'section',
        { class: 'panel about' },
        h('h2', {}, 'How a turn works'),
        h(
          'ol',
          {},
          h(
            'li',
            {},
            'Place your reinforcements, then order every province: hold, march, or support a neighbour’s fight.',
          ),
          h(
            'li',
            {},
            'Pledge secretly to one rival. Mutual pledges make you both stronger; betraying one that was honoured is stronger still, and permanent on your record.',
          ),
          h(
            'li',
            {},
            'Everyone’s orders resolve at once. Armies that swap provinces bounce; three armies into one empty province shred each other.',
          ),
          h(
            'li',
            {},
            'The storm eats the rim of the world on a schedule, so the map always closes toward a fight.',
          ),
        ),
      ),
    ),
  );
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function numberField(id: string, value: number, min: number, max: number): HTMLInputElement {
  return h('input', { id, type: 'number', value, min, max });
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
  return h('option', { value, selected }, label);
}

/** The shared name field, read back when joining from the lobby list. */
function nameField(): HTMLInputElement {
  return (document.getElementById('name') as HTMLInputElement | null) ?? h('input', {});
}

function lobbyList(games: LobbyEntry[], onJoin: (code: string) => void): HTMLElement {
  if (games.length === 0) return h('p', { class: 'hint' }, 'No open tables right now.');

  return h(
    'ul',
    { class: 'lobbies' },
    games.map((game) =>
      h(
        'li',
        {},
        h('span', { class: 'swatch', style: `background:${colourFor(game.playerCount % 12)}` }),
        h('span', {}, `${game.code} — ${game.playerCount} players, ${game.openSeats} open`),
        h('button', { class: 'link', type: 'button', onclick: () => onJoin(game.code) }, 'join'),
      ),
    ),
  );
}
