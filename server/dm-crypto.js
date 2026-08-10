/**
 * 私聊内容存储加密：使用 AES-256-GCM 对落库的 content 加密，保护隐私。
 * 密钥通过环境变量 DM_ENCRYPTION_KEY 配置：64 位 hex，或至少 32 UTF-8 字节的高强度字符串。
 * 旧版未加密文本和无法用当前密钥解密的 enc: 记录原样返回；轮换密钥前必须迁移或备份旧密钥。
 */
const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PREFIX = 'enc:';
const DEVELOPMENT_FALLBACK = 'jchat-development-dm-key-not-for-production';
// Read-only migration support for records created before the Jchat fallback rename.
const LEGACY_DEVELOPMENT_FALLBACK = 'nexichat-dm-default-dev-key';
const canReadLegacyDevelopmentCiphertext = process.env.NODE_ENV !== 'production' && !process.env.DM_ENCRYPTION_KEY;

function getKey() {
    const raw = typeof process.env.DM_ENCRYPTION_KEY === 'string' ? process.env.DM_ENCRYPTION_KEY : '';
    if (raw) {
        if (/^[0-9a-fA-F]{64}$/.test(raw)) {
            return Buffer.from(raw, 'hex');
        }
        if (Buffer.byteLength(raw, 'utf8') < KEY_LEN) {
            throw new Error('DM_ENCRYPTION_KEY must be exactly 64 hexadecimal characters or at least 32 UTF-8 bytes');
        }
        return crypto.createHash('sha256').update(raw, 'utf8').digest();
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error('DM_ENCRYPTION_KEY is required in production and must be a strong 32-byte key');
    }
    console.warn('[security] DM_ENCRYPTION_KEY is unset; using the Jchat development fallback. Do not use this key in production.');
    return crypto.createHash('sha256').update(DEVELOPMENT_FALLBACK, 'utf8').digest();
}

const key = getKey();
const legacyDevelopmentKey = crypto.createHash('sha256').update(LEGACY_DEVELOPMENT_FALLBACK, 'utf8').digest();

function encrypt(plainText) {
    if (plainText == null || String(plainText) === '') return '';
    const text = String(plainText);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, enc, tag]);
    return PREFIX + combined.toString('base64');
}

function decryptWithKey(cipherText, decryptionKey) {
    try {
        const buf = Buffer.from(cipherText.slice(PREFIX.length), 'base64');
        if (buf.length < IV_LEN + TAG_LEN) return null;
        const iv = buf.subarray(0, IV_LEN);
        const tag = buf.subarray(buf.length - TAG_LEN);
        const data = buf.subarray(IV_LEN, buf.length - TAG_LEN);
        const decipher = crypto.createDecipheriv(ALG, decryptionKey, iv, { authTagLength: TAG_LEN });
        decipher.setAuthTag(tag);
        return decipher.update(data) + decipher.final('utf8');
    } catch (e) {
        return null;
    }
}

function decrypt(cipherText) {
    if (cipherText == null || String(cipherText) === '') return '';
    const s = String(cipherText);
    if (!s.startsWith(PREFIX)) return s;
    return decryptWithKey(s, key) ?? (canReadLegacyDevelopmentCiphertext ? decryptWithKey(s, legacyDevelopmentKey) : null) ?? s;
}

module.exports = { encrypt, decrypt };
