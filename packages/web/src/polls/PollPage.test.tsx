// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { PollView } from '@www/server/api-types';

const answerPoll = vi.fn();
const lockPoll = vi.fn();
const getPoll = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    answerPoll: (...a: unknown[]) => answerPoll(...a),
    lockPoll: (...a: unknown[]) => lockPoll(...a),
    getPoll: (...a: unknown[]) => getPoll(...a),
    cancelPoll: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { PollPage } = await import('./PollPage.js');

const future = (days: number) => ({
  startsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + days * 86_400_000 + 3 * 3_600_000).toISOString(),
});

const poll = (over: Partial<PollView> = {}): PollView => ({
  id: 'p1',
  title: 'Board games',
  organizerUid: 'u-alice',
  organizerName: 'Alice',
  status: 'open',
  candidates: [
    { id: 'c1', ...future(2) },
    { id: 'c2', ...future(3) },
    { id: 'c3', ...future(4) },
  ],
  deadlineAt: null,
  lockedCandidateId: null,
  window: null,
  offered: [],
  me: 'u-bob',
  members: [
    {
      uid: 'u-alice',
      name: 'Alice',
      answeredAt: '2026-10-01T10:00:00Z',
      answers: { c1: 'yes', c2: 'no', c3: 'yes' },
    },
    { uid: 'u-bob', name: 'Bob', answeredAt: null, answers: {} },
    { uid: 'u-carol', name: 'Carol', answeredAt: null, answers: {} },
  ],
  ...over,
});

const renderPage = (view: PollView) =>
  render(
    <MemoryRouter>
      <PollPage initial={view} />
    </MemoryRouter>,
  );

const confirmButton = () => screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
const yesButtons = () => screen.getAllByRole('button', { name: 'Yes' });
const noButtons = () => screen.getAllByRole('button', { name: 'No' });

describe('PollPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPoll.mockResolvedValue(poll());
  });
  afterEach(cleanup);

  it('keeps Confirm disabled until every row is set', () => {
    renderPage(poll());
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(yesButtons()[0]);
    fireEvent.click(noButtons()[1]);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(yesButtons()[2]);
    expect(confirmButton().disabled).toBe(false);
  });

  it('sends exactly one answer per candidate', async () => {
    answerPoll.mockResolvedValue(poll());
    renderPage(poll());
    fireEvent.click(yesButtons()[0]);
    fireEvent.click(noButtons()[1]);
    fireEvent.click(yesButtons()[2]);
    await act(async () => {
      confirmButton().click();
    });
    expect(answerPoll).toHaveBeenCalledTimes(1);
    expect(answerPoll).toHaveBeenCalledWith('p1', { answers: { c1: 'yes', c2: 'no', c3: 'yes' } });
  });

  it('shows "You\'re in" once confirmed, with a way back to editing', async () => {
    answerPoll.mockResolvedValue(
      poll({
        members: [
          {
            uid: 'u-alice',
            name: 'Alice',
            answeredAt: '2026-10-01T10:00:00Z',
            answers: { c1: 'yes', c2: 'no', c3: 'yes' },
          },
          {
            uid: 'u-bob',
            name: 'Bob',
            answeredAt: '2026-10-01T11:00:00Z',
            answers: { c1: 'yes', c2: 'yes', c3: 'yes' },
          },
          { uid: 'u-carol', name: 'Carol', answeredAt: null, answers: {} },
        ],
      }),
    );
    renderPage(poll());
    yesButtons().forEach((b) => fireEvent.click(b));
    await act(async () => {
      confirmButton().click();
    });
    expect(await screen.findByText(/you.re in/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /change answer/i }));
    expect(confirmButton()).toBeTruthy();
  });

  it('names exactly the members who have not answered', () => {
    renderPage(poll());
    const waiting = screen.getByRole('heading', { name: 'Waiting on' })
      .parentElement as HTMLElement;
    expect(within(waiting).getByText('Bob, Carol')).toBeTruthy();
    expect(within(waiting).queryByText(/Alice/)).toBeNull();
  });

  it('shows who said yes and who said no for each time', () => {
    renderPage(poll({ me: 'u-alice' }));
    expect(screen.getAllByText(/1 yes/)).toHaveLength(2);
    expect(screen.getByText('No: Alice')).toBeTruthy();
  });

  describe('organizer controls', () => {
    it('shows Lock and Cancel to the organizer while open', () => {
      renderPage(poll({ me: 'u-alice' }));
      expect(screen.getAllByRole('button', { name: 'Lock this time' })).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Cancel poll' })).toBeTruthy();
    });

    it('hides them from everyone else', () => {
      renderPage(poll({ me: 'u-bob' }));
      expect(screen.queryByRole('button', { name: 'Lock this time' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel poll' })).toBeNull();
    });

    it('hides them once the poll is locked, and marks the locked time', () => {
      renderPage(poll({ me: 'u-alice', status: 'locked', lockedCandidateId: 'c2' }));
      expect(screen.queryByRole('button', { name: 'Lock this time' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel poll' })).toBeNull();
      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    });

    it('locks the chosen time after a confirm dialog', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      lockPoll.mockResolvedValue(
        poll({ me: 'u-alice', status: 'locked', lockedCandidateId: 'c2' }),
      );
      renderPage(poll({ me: 'u-alice' }));
      await act(async () => {
        screen.getAllByRole('button', { name: 'Lock this time' })[1].click();
      });
      expect(lockPoll).toHaveBeenCalledWith('p1', { candidateId: 'c2' });
      await waitFor(() => expect(screen.getAllByText('Locked')).toHaveLength(1));
    });

    it('does not lock when the dialog is dismissed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      renderPage(poll({ me: 'u-alice' }));
      await act(async () => {
        screen.getAllByRole('button', { name: 'Lock this time' })[0].click();
      });
      expect(lockPoll).not.toHaveBeenCalled();
    });
  });
});
