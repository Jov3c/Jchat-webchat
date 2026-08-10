const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('SQLite database imports legacy users and persists core records', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-db-'));
    const dbPath = path.join(tempDir, 'jchat.sqlite');
    process.env.JCHAT_DB_FILE = dbPath;

    const db = require('../server/db');

    assert.equal(fs.existsSync(dbPath), true);
    assert.deepEqual(db.getUsers(), []);

    const imported = db.importLegacyUsers([{
        id: 1,
        username: 'legacy-admin',
        password: 'legacy-hash',
        nickname: 'Legacy Admin',
        email: 'legacy@example.com',
        created_at: '2026-08-03T06:52:44.440Z'
    }]);
    assert.equal(imported, 1);
    assert.equal(db.getUserByUsername('legacy-admin').email, 'legacy@example.com');

    const user = db.insertUser({
        username: 'alice',
        password: 'hashed',
        nickname: 'Alice'
    });
    assert.equal(db.getUserById(user.id).username, 'alice');
    assert.equal(db.getUserById(user.id).presence_status, 'online');
    assert.equal(db.getUserById(user.id).active_session_id, null);

    db.updateUser(user.id, { presence_status: 'invisible' });
    assert.equal(db.getUserById(user.id).presence_status, 'invisible');

    db.setUserSession(user.id, 'session-one');
    assert.equal(db.getUserById(user.id).active_session_id, 'session-one');
    assert.equal(db.clearUserSession(user.id, 'different-session'), false);
    assert.equal(db.getUserById(user.id).active_session_id, 'session-one');
    assert.equal(db.clearUserSession(user.id, 'session-one'), true);
    assert.equal(db.getUserById(user.id).active_session_id, null);

    const message = db.insertMessage({
        user_id: user.id,
        channel: 'General',
        content: 'hello'
    });
    assert.equal(db.getMessagesByChannel('General')[0].content, 'hello');
    assert.equal(db.getMessageById(message.id).user_id, user.id);
});
