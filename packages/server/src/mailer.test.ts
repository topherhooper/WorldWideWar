import { describe, expect, it } from 'vitest';

import { LogMailer } from './mailer.js';

describe('LogMailer', () => {
  it('records sent mail', async () => {
    const m = new LogMailer();
    await m.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(m.sent).toEqual([{ to: 'a@b.c', subject: 's', text: 't' }]);
  });
});
