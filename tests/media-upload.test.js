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

test('media upload: videos and generic files allowed, dangerous types rejected', async (t) => {
    const projectRoot = path.join(__dirname, '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-media-'));
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

    const user = await (await fetch(`${baseUrl}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'media_alice', password: 'pass1234' })
    })).json();
    const auth = { authorization: `Bearer ${user.token}` };

    async function upload(field, blob, filename, apiPath) {
        const form = new FormData();
        form.append(field, blob, filename);
        const res = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: auth, body: form });
        const body = await res.json().catch(() => ({}));
        return { res, body };
    }

    // 1. 通用文件通道：允许 PDF 和 zip
    const pdf = await upload('file', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'doc.pdf', '/api/upload/file');
    assert.equal(pdf.res.status, 200);
    assert.ok(pdf.body.file && pdf.body.file.startsWith('uploads/file-'));

    const zip = await upload('file', new Blob(['PK\x03\x04'], { type: 'application/zip' }), 'archive.zip', '/api/upload/file');
    assert.equal(zip.res.status, 200);

    // 2. 危险类型被拒绝：html / exe（防 XSS 与可执行文件）
    const html = await upload('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html', '/api/upload/file');
    assert.equal(html.res.status, 400);
    assert.match(String(html.body.error || ''), /不支持的文件类型/);

    const exe = await upload('file', new Blob(['MZ\x90\x00'], { type: 'application/x-msdownload' }), 'virus.exe', '/api/upload/file');
    assert.equal(exe.res.status, 400);

    // 3. 视频通道：mp4 允许，mkv（不可浏览器预览）拒绝
    const mp4 = await upload('video', new Blob(['fake-mp4'], { type: 'video/mp4' }), 'clip.mp4', '/api/upload/video');
    assert.equal(mp4.res.status, 200);
    assert.ok(mp4.body.video && mp4.body.video.startsWith('uploads/video-'));

    const mkv = await upload('video', new Blob(['fake-mkv'], { type: 'video/x-matroska' }), 'clip.mkv', '/api/upload/video');
    assert.equal(mkv.res.status, 400);

    // 4. 图片通道仍是图片专属：pdf 应被拒
    const imgPdf = await upload('image', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'doc.pdf', '/api/upload/image');
    assert.equal(imgPdf.res.status, 400);

    // 5. 中文文件名不乱码（multer latin1 解码还原为 UTF-8）
    const cn = await upload('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), '项目报告.pdf', '/api/upload/file');
    assert.equal(cn.res.status, 200);
    assert.equal(cn.body.file_name, '项目报告.pdf');

    // 6. m4a 音频（不同 MIME 变体）应放行
    const m4a = await upload('file', new Blob(['fake-m4a'], { type: 'audio/x-m4a' }), '语音.m4a', '/api/upload/file');
    assert.equal(m4a.res.status, 200);
    assert.equal(m4a.body.file_name, '语音.m4a');
});
