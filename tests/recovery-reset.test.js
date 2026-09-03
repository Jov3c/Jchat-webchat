const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForServer(url) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${url}`);
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
}

function authOptions(token, method = 'GET', body) {
    const options = {
        method,
        headers: { authorization: `Bearer ${token}` }
    };
    if (body !== undefined) {
        options.headers['content-type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    return options;
}

async function registerUser(baseUrl, username) {
    const { response, body } = await requestJson(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'pass1234' })
    });
    assert.equal(response.status, 201);
    return body;
}

async function loginUser(baseUrl, username, password = 'pass1234') {
    return requestJson(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
}

const RECOVERY_CODE = 'ABCDEFGH23456789';
const SALT = 'c2FsdC1kYXRhLXNhbHQtZGF0YQ==';
const PRIVATE_KEY = 'ZGF0YS1wcml2YXRlLWtleS1ibG9iLXBsYWNlaG9sZGVyLXZhbHVlLXRlc3Q=';

async function setupRecoverableUser(baseUrl, username) {
    const reg = await registerUser(baseUrl, username);
    const keys = await requestJson(`${baseUrl}/api/profile/keys`, authOptions(reg.token, 'PUT', {
        salt: SALT,
        public_key: '{"kty":"EC","crv":"P-256","x":"x","y":"y"}',
        encrypted_private_key: PRIVATE_KEY
    }));
    assert.equal(keys.response.status, 200);
    const recovery = await requestJson(`${baseUrl}/api/profile/recovery`, authOptions(reg.token, 'PUT', {
        recovery_key: PRIVATE_KEY,
        recovery_code: RECOVERY_CODE
    }));
    assert.equal(recovery.response.status, 200);
    return reg;
}

test('recovery verify and reset flow preserves keys and kills old sessions', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-recovery-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite') },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);

    const reg = await setupRecoverableUser(baseUrl, 'recoveruser');
    const oldToken = reg.token;

    await t.test('verify returns the recovery key for the right code', async () => {
        const ok = await requestJson(`${baseUrl}/api/recovery/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'recoveruser', recovery_code: RECOVERY_CODE })
        });
        assert.equal(ok.response.status, 200);
        assert.equal(ok.body.recovery_key, PRIVATE_KEY);
    });

    await t.test('verify rejects a wrong code and a code-less account', async () => {
        const wrong = await requestJson(`${baseUrl}/api/recovery/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'recoveruser', recovery_code: 'ABCDEFGH23456788' })
        });
        assert.equal(wrong.response.status, 403);

        const noCode = await registerUser(baseUrl, 'nocodereg');
        const denied = await requestJson(`${baseUrl}/api/recovery/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'nocodereg', recovery_code: RECOVERY_CODE })
        });
        assert.equal(denied.response.status, 403);
        assert.equal(denied.body.error, '该账号未设置恢复码');
    });

    await t.test('reset with a wrong code is rejected', async () => {
        const res = await requestJson(`${baseUrl}/api/reset-password`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: 'recoveruser', recovery_code: 'ABCDEFGH23456788',
                new_password: 'newpass123', new_salt: SALT, new_encrypted_private_key: PRIVATE_KEY
            })
        });
        assert.equal(res.response.status, 403);
    });

    await t.test('reset with the right code changes password and invalidates old sessions', async () => {
        const reset = await requestJson(`${baseUrl}/api/reset-password`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: 'recoveruser', recovery_code: RECOVERY_CODE,
                new_password: 'newpass123', new_salt: SALT, new_encrypted_private_key: PRIVATE_KEY
            })
        });
        assert.equal(reset.response.status, 200);

        const oldPasswordLogin = await loginUser(baseUrl, 'recoveruser', 'pass1234');
        assert.equal(oldPasswordLogin.response.status, 401);
        const newPasswordLogin = await loginUser(baseUrl, 'recoveruser', 'newpass123');
        assert.equal(newPasswordLogin.response.status, 200);

        const oldSession = await requestJson(`${baseUrl}/api/channels`, authOptions(oldToken));
        assert.equal(oldSession.response.status, 401);
        assert.equal(oldSession.body.code, 'session_replaced');
        const newSession = await requestJson(`${baseUrl}/api/channels`, authOptions(newPasswordLogin.body.token));
        assert.equal(newSession.response.status, 200);
    });
});
