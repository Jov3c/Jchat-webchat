import { describe, it, expect } from 'vitest';
import { generateKeyPair, generateRecoveryCode, wrapPrivateKeyWithRecovery, unwrapPrivateKeyWithRecovery } from './e2ee.js';

describe('recovery code', () => {
  it('generates a 20-char code from the safe alphabet', () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(20);
    expect(code).toMatch(/^[A-Z2-9]{20}$/);
  });

  it('wrap/unwrap roundtrip recovers the same private key', async () => {
    const pair = await generateKeyPair();
    const code = generateRecoveryCode();
    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, code);
    const recovered = await unwrapPrivateKeyWithRecovery(blob, code);
    expect(recovered).not.toBeNull();
    const origJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const recoveredJwk = await crypto.subtle.exportKey('jwk', recovered);
    expect(recoveredJwk.d).toBe(origJwk.d);
  });

  it('returns null for a wrong code', async () => {
    const pair = await generateKeyPair();
    const blob = await wrapPrivateKeyWithRecovery(pair.privateKey, generateRecoveryCode());
    const recovered = await unwrapPrivateKeyWithRecovery(blob, generateRecoveryCode());
    expect(recovered).toBeNull();
  });
});
