// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  generateKeyPair, exportPublicKey, importPublicKey,
  deriveKek, wrapPrivateKey, unwrapPrivateKey,
  deriveMessageKey, encryptMessage, decryptMessage, randomSalt
} from './e2ee.js';

describe('E2EE crypto', () => {
  it('生成密钥对并能导出/导入公钥', async () => {
    const pair = await generateKeyPair();
    const jwk = await exportPublicKey(pair.publicKey);
    const imported = await importPublicKey(jwk);
    expect(imported).toBeTruthy();
  });

  it('KEK 派生 + 私钥加密/解密往返', async () => {
    const pair = await generateKeyPair();
    const salt = randomSalt();
    const kek = await deriveKek('password123', salt);
    const wrapped = await wrapPrivateKey(pair.privateKey, kek);
    const unwrapped = await unwrapPrivateKey(wrapped, kek);
    expect(unwrapped).toBeTruthy();
    const jwk = await crypto.subtle.exportKey('jwk', unwrapped);
    expect(jwk).toBeTruthy();
  });

  it('ECDH 共享密钥对称，消息加密/解密往返', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const keyAB = await deriveMessageKey(a.privateKey, b.publicKey);
    const keyBA = await deriveMessageKey(b.privateKey, a.publicKey);
    const msg = '你好，这是端到端加密消息';
    const ct = await encryptMessage(msg, keyAB);
    const pt = await decryptMessage(ct, keyBA);
    expect(pt).toBe(msg);
  });

  it('错误密码无法解开私钥', async () => {
    const pair = await generateKeyPair();
    const salt = randomSalt();
    const kek = await deriveKek('correct-password', salt);
    const wrapped = await wrapPrivateKey(pair.privateKey, kek);
    const wrongKek = await deriveKek('wrong-password', salt);
    const unwrapped = await unwrapPrivateKey(wrapped, wrongKek);
    expect(unwrapped).toBeNull();
  });
});
