import { reactive } from 'vue';
import { http } from '../api/http.js';
import {
  deriveKek, generateKeyPair, exportPublicKey, wrapPrivateKey, unwrapPrivateKey,
  deriveMessageKey, importPublicKey, bufToB64, b64ToBuf, randomSalt, hasCrypto
} from './e2ee.js';

// 当前用户端到端加密密钥状态
const state = reactive({
  ready: false,         // 密钥是否就绪
  myPublicKeyJwk: null, // 我的公钥（JWK JSON 字符串）
  myPrivateKey: null,   // 我的私钥（CryptoKey）
  kek: null,            // 密钥加密密钥（CryptoKey）
  messageKeys: {}       // 缓存：peerId → messageKey
});

export function useKeys() { return state; }

export function clearKeys() {
  state.ready = false;
  state.myPublicKeyJwk = null;
  state.myPrivateKey = null;
  state.kek = null;
  state.messageKeys = {};
}

// 登录/注册后初始化密钥：有 salt/加密私钥则恢复，否则生成新密钥并上传
export async function setupKeys(password, serverKeys) {
  if (!hasCrypto()) {
    state.ready = false;
    return { ready: false, error: '浏览器不支持端到端加密（需要 HTTPS 或 localhost 访问）' };
  }
  if (serverKeys?.salt && serverKeys?.encrypted_private_key && serverKeys?.public_key) {
    try {
      const salt = new Uint8Array(b64ToBuf(serverKeys.salt));
      const kek = await deriveKek(password, salt);
      const privateKey = await unwrapPrivateKey(serverKeys.encrypted_private_key, kek);
      if (privateKey) {
        state.myPublicKeyJwk = serverKeys.public_key;
        state.myPrivateKey = privateKey;
        state.kek = kek;
        state.ready = true;
        return { ready: true };
      }
    } catch { /* 解密失败则走生成流程 */ }
  }
  // 首登：生成密钥对并上传加密私钥
  const keyPair = await generateKeyPair();
  const salt = randomSalt();
  const kek = await deriveKek(password, salt);
  const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
  const encryptedPrivateKey = await wrapPrivateKey(keyPair.privateKey, kek);
  state.myPublicKeyJwk = publicKeyJwk;
  state.myPrivateKey = keyPair.privateKey;
  state.kek = kek;
  state.ready = true;
  const upload = { salt: bufToB64(salt.buffer), public_key: publicKeyJwk, encrypted_private_key: encryptedPrivateKey };
  http.put('/api/profile/keys', upload).catch(() => {});
  return { ready: true };
}

// 获取（或派生并缓存）与某个对端的消息密钥
export async function getOrDeriveMessageKey(peerId, peerPublicKeyJwk) {
  if (state.messageKeys[peerId]) return state.messageKeys[peerId];
  const peerPublicKey = await importPublicKey(peerPublicKeyJwk);
  const key = await deriveMessageKey(state.myPrivateKey, peerPublicKey);
  state.messageKeys[peerId] = key;
  return key;
}
