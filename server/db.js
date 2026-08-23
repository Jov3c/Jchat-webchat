const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dmCrypto = require('./dm-crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'jchat.sqlite');
const DB_FILE = process.env.JCHAT_DB_FILE || DEFAULT_DB_FILE;
const DEFAULT_AVATAR = 'images/default.png';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email TEXT UNIQUE,
    nickname TEXT,
    avatar TEXT,
    bio TEXT,
    gender TEXT,
    banned INTEGER NOT NULL DEFAULT 0,
    allow_add_friend_from_profile INTEGER NOT NULL DEFAULT 1,
    presence_status TEXT NOT NULL DEFAULT 'online',
    active_session_id TEXT,
    public_key TEXT,
    encrypted_private_key TEXT,
    salt TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    password TEXT,
    members TEXT NOT NULL DEFAULT '[]',
    owner_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image TEXT,
    voice TEXT,
    file TEXT,
    file_name TEXT,
    reply_to INTEGER,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    blocked_at TEXT,
    is_recalled INTEGER NOT NULL DEFAULT 0,
    recalled_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friends (
    user1 INTEGER NOT NULL,
    user2 INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user1, user2),
    FOREIGN KEY (user1) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS deactivation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS deactivation_locks (
    user_id INTEGER PRIMARY KEY,
    lock_until TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS blacklist (
    blocker_user_id INTEGER NOT NULL,
    blocked_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS clear_timestamps (
    scope TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    conversation_key TEXT NOT NULL,
    cleared_at TEXT NOT NULL,
    PRIMARY KEY (scope, owner_user_id, conversation_key)
  );
  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image TEXT,
    voice TEXT,
    file TEXT,
    file_name TEXT,
    reply_to INTEGER,
    is_recalled INTEGER NOT NULL DEFAULT 0,
    recalled_at TEXT,
    deleted_for TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS channel_aliases (
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    alias TEXT NOT NULL,
    PRIMARY KEY (user_id, channel),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS channel_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    invited_user_id INTEGER NOT NULL,
    inviter_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS pins (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS last_read (
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    last_read_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS stickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const channelColumns = sqlite.prepare('PRAGMA table_info(channels)').all();
if (!channelColumns.some(column => column.name === 'owner_id')) {
    sqlite.exec('ALTER TABLE channels ADD COLUMN owner_id INTEGER');
}

const userColumns = sqlite.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some(column => column.name === 'presence_status')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN presence_status TEXT NOT NULL DEFAULT 'online'");
}
if (!userColumns.some(column => column.name === 'active_session_id')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN active_session_id TEXT');
}
if (!userColumns.some(column => column.name === 'public_key')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN public_key TEXT');
}
if (!userColumns.some(column => column.name === 'encrypted_private_key')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN encrypted_private_key TEXT');
}
if (!userColumns.some(column => column.name === 'salt')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN salt TEXT');
}

const messageColumns = sqlite.prepare('PRAGMA table_info(messages)').all();
if (!messageColumns.some(column => column.name === 'file')) {
    sqlite.exec('ALTER TABLE messages ADD COLUMN file TEXT');
}
if (!messageColumns.some(column => column.name === 'file_name')) {
    sqlite.exec('ALTER TABLE messages ADD COLUMN file_name TEXT');
}

const dmColumns = sqlite.prepare('PRAGMA table_info(dm_messages)').all();
if (!dmColumns.some(column => column.name === 'file')) {
    sqlite.exec('ALTER TABLE dm_messages ADD COLUMN file TEXT');
}
if (!dmColumns.some(column => column.name === 'file_name')) {
    sqlite.exec('ALTER TABLE dm_messages ADD COLUMN file_name TEXT');
}

const users = [];
const messages = [];
const channels = {};
const friends = [];
const friendRequests = [];
const deactivationRequests = [];
const channelAliases = new Map(); // key: `${userId}:${channel}` → alias

const asObject = row => (row ? { ...row } : null);
const asBool = value => value === true || value === 1 || value === '1';
const int = value => Number.parseInt(value, 10);
const validInt = value => Number.isInteger(value) && !Number.isNaN(value);
const nowIso = () => new Date().toISOString();

function loadChannelAliases() {
    channelAliases.clear();
    for (const row of sqlite.prepare('SELECT * FROM channel_aliases').all()) {
        channelAliases.set(`${int(row.user_id)}:${row.channel}`, row.alias);
    }
}
loadChannelAliases();

function getChannelAlias(userId, channel) {
    return channelAliases.get(`${int(userId)}:${channel}`) || null;
}

function setChannelAlias(userId, channel, alias) {
    const uid = int(userId);
    const key = `${uid}:${channel}`;
    const value = alias == null ? '' : String(alias).trim();
    if (!value) {
        channelAliases.delete(key);
        sqlite.prepare('DELETE FROM channel_aliases WHERE user_id = ? AND channel = ?').run(uid, channel);
    } else {
        channelAliases.set(key, value);
        sqlite.prepare('INSERT INTO channel_aliases(user_id, channel, alias) VALUES (?, ?, ?) ON CONFLICT(user_id, channel) DO UPDATE SET alias = excluded.alias').run(uid, channel, value);
    }
}

function createChannelInvite(channel, invitedUserId, inviterUserId) {
    const iid = int(invitedUserId), irid = int(inviterUserId);
    if (!validInt(iid) || !validInt(irid)) return null;
    const result = sqlite.prepare('INSERT INTO channel_invites(channel, invited_user_id, inviter_user_id, status, created_at) VALUES (?, ?, ?, \'pending\', ?)').run(channel, iid, irid, nowIso());
    return sqlite.prepare('SELECT * FROM channel_invites WHERE id = ?').get(Number(result.lastInsertRowid)) || null;
}

function getPendingChannelInvites(userId) {
    const uid = int(userId);
    if (!validInt(uid)) return [];
    return sqlite.prepare('SELECT * FROM channel_invites WHERE invited_user_id = ? AND status = \'pending\' ORDER BY id DESC').all(uid).map(asObject);
}

function respondChannelInvite(id, userId, action) {
    const invite = sqlite.prepare('SELECT * FROM channel_invites WHERE id = ?').get(int(id));
    if (!invite) return { ok: false, error: 'not_found' };
    if (int(invite.invited_user_id) !== int(userId)) return { ok: false, error: 'not_authorized' };
    if (invite.status !== 'pending') return { ok: false, error: 'already_resolved' };
    if (!['accept', 'reject'].includes(action)) return { ok: false, error: 'invalid_action' };
    const status = action === 'accept' ? 'accepted' : 'rejected';
    sqlite.prepare('UPDATE channel_invites SET status = ? WHERE id = ?').run(status, invite.id);
    return { ok: true, invite: { ...invite, status } };
}

const pins = new Map(); // key: `${userId}:${kind}:${key}` → true
function loadPins() {
    pins.clear();
    for (const row of sqlite.prepare('SELECT * FROM pins').all()) {
        pins.set(`${int(row.user_id)}:${row.kind}:${row.key}`, true);
    }
}
loadPins();

function isPinned(userId, kind, key) {
    return pins.has(`${int(userId)}:${kind}:${key}`);
}

function setPin(userId, kind, key, pinned) {
    const uid = int(userId);
    const k = `${uid}:${kind}:${key}`;
    if (pinned) {
        pins.set(k, true);
        sqlite.prepare('INSERT OR IGNORE INTO pins(user_id, kind, key, created_at) VALUES (?, ?, ?, ?)').run(uid, kind, key, nowIso());
    } else {
        pins.delete(k);
        sqlite.prepare('DELETE FROM pins WHERE user_id = ? AND kind = ? AND key = ?').run(uid, kind, key);
    }
}

function getLastDmMessageAt(userId, peerId) {
    const row = sqlite.prepare('SELECT MAX(created_at) AS t FROM dm_messages WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)').get(int(userId), int(peerId), int(peerId), int(userId));
    return row?.t || null;
}

function getLastChannelMessageAt(channel) {
    const row = sqlite.prepare('SELECT MAX(created_at) AS t FROM messages WHERE channel = ?').get(channel);
    return row?.t || null;
}

function getLastReadAt(userId, kind, key) {
    const row = sqlite.prepare('SELECT last_read_at FROM last_read WHERE user_id = ? AND kind = ? AND key = ?').get(int(userId), kind, key);
    return row?.last_read_at || null;
}

function markRead(userId, kind, key) {
    const uid = int(userId);
    const now = nowIso();
    sqlite.prepare('INSERT INTO last_read(user_id, kind, key, last_read_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind, key) DO UPDATE SET last_read_at = excluded.last_read_at').run(uid, kind, key, now);
}

function getUnreadCount(userId, kind, key) {
    const uid = int(userId);
    const since = getLastReadAt(uid, kind, key) || '';
    if (kind === 'dm') {
        const row = sqlite.prepare('SELECT COUNT(*) AS c FROM dm_messages WHERE from_user_id = ? AND to_user_id = ? AND created_at > ?').get(int(key), uid, since);
        return row?.c || 0;
    }
    const row = sqlite.prepare('SELECT COUNT(*) AS c FROM messages WHERE channel = ? AND user_id != ? AND created_at > ?').get(key, uid, since);
    return row?.c || 0;
}

function getReactions(messageId) {
    const rows = sqlite.prepare('SELECT user_id, emoji FROM reactions WHERE message_id = ?').all(int(messageId));
    const byEmoji = {};
    for (const r of rows) {
        if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
        byEmoji[r.emoji].push(int(r.user_id));
    }
    return Object.entries(byEmoji).map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}

function toggleReaction(messageId, userId, emoji) {
    const mid = int(messageId), uid = int(userId);
    if (!validInt(mid) || !validInt(uid) || typeof emoji !== 'string' || !emoji) return null;
    const existing = sqlite.prepare('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?').get(mid, uid);
    if (existing && existing.emoji === emoji) {
        sqlite.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(mid, uid);
    } else {
        sqlite.prepare('INSERT INTO reactions(message_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji').run(mid, uid, emoji);
    }
    return getReactions(mid);
}

function getStickers(userId) {
    const uid = int(userId);
    if (!validInt(uid)) return [];
    return sqlite.prepare('SELECT id, url, created_at FROM stickers WHERE user_id = ? ORDER BY id DESC').all(uid).map(asObject);
}

function getStickerById(id, userId) {
    const row = sqlite.prepare('SELECT id, url, created_at FROM stickers WHERE id = ? AND user_id = ?').get(int(id), int(userId));
    return row ? asObject(row) : null;
}

function addSticker(userId, url) {
    const uid = int(userId);
    if (!validInt(uid) || typeof url !== 'string' || !url) return null;
    const result = sqlite.prepare('INSERT INTO stickers(user_id, url) VALUES (?, ?)').run(uid, url);
    return getStickerById(result.lastInsertRowid, uid);
}

function deleteSticker(id, userId) {
    const result = sqlite.prepare('DELETE FROM stickers WHERE id = ? AND user_id = ?').run(int(id), int(userId));
    return result.changes > 0;
}

function userFromRow(row) {
    if (!row) return null;
    const user = asObject(row);
    user.banned = asBool(user.banned);
    user.allow_add_friend_from_profile = asBool(user.allow_add_friend_from_profile);
    return user;
}

function messageFromRow(row) {
    if (!row) return null;
    const message = asObject(row);
    message.is_blocked = asBool(message.is_blocked);
    message.is_recalled = asBool(message.is_recalled);
    return message;
}

function dmFromRow(row) {
    if (!row) return null;
    const message = asObject(row);
    const raw = message.content;
    message.content = (typeof raw === 'string' && raw.startsWith('e2ee:')) ? raw : dmCrypto.decrypt(raw);
    message.is_recalled = asBool(message.is_recalled);
    try { message.deleted_for = JSON.parse(message.deleted_for || '[]'); } catch { message.deleted_for = []; }
    return message;
}

function refreshCaches() {
    users.splice(0, users.length, ...sqlite.prepare('SELECT * FROM users ORDER BY id').all().map(userFromRow));
    messages.splice(0, messages.length, ...sqlite.prepare('SELECT * FROM messages ORDER BY id').all().map(messageFromRow));
    friends.splice(0, friends.length, ...sqlite.prepare('SELECT * FROM friends ORDER BY created_at').all().map(row => ({ ...row, key: `${row.user1}:${row.user2}` })));
    friendRequests.splice(0, friendRequests.length, ...sqlite.prepare('SELECT * FROM friend_requests ORDER BY id').all().map(asObject));
    deactivationRequests.splice(0, deactivationRequests.length, ...sqlite.prepare('SELECT * FROM deactivation_requests ORDER BY id').all().map(asObject));
    Object.keys(channels).forEach(key => delete channels[key]);
    for (const row of sqlite.prepare('SELECT * FROM channels ORDER BY name').all()) {
        let members = [];
        try { members = JSON.parse(row.members || '[]'); } catch { members = []; }
        const normalizedMembers = Array.isArray(members)
            ? [...new Set(members.map(int).filter(validInt))]
            : [];
        channels[row.name] = {
            password: row.password,
            members: normalizedMembers,
            owner_id: row.owner_id == null ? null : int(row.owner_id)
        };
    }
}

function saveData() {
    sqlite.exec('BEGIN');
    try {
        sqlite.exec('DELETE FROM channels');
        const statement = sqlite.prepare('INSERT INTO channels(name, password, members, owner_id) VALUES (?, ?, ?, ?)');
        for (const [name, channel] of Object.entries(channels)) {
            statement.run(
                name,
                channel.password || null,
                JSON.stringify(channel.members || []),
                channel.owner_id == null ? null : int(channel.owner_id)
            );
        }
        sqlite.exec('COMMIT');
    } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
    }
}

function getUsers() { return users; }
function getUserById(id) { return users.find(user => user.id === int(id)) || null; }
function getUserByUsername(username) { return users.find(user => user.username === username) || null; }
function getUserByEmail(email) { return users.find(user => user.email === email) || null; }
function getUserByNickname(nickname) { return users.find(user => user.nickname === nickname) || null; }
function getUserByIdentifier(identifier) {
    const value = identifier == null ? '' : String(identifier).trim();
    return value ? getUserByUsername(value) : null;
}

function importLegacyUsers(legacyUsers) {
    if (!Array.isArray(legacyUsers) || !legacyUsers.length) return 0;
    const existing = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get();
    if (Number(existing?.count || 0) > 0) return 0;

    const insertWithId = sqlite.prepare(`INSERT OR IGNORE INTO users
      (id, username, password, email, nickname, avatar, bio, gender, banned, allow_add_friend_from_profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertWithoutId = sqlite.prepare(`INSERT OR IGNORE INTO users
      (username, password, email, nickname, avatar, bio, gender, banned, allow_add_friend_from_profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const records = legacyUsers
        .slice()
        .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0))
        .map(record => {
            const username = String(record?.username || '').trim();
            const password = String(record?.password || '');
            if (!username || !password) return null;
            const id = Number(record?.id);
            return {
                id: Number.isInteger(id) && id > 0 ? id : null,
                username,
                password,
                email: record?.email ? String(record.email).trim() : null,
                nickname: record?.nickname ? String(record.nickname) : username,
                avatar: record?.avatar || null,
                bio: record?.bio || null,
                gender: record?.gender || null,
                banned: record?.banned === true || record?.banned === 1 ? 1 : 0,
                allowAddFriend: record?.allow_add_friend_from_profile === false || record?.allow_add_friend_from_profile === 0 ? 0 : 1,
                createdAt: record?.created_at ? String(record.created_at) : nowIso()
            };
        })
        .filter(Boolean);

    if (!records.length) return 0;
    let imported = 0;
    sqlite.exec('BEGIN');
    try {
        for (const record of records) {
            const values = [
                record.username, record.password, record.email, record.nickname, record.avatar,
                record.bio, record.gender, record.banned, record.allowAddFriend, record.createdAt
            ];
            const result = record.id
                ? insertWithId.run(record.id, ...values)
                : insertWithoutId.run(...values);
            imported += Number(result.changes || 0);
        }
        sqlite.exec('COMMIT');
    } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
    }
    if (imported) refreshCaches();
    return imported;
}

function importLegacyUsersFromFile() {
    if (DB_FILE !== DEFAULT_DB_FILE) return 0;
    const legacyFile = path.join(DATA_DIR, 'users.json');
    if (!fs.existsSync(legacyFile)) return 0;
    try {
        const legacyUsers = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
        return importLegacyUsers(legacyUsers);
    } catch (error) {
        console.warn('[WARN] Legacy users migration skipped:', error.message);
        return 0;
    }
}

function insertUser(userData) {
    const createdAt = nowIso();
    const result = sqlite.prepare(`INSERT INTO users
      (username, password, email, nickname, avatar, bio, gender, banned, allow_add_friend_from_profile, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        userData.username,
        userData.password,
        userData.email || null,
        userData.nickname || userData.username,
        null,
        null,
        null,
        0,
        userData.allow_add_friend_from_profile === false ? 0 : 1,
        createdAt
    );
    refreshCaches();
    return getUserById(Number(result.lastInsertRowid));
}

function updateUser(id, userData) {
    const userId = int(id);
    if (!getUserById(userId)) return null;
    const allowed = ['username', 'password', 'email', 'nickname', 'avatar', 'bio', 'gender', 'banned', 'allow_add_friend_from_profile', 'presence_status', 'public_key', 'encrypted_private_key', 'salt'];
    const entries = Object.entries(userData).filter(([key]) => allowed.includes(key));
    if (!entries.length) return getUserById(userId);
    const values = entries.map(([, value]) => value === null ? null : value === true ? 1 : value === false ? 0 : value);
    sqlite.prepare(`UPDATE users SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...values, userId);
    refreshCaches();
    return getUserById(userId);
}

function setUserSession(id, sessionId) {
    const userId = int(id);
    if (!getUserById(userId)) return null;
    sqlite.prepare('UPDATE users SET active_session_id = ? WHERE id = ?').run(sessionId, userId);
    refreshCaches();
    return getUserById(userId);
}

function clearUserSession(id, sessionId) {
    const userId = int(id);
    const result = sqlite.prepare('UPDATE users SET active_session_id = NULL WHERE id = ? AND active_session_id = ?')
        .run(userId, sessionId);
    if (!result.changes) return false;
    refreshCaches();
    return true;
}

function deleteUser(id) {
    const userId = int(id);
    const result = sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
    if (!result.changes) return false;
    refreshCaches();
    return true;
}

function getChannelClearTime(userId, channel) {
    const row = sqlite.prepare('SELECT cleared_at FROM clear_timestamps WHERE scope = ? AND owner_user_id = ? AND conversation_key = ?').get('channel', int(userId), channel);
    return row ? row.cleared_at : null;
}

function setChannelClearTime(userId, channel) {
    const value = nowIso();
    sqlite.prepare(`INSERT INTO clear_timestamps(scope, owner_user_id, conversation_key, cleared_at)
      VALUES ('channel', ?, ?, ?) ON CONFLICT(scope, owner_user_id, conversation_key)
      DO UPDATE SET cleared_at = excluded.cleared_at`).run(int(userId), channel, value);
    return value;
}

function getDmClearTime(userId, dmKey) {
    const row = sqlite.prepare('SELECT cleared_at FROM clear_timestamps WHERE scope = ? AND owner_user_id = ? AND conversation_key = ?').get('dm', int(userId), dmKey);
    return row ? row.cleared_at : null;
}

function setDmClearTime(userId, dmKey) {
    const value = nowIso();
    sqlite.prepare(`INSERT INTO clear_timestamps(scope, owner_user_id, conversation_key, cleared_at)
      VALUES ('dm', ?, ?, ?) ON CONFLICT(scope, owner_user_id, conversation_key)
      DO UPDATE SET cleared_at = excluded.cleared_at`).run(int(userId), dmKey, value);
    return value;
}

function getMessagesByChannel(channel) { return messages.filter(message => message.channel === channel); }
function getMessageById(id) { return messages.find(message => message.id === int(id)) || null; }

function insertMessage(messageData) {
    const blocked = messageData.is_blocked ? 1 : 0;
    const result = sqlite.prepare(`INSERT INTO messages
      (user_id, channel, content, image, voice, file, file_name, reply_to, is_blocked, blocked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        int(messageData.user_id), messageData.channel, messageData.content || '', messageData.image || null,
        messageData.voice || null, messageData.file || null, messageData.file_name || null,
        messageData.reply_to || null, blocked, blocked ? nowIso() : null, nowIso()
    );
    refreshCaches();
    return getMessageById(Number(result.lastInsertRowid));
}

function updateMessage(id, updates) {
    const message = getMessageById(id);
    if (!message) return null;
    const allowed = ['user_id', 'channel', 'content', 'image', 'voice', 'reply_to', 'is_blocked', 'blocked_at', 'is_recalled', 'recalled_at'];
    const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
    if (!entries.length) return message;
    if (updates.is_recalled) { updates.image = null; updates.voice = null; }
    const values = entries.map(([, value]) => value === true ? 1 : value === false ? 0 : value);
    sqlite.prepare(`UPDATE messages SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...values, int(id));
    refreshCaches();
    return getMessageById(id);
}

function deleteMessage(id) {
    const result = sqlite.prepare('DELETE FROM messages WHERE id = ?').run(int(id));
    if (!result.changes) return false;
    refreshCaches();
    return true;
}

function purgeRecalledChannelMessagesOlderThan(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = sqlite.prepare('SELECT id, channel FROM messages WHERE is_recalled = 1 AND recalled_at < ?').all(cutoff).map(asObject);
    sqlite.prepare('DELETE FROM messages WHERE is_recalled = 1 AND recalled_at < ?').run(cutoff);
    if (rows.length) refreshCaches();
    return rows;
}

function normalizePair(a, b) {
    const x = int(a); const y = int(b);
    if (!validInt(x) || !validInt(y)) return null;
    return x < y ? [x, y] : [y, x];
}
function getConversationKey(a, b) {
    const pair = normalizePair(a, b);
    return pair ? `${pair[0]}:${pair[1]}` : null;
}

function areFriends(userIdA, userIdB) {
    const pair = normalizePair(userIdA, userIdB);
    return !!pair && !!sqlite.prepare('SELECT 1 FROM friends WHERE user1 = ? AND user2 = ?').get(...pair);
}
function getFriends(userId) {
    const uid = int(userId); if (!validInt(uid)) return [];
    return sqlite.prepare(`SELECT u.id, u.username, u.nickname, u.avatar FROM users u
      JOIN friends f ON (f.user1 = u.id OR f.user2 = u.id) WHERE (f.user1 = ? OR f.user2 = ?) AND u.id <> ? ORDER BY u.id`).all(uid, uid, uid).map(row => ({ ...row, nickname: row.nickname || row.username, avatar: row.avatar || DEFAULT_AVATAR }));
}
function addFriendship(userIdA, userIdB) {
    const pair = normalizePair(userIdA, userIdB);
    if (!pair || pair[0] === pair[1]) return null;
    sqlite.prepare('INSERT OR IGNORE INTO friends(user1, user2, created_at) VALUES (?, ?, ?)').run(...pair, nowIso());
    refreshCaches();
    return `${pair[0]}:${pair[1]}`;
}
function removeFriendship(userIdA, userIdB) {
    const pair = normalizePair(userIdA, userIdB); if (!pair) return false;
    const result = sqlite.prepare('DELETE FROM friends WHERE user1 = ? AND user2 = ?').run(...pair);
    if (result.changes) refreshCaches();
    return !!result.changes;
}
function clearDmDataBetween(userIdA, userIdB) {
    const pair = normalizePair(userIdA, userIdB); if (!pair) return;
    sqlite.prepare('DELETE FROM dm_messages WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)').run(pair[0], pair[1], pair[1], pair[0]);
    sqlite.prepare('DELETE FROM clear_timestamps WHERE scope = ? AND conversation_key = ?').run('dm', `${pair[0]}_${pair[1]}`);
}

function createFriendRequest(fromUserId, toUserId, message) {
    const fromId = int(fromUserId); const toId = int(toUserId);
    if (!validInt(fromId) || !validInt(toId)) return { ok: false, error: 'invalid_user' };
    if (fromId === toId) return { ok: false, error: 'cannot_add_self' };
    if (!getUserById(toId)) return { ok: false, error: 'target_not_found' };
    if (areFriends(fromId, toId)) return { ok: false, error: 'already_friends' };
    const existing = friendRequests.find(request => request.status === 'pending' && ((request.from_user_id === fromId && request.to_user_id === toId) || (request.from_user_id === toId && request.to_user_id === fromId)));
    if (existing) return { ok: false, error: 'request_already_pending', request: existing };
    const timestamp = nowIso();
    const result = sqlite.prepare(`INSERT INTO friend_requests(from_user_id, to_user_id, status, message, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)`).run(fromId, toId, message && String(message).trim() ? String(message).trim() : null, timestamp, timestamp);
    refreshCaches();
    return { ok: true, request: friendRequests.find(request => request.id === Number(result.lastInsertRowid)) };
}
function getIncomingFriendRequests(userId) {
    const uid = int(userId); if (!validInt(uid)) return [];
    return friendRequests.filter(request => request.to_user_id === uid && request.status === 'pending').map(request => {
        const from = getUserById(request.from_user_id);
        return { id: request.id, from_user: from ? { id: from.id, username: from.username, nickname: from.nickname || from.username, avatar: from.avatar || DEFAULT_AVATAR } : { id: request.from_user_id, username: 'Deleted user', nickname: 'Deleted user', avatar: DEFAULT_AVATAR }, message: request.message || null, created_at: request.created_at };
    });
}
function respondFriendRequest(requestId, responderUserId, action) {
    const request = friendRequests.find(item => item.id === int(requestId));
    const responderId = int(responderUserId);
    if (!request || !validInt(responderId)) return { ok: false, error: request ? 'invalid_request' : 'not_found' };
    if (request.to_user_id !== responderId) return { ok: false, error: 'not_authorized' };
    if (request.status !== 'pending') return { ok: false, error: 'already_resolved' };
    if (!['accept', 'reject'].includes(action)) return { ok: false, error: 'invalid_action' };
    const status = action === 'accept' ? 'accepted' : 'rejected';
    sqlite.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), request.id);
    if (action === 'accept') addFriendship(request.from_user_id, request.to_user_id);
    refreshCaches();
    return { ok: true, request: friendRequests.find(item => item.id === request.id) };
}

function getDeactivationLock(userId) {
    const row = sqlite.prepare('SELECT lock_until FROM deactivation_locks WHERE user_id = ?').get(int(userId));
    if (!row) return null;
    if (Date.now() >= new Date(row.lock_until).getTime()) { sqlite.prepare('DELETE FROM deactivation_locks WHERE user_id = ?').run(int(userId)); return null; }
    return row.lock_until;
}
function addDeactivationRequest(userId, reason) {
    const uid = int(userId); const lock = getDeactivationLock(uid); if (lock) return { locked: true, lock_until: lock };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM deactivation_requests WHERE user_id = ? AND created_at >= ?').get(uid, since).count;
    if (Number(count) >= 3) { const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); sqlite.prepare('INSERT OR REPLACE INTO deactivation_locks(user_id, lock_until) VALUES (?, ?)').run(uid, until); return { locked: true, lock_until: until }; }
    if (deactivationRequests.some(request => request.user_id === uid && request.status === 'pending')) return null;
    const result = sqlite.prepare(`INSERT INTO deactivation_requests(user_id, reason, status, created_at) VALUES (?, ?, 'pending', ?)`).run(uid, String(reason).trim(), nowIso());
    refreshCaches();
    return deactivationRequests.find(request => request.id === Number(result.lastInsertRowid));
}
function getDeactivationRequestByUserId(userId) { return deactivationRequests.find(request => request.user_id === int(userId) && request.status === 'pending') || null; }
function getDeactivationRequestById(id) { return deactivationRequests.find(request => request.id === int(id)) || null; }
function getDeactivationRequests() { return deactivationRequests.slice(); }
function updateDeactivationRequestStatus(id, status) {
    if (!['approved', 'rejected'].includes(status)) return null;
    sqlite.prepare('UPDATE deactivation_requests SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), int(id));
    refreshCaches();
    return getDeactivationRequestById(id);
}

function getBlockedUserIds(blockerUserId) { return sqlite.prepare('SELECT blocked_user_id FROM blacklist WHERE blocker_user_id = ? ORDER BY blocked_user_id').all(int(blockerUserId)).map(row => row.blocked_user_id); }
function isBlocked(blockerUserId, blockedUserId) { return !!sqlite.prepare('SELECT 1 FROM blacklist WHERE blocker_user_id = ? AND blocked_user_id = ?').get(int(blockerUserId), int(blockedUserId)); }
function addBlock(blockerUserId, blockedUserId) {
    const blocker = int(blockerUserId); const blocked = int(blockedUserId);
    if (!validInt(blocked) || blocker === blocked) return false;
    sqlite.prepare('INSERT OR IGNORE INTO blacklist(blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?)').run(blocker, blocked, nowIso());
    return true;
}
function removeBlock(blockerUserId, blockedUserId) { return !!sqlite.prepare('DELETE FROM blacklist WHERE blocker_user_id = ? AND blocked_user_id = ?').run(int(blockerUserId), int(blockedUserId)).changes; }

function getDmMessagesBetween(userIdA, userIdB, viewerUserId) {
    const a = int(userIdA); const b = int(userIdB); const viewer = int(viewerUserId);
    if (!validInt(a) || !validInt(b) || !validInt(viewer)) return [];
    return sqlite.prepare(`SELECT * FROM dm_messages WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?) ORDER BY id`).all(a, b, b, a).map(dmFromRow).filter(message => !message.deleted_for.includes(viewer));
}
function getDmMessageById(id) { return dmFromRow(sqlite.prepare('SELECT * FROM dm_messages WHERE id = ?').get(int(id))); }
function insertDmMessage({ from_user_id, to_user_id, content, image, voice, file, file_name, reply_to }) {
    const fromId = int(from_user_id); const toId = int(to_user_id); if (!normalizePair(fromId, toId)) return null;
    const raw = content || '';
    const stored = (typeof raw === 'string' && raw.startsWith('e2ee:')) ? raw : dmCrypto.encrypt(raw);
    const result = sqlite.prepare(`INSERT INTO dm_messages(from_user_id, to_user_id, content, image, voice, file, file_name, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(fromId, toId, stored, image || null, voice || null, file || null, file_name || null, reply_to != null ? int(reply_to) : null, nowIso());
    return getDmMessageById(Number(result.lastInsertRowid));
}
function updateDmMessage(id, updates) {
    const allowed = ['content', 'image', 'voice', 'reply_to', 'is_recalled', 'recalled_at', 'deleted_for'];
    const entries = Object.entries(updates).filter(([key]) => allowed.includes(key)); if (!entries.length) return getDmMessageById(id);
    const values = entries.map(([key, value]) => key === 'content' ? dmCrypto.encrypt(value || '') : key === 'is_recalled' ? (value ? 1 : 0) : key === 'deleted_for' ? JSON.stringify(value || []) : value);
    sqlite.prepare(`UPDATE dm_messages SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...values, int(id));
    return getDmMessageById(id);
}
function deleteDmMessage(messageId, requestedByUserId) {
    const message = getDmMessageById(messageId); if (!message || message.from_user_id !== int(requestedByUserId)) return false;
    if ((Date.now() - new Date(message.created_at).getTime()) / 60000 > 2) return false;
    return !!sqlite.prepare('DELETE FROM dm_messages WHERE id = ?').run(int(messageId)).changes;
}
function removeRecalledDmMessageById(messageId) { const message = getDmMessageById(messageId); return !!(message && message.is_recalled && sqlite.prepare('DELETE FROM dm_messages WHERE id = ?').run(int(messageId)).changes); }
function deleteDmMessageForUser(messageId, userId) {
    const message = getDmMessageById(messageId); const uid = int(userId);
    if (!message || (message.from_user_id !== uid && message.to_user_id !== uid)) return { ok: false };
    const deletedFor = Array.isArray(message.deleted_for) ? message.deleted_for : []; if (!deletedFor.includes(uid)) deletedFor.push(uid);
    updateDmMessage(messageId, { deleted_for: deletedFor });
    return { ok: true, conversation_key: getConversationKey(message.from_user_id, message.to_user_id) };
}
function clearDmConversationForUser(userIdA, userIdB, userId) {
    const messagesForUser = getDmMessagesBetween(userIdA, userIdB, userId);
    for (const message of messagesForUser) deleteDmMessageForUser(message.id, userId);
    return { ok: true, conversation_key: getConversationKey(userIdA, userIdB) };
}
function purgeRecalledDmMessagesOlderThan(maxAgeMs) {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = sqlite.prepare('SELECT id, from_user_id, to_user_id FROM dm_messages WHERE is_recalled = 1 AND recalled_at < ?').all(cutoff).map(row => ({ messageId: row.id, fromId: row.from_user_id, toId: row.to_user_id }));
    sqlite.prepare('DELETE FROM dm_messages WHERE is_recalled = 1 AND recalled_at < ?').run(cutoff);
    return rows;
}
function resetAllMessages() {
    sqlite.exec('DELETE FROM messages; DELETE FROM dm_messages; DELETE FROM clear_timestamps;');
    refreshCaches();
}

refreshCaches();
importLegacyUsersFromFile();

module.exports = {
    users, messages, channels, friends, friendRequests,
    getUsers, getUserById, getUserByUsername, getUserByEmail, getUserByNickname, getUserByIdentifier,
    importLegacyUsers, insertUser, updateUser, setUserSession, clearUserSession, deleteUser, addDeactivationRequest, getDeactivationLock,
    getDeactivationRequestByUserId, getDeactivationRequestById, getDeactivationRequests,
    updateDeactivationRequestStatus, getMessagesByChannel, getMessageById, insertMessage,
    updateMessage, deleteMessage, purgeRecalledChannelMessagesOlderThan, purgeRecalledDmMessagesOlderThan,
    areFriends, getFriends, addFriendship, removeFriendship, createFriendRequest,
    getIncomingFriendRequests, respondFriendRequest, getDmMessagesBetween, getDmMessageById,
    updateDmMessage, insertDmMessage, deleteDmMessage, removeRecalledDmMessageById,
    deleteDmMessageForUser, clearDmConversationForUser, getConversationKey, saveData,
    resetAllMessages, getChannelClearTime, setChannelClearTime, getDmClearTime, setDmClearTime,
    clearDmDataBetween, isBlocked, addBlock, removeBlock, getBlockedUserIds,
    getChannelAlias, setChannelAlias,
    createChannelInvite, getPendingChannelInvites, respondChannelInvite,
    isPinned, setPin, getLastDmMessageAt, getLastChannelMessageAt,
    markRead, getUnreadCount, getReactions, toggleReaction,
    getStickers, getStickerById, addSticker, deleteSticker
};
