// 端到端加密（WebCrypto）：ECDH P-256 + PBKDF2 + AES-256-GCM
// 注意：crypto.subtle 需要安全上下文（HTTPS 或 localhost）

const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

function hasCrypto() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export function randomSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function importPassword(password) {
  return crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
}

// 用密码 + 盐派生密钥加密密钥（KEK）
export async function deriveKek(password, saltBytes) {
  const baseKey = await importPassword(password);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateKeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

export async function exportPublicKey(publicKey) {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(jwk);
}

export async function importPublicKey(jwkJson) {
  const jwk = JSON.parse(jwkJson);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function aesGcmEncrypt(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return bufToB64(combined.buffer);
}

async function aesGcmDecrypt(key, b64) {
  try {
    const combined = new Uint8Array(b64ToBuf(b64));
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return decoder.decode(pt);
  } catch {
    return null;
  }
}

// 用 KEK 加密私钥（私钥导出为 JWK JSON）
export async function wrapPrivateKey(privateKey, kek) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  return aesGcmEncrypt(kek, encoder.encode(JSON.stringify(jwk)));
}

export async function unwrapPrivateKey(encryptedB64, kek) {
  const json = await aesGcmDecrypt(kek, encryptedB64);
  if (!json) return null;
  const jwk = JSON.parse(json);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

// ECDH 共享密钥 → 消息密钥（AES-GCM key）
export async function deriveMessageKey(myPrivateKey, peerPublicKey) {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, myPrivateKey, 256);
  const hash = await crypto.subtle.digest('SHA-256', bits);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptMessage(plainText, messageKey) {
  return aesGcmEncrypt(messageKey, encoder.encode(plainText));
}

export async function decryptMessage(b64, messageKey) {
  return aesGcmDecrypt(messageKey, b64);
}

export { hasCrypto, bufToB64, b64ToBuf };
