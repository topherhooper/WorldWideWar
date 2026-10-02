// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const createPoll = vi.fn();
const pastMembers = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    createPoll: (...a: unknown[]) => createPoll(...a),
    pastMembers: () => pastMembers(),
  },
  ApiError: class ApiError extends Error {},
}));

const { NewPoll } = await import('./NewPoll.js');

const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const set = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillRow(n: number, days: number, start = '19:00', end = '23:00') {
  set(`Date ${n}`, dateIn(days));
  set(`Start ${n}`, start);
  set(`End ${n}`, end);
}

const submit = () => screen.getByRole('button', { name: 'Create poll' });

describe('NewPoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pastMembers.mockResolvedValue([]);
    createPoll.mockResolvedValue({ id: 'p9' });
  });
  afterEach(cleanup);

  const renderForm = () =>
    render(
      <MemoryRouter>
        <NewPoll />
      </MemoryRouter>,
    );

  it('blocks submit with only one time filled in', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value: 'Games' } });
    fillRow(1, 2);
    await act(async () => submit().click());
    expect(createPoll).not.toHaveBeenCalled();
    expect(screen.getByText(/fill in a date/i)).toBeTruthy();
  });

  it('blocks submit with a time in the past', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value: 'Games' } });
    fillRow(1, -1);
    fillRow(2, 2);
    await act(async () => submit().click());
    expect(createPoll).not.toHaveBeenCalled();
    expect(screen.getByText(/in the future/i)).toBeTruthy();
  });

  it('sends the poll with ISO instants, sorted, and nothing about people when none are picked', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value: ' Games ' } });
    fillRow(1, 3);
    fillRow(2, 2);
    await act(async () => submit().click());
    expect(createPoll).toHaveBeenCalledTimes(1);
    const req = createPoll.mock.calls[0][0] as {
      title: string;
      candidates: { startsAt: string; endsAt: string }[];
      deadlineAt: string | null;
      addUids?: string[];
    };
    expect(req.title).toBe('Games');
    expect(req.candidates).toHaveLength(2);
    expect(req.candidates[0].startsAt < req.candidates[1].startsAt).toBe(true);
    expect(req.candidates[0].startsAt).toMatch(/Z$/);
    expect(req.deadlineAt).toBeNull();
    expect(req.addUids).toBeUndefined();
  });

  it('treats an end before the start as the next day', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value: 'Late' } });
    fillRow(1, 2, '21:00', '01:00');
    fillRow(2, 3, '21:00', '01:00');
    await act(async () => submit().click());
    const { candidates } = createPoll.mock.calls[0][0] as {
      candidates: { startsAt: string; endsAt: string }[];
    };
    for (const c of candidates) {
      expect(new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()).toBe(4 * 3_600_000);
    }
  });

  it('adds a row that copies the previous times, up to six, and removes one', () => {
    renderForm();
    fillRow(2, 2, '18:30', '22:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    expect((screen.getByLabelText('Start 3') as HTMLInputElement).value).toBe('18:30');
    expect((screen.getByLabelText('Date 3') as HTMLInputElement).value).toBe('');
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    expect(screen.queryByRole('button', { name: 'Add a time' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove time 6' }));
    expect(screen.getByRole('button', { name: 'Add a time' })).toBeTruthy();
  });

  it('offers people from past polls only when there are some, and sends the ticked ones', async () => {
    pastMembers.mockResolvedValue([{ uid: 'u-bob', name: 'Bob' }]);
    renderForm();
    fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value: 'Games' } });
    fillRow(1, 2);
    fillRow(2, 3);
    fireEvent.click(await screen.findByLabelText('Bob'));
    await act(async () => submit().click());
    await waitFor(() => expect(createPoll).toHaveBeenCalled());
    expect((createPoll.mock.calls[0][0] as { addUids: string[] }).addUids).toEqual(['u-bob']);
  });

  it('hides the people list when there is nobody to add', async () => {
    renderForm();
    await waitFor(() => expect(pastMembers).toHaveBeenCalled());
    expect(screen.queryByText(/past polls/i)).toBeNull();
  });
});
