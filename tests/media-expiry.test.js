const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// 媒体过期清理：超过 7 天的上传（图片/视频/语音/文件）被列出并标记过期，字段清空但 file_name 保留
test('media expiry: old media messages are listed and marked expired', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-expiry-'));
    process.env.JCHAT_DB_FILE = path.join(tempDir, 'jchat.sqlite');
    const db = require('../server/db');

    const u = db.insertUser({ username: 'expiry_alice', password: 'x', email: null, nickname: 'A' });
    const u2 = db.insertUser({ username: 'expiry_bob', password: 'x', email: null, nickname: 'B' });
    const uid = u.id;

    // 频道消息：图片、视频、纯文本
    const imgMsg = db.insertMessage({ user_id: uid, channel: '公共频道', content: '', image: 'uploads/img.png' });
    const videoMsg = db.insertMessage({ user_id: uid, channel: '公共频道', content: '', video: 'uploads/vid.mp4', file_name: 'a.mp4' });
    const textMsg = db.insertMessage({ user_id: uid, channel: '公共频道', content: 'hi' });
    // 私聊消息：文件
    const dmMsg = db.insertDmMessage({ from_user_id: uid, to_user_id: u2.id, content: '', file: 'uploads/f.zip', file_name: 'f.zip' });

    // 未来时间戳作为 cutoff，命中所有已有媒体字段的消息
    const future = '2099-01-01T00:00:00.000Z';
    const { messages, dmMessages } = db.listExpiredMediaMessages(future);
    const channelIds = messages.map(m => m.id);
    assert.ok(channelIds.includes(imgMsg.id), 'image message listed');
    assert.ok(channelIds.includes(videoMsg.id), 'video message listed');
    assert.ok(!channelIds.includes(textMsg.id), 'text message not listed');
    assert.ok(dmMessages.some(m => m.id === dmMsg.id), 'dm file message listed');

    // 标记过期：媒体字段清空、media_expired=1、file_name 保留
    db.markMessageExpired(imgMsg.id);
    const imgAfter = db.getMessageById(imgMsg.id);
    assert.equal(imgAfter.image, null);
    assert.equal(imgAfter.media_expired, 1);

    db.markMessageExpired(videoMsg.id);
    const videoAfter = db.getMessageById(videoMsg.id);
    assert.equal(videoAfter.video, null);
    assert.equal(videoAfter.file_name, 'a.mp4');
    assert.equal(videoAfter.media_expired, 1);

    db.markDmMessageExpired(dmMsg.id);
    const dmAfter = db.getDmMessageById(dmMsg.id);
    assert.equal(dmAfter.file, null);
    assert.equal(dmAfter.file_name, 'f.zip');
    assert.equal(dmAfter.media_expired, 1);

    // 标记后再次列出不再命中（media_expired=0 过滤）
    const second = db.listExpiredMediaMessages(future);
    assert.ok(!second.messages.some(m => m.id === imgMsg.id));
    assert.ok(!second.dmMessages.some(m => m.id === dmMsg.id));

    // SQLite 文件句柄可能未释放，删除失败可忽略（临时目录由系统清理）
    try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (_) {}
});
