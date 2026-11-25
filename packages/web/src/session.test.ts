import { describe, expect, it } from 'vitest';

import { safeReturnUrl } from './session.js';

describe('safeReturnUrl', () => {
  it('allows https pages on topherhooper.com and its subdomains', () => {
    expect(safeReturnUrl('https://topherhooper.com/')).toBe('https://topherhooper.com/');
    expect(safeReturnUrl('https://garden.topherhooper.com/x?y=1')).toBe(
      'https://garden.topherhooper.com/x?y=1',
    );
  });

  it('refuses anything that would make /signin an open redirect', () => {
    expect(safeReturnUrl('https://evil.example/')).toBeNull();
    expect(safeReturnUrl('https://topherhooper.com.evil.example/')).toBeNull();
    expect(safeReturnUrl('https://eviltopherhooper.com/')).toBeNull();
    expect(safeReturnUrl('http://topherhooper.com/')).toBeNull();
    expect(safeReturnUrl('javascript:alert(1)')).toBeNull();
    expect(safeReturnUrl('/relative')).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
  });
});
