const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
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
        try { if ((await fetch(url)).ok) return; } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${url}`);
}

test('legacy admin credentials migrate to a bcrypt hash and password changes persist without plaintext', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-admin-credentials-'));
    const credentialsFile = path.join(tempDir, 'admin_credentials.json');
    fs.writeFileSync(credentialsFile, JSON.stringify({ username: 'legacy-admin', password: 'legacy-pass-123' }));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite'), JCHAT_ADMIN_CREDENTIALS_FILE: credentialsFile },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);
    const migrated = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    assert.deepEqual(Object.keys(migrated).sort(), ['passwordHash', 'username']);
    assert.equal(await bcrypt.compare('legacy-pass-123', migrated.passwordHash), true);
    assert.doesNotMatch(fs.readFileSync(credentialsFile, 'utf8'), /legacy-pass-123/);

    const login = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'legacy-admin', password: 'legacy-pass-123' }) });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const weakChange = await fetch(`${baseUrl}/api/admin/password`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: 'legacy-pass-123', newPassword: 'admin123' }) });
    assert.equal(weakChange.status, 400);
    const loginAfterWeakChange = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'legacy-admin', password: 'legacy-pass-123' }) });
    assert.equal(loginAfterWeakChange.status, 200);
    const changed = await fetch(`${baseUrl}/api/admin/password`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: 'legacy-pass-123', newPassword: 'new-admin-pass-456' }) });
    assert.equal(changed.status, 200);
    const oldLogin = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'legacy-admin', password: 'legacy-pass-123' }) });
    assert.equal(oldLogin.status, 401);
    const newLogin = await fetch(`${baseUrl}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'legacy-admin', password: 'new-admin-pass-456' }) });
    assert.equal(newLogin.status, 200);
    assert.doesNotMatch(fs.readFileSync(credentialsFile, 'utf8'), /new-admin-pass-456/);
});

test('production refuses the default JWT secret before serving requests', async () => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-production-jwt-'));
    const credentialsFile = path.join(tempDir, 'admin_credentials.json');
    fs.writeFileSync(credentialsFile, JSON.stringify({ username: 'admin', passwordHash: await bcrypt.hash('safe-admin-pass-123', 10) }));
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', DM_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', PORT: '0', JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite'), JCHAT_ADMIN_CREDENTIALS_FILE: credentialsFile },
        stdio: 'ignore'
    });
    try {
        const code = await Promise.race([
            once(child, 'exit').then(([exitCode]) => exitCode),
            new Promise((_, reject) => setTimeout(() => reject(new Error('production server accepted the default JWT secret')), 2_000))
        ]);
        assert.notEqual(code, 0);
    } finally {
        if (child.exitCode === null) child.kill();
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
