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

test('stickers are per-user collections: add, list, remove, and reject bad URLs', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-sticker-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: String(port),
            JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite')
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

    const alice = await (await fetch(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'sticker_alice', password: 'pass1234' })
    })).json();
    const bob = await (await fetch(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'sticker_bob', password: 'pass1234' })
    })).json();

    // 1. 初始列表为空
    const initial = await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token));
    assert.equal(initial.response.status, 200);
    assert.deepEqual(initial.body.stickers, []);

    // 2. 添加一个合法表情包（uploads 相对路径）
    const add = await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token, 'POST', { url: 'uploads/sticker-1.png' }));
    assert.equal(add.response.status, 201);
    assert.equal(add.body.stickers.length, 1);
    const stickerId = add.body.stickers[0].id;

    // 3. 再添加一个，确认列表累积
    await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token, 'POST', { url: 'uploads/sticker-2.png' }));
    const listAfter = await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token));
    assert.equal(listAfter.body.stickers.length, 2);

    // 4. 危险 URL 被拒绝（javascript:）
    const bad = await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token, 'POST', { url: 'javascript:alert(1)' }));
    assert.equal(bad.response.status, 400);

    // 5. 仅自己可见：bob 看不到 alice 的表情包
    const bobList = await requestJson(`${baseUrl}/api/stickers`, authOptions(bob.token));
    assert.deepEqual(bobList.body.stickers, []);

    // 6. 删除
    const del = await requestJson(`${baseUrl}/api/stickers/${stickerId}`, authOptions(alice.token, 'DELETE'));
    assert.equal(del.response.status, 200);
    const listAfterDel = await requestJson(`${baseUrl}/api/stickers`, authOptions(alice.token));
    assert.equal(listAfterDel.body.stickers.length, 1);
});
