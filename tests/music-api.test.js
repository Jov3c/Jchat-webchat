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

test('music card endpoint validates the song id', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-music-'));
    const port = await getFreePort();
    const child = spawn(process.execPath, ['index.js'], {
        cwd: projectRoot,
        env: { ...process.env, PORT: String(port), JCHAT_DB_FILE: path.join(tempDir, 'jchat.sqlite') },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/api/version`);

    // 缺 id → 400
    const noId = await fetch(`${baseUrl}/api/music`);
    assert.equal(noId.status, 400);

    // 非数字 id → 400（清洗后为空）
    const badId = await fetch(`${baseUrl}/api/music?id=abc`);
    assert.equal(badId.status, 400);

    // 数字 id → 返回结构（若外部接口可达则 ok:true；网络不可达返回 502 或 not found 都算接口正常）
    const okId = await fetch(`${baseUrl}/api/music?id=1382596189`);
    if (okId.status === 200) {
        const body = await okId.json();
        assert.equal(typeof body.ok, 'boolean');
    } else {
        assert.ok([502].includes(okId.status), 'external fetch should degrade gracefully');
    }
});
