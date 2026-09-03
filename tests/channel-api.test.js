const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
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

async function loginUser(baseUrl, username, password = 'pass1234') {
    return requestJson(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
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

test('private channel membership is persisted and enforced across HTTP and Socket.IO', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-channel-membership-'));
    const databaseFile = path.join(tempDir, 'jchat.sqlite');
    const legacyDb = new DatabaseSync(databaseFile);
    legacyDb.exec(`
      CREATE TABLE channels (
        name TEXT PRIMARY KEY,
        password TEXT,
        members TEXT NOT NULL DEFAULT '[]'
      );
      INSERT INTO channels(name, password, members)
      VALUES ('Legacy private', 'legacy-secret', '[99]');
    `);
    legacyDb.close();

    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), JCHAT_DB_FILE: databaseFile },
        stdio: 'ignore'
    });
    const sockets = [];

    t.after(async () => {
        sockets.forEach(socket => socket.close());
        if (child.exitCode === null) {
            child.kill();
            await once(child, 'exit');
        }
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);

    const owner = await registerUser(baseUrl, 'channelowner');
    const invited = await registerUser(baseUrl, 'inviteduser');
    const outsider = await registerUser(baseUrl, 'outsideruser');
    const privateChannel = '产品密室';
    const privatePath = encodeURIComponent(privateChannel);

    await t.test('a successful new login invalidates the old user token but failed credentials do not', async () => {
        const sessionUser = await registerUser(baseUrl, 'sessionuser');
        const failed = await loginUser(baseUrl, 'sessionuser', 'wrong-password');
        assert.equal(failed.response.status, 401);
        const stillCurrent = await requestJson(`${baseUrl}/api/channels`, authOptions(sessionUser.token));
        assert.equal(stillCurrent.response.status, 200);

        const secondLogin = await loginUser(baseUrl, 'sessionuser');
        assert.equal(secondLogin.response.status, 200);
        const expired = await requestJson(`${baseUrl}/api/channels`, authOptions(sessionUser.token));
        assert.equal(expired.response.status, 401);
        assert.equal(expired.body.code, 'session_replaced');
        const current = await requestJson(`${baseUrl}/api/channels`, authOptions(secondLogin.body.token));
        assert.equal(current.response.status, 200);
    });

    await t.test('socket authentication replaces the old page and emits channel online counts', async () => {
        const firstLogin = await registerUser(baseUrl, 'socketpresenceuser');
        const oldPage = createSocketClient(baseUrl);
        sockets.push(oldPage);
        await oldPage.connected;
        const firstAuthenticated = oldPage.waitFor('authenticated');
        oldPage.emit('authenticate', firstLogin.token);
        await firstAuthenticated;

        const secondLogin = await loginUser(baseUrl, 'socketpresenceuser');
        assert.equal(secondLogin.response.status, 200);
        const newPage = createSocketClient(baseUrl);
        sockets.push(newPage);
        await newPage.connected;
        const replacement = oldPage.waitFor('sessionReplaced');
        const secondAuthenticated = newPage.waitFor('authenticated');
        newPage.emit('authenticate', secondLogin.body.token);
        assert.equal((await replacement).code, 'session_replaced');
        await secondAuthenticated;

        const countUpdate = newPage.waitFor('channelPresenceUpdated');
        newPage.emit('joinChannel', PUBLIC_CHANNELS[0]);
        const countPayload = await countUpdate;
        assert.equal(countPayload.channel, PUBLIC_CHANNELS[0]);
        assert.equal(Number.isInteger(countPayload.onlineCount), true);
        assert.equal(countPayload.onlineCount >= 1, true);
    });

    await t.test('profile status is validated, persisted, and hidden from other users when invisible', async () => {
        const statusOwner = await registerUser(baseUrl, 'statusowner');
        const statusViewer = await registerUser(baseUrl, 'statusviewer');
        const ownerSocket = createSocketClient(baseUrl);
        sockets.push(ownerSocket);
        await ownerSocket.connected;
        const authenticated = ownerSocket.waitFor('authenticated');
        ownerSocket.emit('authenticate', statusOwner.token);
        await authenticated;

        const invisibleUpdate = await requestJson(
            `${baseUrl}/api/profile/${statusOwner.userId}`,
            authOptions(statusOwner.token, 'PUT', { presence_status: 'invisible' })
        );
        assert.equal(invisibleUpdate.response.status, 200);

        const ownProfile = await requestJson(
            `${baseUrl}/api/profile/${statusOwner.userId}`,
            authOptions(statusOwner.token)
        );
        assert.equal(ownProfile.body.presence_status, 'invisible');
        assert.equal(ownProfile.body.effective_status, 'invisible');

        const publicProfile = await requestJson(
            `${baseUrl}/api/profile/${statusOwner.userId}`,
            authOptions(statusViewer.token)
        );
        assert.equal(publicProfile.body.effective_status, 'offline');
        assert.equal(Object.hasOwn(publicProfile.body, 'presence_status'), false);

        const rejected = await requestJson(
            `${baseUrl}/api/profile/${statusOwner.userId}`,
            authOptions(statusOwner.token, 'PUT', { presence_status: 'sleeping' })
        );
        assert.equal(rejected.response.status, 400);
        assert.equal(rejected.body.code, 'invalid_presence_status');
    });

    await t.test('channel listing authenticates and exposes exactly two public channels plus memberships', async () => {
        const unauthenticated = await requestJson(`${baseUrl}/api/channels`);
        assert.equal(unauthenticated.response.status, 401);

        const ownerBeforeCreate = await requestJson(`${baseUrl}/api/channels`, authOptions(owner.token));
        assert.equal(ownerBeforeCreate.response.status, 200);
        assert.deepEqual(ownerBeforeCreate.body.channels.map(c => c.name), PUBLIC_CHANNELS);
    });

    await t.test('legacy channel schema gains nullable owner_id without losing existing data', () => {
        const migratedDb = new DatabaseSync(databaseFile, { readOnly: true });
        const columns = migratedDb.prepare('PRAGMA table_info(channels)').all();
        const legacyChannel = migratedDb.prepare('SELECT name, password, members, owner_id FROM channels WHERE name = ?').get('Legacy private');
        migratedDb.close();

        assert.ok(columns.some(column => column.name === 'owner_id'));
        assert.deepEqual({ ...legacyChannel }, {
            name: 'Legacy private',
            password: 'legacy-secret',
            members: '[99]',
            owner_id: null
        });
    });

    await t.test('creating a channel makes the authenticated creator its owner and initial member', async () => {
        const creation = await requestJson(`${baseUrl}/api/channels`, authOptions(owner.token, 'POST', { name: privateChannel }));
        assert.equal(creation.response.status, 201);
        assert.deepEqual(creation.body, {
            name: privateChannel,
            ownerId: owner.userId,
            members: [owner.userId]
        });

        const ownerList = await requestJson(`${baseUrl}/api/channels`, authOptions(owner.token));
        const outsiderList = await requestJson(`${baseUrl}/api/channels`, authOptions(outsider.token));
        assert.deepEqual(ownerList.body.channels.map(c => c.name), [...PUBLIC_CHANNELS, privateChannel]);
        assert.deepEqual(outsiderList.body.channels.map(c => c.name), PUBLIC_CHANNELS);

        const persistedDb = new DatabaseSync(databaseFile, { readOnly: true });
        const row = persistedDb.prepare('SELECT owner_id, members FROM channels WHERE name = ?').get(privateChannel);
        persistedDb.close();
        assert.deepEqual({ ...row }, { owner_id: owner.userId, members: JSON.stringify([owner.userId]) });
    });

    await t.test('only the owner can invite exact usernames and duplicate members are stored once', async () => {
        const denied = await requestJson(
            `${baseUrl}/api/channel/${privatePath}/members`,
            authOptions(outsider.token, 'POST', { usernames: ['inviteduser'] })
        );
        assert.equal(denied.response.status, 403);

        const invitedSocket = createSocketClient(baseUrl);
        sockets.push(invitedSocket);
        await invitedSocket.connected;
        invitedSocket.emit('authenticate', invited.token);
        const joined = invitedSocket.waitFor('channelJoined');
        invitedSocket.emit('joinChannel', PUBLIC_CHANNELS[0], invited.userId);
        await joined;

        const invitationEvent = invitedSocket.waitFor('channelInvited');
        const invitedPresence = invitedSocket.waitFor(
            'channelPresenceUpdated',
            2_000,
            payload => payload?.channel === privateChannel
        );
        const invitation = await requestJson(
            `${baseUrl}/api/channel/${privatePath}/members`,
            authOptions(owner.token, 'POST', {
                usernames: ['inviteduser', 'inviteduser', 'INVITEDUSER', 'missing-user']
            })
        );
        const invitedPresencePayload = await invitedPresence;
        assert.equal(invitedPresencePayload.channel, privateChannel);
        assert.equal(Number.isInteger(invitedPresencePayload.onlineCount), true);
        assert.equal(invitation.response.status, 200);
        assert.deepEqual({
            ...invitation.body,
            members: invitation.body.members.map(m => ({ id: m.id, username: m.username }))
        }, {
            success: true,
            invited: [{ id: invited.userId, username: 'inviteduser' }],
            notFound: ['INVITEDUSER', 'missing-user'],
            members: [
                { id: owner.userId, username: 'channelowner' },
                { id: invited.userId, username: 'inviteduser' }
            ]
        });
        const eventPayload = await invitationEvent;
        assert.equal(eventPayload.channel, privateChannel);
        assert.deepEqual(eventPayload.invitedBy, { id: owner.userId, username: 'channelowner' });

        const persistedDb = new DatabaseSync(databaseFile, { readOnly: true });
        const row = persistedDb.prepare('SELECT members FROM channels WHERE name = ?').get(privateChannel);
        persistedDb.close();
        assert.deepEqual(JSON.parse(row.members), [owner.userId, invited.userId]);
    });

    await t.test('password verification cannot grant private-channel membership', async () => {
        const verification = await requestJson(
            `${baseUrl}/api/channel/verify-password`,
            authOptions(outsider.token, 'POST', {
                channel: privateChannel,
                password: 'guessed-password',
                userId: outsider.userId
            })
        );
        assert.equal(verification.response.status, 410);

        const outsiderList = await requestJson(`${baseUrl}/api/channels`, authOptions(outsider.token));
        assert.deepEqual(outsiderList.body.channels.map(c => c.name), PUBLIC_CHANNELS);

        const persistedDb = new DatabaseSync(databaseFile, { readOnly: true });
        const row = persistedDb.prepare('SELECT members FROM channels WHERE name = ?').get(privateChannel);
        persistedDb.close();
        assert.deepEqual(JSON.parse(row.members), [owner.userId, invited.userId]);
    });

    await t.test('member listing is available to any member while removal is owner-only', async () => {
        const invitedListing = await requestJson(`${baseUrl}/api/channel/${privatePath}/members`, authOptions(invited.token));
        assert.equal(invitedListing.response.status, 200);

        const listing = await requestJson(`${baseUrl}/api/channel/${privatePath}/members`, authOptions(owner.token));
        assert.equal(listing.response.status, 200);
        assert.deepEqual(listing.body.members.map(m => ({ id: m.id, username: m.username })), [
            { id: owner.userId, username: 'channelowner' },
            { id: invited.userId, username: 'inviteduser' }
        ]);

        const selfRemoval = await requestJson(
            `${baseUrl}/api/channel/${privatePath}/members/${owner.userId}`,
            authOptions(owner.token, 'DELETE')
        );
        assert.equal(selfRemoval.response.status, 400);
        assert.equal(selfRemoval.body.code, 'owner_cannot_be_removed');
    });

    await t.test('private messages and clear operations reject non-members while public channels stay authenticated-accessible', async () => {
        const publicMessages = await requestJson(
            `${baseUrl}/api/messages/${encodeURIComponent(PUBLIC_CHANNELS[0])}`,
            authOptions(outsider.token)
        );
        const publicClear = await requestJson(
            `${baseUrl}/api/channel/${encodeURIComponent(PUBLIC_CHANNELS[0])}/clear`,
            authOptions(outsider.token, 'POST')
        );
        const unauthenticatedPublicMessages = await requestJson(`${baseUrl}/api/messages/${encodeURIComponent(PUBLIC_CHANNELS[0])}`);
        const ownerMessages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(owner.token));
        const invitedMessages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(invited.token));
        const outsiderMessages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(outsider.token));
        const outsiderClear = await requestJson(`${baseUrl}/api/channel/${privatePath}/clear`, authOptions(outsider.token, 'POST'));

        assert.equal(publicMessages.response.status, 200);
        assert.equal(publicClear.response.status, 200);
        assert.equal(unauthenticatedPublicMessages.response.status, 401);
        assert.equal(ownerMessages.response.status, 200);
        assert.equal(invitedMessages.response.status, 200);
        assert.equal(outsiderMessages.response.status, 403);
        assert.equal(outsiderClear.response.status, 403);
    });

    await t.test('socket join denies a non-member even when the client supplies an owner id', async () => {
        const outsiderSocket = createSocketClient(baseUrl);
        sockets.push(outsiderSocket);
        await outsiderSocket.connected;
        outsiderSocket.emit('authenticate', outsider.token);
        const denied = outsiderSocket.waitFor('channelAccessDenied');
        outsiderSocket.emit('joinChannel', privateChannel, owner.userId);
        const payload = await denied;
        assert.equal(payload.channel, privateChannel);
    });

    await t.test('a bare forged user id cannot authenticate, join, or send as a private-channel owner', async () => {
        const forgedSocket = createSocketClient(baseUrl);
        sockets.push(forgedSocket);
        await forgedSocket.connected;
        forgedSocket.emit('authenticate', owner.userId);

        const joinDenied = forgedSocket.waitFor('channelAccessDenied', 750);
        forgedSocket.emit('joinChannel', privateChannel, owner.userId);
        assert.equal((await joinDenied).channel, privateChannel);

        const sendDenied = forgedSocket.waitFor('channelAccessDenied', 750);
        forgedSocket.emit('sendMessage', {
            userId: owner.userId,
            channel: privateChannel,
            content: 'forged socket write'
        });
        assert.equal((await sendDenied).channel, privateChannel);

        const messages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(owner.token));
        assert.equal(messages.body.messages.some(message => message.content === 'forged socket write'), false);
    });

    await t.test('a verified non-member is denied join and send even with an owner id in event data', async () => {
        const outsiderSocket = createSocketClient(baseUrl);
        sockets.push(outsiderSocket);
        await outsiderSocket.connected;
        const authenticated = outsiderSocket.waitFor('authenticated', 750);
        outsiderSocket.emit('authenticate', outsider.token);
        assert.deepEqual(await authenticated, { userId: outsider.userId });

        const joinDenied = outsiderSocket.waitFor('channelAccessDenied');
        outsiderSocket.emit('joinChannel', privateChannel, owner.userId);
        assert.equal((await joinDenied).channel, privateChannel);

        const sendDenied = outsiderSocket.waitFor('channelAccessDenied');
        outsiderSocket.emit('sendMessage', {
            userId: owner.userId,
            channel: privateChannel,
            content: 'outsider token write'
        });
        assert.equal((await sendDenied).channel, privateChannel);

        const messages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(owner.token));
        assert.equal(messages.body.messages.some(message => message.content === 'outsider token write'), false);
    });

    await t.test('an unauthenticated socket cannot recall another user private-channel message', async () => {
        const ownerSocket = createSocketClient(baseUrl);
        sockets.push(ownerSocket);
        await ownerSocket.connected;
        ownerSocket.emit('authenticate', owner.token);
        const joined = ownerSocket.waitFor('channelJoined');
        ownerSocket.emit('joinChannel', privateChannel, owner.userId);
        await joined;

        const received = ownerSocket.waitFor('messageReceived');
        ownerSocket.emit('sendMessage', {
            userId: owner.userId,
            channel: privateChannel,
            content: 'owner recall target'
        });
        const message = await received;

        const unauthenticatedSocket = createSocketClient(baseUrl);
        sockets.push(unauthenticatedSocket);
        await unauthenticatedSocket.connected;
        const denied = unauthenticatedSocket.waitFor('recallFailed', 750);
        unauthenticatedSocket.emit('recallMessage', { messageId: message.id, channel: privateChannel });
        assert.equal((await denied).reason, 'not_authenticated');

        const messages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(owner.token));
        assert.equal(messages.body.messages.find(item => item.id === message.id).is_recalled, false);
    });

    await t.test('a removed private-channel author cannot recall their own message', async () => {
        const channel = '撤回权限测试';
        const channelPath = encodeURIComponent(channel);
        const creation = await requestJson(`${baseUrl}/api/channels`, authOptions(owner.token, 'POST', { name: channel }));
        assert.equal(creation.response.status, 201);
        const invitation = await requestJson(
            `${baseUrl}/api/channel/${channelPath}/members`,
            authOptions(owner.token, 'POST', { usernames: ['inviteduser'] })
        );
        assert.equal(invitation.response.status, 200);

        const memberSocket = createSocketClient(baseUrl);
        sockets.push(memberSocket);
        await memberSocket.connected;
        memberSocket.emit('authenticate', invited.token);
        const joined = memberSocket.waitFor('channelJoined');
        memberSocket.emit('joinChannel', channel, invited.userId);
        await joined;
        const received = memberSocket.waitFor('messageReceived');
        memberSocket.emit('sendMessage', {
            userId: invited.userId,
            channel,
            content: 'removed author recall target'
        });
        const message = await received;

        const removal = await requestJson(
            `${baseUrl}/api/channel/${channelPath}/members/${invited.userId}`,
            authOptions(owner.token, 'DELETE')
        );
        assert.equal(removal.response.status, 200);

        const denied = memberSocket.waitFor('recallFailed', 750);
        memberSocket.emit('recallMessage', { messageId: message.id, channel });
        assert.equal((await denied).reason, 'channel_access_denied');

        const messages = await requestJson(`${baseUrl}/api/messages/${channelPath}`, authOptions(owner.token));
        assert.equal(messages.body.messages.find(item => item.id === message.id).is_recalled, false);
    });

    await t.test('only the verified author who remains a member can recall a private-channel message', async () => {
        const ownerSocket = createSocketClient(baseUrl);
        sockets.push(ownerSocket);
        await ownerSocket.connected;
        const authenticated = ownerSocket.waitFor('authenticated', 750);
        ownerSocket.emit('authenticate', owner.token);
        assert.deepEqual(await authenticated, { userId: owner.userId });

        const joined = ownerSocket.waitFor('channelJoined');
        ownerSocket.emit('joinChannel', privateChannel, outsider.userId);
        await joined;
        const received = ownerSocket.waitFor('messageReceived');
        ownerSocket.emit('sendMessage', {
            userId: outsider.userId,
            channel: privateChannel,
            content: 'verified owner recall target'
        });
        const message = await received;

        const recalled = ownerSocket.waitFor('messageRecalled');
        ownerSocket.emit('recallMessage', { messageId: message.id, channel: privateChannel });
        assert.equal((await recalled).messageId, message.id);

        const messages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(owner.token));
        assert.equal(messages.body.messages.find(item => item.id === message.id).is_recalled, true);
    });

    await t.test('owner can remove a member, after which the channel disappears and access is forbidden', async () => {
        const removal = await requestJson(
            `${baseUrl}/api/channel/${privatePath}/members/${invited.userId}`,
            authOptions(owner.token, 'DELETE')
        );
        assert.equal(removal.response.status, 200);
        assert.equal(removal.body.success, true);

        const invitedList = await requestJson(`${baseUrl}/api/channels`, authOptions(invited.token));
        const invitedMessages = await requestJson(`${baseUrl}/api/messages/${privatePath}`, authOptions(invited.token));
        assert.deepEqual(invitedList.body.channels.map(c => c.name), PUBLIC_CHANNELS);
        assert.equal(invitedMessages.response.status, 403);
    });
});
