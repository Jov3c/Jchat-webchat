const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');

const PUBLIC_CHANNELS = ['公共频道'];

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

function createSocketClient(baseUrl) {
    const websocketUrl = `${baseUrl.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const socket = new WebSocket(websocketUrl);
    const eventWaiters = new Map();
    let connectedResolve;
    let connectedReject;
    const connected = new Promise((resolve, reject) => {
        connectedResolve = resolve;
        connectedReject = reject;
    });
    const connectTimer = setTimeout(() => connectedReject(new Error('Socket.IO connection timed out')), 3_000);

    socket.on('error', connectedReject);
    socket.on('message', raw => {
        const packet = raw.toString();
        if (packet.startsWith('0')) {
            socket.send('40');
            return;
        }
        if (packet.startsWith('2')) {
            socket.send(`3${packet.slice(1)}`);
            return;
        }
        if (packet.startsWith('40')) {
            clearTimeout(connectTimer);
            connectedResolve();
            return;
        }
        if (!packet.startsWith('42')) return;
        const [eventName, payload] = JSON.parse(packet.slice(2));
        const waiters = eventWaiters.get(eventName) || [];
        const waiterIndex = waiters.findIndex(waiter => !waiter.predicate || waiter.predicate(payload));
        const waiter = waiterIndex >= 0 ? waiters.splice(waiterIndex, 1)[0] : null;
        if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve(payload);
        }
        if (waiters.length) eventWaiters.set(eventName, waiters);
        else eventWaiters.delete(eventName);
    });

    return {
        connected,
        emit(eventName, ...args) {
            socket.send(`42${JSON.stringify([eventName, ...args])}`);
        },
        waitFor(eventName, timeoutMs = 2_000, predicate = null) {
            return new Promise((resolve, reject) => {
                const waiter = {
                    resolve,
                    predicate,
                    timer: setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs)
                };
                const waiters = eventWaiters.get(eventName) || [];
                waiters.push(waiter);
                eventWaiters.set(eventName, waiters);
            });
        },
        close() { socket.close(); }
    };
}

async function sendChannelMessage(socket, channel, content) {
    const received = socket.waitFor('messageReceived');
    socket.emit('sendMessage', { channel, content });
    return received;
}

test('channel message history is paginated with limit and before_id', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-pagination-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite') },
        stdio: 'ignore'
    });
    const sockets = [];
    t.after(async () => {
        sockets.forEach(s => s.close());
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);
    const channel = '公共频道';
    const channelPath = encodeURIComponent(channel);

    const user = await registerUser(baseUrl, 'pager');
    const socket = createSocketClient(baseUrl);
    sockets.push(socket);
    await socket.connected;
    socket.emit('authenticate', user.token);
    await socket.waitFor('authenticated');
    socket.emit('joinChannel', channel);
    await socket.waitFor('channelJoined');

    for (let i = 1; i <= 5; i++) {
        await sendChannelMessage(socket, channel, `msg${i}`);
    }

    await t.test('default limit returns the latest messages with has_more flag', async () => {
        const { response, body } = await requestJson(`${baseUrl}/api/messages/${channelPath}`, authOptions(user.token));
        assert.equal(response.status, 200);
        assert.equal(body.messages.length, 5);
        assert.deepEqual(body.messages.map(m => m.content), ['msg1', 'msg2', 'msg3', 'msg4', 'msg5']);
        assert.equal(body.has_more, false);
    });

    await t.test('limit=3 returns the latest 3 with has_more=true', async () => {
        const { body } = await requestJson(`${baseUrl}/api/messages/${channelPath}?limit=3`, authOptions(user.token));
        assert.deepEqual(body.messages.map(m => m.content), ['msg3', 'msg4', 'msg5']);
        assert.equal(body.has_more, true);
        assert.deepEqual(body.messages.map(m => m.id), body.messages.map(m => m.id).sort((a, b) => a - b));
    });

    await t.test('before_id returns the older batch and tracks has_more', async () => {
        const first = (await requestJson(`${baseUrl}/api/messages/${channelPath}?limit=3`, authOptions(user.token))).body;
        const beforeId = first.messages[0].id;
        const second = (await requestJson(`${baseUrl}/api/messages/${channelPath}?limit=3&before_id=${beforeId}`, authOptions(user.token))).body;
        assert.deepEqual(second.messages.map(m => m.content), ['msg1', 'msg2']);
        assert.equal(second.has_more, false);
        assert.equal(second.messages.every(m => m.id < beforeId), true);
    });

    await t.test('invalid limit falls back to 50', async () => {
        const fallback = (await requestJson(`${baseUrl}/api/messages/${channelPath}?limit=abc`, authOptions(user.token))).body;
        assert.equal(fallback.messages.length, 5);
    });
});

test('dm message history is paginated', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-dm-pagination-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite') },
        stdio: 'ignore'
    });
    const sockets = [];
    t.after(async () => {
        sockets.forEach(s => s.close());
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);
    const a = await registerUser(baseUrl, 'dmpager_a');
    const b = await registerUser(baseUrl, 'dmpager_b');

    // 建立好友关系：A 申请（入参字段是 `to`）→ B 同意
    const request = await requestJson(`${baseUrl}/api/friends/request`, authOptions(a.token, 'POST', { to: 'dmpager_b' }));
    assert.equal(request.response.status, 200);
    const incoming = (await requestJson(`${baseUrl}/api/friends/requests`, authOptions(b.token))).body.requests;
    const pending = incoming.find(r => r.from_user && r.from_user.username === 'dmpager_a');
    assert.ok(pending, 'friend request must be visible to B');
    const respond = await requestJson(`${baseUrl}/api/friends/request/${pending.id}/respond`, authOptions(b.token, 'POST', { action: 'accept' }));
    assert.equal(respond.response.status, 200);

    // A 发 5 条私聊（socket）
    const socket = createSocketClient(baseUrl);
    sockets.push(socket);
    await socket.connected;
    socket.emit('authenticate', a.token);
    await socket.waitFor('authenticated');
    for (let i = 1; i <= 5; i++) {
        const received = socket.waitFor('privateMessageReceived');
        socket.emit('sendPrivateMessage', { toUserId: b.userId, content: `dm${i}` });
        await received;
    }

    await t.test('limit=3 returns latest 3 with has_more=true, before_id returns older', async () => {
        const first = (await requestJson(`${baseUrl}/api/dm/${b.userId}/messages?limit=3`, authOptions(a.token))).body;
        assert.deepEqual(first.messages.map(m => m.content), ['dm3', 'dm4', 'dm5']);
        assert.equal(first.has_more, true);
        const beforeId = first.messages[0].id;
        const second = (await requestJson(`${baseUrl}/api/dm/${b.userId}/messages?limit=3&before_id=${beforeId}`, authOptions(a.token))).body;
        assert.deepEqual(second.messages.map(m => m.content), ['dm1', 'dm2']);
        assert.equal(second.has_more, false);
    });
});
