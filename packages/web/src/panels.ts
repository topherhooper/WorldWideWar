/**
 * The sidebar: who is at the table, what you have ordered, and what happened
 * last turn.
 *
 * The turn report leads with the pacts rather than the battles. That is a
 * deliberate inversion of the genre — the interesting event in a turn is almost
 * never who took which province, it is who kept their word.
 */

import type {
  BattleReport,
  GameState,
  GeneratedMap,
  PactResult,
  Slot,
  TerritoryId,
  TurnReport,
  WorldEvent,
} from '@www/engine';
import type { GameView, PlayerView } from '@www/server';
import { h } from './dom.js';
import { colourFor } from './palette.js';
import type { TargetMode } from './map.js';
import type { OrderDraft } from './orders.js';
import { HIDDEN } from './orders.js';

export interface PanelActions {
  onPledge: (slot: Slot | null) => void;
  onMode: (mode: TargetMode) => void;
  onSelect: (id: TerritoryId | null) => void;
  onTarget: (id: TerritoryId) => void;
  onDeploy: (id: TerritoryId, delta: number) => void;
  onMoveCount: (from: TerritoryId, delta: number) => void;
  onHold: (id: TerritoryId) => void;
  onClearOrder: (id: TerritoryId) => void;
  onSupportFor: (from: TerritoryId, slot: Slot) => void;
  onClearAll: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onResign: () => void;
}

function swatch(slot: Slot | null): HTMLElement {
  return h('span', { class: 'swatch', style: `background:${colourFor(slot)}` });
}

function nameOf(view: GameView, slot: Slot | null): string {
  if (slot === null) return 'nobody';
  return view.players[slot]?.name ?? `Seat ${slot + 1}`;
}

// ─── Players ─────────────────────────────────────────────────────────────────

export function playersPanel(view: GameView): HTMLElement {
  return h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'The table'),
    h(
      'ul',
      { class: 'players' },
      view.players.map((player) => playerRow(view, player)),
    ),
  );
}

function playerRow(view: GameView, player: PlayerView): HTMLElement {
  const you = view.you?.slot === player.slot;
  const classes = ['player', `is-${player.status}`];
  if (you) classes.push('is-you');

  const record: string[] = [];
  if (player.pactsHonored > 0) record.push(`${player.pactsHonored} kept`);
  if (player.pactsBroken > 0) record.push(`${player.pactsBroken} broken`);
  if (player.streak > 0 && player.partner !== null) {
    record.push(`${player.streak}× with ${nameOf(view, player.partner)}`);
  }

  return h(
    'li',
    { class: classes.join(' ') },
    h(
      'div',
      { class: 'player-head' },
      swatch(player.slot),
      h('span', { class: 'player-name' }, player.name, you ? ' (you)' : ''),
      player.kind === 'bot' ? h('span', { class: 'tag' }, 'bot') : null,
      player.open ? h('span', { class: 'tag' }, 'open seat') : null,
      view.phase === 'active' && player.status === 'active' && player.kind === 'human'
        ? h(
            'span',
            { class: player.ready ? 'tag is-ready' : 'tag is-waiting' },
            player.ready ? 'locked in' : 'thinking',
          )
        : null,
      player.status !== 'active' ? h('span', { class: 'tag is-out' }, player.status) : null,
    ),
    view.phase === 'lobby'
      ? null
      : h(
          'div',
          { class: 'player-stats' },
          h('span', {}, `${player.territories} land`),
          h('span', {}, `${player.armies === null ? '?' : player.armies} armies`),
          h('span', {}, `+${player.income}`),
        ),
    record.length > 0 ? h('div', { class: 'player-record' }, record.join(' · ')) : null,
    player.tags.length > 0 ? h('div', { class: 'player-record' }, player.tags.join(' · ')) : null,
  );
}

// ─── The pledge ──────────────────────────────────────────────────────────────

export function pledgePanel(view: GameView, draft: OrderDraft, actions: PanelActions): HTMLElement {
  const options = view.players.filter(
    (player) => player.slot !== draft.slot && player.status === 'active',
  );

  return h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'The pact'),
    h(
      'p',
      { class: 'hint' },
      'Pledge to one rival. If they pledge you back and neither attacks, you both fight at ×1.35 this turn. Betray a pledge that was honoured and you fight at ×1.40 — and everyone will know who you are.',
    ),
    h(
      'div',
      { class: 'pledge-options' },
      options.map((player) =>
        h(
          'button',
          {
            class: draft.pledge === player.slot ? 'pledge is-chosen' : 'pledge',
            type: 'button',
            onclick: () => actions.onPledge(draft.pledge === player.slot ? null : player.slot),
          },
          swatch(player.slot),
          player.name,
          player.pactsBroken > 0
            ? h('span', { class: 'tag is-danger' }, `${player.pactsBroken}✗`)
            : null,
        ),
      ),
      h(
        'button',
        {
          class: draft.pledge === null ? 'pledge is-chosen' : 'pledge',
          type: 'button',
          onclick: () => actions.onPledge(null),
        },
        'Abstain',
      ),
    ),
  );
}

// ─── Selection ───────────────────────────────────────────────────────────────

export function selectionPanel(
  view: GameView,
  draft: OrderDraft,
  selected: TerritoryId | null,
  mode: TargetMode,
  map: GeneratedMap,
  actions: PanelActions,
): HTMLElement {
  if (selected === null) {
    return h(
      'section',
      { class: 'panel' },
      h('h2', {}, 'Orders'),
      h('p', { class: 'hint' }, 'Pick one of your territories on the map to give it an order.'),
    );
  }

  const state = view.state as GameState;
  const owner = state.owner[selected];
  const mine = draft.owns(selected);
  const armies = state.armies[selected];
  const region = map.regions.find((each) => each.id === map.territories[selected].regionId);
  const order = draft.orderFrom(selected);

  return h(
    'section',
    { class: 'panel' },
    h(
      'h2',
      {},
      draft.name(selected),
      h(
        'button',
        { class: 'link', type: 'button', onclick: () => actions.onSelect(null) },
        'clear',
      ),
    ),
    h(
      'div',
      { class: 'territory-facts' },
      h('span', {}, swatch(owner), owner === null ? 'unclaimed' : nameOf(view, owner)),
      h('span', {}, `${armies === HIDDEN ? '?' : armies} armies`),
      region ? h('span', {}, `${region.name} (+${region.bonus})`) : null,
      mine && !draft.supplied(selected) ? h('span', { class: 'is-danger' }, 'out of supply') : null,
      view.warned.includes(selected) ? h('span', { class: 'is-warning' }, 'storm next turn') : null,
    ),

    mine ? deployRow(draft, selected, actions) : null,
    mine ? orderRow(view, draft, selected, mode, actions) : null,
    mine
      ? null
      : h(
          'p',
          { class: 'hint' },
          'You can only order territories you hold — but you can support a fight here from one you do.',
        ),

    order && order.kind === 'MOVE' ? moveCountRow(draft, selected, order.count, actions) : null,
    order && order.kind === 'SUPPORT'
      ? supportForRow(view, draft, selected, order.target, order.forPlayer, actions)
      : null,
  );
}

function deployRow(draft: OrderDraft, id: TerritoryId, actions: PanelActions): HTMLElement {
  const deployed = draft.deployAt(id);
  const allowed = draft.canDeployTo(id);

  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'row-label' }, 'Reinforce'),
    h(
      'div',
      { class: 'stepper' },
      h(
        'button',
        {
          type: 'button',
          disabled: !allowed || deployed <= 0,
          onclick: () => actions.onDeploy(id, -1),
        },
        '−',
      ),
      h('span', { class: 'stepper-value' }, String(deployed)),
      h(
        'button',
        {
          type: 'button',
          disabled: !allowed || draft.remaining() <= 0,
          onclick: () => actions.onDeploy(id, 1),
        },
        '+',
      ),
    ),
    h(
      'span',
      { class: 'hint' },
      allowed ? `${draft.remaining()} left to place` : 'needs a supply line to your capital',
    ),
  );
}

function orderRow(
  view: GameView,
  draft: OrderDraft,
  id: TerritoryId,
  mode: TargetMode,
  actions: PanelActions,
): HTMLElement {
  const order = draft.orderFrom(id);
  const neighbours = draft.neighbours(id);

  return h(
    'div',
    { class: 'order-builder' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'row-label' }, 'Order'),
      h('span', {}, order ? draft.describe(order) : 'none yet'),
      order
        ? h(
            'button',
            { class: 'link', type: 'button', onclick: () => actions.onClearOrder(id) },
            'remove',
          )
        : null,
    ),
    h(
      'div',
      { class: 'modes' },
      h(
        'button',
        {
          type: 'button',
          class: mode === 'move' ? 'mode is-chosen' : 'mode',
          onclick: () => actions.onMode('move'),
        },
        'Move',
      ),
      h(
        'button',
        {
          type: 'button',
          class: mode === 'support' ? 'mode is-chosen' : 'mode',
          onclick: () => actions.onMode('support'),
        },
        'Support',
      ),
      h('button', { type: 'button', class: 'mode', onclick: () => actions.onHold(id) }, 'Hold'),
    ),
    h(
      'div',
      { class: 'targets' },
      neighbours.map((target) => {
        const state = view.state as GameState;
        const owner = state.owner[target];
        const legal = mode === 'move' ? draft.canMove(id, target) : draft.canSupport(id, target);
        return h(
          'button',
          {
            type: 'button',
            class: 'target',
            disabled: !legal,
            onclick: () => actions.onTarget(target),
          },
          swatch(owner),
          draft.name(target),
          h(
            'span',
            { class: 'target-armies' },
            state.armies[target] === HIDDEN ? '?' : String(state.armies[target]),
          ),
        );
      }),
    ),
  );
}

function moveCountRow(
  draft: OrderDraft,
  from: TerritoryId,
  count: number,
  actions: PanelActions,
): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'row-label' }, 'Armies'),
    h(
      'div',
      { class: 'stepper' },
      h(
        'button',
        { type: 'button', disabled: count <= 1, onclick: () => actions.onMoveCount(from, -1) },
        '−',
      ),
      h('span', { class: 'stepper-value' }, String(count)),
      h(
        'button',
        {
          type: 'button',
          disabled: count >= draft.maxMove(from),
          onclick: () => actions.onMoveCount(from, 1),
        },
        '+',
      ),
    ),
    h('span', { class: 'hint' }, `of ${draft.maxMove(from)} standing there`),
  );
}

function supportForRow(
  view: GameView,
  draft: OrderDraft,
  from: TerritoryId,
  target: TerritoryId,
  forPlayer: Slot,
  actions: PanelActions,
): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'row-label' }, 'Fighting for'),
    h(
      'div',
      { class: 'support-for' },
      draft.supportCandidates(target).map((slot) =>
        h(
          'button',
          {
            type: 'button',
            class: slot === forPlayer ? 'chip is-chosen' : 'chip',
            onclick: () => actions.onSupportFor(from, slot),
          },
          swatch(slot),
          slot === draft.slot ? 'you' : nameOf(view, slot),
        ),
      ),
    ),
  );
}

// ─── The order sheet ─────────────────────────────────────────────────────────

export function ordersPanel(view: GameView, draft: OrderDraft, actions: PanelActions): HTMLElement {
  const units = [...draft.orders.units].sort((a, b) => a.from - b.from);
  const deploys = [...draft.orders.deploys].sort((a, b) => a.to - b.to);
  const nothing = units.length === 0 && deploys.length === 0 && draft.pledge === null;

  return h(
    'section',
    { class: 'panel' },
    h(
      'h2',
      {},
      'This turn',
      nothing
        ? null
        : h(
            'button',
            { class: 'link', type: 'button', onclick: () => actions.onClearAll() },
            'clear all',
          ),
    ),
    h(
      'ul',
      { class: 'order-sheet' },
      draft.pledge !== null
        ? h('li', {}, swatch(draft.pledge), `Pledge to ${nameOf(view, draft.pledge)}`)
        : null,
      deploys.map((deploy) =>
        h(
          'li',
          { onclick: () => actions.onSelect(deploy.to) },
          `Reinforce ${draft.name(deploy.to)} ×${deploy.count}`,
        ),
      ),
      units.map((unit) =>
        h('li', { onclick: () => actions.onSelect(unit.from) }, draft.describe(unit)),
      ),
      nothing ? h('li', { class: 'hint' }, 'Nothing ordered yet.') : null,
    ),
    draft.remaining() > 0
      ? h('p', { class: 'is-warning' }, `${draft.remaining()} reinforcements still unplaced.`)
      : null,
    h(
      'div',
      { class: 'actions' },
      view.locked
        ? h(
            'button',
            { type: 'button', class: 'secondary', onclick: () => actions.onUnlock() },
            'Withdraw',
          )
        : h(
            'button',
            { type: 'button', class: 'primary', onclick: () => actions.onLock() },
            'Lock in orders',
          ),
      h('button', { type: 'button', class: 'danger', onclick: () => actions.onResign() }, 'Resign'),
    ),
    view.locked
      ? h(
          'p',
          { class: 'hint' },
          'Locked in. The turn resolves when everyone has, or when the clock runs out.',
        )
      : null,
  );
}

// ─── The turn report ─────────────────────────────────────────────────────────

export function reportPanel(view: GameView, map: GeneratedMap): HTMLElement | null {
  const report = view.report;
  if (!report) return null;

  return h(
    'section',
    { class: 'panel report' },
    h('h2', {}, `Turn ${report.turn}`),
    h('p', { class: 'headline' }, report.headline),
    pactList(view, report),
    battleList(view, report, map),
    worldList(view, report, map),
    report.quietMoves > 0
      ? h(
          'p',
          { class: 'hint' },
          `${report.quietMoves} unopposed ${report.quietMoves === 1 ? 'move' : 'moves'}.`,
        )
      : null,
  );
}

const PACT_WORDS: Record<PactResult['outcome'], (a: string, b: string) => string> = {
  concord: (a, b) => `${a} and ${b} kept faith.`,
  betrayal: (a, b) => `${a} betrayed ${b}.`,
  betrayed: (a, b) => `${a} was betrayed by ${b}.`,
  mutual_treachery: (a, b) => `${a} and ${b} stabbed each other.`,
  spurned: (a, b) => `${a} pledged ${b}, who had other plans.`,
  courted: (a, b) => `${a} was courted by ${b}.`,
  abstain: (a) => `${a} pledged nobody.`,
};

/**
 * Every pact outcome is reported from both seats, but most of them describe one
 * shared event: a concord, a stab. Printing both halves would double the list
 * and bury the betrayals, so each pairing is named once, from the side that did
 * the interesting thing.
 */
function pactList(view: GameView, report: TurnReport): HTMLElement | null {
  const lines: HTMLElement[] = [];

  for (const pact of report.pacts) {
    if (pact.outcome === 'abstain') continue;

    // The betrayer's line already names the victim.
    if (pact.outcome === 'betrayed') continue;

    // Mutual outcomes read identically from either seat; keep the lower one.
    if (
      (pact.outcome === 'concord' || pact.outcome === 'mutual_treachery') &&
      pact.partner !== null &&
      pact.partner < pact.slot
    ) {
      continue;
    }

    const other = counterpart(report, pact);
    lines.push(
      h(
        'li',
        { class: `pact is-${pact.outcome}` },
        PACT_WORDS[pact.outcome](nameOf(view, pact.slot), nameOf(view, other)),
        h('span', { class: 'multiplier' }, `×${(pact.multiplier / 100).toFixed(2)}`),
      ),
    );
  }

  return lines.length === 0 ? null : h('ul', { class: 'report-list' }, lines);
}

/** Who the other half of this outcome was. */
function counterpart(report: TurnReport, pact: PactResult): Slot | null {
  // Being courted is the one outcome whose counterpart is not on your own
  // record: the suitor is whoever pledged you and got nothing back.
  if (pact.outcome === 'courted') {
    return report.pacts.find((other) => other.pledged === pact.slot)?.slot ?? null;
  }
  return pact.partner ?? pact.pledged;
}

function battleList(view: GameView, report: TurnReport, map: GeneratedMap): HTMLElement | null {
  if (report.battles.length === 0 && report.clashes.length === 0) return null;
  const place = (id: TerritoryId): string => map.territories[id]?.name ?? `#${id}`;

  const battles = [...report.battles]
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 12)
    .map((battle) => h('li', { class: 'battle' }, battleLine(view, battle, place)));

  const clashes = report.clashes.map((clash) =>
    h(
      'li',
      { class: 'battle' },
      `${nameOf(view, clash.slotA)} and ${nameOf(view, clash.slotB)} collided between ` +
        `${place(clash.a)} and ${place(clash.b)} — ${nameOf(view, clash.winner)} came through.`,
    ),
  );

  return h('ul', { class: 'report-list' }, clashes, battles);
}

function battleLine(
  view: GameView,
  battle: BattleReport,
  place: (id: TerritoryId) => string,
): string {
  const where = place(battle.territory);
  const winner = battle.winner === null ? 'nobody' : nameOf(view, battle.winner);
  const sides = battle.sides
    .map(
      (side) => `${side.slot === null ? 'the garrison' : nameOf(view, side.slot)} ${side.armies}`,
    )
    .join(' vs ');

  if (battle.captured) {
    const from =
      battle.previousOwner === null ? 'the unclaimed' : nameOf(view, battle.previousOwner);
    return `${winner} took ${where} from ${from} (${sides}), losing ${battle.casualties}.`;
  }
  return `${where} held (${sides}); ${winner} lost ${battle.casualties}.`;
}

function worldList(view: GameView, report: TurnReport, map: GeneratedMap): HTMLElement | null {
  const place = (id: TerritoryId): string => map.territories[id]?.name ?? `#${id}`;
  const lines = report.world
    .map((event) => worldLine(view, event, place))
    .filter((line): line is string => line !== null);

  if (lines.length === 0) return null;
  return h(
    'ul',
    { class: 'report-list world' },
    lines.map((line) => h('li', {}, line)),
  );
}

function worldLine(
  view: GameView,
  event: WorldEvent,
  place: (id: TerritoryId) => string,
): string | null {
  switch (event.kind) {
    case 'storm':
      return `The storm took ${event.territories.length} territories and ${event.armiesLost} armies with them.`;
    case 'storm_warning':
      return `The storm closes on ${event.territories.map(place).join(', ')}.`;
    case 'global_event':
      return view.eventDescriptions[event.id] ?? event.id;
    case 'event_announced':
      return `Next turn: ${view.eventDescriptions[event.id] ?? event.id}`;
    case 'eliminated':
      return `${nameOf(view, event.slot)} is out of the war.`;
    case 'capital_fell':
      return event.to === null
        ? `${nameOf(view, event.slot)} lost their capital at ${place(event.from)}.`
        : `${nameOf(view, event.slot)} fell back from ${place(event.from)} to ${place(event.to)}.`;
    case 'routed':
      return `${nameOf(view, event.slot)} was routed at ${place(event.at)}, losing ${event.lost}.`;
    case 'order_rejected':
      // Only ever shown to the player whose order it was; nobody else needs to
      // see the mistakes at the other end of the table.
      return view.you?.slot === event.slot ? `Order refused: ${event.reason}` : null;
    case 'game_over':
      return null;
    default:
      return null;
  }
}

// ─── Endgame ─────────────────────────────────────────────────────────────────

const VICTORY_WORDS: Record<string, string> = {
  conquest: 'Conquest',
  domination: 'Domination',
  hegemony: 'Hegemony',
  decapitation: 'Decapitation',
  condominium: 'Condominium',
  concordat: 'Concordat',
  turn_cap: 'Time ran out',
};

export function resultPanel(view: GameView): HTMLElement | null {
  const result = view.result;
  if (!result) return null;

  const winners = result.winners.map((slot) => nameOf(view, slot));
  const youWon = view.you !== null && result.winners.includes(view.you.slot);

  return h(
    'section',
    { class: youWon ? 'panel result is-victory' : 'panel result' },
    h('h2', {}, VICTORY_WORDS[result.kind] ?? result.kind),
    h(
      'p',
      { class: 'headline' },
      winners.length === 0
        ? 'Nobody closed it out.'
        : `${listNames(winners)} ${winners.length > 1 ? 'share the world' : 'takes the world'}.`,
    ),
    result.detail ? h('p', {}, result.detail) : null,
    h(
      'ol',
      { class: 'standings' },
      result.standings.map((slot, rank) =>
        h('li', {}, h('span', { class: 'rank' }, `${rank + 1}`), swatch(slot), nameOf(view, slot)),
      ),
    ),
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
