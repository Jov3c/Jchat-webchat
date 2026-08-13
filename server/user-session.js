const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

class UserSessionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'UserSessionError';
        this.code = code;
    }
}

function createUserSessionToken(userId, jwtSecret, expiresIn) {
    const sessionId = crypto.randomUUID();
    const token = jwt.sign({ userId: Number(userId), sessionId }, jwtSecret, { expiresIn });
    return { sessionId, token };
}

function verifyCurrentUserToken(token, jwtSecret, db) {
    let decoded;
    try {
        decoded = jwt.verify(token, jwtSecret);
    } catch {
        throw new UserSessionError('invalid_token');
    }
    const userId = Number.parseInt(decoded?.userId, 10);
    if (!Number.isInteger(userId) || typeof decoded?.sessionId !== 'string') {
        throw new UserSessionError('invalid_token');
    }
    const user = db.getUserById(userId);
    if (!user) throw new UserSessionError('invalid_token');
    if (user.banned) throw new UserSessionError('banned');
    if (!user.active_session_id || user.active_session_id !== decoded.sessionId) {
        throw new UserSessionError('session_replaced');
    }
    return user;
}

module.exports = {
    UserSessionError,
    createUserSessionToken,
    verifyCurrentUserToken
};
