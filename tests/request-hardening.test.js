const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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
            if ((await fetch(url)).ok) return;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${url}`);
}

test('request hardening limits bodies and abusive login attempts while allowing configured CORS origins', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-request-hardening-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: String(port),
            JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite'),
            JCHAT_JSON_LIMIT: '1kb',
            JCHAT_AUTH_RATE_LIMIT_MAX: '2',
            JCHAT_ALLOWED_ORIGINS: 'http://trusted.example'
        },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) {
            child.kill();
            await once(child, 'exit');
        }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);

    const headers = await fetch(`${baseUrl}/api/version`);
    assert.equal(headers.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.headers.get('x-frame-options'), 'SAMEORIGIN');

    const allowed = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'http://trusted.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://trusted.example');
    const rejected = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'https://untrusted.example' } });
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
    assert.equal(rejected.status, 403);
    const lanFrontend = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'http://192.168.1.20:3001' } });
    assert.equal(lanFrontend.status, 200);
    const lanWrongPort = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'http://192.168.1.20:3002' } });
    assert.equal(lanWrongPort.status, 403);

    const tooLarge = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'a', password: 'x'.repeat(2048) })
    });
    assert.equal(tooLarge.status, 413);

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${baseUrl}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 400);
    }
    const throttled = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
    });
    assert.equal(throttled.status, 429);
});

test('browser Socket.IO resolves API_ORIGIN, development proxy, and same-origin deployments', () => {
    const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');
    const match = chatJs.match(/function resolveSocketUrl\(\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'chat.js exposes a dedicated Socket.IO URL resolver');
    const resolve = (location, API_ORIGIN, JCHAT_API_PORT) => vm.runInNewContext(`${match[0]}; resolveSocketUrl()`, {
        window: { location, API_ORIGIN, JCHAT_API_PORT }
    });
    assert.equal(resolve({ protocol: 'http:', hostname: 'localhost', port: '3001', origin: 'http://localhost:3001' }), 'http://localhost:3000');
    assert.equal(resolve({ protocol: 'http:', hostname: '192.168.1.20', port: '3001', origin: 'http://192.168.1.20:3001' }), 'http://192.168.1.20:3000');
    assert.equal(resolve({ protocol: 'https:', hostname: 'chat.example', port: '', origin: 'https://chat.example' }), 'https://chat.example');
    assert.equal(resolve({ protocol: 'https:', hostname: 'chat.example', port: '', origin: 'https://chat.example' }, 'https://api.example'), 'https://api.example');
});
