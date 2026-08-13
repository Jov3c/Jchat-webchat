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
    return { response, body: await response.json().catch(() => ({})) };
}

async function registerUser(baseUrl, username) {
    const result = await requestJson(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'pass1234' })
    });
    assert.equal(result.response.status, 201);
    return result.body;
}

function uploadOptions(token, form) {
    return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form };
}

function pngFile(name = 'image.png') {
    // A complete solid-color PNG that Sharp 0.35 can decode and re-encode.
    const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAMAAACahl6sAAAAA1BMVEX/AAAZ4gk3AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAPUlEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8GadCAABYe850QAAAABJRU5ErkJggg==', 'base64');
    return new File([data], name, { type: 'image/png' });
}

test('uploads require a session, use its user identity, and reject disallowed or oversized files', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-upload-security-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite') },
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

    for (const [route, field, file] of [
        ['/api/upload/avatar', 'avatar', pngFile('avatar.png')],
        ['/api/upload/image', 'image', pngFile('image.png')],
        ['/api/upload/voice', 'voice', new File(['voice'], 'voice.webm', { type: 'audio/webm' })]
    ]) {
        const unauthenticatedForm = new FormData();
        unauthenticatedForm.set(field, file);
        const unauthenticated = await requestJson(`${baseUrl}${route}`, { method: 'POST', body: unauthenticatedForm });
        assert.equal(unauthenticated.response.status, 401, `${route} must reject a file before it reaches Multer without a valid session`);
    }

    const owner = await registerUser(baseUrl, 'uploadowner');
    const victim = await registerUser(baseUrl, 'uploadvictim');
    const victimBefore = await requestJson(`${baseUrl}/api/profile/${victim.userId}`, { headers: { authorization: `Bearer ${owner.token}` } });
    const forgedIdentityForm = new FormData();
    forgedIdentityForm.set('userId', String(victim.userId));
    forgedIdentityForm.set('avatar', pngFile('avatar.png'));
    const forgedIdentity = await requestJson(`${baseUrl}/api/upload/avatar`, uploadOptions(owner.token, forgedIdentityForm));
    assert.equal(forgedIdentity.response.status, 200);
    const ownerProfile = await requestJson(`${baseUrl}/api/profile/${owner.userId}`, { headers: { authorization: `Bearer ${owner.token}` } });
    const victimProfile = await requestJson(`${baseUrl}/api/profile/${victim.userId}`, { headers: { authorization: `Bearer ${owner.token}` } });
    assert.match(ownerProfile.body.avatar, /^uploads\//, 'the token owner receives the new avatar');
    assert.equal(victimProfile.body.avatar, victimBefore.body.avatar, 'a form userId cannot alter another account');

    const recordedVoiceForm = new FormData();
    recordedVoiceForm.set('voice', new File(['recorded voice'], 'voice.webm', { type: 'audio/webm;codecs=opus' }));
    const recordedVoice = await requestJson(`${baseUrl}/api/upload/voice`, uploadOptions(owner.token, recordedVoiceForm));
    assert.equal(recordedVoice.response.status, 200, 'MediaRecorder webm MIME parameters remain compatible');

    const illegalForm = new FormData();
    illegalForm.set('voice', new File(['not-audio'], 'malware.exe', { type: 'application/octet-stream' }));
    const illegal = await requestJson(`${baseUrl}/api/upload/voice`, uploadOptions(owner.token, illegalForm));
    assert.equal(illegal.response.status, 400, 'non-audio uploads are rejected');

    const oversizedForm = new FormData();
    oversizedForm.set('image', new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'oversized.png', { type: 'image/png' }));
    const oversized = await requestJson(`${baseUrl}/api/upload/image`, uploadOptions(owner.token, oversizedForm));
    assert.equal(oversized.response.status, 413, 'oversized uploads are rejected before processing');
});

test('browser upload requests use page-isolated JWT authentication instead of a form userId', () => {
    const projectRoot = path.join(__dirname, '..');
    const chatJs = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'chat.js'), 'utf8');
    const registerJs = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'register.js'), 'utf8');

    for (const route of ['/api/upload/avatar', '/api/upload/image', '/api/upload/voice']) {
        const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(chatJs, new RegExp(`fetch\\('${escapedRoute}',\\s*\\{[\\s\\S]{0,160}?headers:\\s*getAuthHeaders\\(\\)`, 'g'), `${route} must send the current page JWT`);
    }
    assert.match(registerJs, /window\.JchatAuthStorage\.getAuthToken\(\)/);
    assert.match(registerJs, /fetch\('\/api\/upload\/avatar',[\s\S]{0,160}?Authorization': 'Bearer ' \+ token/);
    assert.doesNotMatch(chatJs, /formData\.append\('userId'/);
    assert.doesNotMatch(registerJs, /formData\.append\('userId'/);
});
