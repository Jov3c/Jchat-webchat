const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const SECRET = 'test-session-secret';

test('session token verifies only while it is the user current session', () => {
    const users = new Map([[7, { id: 7, username: 'alice', banned: false, active_session_id: null }]]);
    const db = {
        getUserById(id) { return users.get(Number(id)) || null; },
        setUserSession(id, sessionId) {
            const user = users.get(Number(id));
            user.active_session_id = sessionId;
            return user;
        }
    };
    const { createUserSessionToken, verifyCurrentUserToken } = require('../server/user-session');

    const first = createUserSessionToken(7, SECRET, '1h');
    db.setUserSession(7, first.sessionId);
    assert.equal(verifyCurrentUserToken(first.token, SECRET, db).id, 7);

    const second = createUserSessionToken(7, SECRET, '1h');
    db.setUserSession(7, second.sessionId);
    assert.throws(
        () => verifyCurrentUserToken(first.token, SECRET, db),
        error => error.code === 'session_replaced'
    );
    assert.equal(verifyCurrentUserToken(second.token, SECRET, db).id, 7);
});

test('session verification rejects missing users and banned users with stable codes', () => {
    const { createUserSessionToken, verifyCurrentUserToken } = require('../server/user-session');
    const active = createUserSessionToken(9, SECRET, '1h');
    const missingDb = { getUserById() { return null; } };
    assert.throws(
        () => verifyCurrentUserToken(active.token, SECRET, missingDb),
        error => error.code === 'invalid_token'
    );

    const bannedDb = {
        getUserById() {
            return { id: 9, banned: true, active_session_id: active.sessionId };
        }
    };
    assert.throws(
        () => verifyCurrentUserToken(active.token, SECRET, bannedDb),
        error => error.code === 'banned'
    );

    const adminToken = jwt.sign({ admin: true }, SECRET, { expiresIn: '1h' });
    assert.throws(
        () => verifyCurrentUserToken(adminToken, SECRET, bannedDb),
        error => error.code === 'invalid_token'
    );
});
