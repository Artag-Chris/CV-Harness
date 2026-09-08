import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/common/hash.util';

describe('fingerprint', () => {
  it('es estable para la misma url', () => {
    expect(fingerprint('http://x/a')).toBe(fingerprint(' http://x/a '));
  });

  it('difiere entre urls distintas', () => {
    expect(fingerprint('http://x/a')).not.toBe(fingerprint('http://x/b'));
  });

  it('es sha256 hex de 64 chars', () => {
    expect(fingerprint('http://x/a')).toMatch(/^[a-f0-9]{64}$/);
  });
});
