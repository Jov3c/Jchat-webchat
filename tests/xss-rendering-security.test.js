const assert = require('node:assert/strict');
const test = require('node:test');
const { validateMediaUrl } = require('../server/validation');

test('media URL guard rejects dangerous protocols and keeps only safe URLs', () => {
    // 危险协议一律拒绝
    for (const bad of [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        '  javascript:alert(1)  '
    ]) {
        assert.equal(validateMediaUrl(bad).ok, false, `should reject ${bad}`);
    }

    // 空值归一为 null
    assert.deepEqual(validateMediaUrl(null), { ok: true, value: null });
    assert.deepEqual(validateMediaUrl(undefined), { ok: true, value: null });
    assert.deepEqual(validateMediaUrl(''), { ok: true, value: null });
    assert.deepEqual(validateMediaUrl('   '), { ok: true, value: null });

    // 站内上传相对路径放行
    assert.deepEqual(validateMediaUrl('uploads/chat-safe.png'), { ok: true, value: 'uploads/chat-safe.png' });
    assert.deepEqual(validateMediaUrl('uploads/voice-123.mp3'), { ok: true, value: 'uploads/voice-123.mp3' });

    // http/https 外链放行
    assert.equal(validateMediaUrl('https://cdn.example.test/safe.png').ok, true);
    assert.equal(validateMediaUrl('http://cdn.example.test/safe.png').ok, true);

    // 其它协议 / 无法解析的字符串拒绝
    assert.equal(validateMediaUrl('ftp://cdn.example.test/x.png').ok, false);
    assert.equal(validateMediaUrl('not a url').ok, false);
    assert.equal(validateMediaUrl('//evil.com/x.png').ok, false);
    assert.equal(validateMediaUrl(123).ok, false);
});
