const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');

function loadRenderSecurityHelpers() {
    const start = chatJs.indexOf('const DEFAULT_AVATAR');
    const end = chatJs.indexOf('function getPinnedFriendIds');
    assert.ok(start >= 0 && end > start, 'chat renderer must expose the shared escaping and media URL helpers');
    const sandbox = { URL };
    vm.runInNewContext(`${chatJs.slice(start, end)}; helpers = { escapeHtml, escapeAttribute, safeMediaUrl, getAvatarUrl, safeMessageId };`, sandbox);
    return sandbox.helpers;
}

test('message renderer escapes markup and unsafe media URLs before channel or DM insertion', () => {
    const { escapeHtml, escapeAttribute, safeMediaUrl, getAvatarUrl, safeMessageId } = loadRenderSecurityHelpers();
    const payload = '<img src=x onerror=alert(1)>';
    assert.equal(escapeHtml(payload), '&lt;img src=x onerror=alert(1)&gt;');
    assert.match(escapeAttribute('" onerror="alert(1)'), /&quot;/);
    assert.equal(safeMediaUrl('javascript:alert(1)'), '');
    assert.equal(safeMediaUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(safeMediaUrl('uploads/chat-safe.png'), 'uploads/chat-safe.png');
    assert.equal(safeMediaUrl('https://cdn.example.test/safe.png'), 'https://cdn.example.test/safe.png');
    assert.equal(getAvatarUrl('javascript:alert(1)'), 'images/default.png');
    assert.equal(safeMessageId('1" data-x="pwned'), '');
    assert.equal(safeMessageId(' 42 '), '42');
});

test('channel and DM render paths use shared escaping and safe media URL guards', () => {
    const channelPath = chatJs.slice(chatJs.indexOf('function addMessageToDOM'), chatJs.indexOf('function formatTime'));
    const dmPath = chatJs.slice(chatJs.indexOf('function addDmMessageToDOM'), chatJs.indexOf('async function loadDmMessages'));
    for (const renderer of [channelPath, dmPath]) {
        assert.match(renderer, /escapeHtml\(/, 'stored user text must be escaped');
        assert.match(renderer, /safeMediaUrl\(/, 'stored media URLs must be validated');
        assert.match(renderer, /safeMessageId\(/, 'stored message ids must not break attributes');
        assert.doesNotMatch(renderer, /<div class="message-text">\$?\{?message\.content|<div class="message-text">' \+ mapped\.content/);
    }
});
