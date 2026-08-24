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

    for (const [route, expectedText] of [
        ['/', '<title>JoyChat'],
        ['/login', '<title>JoyChat'],
        ['/register', '<title>JoyChat'],
        ['/admin', '<title>JoyChat'],
        ['/admin/login', '<title>JoyChat']
    ]) {
        const page = await fetch(`${baseUrl}${route}`);
        assert.equal(page.status, 200, `${route} is served by the API process`);
        assert.match(await page.text(), new RegExp(expectedText, 'i'));
    }

    const headers = await fetch(`${baseUrl}/api/version`);
    assert.equal(headers.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.headers.get('x-frame-options'), 'SAMEORIGIN');

    const allowed = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'http://trusted.example' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://trusted.example');
    const rejected = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'https://untrusted.example' } });
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
    assert.equal(rejected.status, 403);
    const lanApi = await fetch(`${baseUrl}/api/version`, { headers: { origin: `http://192.168.1.20:${port}` } });
    assert.equal(lanApi.status, 200);
    const lanWrongPort = await fetch(`${baseUrl}/api/version`, { headers: { origin: 'http://192.168.1.20:3001' } });
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

test('package scripts expose a single-service startup only', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts.start, 'node --env-file-if-exists=.env index.js');
    assert.equal(packageJson.scripts.dev, 'nodemon index.js');
    assert.equal(packageJson.scripts['start-all'], undefined);
    assert.equal(packageJson.scripts.frontend, undefined);
    assert.equal(packageJson.scripts['dev-frontend'], undefined);
    assert.equal(packageJson.dependencies['express-http-proxy'], undefined);
    assert.equal(packageJson.devDependencies.concurrently, undefined);
});

test('CI and server output reference only existing single-service entrypoints', () => {
    const projectRoot = path.join(__dirname, '..');
    const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const checkedFiles = [...workflow.matchAll(/node --check ([^\s]+)/g)].map(match => match[1]);
    assert.deepEqual(checkedFiles, ['index.js', 'scripts/reset-data.js']);
    for (const checkedFile of checkedFiles) {
        assert.equal(fs.existsSync(path.join(projectRoot, checkedFile)), true, `${checkedFile} exists`);
    }
    assert.doesNotMatch(workflow, /frontend-server|start-all|FRONTEND_PORT|SERVE_FRONTEND/);

    const serverSource = fs.readFileSync(path.join(projectRoot, 'index.js'), 'utf8');
    assert.doesNotMatch(serverSource, /API only|SERVE_FRONTEND/);
});

test('browser Socket.IO client connects to the same origin for a single-service deployment', () => {
    const socketClient = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'api', 'socket.js'), 'utf8');
    // 单服务部署：socket.io-client 不指定 URL，默认连接页面同源
    assert.match(socketClient, /io\(\{ transports: \['websocket', 'polling'\] \}\)/);
    assert.doesNotMatch(socketClient, /API_ORIGIN|http[s]?:\/\//, 'socket must not hardcode a cross-origin URL');
});
