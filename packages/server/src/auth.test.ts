import { describe, expect, it } from 'vitest';

import { emulatorDb, emulatorToken } from './testing.js';
import { realVerifiers } from './auth.js';

describe.skipIf(!process.env.FIREBASE_AUTH_EMULATOR_HOST)('auth verifiers', () => {
  emulatorDb(); // ensures the admin app is initialized
  const verifiers = realVerifiers({
    tickAudience: 'https://example.test',
    tickServiceAccount: 'tick@example.iam.gserviceaccount.com',
  });

  it('verifies an emulator-issued user token', async () => {
    const token = await emulatorToken('carol@test.dev', 'Carol');
    const user = await verifiers.verifyUser(`Bearer ${token}`);
    expect(user.email).toBe('carol@test.dev');
    expect(user.name).toBe('Carol');
    expect(user.uid).toBeTruthy();
  });

  it('rejects a missing authorization header', async () => {
    await expect(verifiers.verifyUser(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a garbage token', async () => {
    await expect(verifiers.verifyUser('Bearer garbage')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a garbage tick token', async () => {
    await expect(verifiers.verifyTick('Bearer garbage')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(verifiers.verifyTick(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });
});
