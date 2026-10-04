// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const createPoll = vi.fn();
const pastMembers = vi.fn();
const readBusy = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    createPoll: (...a: unknown[]) => createPoll(...a),
    pastMembers: () => pastMembers(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('./calendar.js', () => ({ readBusy: (...a: unknown[]) => readBusy(...a) }));

const { NewPoll } = await import('./NewPoll.js');
const { detectedZone, zonedHour } = await import('./grid.js');

const HOUR = 3_600_000;
const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Local hour start `days` from today. */
const at = (days: number, hour: number): number => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour).getTime();
};

const cells = () => [...document.querySelectorAll<HTMLButtonElement>('.hour-grid button')];
const pressed = () => cells().filter((b) => b.getAttribute('aria-pressed') === 'true');
const submit = () => screen.getByRole('button', { name: 'Create poll' });
const name = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(/board games/i), { target: { value } });
/** Start tomorrow so no cell is in the past whatever the clock says. */
const fromTomorrow = () =>
  fireEvent.change(screen.getByLabelText('From'), { target: { value: dateIn(1) } });

interface Sent {
  title: string;
  window: { firstDay: string; days: number; fromHour: number; toHour: number; timeZone: string };
  offered: string[];
  deadlineAt: string | null;
  addUids?: string[];
}
const sent = (): Sent => createPoll.mock.calls[0][0] as Sent;

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

  it('shows 14 days of 18:00–23:00 with no date or time fields to type into', () => {
    renderForm();
    fromTomorrow();
    expect(cells()).toHaveLength(14 * 5);
    expect(pressed()).toHaveLength(14 * 5);
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);
  });

  it('sends the window and every offered hour, sorted, in ISO', async () => {
    renderForm();
    fromTomorrow();
    name(' Games ');
    await act(async () => submit().click());
    const req = sent();
    expect(req.title).toBe('Games');
    expect(req.window).toMatchObject({ firstDay: dateIn(1), days: 14, fromHour: 18, toHour: 23 });
    expect(req.window.timeZone).toBeTruthy();
    expect(req.offered).toHaveLength(70);
    expect(req.offered[0]).toBe(new Date(at(1, 18)).toISOString());
    expect([...req.offered].sort()).toEqual(req.offered);
    expect(req.deadlineAt).toBeNull();
    expect(req.addUids).toBeUndefined();
  });

  it('fills the grid from the calendar, leaving busy hours off, and says how many', async () => {
    // Busy 19:30–21:00 tomorrow: the 19:00 and 20:00 cells are busy, 21:00 is free.
    readBusy.mockResolvedValue([
      {
        start: new Date(at(1, 19) + HOUR / 2).toISOString(),
        end: new Date(at(1, 21)).toISOString(),
      },
    ]);
    renderForm();
    fromTomorrow();
    await act(async () => screen.getByRole('button', { name: 'Use my calendar' }).click());
    expect(readBusy).toHaveBeenCalledWith(at(1, 18), at(14, 22) + HOUR);
    expect(pressed()).toHaveLength(68);
    expect(screen.getByText(/2 busy hours left off/)).toBeTruthy();
    name('Games');
    await act(async () => submit().click());
    const offered = sent().offered;
    expect(offered).not.toContain(new Date(at(1, 19)).toISOString());
    expect(offered).not.toContain(new Date(at(1, 20)).toISOString());
    expect(offered).toContain(new Date(at(1, 21)).toISOString());
  });

  it('lets any hour be changed after the calendar fills the grid', async () => {
    readBusy.mockResolvedValue([
      { start: new Date(at(1, 18)).toISOString(), end: new Date(at(1, 19)).toISOString() },
    ]);
    renderForm();
    fromTomorrow();
    await act(async () => screen.getByRole('button', { name: 'Use my calendar' }).click());
    const first = cells()[0];
    expect(first.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(first); // free after all
    fireEvent.click(cells()[1]); // busy after all
    name('Games');
    await act(async () => submit().click());
    const offered = sent().offered;
    expect(offered).toContain(new Date(at(1, 18)).toISOString());
    expect(offered).not.toContain(new Date(at(1, 19)).toISOString());
  });

  it('says so when the calendar cannot be read, and keeps the grid', async () => {
    readBusy.mockRejectedValue(new Error('Google Calendar answered 403.'));
    renderForm();
    fromTomorrow();
    await act(async () => screen.getByRole('button', { name: 'Use my calendar' }).click());
    expect(screen.getByText('Google Calendar answered 403.')).toBeTruthy();
    expect(pressed()).toHaveLength(70);
  });

  it('redraws the grid for a different window', () => {
    renderForm();
    fromTomorrow();
    fireEvent.change(screen.getByLabelText('for'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('between'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('and'), { target: { value: '14' } });
    expect(cells()).toHaveLength(7 * 2);
  });

  it('blocks submit with no title, or with every hour cleared', async () => {
    renderForm();
    fromTomorrow();
    await act(async () => submit().click());
    expect(screen.getByText(/give the poll a title/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('for'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('and'), { target: { value: '19' } });
    for (const b of cells()) fireEvent.click(b);
    name('Games');
    await act(async () => submit().click());
    expect(screen.getByText(/at least one hour/i)).toBeTruthy();
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('offers people from past polls only when there are some, and sends the ticked ones', async () => {
    pastMembers.mockResolvedValue([{ uid: 'u-bob', name: 'Bob' }]);
    renderForm();
    fromTomorrow();
    name('Games');
    fireEvent.click(await screen.findByLabelText('Bob'));
    await act(async () => submit().click());
    await waitFor(() => expect(createPoll).toHaveBeenCalled());
    expect(sent().addUids).toEqual(['u-bob']);
  });

  it('hides the people list when there is nobody to add', async () => {
    renderForm();
    await waitFor(() => expect(pastMembers).toHaveBeenCalled());
    expect(screen.queryByText(/past polls/i)).toBeNull();
  });

  it('detects the time zone, shows it, and builds the grid in another one when picked', async () => {
    renderForm();
    fromTomorrow();
    const picker = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(picker.value).toBe(detectedZone());
    expect(picker.selectedOptions[0].textContent).toMatch(/\(detected\)/);
    const other = detectedZone() === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo';
    fireEvent.change(picker, { target: { value: other } });
    name('Games');
    await act(async () => submit().click());
    const [y, m, d] = dateIn(1).split('-').map(Number);
    expect(sent().window.timeZone).toBe(other);
    expect(sent().offered[0]).toBe(new Date(zonedHour(y, m, d, 18, other)).toISOString());
  });
});
