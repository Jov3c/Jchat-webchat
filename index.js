const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
let sharp = null;
try {
    sharp = require('sharp');
} catch (e) {
    console.warn('[WARN] sharp 未安装或不可用，将禁用图片处理相关功能（头像/图片压缩）。');
}
const fs = require('fs');
const db = require('./server/db');
const logger = require('./server/log');
const badWordsFilter = require('./server/badwords');
const { createUserSessionToken, verifyCurrentUserToken } = require('./server/user-session');
const { PresenceRegistry, VALID_PRESENCE_STATUSES } = require('./server/presence');
const DEFAULT_AVATAR = 'images/default.png';
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

function parsePositiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function isAllowedOrigin(origin) {
    if (!origin) return true;
    let url;
    try {
        url = new URL(origin);
    } catch (_) {
        return false;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const configured = (process.env.JCHAT_ALLOWED_ORIGINS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    if (configured.includes(origin)) return true;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    const apiPort = String(PORT);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (port !== apiPort) return false;
    const octets = host.split('.').map(Number);
    return octets.length === 4 && octets.every(Number.isInteger) && (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
    );
}

function createRateLimiter(envName, fallbackMax) {
    const requests = new Map();
    const windowMs = parsePositiveInteger(process.env.JCHAT_RATE_LIMIT_WINDOW_MS, 2 * 60 * 1000, 1_000, 24 * 60 * 60 * 1000);
    const max = parsePositiveInteger(process.env[envName], fallbackMax, 1, 10_000);
    const cleanup = () => {
        const now = Date.now();
        for (const [key, entry] of requests) {
            if (now >= entry.resetAt) requests.delete(key);
        }
    };
    const cleanupTimer = setInterval(cleanup, Math.min(windowMs, 60_000));
    cleanupTimer.unref();
    return (req, res, next) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = requests.get(key);
        if (!entry || now >= entry.resetAt) {
            requests.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        if (entry.count >= max) {
            res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ error: 'Too many requests, please try again later' });
        }
        entry.count += 1;
        next();
    };
}

const corsOptions = {
    origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE']
};
const io = socketIo(server, {
    cors: corsOptions,
    maxHttpBufferSize: parsePositiveInteger(process.env.JCHAT_SOCKET_MAX_HTTP_BUFFER_SIZE, 1_000_000, 1_024, 10_000_000),
    connectTimeout: parsePositiveInteger(process.env.JCHAT_SOCKET_CONNECT_TIMEOUT_MS, 20_000, 1_000, 120_000),
    pingTimeout: parsePositiveInteger(process.env.JCHAT_SOCKET_PING_TIMEOUT_MS, 20_000, 1_000, 120_000),
    pingInterval: parsePositiveInteger(process.env.JCHAT_SOCKET_PING_INTERVAL_MS, 25_000, 1_000, 120_000),
    perMessageDeflate: false,
    allowRequest(req, callback) {
        callback(null, isAllowedOrigin(req.headers.origin));
    }
});
const presence = new PresenceRegistry();
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
if (process.env.NODE_ENV === 'production' && (JWT_SECRET === DEFAULT_JWT_SECRET || JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
const CHANNELS = ['公共频道'];
const REGISTRATION_ENABLED = true;
const VERSION = 'beta v2.2.0';

function getAvailableChannels(userId) {
    const uid = Number.parseInt(userId, 10);
    const privateChannels = Number.isInteger(uid)
        ? Object.entries(db.channels)
            .filter(([, channel]) => channel.members.includes(uid))
            .map(([name]) => name)
        : [];
    return [...CHANNELS, ...privateChannels];
}

function getAllChannels() {
    return [...CHANNELS, ...Object.keys(db.channels)];
}

function isValidChannel(channel) {
    return typeof channel === 'string' && (CHANNELS.includes(channel) || Boolean(db.channels[channel]));
}

function isPrivateChannel(channel) {
    return Boolean(db.channels[channel]);
}

function canAccessChannel(channel, userId) {
    if (CHANNELS.includes(channel)) return true;
    const uid = Number.parseInt(userId, 10);
    return Number.isInteger(uid) && Boolean(db.channels[channel]?.members.includes(uid));
}

function memberSummary(user, viewerId) {
    return {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: user.avatar || null,
        presence_status: presence.effectiveStatus(viewerId, user)
    };
}

function getChannelMemberSummaries(channel, viewerId) {
    return (db.channels[channel]?.members || [])
        .map(userId => db.getUserById(userId))
        .filter(Boolean)
        .map(user => memberSummary(user, viewerId));
}

function getPublicChannelMembers(viewerId) {
    return db.getUsers().map(user => memberSummary(user, viewerId));
}

function getChannelOnlineCount(channel) {
    if (!isValidChannel(channel)) return 0;
    const channelData = isPrivateChannel(channel) ? db.channels[channel] : null;
    return presence.countChannelOnline(channelData, db.getUsers());
}

function emitChannelPresence(socket, channel) {
    const userId = Number.parseInt(socket.data?.userId, 10);
    if (!Number.isInteger(userId) || !canAccessChannel(channel, userId)) return;
    socket.emit('channelPresenceUpdated', { channel, onlineCount: getChannelOnlineCount(channel) });
}

function broadcastChannelPresence(channel) {
    for (const [userId, connection] of presence.connections) {
        if (canAccessChannel(channel, userId)) emitChannelPresence(connection.socket, channel);
    }
}

function broadcastAllChannelPresence() {
    for (const channel of getAllChannels()) broadcastChannelPresence(channel);
}

function broadcastUserPresence(userId) {
    const target = db.getUserById(userId);
    if (!target) return;
    for (const [viewerId, connection] of presence.connections) {
        connection.socket.emit('presenceUpdated', {
            userId: target.id,
            status: presence.effectiveStatus(viewerId, target)
        });
    }
}

const { validateUsername, validatePassword, validateNickname, validateFriendReason, validateDeactivationReason } = require('./server/validation');

const ADMIN_CREDENTIALS_FILE = process.env.JCHAT_ADMIN_CREDENTIALS_FILE || path.join(__dirname, 'server', 'data', 'admin_credentials.json');
const BCRYPT_HASH_PREFIX = /^\$2[aby]\$\d\d\$/;

function isStrongAdminPassword(password) {
    return typeof password === 'string' && password.length >= 12 && password !== 'admin123';
}

function writeAdminCredentials(credentials) {
    const dataDir = path.dirname(ADMIN_CREDENTIALS_FILE);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tempFile = path.join(dataDir, `.admin_credentials.${process.pid}.${Date.now()}.tmp`);
    const contents = JSON.stringify({ username: credentials.username, passwordHash: credentials.passwordHash }, null, 2);
    try {
        fs.writeFileSync(tempFile, contents, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tempFile, ADMIN_CREDENTIALS_FILE);
        try { fs.chmodSync(ADMIN_CREDENTIALS_FILE, 0o600); } catch (_) {}
    } finally {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    }
}

function loadAdminCredentials() {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(ADMIN_CREDENTIALS_FILE, 'utf8'));
        const loadedUsername = typeof parsed.username === 'string' ? parsed.username.trim() : '';
        if (!loadedUsername) throw new Error('Admin credentials file has no valid username');
        if (typeof parsed.passwordHash === 'string' && BCRYPT_HASH_PREFIX.test(parsed.passwordHash)) {
            return { username: loadedUsername, passwordHash: parsed.passwordHash };
        }
        if (typeof parsed.password === 'string' && parsed.password.length > 0) {
            const migrated = { username: loadedUsername, passwordHash: bcrypt.hashSync(parsed.password, 12) };
            writeAdminCredentials(migrated);
            return migrated;
        }
        throw new Error('Admin credentials file has no valid password hash');
    }
    if (process.env.NODE_ENV === 'production' && !isStrongAdminPassword(password)) {
        throw new Error('ADMIN_PASSWORD must be at least 12 characters when initializing admin credentials in production');
    }
    const initial = { username, passwordHash: bcrypt.hashSync(password, 12) };
    writeAdminCredentials(initial);
    return initial;
}

function saveAdminCredentials() {
    try {
        writeAdminCredentials(ADMIN_CREDENTIALS);
        return true;
    } catch (_) {
        console.error('[ERROR] Could not save admin credentials');
        return false;
    }
}

const ADMIN_CREDENTIALS = loadAdminCredentials();

function ensureAdministratorUser() {
    const existing = db.getUserByUsername(ADMIN_CREDENTIALS.username);
    if (existing) {
        if (existing.password !== ADMIN_CREDENTIALS.passwordHash) {
            db.updateUser(existing.id, { password: ADMIN_CREDENTIALS.passwordHash });
        }
        return existing;
    }
    return db.insertUser({
        username: ADMIN_CREDENTIALS.username,
        password: ADMIN_CREDENTIALS.passwordHash,
        email: null,
        nickname: '管理员'
    });
}

ensureAdministratorUser();

if (process.env.JCHAT_TRUST_PROXY) {
    app.set('trust proxy', process.env.JCHAT_TRUST_PROXY === 'true' ? true : process.env.JCHAT_TRUST_PROXY);
}
const loginRateLimiter = createRateLimiter('JCHAT_AUTH_RATE_LIMIT_MAX', 10);
const registrationRateLimiter = createRateLimiter('JCHAT_REGISTRATION_RATE_LIMIT_MAX', 20);
const adminLoginRateLimiter = createRateLimiter('JCHAT_ADMIN_RATE_LIMIT_MAX', 5);
const uploadRateLimiter = createRateLimiter('JCHAT_UPLOAD_RATE_LIMIT_MAX', 30);
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(self)',
        'Cross-Origin-Resource-Policy': 'same-origin'
    });
    next();
});
app.use((req, res, next) => {
    if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
        return res.status(403).json({ error: 'Origin is not allowed' });
    }
    next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.JCHAT_JSON_LIMIT || '1mb' }));
app.use(express.urlencoded({
    extended: true,
    limit: process.env.JCHAT_URLENCODED_LIMIT || '100kb',
    parameterLimit: parsePositiveInteger(process.env.JCHAT_URLENCODED_PARAMETER_LIMIT, 1_000, 1, 100_000)
}));
app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
        return res.status(413).json({ error: 'Request body too large' });
    }
    next(error);
});
const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        next();
        return;
    }
    try {
        const user = verifyCurrentUserToken(token, JWT_SECRET, db);
        if (!user) {
            return res.status(401).json({ error: '用户不存在或已被删除', code: 'user_deleted' });
        }
        req.userId = user.id;
        req.userSessionId = user.active_session_id;
        next();
    } catch (error) {
        const code = error?.code || 'invalid_token';
        return res.status(401).json({
            error: code === 'session_replaced' ? 'Account signed in on another page' : 'Invalid or expired token',
            code
        });
    }
};

function requireUser(req, res, next) {
    const parsed = Number.parseInt(req.userId, 10);
    if (!Number.isInteger(parsed)) return res.status(401).json({ error: 'Authorization required' });
    req.userId = parsed;
    next();
}

function requireAuthenticatedUser(req, res, next) {
    const parsed = Number.parseInt(req.userId, 10);
    if (!Number.isInteger(parsed)) return res.status(401).json({ error: 'Authorization required' });
    req.userId = parsed;
    next();
}

const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Admin token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.admin) {
            next();
        } else {
            res.status(403).json({ error: 'Not authorized as admin' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
console.log('Connected to JavaScript data storage.');
const defaultAvatarPath = path.join(__dirname, 'public', 'images', 'default.png');
if (!fs.existsSync(defaultAvatarPath)) {
    if (sharp) {
        sharp({
            create: {
                width: 100,
                height: 100,
                channels: 4,
                background: { r: 150, g: 150, b: 150, alpha: 1 }
            }
        })
            .png()
            .toFile(defaultAvatarPath, (err) => {
                if (err) console.error('Error creating default avatar:', err);
            });
    }
}
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}

function deleteRecallAttachment(relativeUrl) {
    if (!relativeUrl || typeof relativeUrl !== 'string') return;
    const trimmed = relativeUrl.trim();
    if (!trimmed.startsWith('uploads/') || trimmed.includes('..')) return;
    const filePath = path.join(__dirname, 'public', trimmed);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Recall: deleted attachment', trimmed);
        }
    } catch (err) {
        console.error('Recall: failed to delete attachment', trimmed, err.message);
    }
}
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const IMAGE_UPLOAD_TYPES = new Map([
    ['.jpg', ['image/jpeg']],
    ['.jpeg', ['image/jpeg']],
    ['.png', ['image/png']],
    ['.gif', ['image/gif']],
    ['.webp', ['image/webp']]
]);
const VOICE_UPLOAD_TYPES = new Map([
    ['.webm', ['audio/webm']],
    ['.ogg', ['audio/ogg']],
    ['.mp3', ['audio/mpeg']],
    ['.wav', ['audio/wav', 'audio/x-wav']],
    ['.m4a', ['audio/mp4']],
    ['.aac', ['audio/aac']]
]);

function removeUploadedFile(file) {
    if (!file?.path) return;
    try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (error) {
        console.error('Failed to remove rejected upload:', error.message);
    }
}

function cleanupUploadedFiles(req) {
    removeUploadedFile(req.file);
    if (Array.isArray(req.files)) req.files.forEach(removeUploadedFile);
    else if (req.files && typeof req.files === 'object') Object.values(req.files).flat().forEach(removeUploadedFile);
}

const upload = multer({
    storage,
    limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024,
        fields: 10,
        parts: 11,
        fieldNameSize: 100,
        fieldSize: 64 * 1024
    },
    fileFilter(req, file, cb) {
        const allowedTypes = file.fieldname === 'voice' ? VOICE_UPLOAD_TYPES : IMAGE_UPLOAD_TYPES;
        const extension = path.extname(file.originalname).toLowerCase();
        const permittedMimeTypes = allowedTypes.get(extension);
        const mimeType = String(file.mimetype || '').toLowerCase().split(';', 1)[0].trim();
        if (!permittedMimeTypes || !permittedMimeTypes.includes(mimeType)) {
            const error = new Error('Unsupported file type');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error);
        }
        cb(null, true);
    }
});

function secureSingleUpload(fieldName) {
    const single = upload.single(fieldName);
    return (req, res, next) => single(req, res, error => {
        if (!error) return next();
        cleanupUploadedFiles(req);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File size exceeds limit (10MB)' });
        }
        if (error instanceof multer.MulterError || error.code === 'INVALID_FILE_TYPE') {
            return res.status(400).json({ error: error.code === 'INVALID_FILE_TYPE' ? 'Unsupported file type' : 'Invalid upload payload' });
        }
        console.error('Upload rejected:', error);
        return res.status(400).json({ error: 'Upload failed' });
    });
}

app.get('/api/registration-status', (req, res) => {
    res.json({ enabled: REGISTRATION_ENABLED });
});

app.get('/api/version', (req, res) => {
    res.json({ version: VERSION });
});

app.get('/api/channels', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const uid = parseInt(req.userId, 10);
    const channels = getAvailableChannels(req.userId).map(name => {
        const priv = db.channels[name];
        return {
            name,
            alias: db.getChannelAlias(req.userId, name),
            ownerId: priv ? priv.owner_id : null,
            isOwner: priv ? priv.owner_id === uid : false
        };
    });
    res.json({ channels });
});

app.post('/api/channels', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 28 || /[\r\n<>]/.test(name)) {
        return res.status(400).json({ error: 'Invalid channel name' });
    }
    if (isValidChannel(name)) {
        return res.status(409).json({ error: 'Channel already exists' });
    }
    db.channels[name] = { password: null, members: [req.userId], owner_id: req.userId };
    db.saveData();
    res.status(201).json({ name, ownerId: req.userId, members: [req.userId] });
});

app.post('/api/channel/verify-password', authenticateUser, requireAuthenticatedUser, (req, res) => {
    return res.status(410).json({ error: 'Password-based channel access is no longer supported' });
});

app.put('/api/channel/:channel/alias', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) return res.status(404).json({ error: 'Channel not found' });
    if (!canAccessChannel(channel, req.userId)) return res.status(403).json({ error: 'Channel access denied' });
    const alias = typeof req.body?.alias === 'string' ? req.body.alias.trim() : '';
    if (alias.length > 28) return res.status(400).json({ error: '备注最多 28 个字符' });
    db.setChannelAlias(req.userId, channel, alias);
    res.json({ success: true, alias: alias || null });
});

app.post('/api/channel/:channel/leave', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isPrivateChannel(channel)) return res.status(400).json({ error: '公共频道无法退出' });
    const channelData = db.channels[channel];
    if (!channelData) return res.status(404).json({ error: 'Channel not found' });
    const uid = parseInt(req.userId, 10);
    if (channelData.owner_id === uid) return res.status(400).json({ error: '频道创建者不能退出' });
    const idx = channelData.members.indexOf(uid);
    if (idx === -1) return res.status(400).json({ error: 'Not a member' });
    channelData.members.splice(idx, 1);
    db.saveData();
    broadcastChannelPresence(channel);
    res.json({ success: true });
});

app.get('/api/channel/:channel/access/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    return res.json({ hasAccess: canAccessChannel(req.params.channel, req.userId) });
});
app.post('/api/register', registrationRateLimiter, async (req, res) => {
    if (!REGISTRATION_ENABLED) {
        return res.status(403).json({ error: '注册功能已关闭' });
    }

    const { username, password, email, nickname } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '请填写账号和密码' });
    }

    const userCheck = validateUsername(username);
    if (!userCheck.ok) return res.status(400).json({ error: userCheck.error });
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.error });
    // 用户名（显示名）：未填则默认等于账号
    const rawNickname = (typeof nickname === 'string' && nickname.trim()) ? nickname : userCheck.value;
    const nicknameCheck = validateNickname(rawNickname);
    if (!nicknameCheck.ok) return res.status(400).json({ error: nicknameCheck.error });

    try {
        if (db.getUserByUsername(userCheck.value)) {
            return res.status(400).json({ error: '账号已被使用' });
        }

        if (db.getUserByNickname(nicknameCheck.value)) {
            return res.status(400).json({ error: '用户名已被使用' });
        }

        if (email && db.getUserByEmail(email)) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = db.insertUser({
            username: userCheck.value,
            password: hashedPassword,
            email,
            nickname: nicknameCheck.value
        });

        const session = createUserSessionToken(newUser.id, JWT_SECRET, JWT_EXPIRES_IN);
        db.setUserSession(newUser.id, session.sessionId);
        logger.auditLog('user_register', newUser.id, { username: newUser.username });

        res.status(201).json({
            token: session.token,
            userId: newUser.id,
            username: newUser.username,
            nickname: newUser.nickname,
            presence_status: newUser.presence_status || 'online'
        });

    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', loginRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const user = db.getUserByUsername(username);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        if (user.banned) return res.status(403).json({ error: '账号已被封禁', code: 'banned' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        logger.auditLog('user_login', user.id, { username: user.username });
        const session = createUserSessionToken(user.id, JWT_SECRET, JWT_EXPIRES_IN);
        db.setUserSession(user.id, session.sessionId);
        res.json({
            token: session.token,
            userId: user.id,
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar,
            bio: user.bio,
            gender: user.gender,
            presence_status: user.presence_status || 'online'
        });

    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/api/logout', authenticateUser, requireAuthenticatedUser, (req, res) => {
    db.clearUserSession(req.userId, req.userSessionId);
    res.json({ success: true });
});

app.post('/api/admin/login', adminLoginRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    const passwordMatches = username === ADMIN_CREDENTIALS.username && await bcrypt.compare(password, ADMIN_CREDENTIALS.passwordHash);
    if (passwordMatches) {
        const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({ token, admin: true });
    } else {
        res.status(401).json({ error: 'Invalid admin credentials' });
    }
});

app.put('/api/admin/password', authenticateAdmin, async (req, res) => {
    const rawCurrent = req.body.currentPassword;
    const rawNew = req.body.newPassword;
    const currentPassword = typeof rawCurrent === 'string' ? rawCurrent.trim() : '';
    const newPassword = typeof rawNew === 'string' ? rawNew.trim() : '';

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (!isStrongAdminPassword(newPassword)) {
        return res.status(400).json({ error: 'Admin password must be at least 12 characters and not use the default password' });
    }

    if (!await bcrypt.compare(currentPassword, ADMIN_CREDENTIALS.passwordHash)) {
        return res.status(401).json({
            error: 'Current password is incorrect'
        });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const previousHash = ADMIN_CREDENTIALS.passwordHash;
    ADMIN_CREDENTIALS.passwordHash = passwordHash;
    if (!saveAdminCredentials()) {
        ADMIN_CREDENTIALS.passwordHash = previousHash;
        return res.status(500).json({ error: 'Could not save admin password' });
    }
    ensureAdministratorUser();
    res.json({ success: true, message: 'Admin password updated successfully' });
});

app.post('/api/admin/reset-messages', authenticateAdmin, (req, res) => {
    db.resetAllMessages();
    res.json({ success: true, message: 'All channel and DM messages have been reset' });
});

app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    const list = (db.getUsers ? db.getUsers() : (db.users || [])).map(u => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname || u.username,
        email: u.email || null,
        banned: !!u.banned,
        created_at: u.created_at || null
    }));
    res.json(list);
});

app.put('/api/admin/users/:userId/ban', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user id' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.username === ADMIN_CREDENTIALS.username) return res.status(403).json({ error: '不能封禁管理员账号' });
    const updated = db.updateUser(userId, { banned: true });
    if (!updated) return res.status(500).json({ error: 'Failed to update' });
    io.to(`user:${userId}`).emit('userBanned');
    res.json({ success: true, message: '用户已封禁', user: { id: updated.id, username: updated.username, banned: true } });
});

app.put('/api/admin/users/:userId/unban', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user id' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updated = db.updateUser(userId, { banned: false });
    if (!updated) return res.status(500).json({ error: 'Failed to update' });
    io.to(`user:${userId}`).emit('userUnbanned');
    res.json({ success: true, message: '用户已解封', user: { id: updated.id, username: updated.username, banned: false } });
});

app.delete('/api/admin/users/:userId', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user id' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.username === ADMIN_CREDENTIALS.username) return res.status(403).json({ error: '不能删除管理员账号' });
    const ok = db.deleteUser(userId);
    if (!ok) return res.status(500).json({ error: 'Failed to delete' });
    io.to(`user:${userId}`).emit('userDeleted');
    res.json({ success: true, message: '用户已删除' });
});

app.post('/api/account/deactivation-request', authenticateUser, requireUser, (req, res) => {
    try {
        const { reason } = req.body || {};
        const v = validateDeactivationReason(reason);
        if (!v.ok) return res.status(400).json({ error: v.error });
        if (typeof db.addDeactivationRequest !== 'function') return res.status(503).json({ error: '服务未就绪，请重启后端服务后重试' });
        const result = db.addDeactivationRequest(req.userId, v.value);
        if (result && result.locked === true) {
            const until = result.lock_until ? new Date(result.lock_until).toLocaleString('zh-CN') : '24 小时后';
            return res.status(429).json({ error: '您今日申请次数已用尽，请 24 小时后再试', lock_until: result.lock_until });
        }
        if (!result) return res.status(400).json({ error: '您已提交过注销申请，请等待审核' });
        io.to('admin').emit('deactivationRequestNew', { request: result });
        res.status(201).json({ success: true, message: '注销申请已提交', request: result });
    } catch (err) {
        console.error('[deactivation] POST request error:', err);
        res.status(500).json({ error: err.message || '提交注销申请失败' });
    }
});

app.get('/api/account/deactivation-request', authenticateUser, requireUser, (req, res) => {
    try {
        if (typeof db.getDeactivationRequestByUserId !== 'function') return res.status(503).json({ error: '服务未就绪，请重启后端服务后重试' });
        const request = db.getDeactivationRequestByUserId(req.userId);
        let lock_until = null;
        if (typeof db.getDeactivationLock === 'function') lock_until = db.getDeactivationLock(req.userId);
        res.json({ request: request || null, lock_until });
    } catch (err) {
        console.error('[deactivation] GET request error:', err);
        res.status(500).json({ error: err.message || '获取申请状态失败' });
    }
});

app.get('/api/admin/deactivation-requests', authenticateAdmin, (req, res) => {
    try {
        if (typeof db.getDeactivationRequests !== 'function') return res.status(503).json({ error: '服务未就绪，请重启后端服务后重试' });
        const list = db.getDeactivationRequests().map(r => {
            const user = db.getUserById(r.user_id);
            return {
                id: r.id,
                user_id: r.user_id,
                username: user ? user.username : null,
                nickname: user ? (user.nickname || user.username) : null,
                reason: r.reason,
                status: r.status,
                created_at: r.created_at,
                updated_at: r.updated_at || null
            };
        });
        res.json({ requests: list });
    } catch (err) {
        console.error('[deactivation] GET admin list error:', err);
        res.status(500).json({ error: err.message || '获取注销申请列表失败' });
    }
});

app.put('/api/admin/deactivation-requests/:id', authenticateAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { action } = req.body || {};
        if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 必须为 approve 或 reject' });
        if (typeof db.getDeactivationRequestById !== 'function') return res.status(503).json({ error: '服务未就绪，请重启后端服务后重试' });
        const request = db.getDeactivationRequestById(id);
        if (!request) return res.status(404).json({ error: '申请不存在' });
        if (request.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
        db.updateDeactivationRequestStatus(id, action === 'approve' ? 'approved' : 'rejected');
        const status = action === 'approve' ? 'approved' : 'rejected';
        const userId = request.user_id;
        io.to(`user:${userId}`).emit('deactivationRequestUpdated', { requestId: id, status });
        io.to('admin').emit('deactivationRequestUpdated', { requestId: id, status });
        if (action === 'approve') {
            const user = db.getUserById(userId);
            if (user && user.username !== ADMIN_CREDENTIALS.username) {
                db.deleteUser(userId);
                io.to(`user:${userId}`).emit('userDeleted');
            }
        }
        res.json({ success: true, message: action === 'approve' ? '已通过并注销该用户' : '已拒绝' });
    } catch (err) {
        console.error('[deactivation] PUT admin error:', err);
        res.status(500).json({ error: err.message || '操作失败' });
    }
});

app.post('/api/channel/:channel/members', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isPrivateChannel(channel)) {
        return res.status(404).json({ error: 'Private channel not found' });
    }
    const channelData = db.channels[channel];
    if (channelData.owner_id !== req.userId) {
        return res.status(403).json({ error: 'Only the channel owner can invite members' });
    }
    if (!Array.isArray(req.body?.usernames) || req.body.usernames.some(username => typeof username !== 'string')) {
        return res.status(400).json({ error: 'usernames must be an array of strings' });
    }

    const usernames = [...new Set(req.body.usernames.filter(username => username.length > 0))];
    const invited = [];
    const notFound = [];
    const memberIds = new Set(channelData.members);
    for (const username of usernames) {
        const user = db.getUserByUsername(username);
        if (!user) {
            notFound.push(username);
            continue;
        }
        if (!memberIds.has(user.id)) {
            memberIds.add(user.id);
            invited.push({ id: user.id, username: user.username });
        }
    }

    if (invited.length) {
        channelData.members = [...memberIds];
        db.saveData();
        const owner = db.getUserById(req.userId);
        const payload = {
            channel,
            invitedBy: { id: owner.id, username: owner.username }
        };
        for (const user of invited) io.to(`user:${user.id}`).emit('channelInvited', payload);
        broadcastChannelPresence(channel);
    }

    res.json({ success: true, invited, notFound, members: getChannelMemberSummaries(channel, req.userId) });
});

app.get('/api/channel/:channel/members', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) {
        return res.status(404).json({ error: 'Channel not found' });
    }
    if (isPrivateChannel(channel)) {
        if (db.channels[channel].owner_id !== req.userId) {
            return res.status(403).json({ error: 'Only the channel owner can list members' });
        }
        return res.json({ members: getChannelMemberSummaries(channel, req.userId) });
    }
    res.json({ members: getPublicChannelMembers(req.userId) });
});

app.delete('/api/channel/:channel/members/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel, userId } = req.params;
    const parsedUserId = Number.parseInt(userId, 10);

    if (!isPrivateChannel(channel)) {
        return res.status(404).json({ error: 'Private channel not found' });
    }
    const channelData = db.channels[channel];
    if (channelData.owner_id !== req.userId) {
        return res.status(403).json({ error: 'Only the channel owner can remove members' });
    }
    if (parsedUserId === channelData.owner_id) {
        return res.status(400).json({ error: 'The channel owner cannot be removed', code: 'owner_cannot_be_removed' });
    }
    const memberIndex = channelData.members.indexOf(parsedUserId);
    if (memberIndex !== -1) {
        channelData.members.splice(memberIndex, 1);
        db.saveData();
        broadcastChannelPresence(channel);
        res.json({ success: true, message: 'User removed from channel' });
    } else {
        res.status(404).json({ error: 'User not found in channel' });
    }
});

app.put('/api/channel/:channel/password', authenticateAdmin, (req, res) => {
    const { channel } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
        return res.status(400).json({ error: 'New password is required' });
    }

    if (!isPrivateChannel(channel)) {
        return res.status(400).json({ error: 'Not a private channel' });
    }

    db.channels[channel].password = newPassword;
    db.saveData();
    res.json({ success: true, message: 'Channel password updated successfully' });
});
app.get('/api/profile/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { userId } = req.params;
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userProfile = {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: user.avatar,
        bio: user.bio,
        gender: user.gender,
        email: user.email,
        created_at: user.created_at,
        allow_add_friend_from_profile: user.allow_add_friend_from_profile === true || user.allow_add_friend_from_profile === 'true',
        effective_status: presence.effectiveStatus(req.userId, user)
    };
    if (Number(req.userId) === Number(user.id)) userProfile.presence_status = user.presence_status || 'online';
    res.json(userProfile);
});

app.put('/api/profile/:userId', authenticateUser, requireUser, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (userId !== parseInt(req.userId, 10)) return res.status(403).json({ error: '只能修改自己的资料' });
    const { bio, gender, email, nickname, allow_add_friend_from_profile, presence_status } = req.body;
    if (presence_status !== undefined && !VALID_PRESENCE_STATUSES.has(presence_status)) {
        return res.status(400).json({ error: 'Invalid presence status', code: 'invalid_presence_status' });
    }
    if (email !== undefined && email !== null && email !== '') {
        const existingUser = db.getUserByEmail(email);
        if (existingUser && existingUser.id !== userId) {
            return res.status(400).json({ error: 'Email already exists' });
        }
    }
    let checkedNickname;
    if (nickname !== undefined) {
        const nicknameCheck = validateNickname(nickname);
        if (!nicknameCheck.ok) return res.status(400).json({ error: nicknameCheck.error });
        const existingNick = db.getUserByNickname(nicknameCheck.value);
        if (existingNick && existingNick.id !== userId) return res.status(400).json({ error: '用户名已被使用' });
        checkedNickname = nicknameCheck.value;
    }
    const updates = {};
    if (bio !== undefined) updates.bio = bio;
    if (gender !== undefined) updates.gender = gender;
    if (email !== undefined) updates.email = email;
    if (nickname !== undefined) updates.nickname = checkedNickname;
    if (presence_status !== undefined) updates.presence_status = presence_status;
    if (allow_add_friend_from_profile !== undefined) {
        const v = allow_add_friend_from_profile;
        updates.allow_add_friend_from_profile = v === true || v === 'true';
    }
    if (Object.keys(updates).length === 0) return res.json({ success: true });
    const updatedUser = db.updateUser(userId, updates);
    if (!updatedUser) return res.status(404).json({ error: 'User not found' });
    if (presence_status !== undefined) {
        broadcastUserPresence(userId);
        broadcastAllChannelPresence();
    }
    res.json({ success: true });
});
app.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authorization token required' });
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.ok) {
        return res.status(400).json({ error: passwordCheck.error, success: false });
    }

    try {
        const user = verifyCurrentUserToken(token, JWT_SECRET, db);
        const userId = user.id;
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(401).json({ error: '当前密码错误', success: false });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const updatedUser = db.updateUser(userId, { password: hashedPassword });
        if (!updatedUser) {
            return res.status(500).json({ error: 'Failed to update password', success: false });
        }

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token', success: false });
        }
        res.status(500).json({ error: 'Server error', success: false });
    }
});

app.post('/api/upload/avatar', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
    }

    const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    if (!allowedExt.includes(originalExt)) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: '仅支持 JPG、PNG、GIF、WebP 格式' });
    }

    let createdAvatarPath = null;
    try {
        let avatarUrl;

        if (sharp) {
            const isGif = originalExt === '.gif';
            const optimizedPath = path.join(__dirname, 'public', 'uploads', 'optimized-' + req.file.filename);
            createdAvatarPath = optimizedPath;
            const sharpInstance = sharp(req.file.path)
                .resize(200, 200, { fit: 'cover' });

            if (isGif) {
                await sharpInstance.toFile(optimizedPath);
            } else {
                await sharpInstance
                    .png({ quality: 80 })
                    .toFile(optimizedPath);
            }
            fs.unlinkSync(req.file.path);
            avatarUrl = 'uploads/optimized-' + req.file.filename;
        } else {
            const safeName = 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + originalExt;
            const destPath = path.join(__dirname, 'public', 'uploads', safeName);
            createdAvatarPath = destPath;
            fs.renameSync(req.file.path, destPath);
            avatarUrl = 'uploads/' + safeName;
        }

        const updatedUser = db.updateUser(req.userId, { avatar: avatarUrl });
        if (!updatedUser) {
            removeUploadedFile({ path: createdAvatarPath });
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, avatar: avatarUrl });
    } catch (error) {
        console.error('Avatar upload error:', error);
        cleanupUploadedFiles(req);
        removeUploadedFile({ path: createdAvatarPath });
        res.status(500).json({ error: error.message || 'Image processing error' });
    }
});

app.post('/api/upload/image', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('image'), async (req, res) => {
    if (!req.file) {
        console.error('Upload failed: No file provided');
        return res.status(400).json({ error: 'File is required' });
    }

    const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    if (!allowedExt.includes(originalExt)) {
        cleanupUploadedFiles(req);
        return res.status(400).json({ error: '仅支持 JPG、PNG、GIF、WebP 格式' });
    }

    let createdImagePath = null;
    try {
        let imageUrl;

        if (sharp) {
            const isGif = originalExt === '.gif';
            const optimizedPath = path.join(__dirname, 'public', 'uploads', 'chat-' + req.file.filename);
            createdImagePath = optimizedPath;
            const sharpInstance = sharp(req.file.path)
                .resize(600, 450, { fit: 'inside' });

            if (isGif) {
                await sharpInstance.gif().toFile(optimizedPath);
            } else {
                await sharpInstance.png({ quality: 85 }).toFile(optimizedPath);
            }
            fs.unlinkSync(req.file.path);
            imageUrl = 'uploads/chat-' + req.file.filename;
        } else {
            const safeName = 'chat-' + req.file.filename;
            const destPath = path.join(__dirname, 'public', 'uploads', safeName);
            createdImagePath = destPath;
            fs.renameSync(req.file.path, destPath);
            imageUrl = 'uploads/' + safeName;
        }

        res.json({ success: true, image: imageUrl });
    } catch (error) {
        console.error('Upload failed:', error);
        cleanupUploadedFiles(req);
        removeUploadedFile({ path: createdImagePath });
        if (error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'File size exceeds limit (10MB)' });
        } else {
            res.status(500).json({ error: 'Image processing error' });
        }
    }
});

app.get('/api/admin/logs/list', authenticateAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    const logDir = path.join(__dirname, 'server', 'logs');

    try {
        const files = fs.readdirSync(logDir);

        const logFiles = files.filter(file => file.match(/\.(log)$/))
            .map(file => {
                const stats = fs.statSync(path.join(logDir, file));
                return {
                    filename: file,
                    size: stats.size,
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime
                };
            })
            .sort((a, b) => b.modifiedAt - a.modifiedAt);

        res.json({ logFiles });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get log files: ' + error.message });
    }
});

app.get('/api/admin/logs/content/:filename', authenticateAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    const { filename } = req.params;
    const { search = '', page = 1, limit = 50, type = '' } = req.query;

    if (!filename.match(/^[a-zA-Z0-9\-_\.]+$/)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const logPath = path.join(__dirname, 'server', 'logs', filename);

    try {
        const content = fs.readFileSync(logPath, 'utf8');

        let logs = content.trim().split('\n')
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            })
            .filter(log => log !== null);

        if (type) {
            const t = String(type).toLowerCase();
            if (t === 'chat') {
                logs = logs.filter(log => log.channel != null);
            } else if (t === 'audit') {
                logs = logs.filter(log => log.action != null && log.channel == null);
            } else {
                logs = logs.filter(log => log.action === t);
            }
        }

        if (search) {
            const searchLower = search.toLowerCase();
            logs = logs.filter(log => {
                return JSON.stringify(log).toLowerCase().includes(searchLower);
            });
        }

        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedLogs = logs.slice(startIndex, endIndex);

        res.json({
            logs: paginatedLogs,
            total: logs.length,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(logs.length / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read log file: ' + error.message });
    }
});

app.post('/api/upload/voice', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('voice'), async (req, res) => {
    if (!req.file) {
        console.error('Voice upload failed: No file provided');
        return res.status(400).json({ error: 'File is required' });
    }

    console.log('Voice upload started:', {
        originalname: req.file.originalname,
        size: req.file.size,
        path: req.file.path,
        mimetype: req.file.mimetype
    });

    let voicePath = null;
    try {
        const originalExt = path.extname(req.file.originalname).toLowerCase();

        if (!VOICE_UPLOAD_TYPES.has(originalExt)) {
            cleanupUploadedFiles(req);
            return res.status(400).json({ error: 'Unsupported file type' });
        }

        voicePath = path.join(__dirname, 'public', 'uploads', 'voice-' + req.file.filename);

        fs.renameSync(req.file.path, voicePath);

        const voiceUrl = 'uploads/voice-' + req.file.filename;
        console.log('Voice upload completed successfully:', voiceUrl);
        res.json({ success: true, voice: voiceUrl });
    } catch (error) {
        console.error('Voice upload failed:', error);
        cleanupUploadedFiles(req);
        removeUploadedFile({ path: voicePath });
        if (error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'File size exceeds limit (10MB)' });
        } else {
            res.status(500).json({ error: 'Voice upload error' });
        }
    }
});

app.post('/api/channel/:channel/clear', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) return res.status(400).json({ error: 'Invalid channel' });
    const userId = parseInt(req.userId, 10);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!canAccessChannel(channel, userId)) return res.status(403).json({ error: 'Channel access denied' });
    try {
        const last_clear_at = db.setChannelClearTime(userId, channel);
        res.json({ success: true, last_clear_at });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Clear failed' });
    }
});

app.get('/api/messages/:channel', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;

    if (!isValidChannel(channel)) {
        return res.status(400).json({ error: 'Invalid channel' });
    }
    if (!canAccessChannel(channel, req.userId)) {
        return res.status(403).json({ error: 'Channel access denied' });
    }

    let messages = db.getMessagesByChannel(channel);

    if (req.userId) {
        messages = messages.filter(msg => {
            return !msg.is_blocked || msg.user_id === parseInt(req.userId);
        });
        const lastClearAt = db.getChannelClearTime(req.userId, channel);
        if (lastClearAt) {
            const t = new Date(lastClearAt).getTime();
            messages = messages.filter(msg => new Date(msg.created_at).getTime() > t);
        }
    } else {
        messages = messages.filter(msg => !msg.is_blocked);
    }

    const messagesWithUserInfo = messages.map(msg => {
        const user = db.getUserById(msg.user_id);

        const messageData = {
            ...msg,
            username: user?.username || '该账户已注销',
            nickname: user?.nickname || user?.username || '该账户已注销',
            avatar: user?.avatar || DEFAULT_AVATAR,
            reply_info: null
        };

        if (msg.reply_to) {
            const repliedMessage = db.getMessageById(msg.reply_to);
            if (repliedMessage) {
                const repliedUser = db.getUserById(repliedMessage.user_id);
                messageData.reply_info = {
                    message_id: repliedMessage.id,
                    username: repliedUser?.username || '该账户已注销',
                    nickname: repliedUser?.nickname || repliedUser?.username || '该账户已注销',
                    content: repliedMessage.content,
                    image: repliedMessage.image,
                    voice: repliedMessage.voice
                };
            }
        }

        return messageData;
    });

    res.json(messagesWithUserInfo);
});

app.get('/api/friends', authenticateUser, requireUser, (req, res) => {
    const list = db.getFriends(req.userId).map(friend => {
        const user = db.getUserById(friend.id);
        return {
            ...friend,
            presence_status: user ? presence.effectiveStatus(req.userId, user) : 'offline'
        };
    });
    res.json({ friends: list });
});

app.get('/api/friends/requests', authenticateUser, requireUser, (req, res) => {
    const requests = db.getIncomingFriendRequests(req.userId);
    res.json({ requests });
});

app.post('/api/friends/request', authenticateUser, requireUser, (req, res) => {
    const { to, message } = req.body;
    const targetUser = db.getUserByIdentifier(to);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    const allowAdd = targetUser.allow_add_friend_from_profile;
    if (allowAdd !== true && allowAdd !== 'true') {
        return res.status(403).json({ error: '对方暂未开启权限', code: 'add_friend_disabled' });
    }
    if (db.isBlocked(targetUser.id, req.userId)) {
        return res.status(403).json({ error: '对方设置了权限，您暂时不可以添加对方为好友', code: 'blocked_by_target' });
    }
    if (db.isBlocked(req.userId, targetUser.id)) {
        return res.status(403).json({ error: '如果想添加对方为好友，请先移出黑名单', code: 'you_blocked_target' });
    }
    const reasonCheck = validateFriendReason(message);
    if (!reasonCheck.ok) return res.status(400).json({ error: reasonCheck.error });
    const result = db.createFriendRequest(req.userId, targetUser.id, reasonCheck.value);
    if (!result.ok) {
        const map = {
            cannot_add_self: '不能添加自己为好友',
            target_not_found: '用户不存在',
            already_friends: '你们已经是好友了',
            request_already_pending: '好友申请已在处理中'
        };
        return res.status(400).json({ error: map[result.error] || 'Failed to create request' });
    }
    io.to(`user:${targetUser.id}`).emit('friendRequestReceived', {
        requestId: result.request.id,
        fromUserId: req.userId
    });
    res.json({ success: true, request: result.request });
});

app.post('/api/friends/request/:requestId/respond', authenticateUser, requireUser, (req, res) => {
    const { requestId } = req.params;
    const { action } = req.body;
    const result = db.respondFriendRequest(requestId, req.userId, action);
    if (!result.ok) {
        const map = {
            not_found: '申请不存在',
            not_authorized: '无权限操作该申请',
            already_resolved: '该申请已处理',
            invalid_action: '无效操作'
        };
        return res.status(400).json({ error: map[result.error] || 'Failed to respond request' });
    }
    io.to(`user:${result.request.from_user_id}`).emit('friendRequestUpdated', { requestId: result.request.id, status: result.request.status });
    io.to(`user:${result.request.to_user_id}`).emit('friendRequestUpdated', { requestId: result.request.id, status: result.request.status });
    res.json({ success: true, request: result.request });
});

app.delete('/api/friends/:friendUserId', authenticateUser, requireUser, (req, res) => {
    const friendUserId = parseInt(req.params.friendUserId);
    if (!friendUserId) return res.status(400).json({ error: 'Invalid friend id' });
    const ok = db.removeFriendship(req.userId, friendUserId);
    if (!ok) db.clearDmDataBetween(req.userId, friendUserId);
    if (ok) {
        io.to(`user:${req.userId}`).emit('friendsChanged');
        const deletedUser = friendUserId;
        const deleter = db.getUserById(req.userId);
        if (deleter) {
            io.to(`user:${deletedUser}`).emit('friendRemovedYou', {
                user: { id: deleter.id, username: deleter.username, nickname: deleter.nickname || deleter.username, avatar: deleter.avatar || DEFAULT_AVATAR }
            });
        }
    }
    res.json({ success: true });
});

app.get('/api/block/list', authenticateUser, requireUser, (req, res) => {
    try {
        const blockedIds = db.getBlockedUserIds(req.userId);
        const users = blockedIds.map(id => {
            const u = db.getUserById(id);
            return u ? { id: u.id, username: u.username, nickname: u.nickname || u.username, avatar: u.avatar || DEFAULT_AVATAR } : null;
        }).filter(Boolean);
        return res.json({ blockedIds, users });
    } catch (e) {
        console.error('getBlockedUserIds error:', e);
        return res.status(500).json({ error: '获取黑名单失败' });
    }
});

app.post('/api/block/:userId', authenticateUser, requireUser, (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId, 10);
        if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: '无效的用户' });
        if (targetUserId === parseInt(req.userId, 10)) return res.status(400).json({ error: '不能拉黑自己' });
        db.addBlock(req.userId, targetUserId);
        return res.json({ success: true, message: '已加入黑名单' });
    } catch (e) {
        console.error('addBlock error:', e);
        return res.status(500).json({ error: '操作失败，请重试' });
    }
});

app.delete('/api/block/:userId', authenticateUser, requireUser, (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId, 10);
        if (!targetUserId || Number.isNaN(targetUserId)) return res.status(400).json({ error: '无效的用户' });
        db.removeBlock(req.userId, targetUserId);
        return res.json({ success: true, message: '已移出黑名单' });
    } catch (e) {
        console.error('removeBlock error:', e);
        return res.status(500).json({ error: '操作失败，请重试' });
    }
});

app.post('/api/dm/:peerUserId/clear', authenticateUser, requireUser, (req, res) => {
    const peerUserId = parseInt(req.params.peerUserId);
    if (!peerUserId) return res.status(400).json({ error: 'Invalid peer id' });
    if (!db.areFriends(req.userId, peerUserId)) return res.status(403).json({ error: 'Not friends' });
    const dmKey = [parseInt(req.userId, 10), peerUserId].sort((a, b) => a - b).join('_');
    try {
        const last_clear_at = db.setDmClearTime(req.userId, dmKey);
        res.json({ success: true, last_clear_at });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Clear failed' });
    }
});

app.get('/api/dm/:peerUserId/messages', authenticateUser, requireUser, (req, res) => {
    const peerUserId = parseInt(req.params.peerUserId);
    if (!peerUserId) return res.status(400).json({ error: 'Invalid peer id' });
    if (!db.areFriends(req.userId, peerUserId)) return res.status(403).json({ error: 'Not friends' });
    let raw = db.getDmMessagesBetween(req.userId, peerUserId, req.userId);
    const dmKey = [parseInt(req.userId, 10), peerUserId].sort((a, b) => a - b).join('_');
    const lastClearAt = db.getDmClearTime(req.userId, dmKey);
    if (lastClearAt) {
        const t = new Date(lastClearAt).getTime();
        raw = raw.filter(m => new Date(m.created_at).getTime() > t);
    }
    const messages = raw.map(m => {
        const sender = db.getUserById(m.from_user_id);
        const out = {
            ...m,
            username: sender?.username || '该账户已注销',
            nickname: sender?.nickname || sender?.username || '该账户已注销',
            avatar: sender?.avatar || DEFAULT_AVATAR
        };
        if (m.reply_to) {
            const replied = db.getDmMessageById(m.reply_to);
            const fromUser = replied ? db.getUserById(replied.from_user_id) : null;
            out.reply_info = replied ? {
                content: replied.is_recalled ? '[此消息已撤回]' : (replied.content || '图片消息'),
                username: fromUser?.username || '该账户已注销',
                nickname: fromUser?.nickname || fromUser?.username || '该账户已注销'
            } : null;
        }
        return out;
    });
    res.json({ messages });
});

app.delete('/api/dm/messages/:messageId', authenticateUser, requireUser, (req, res) => {
    const { messageId } = req.params;
    const result = db.deleteDmMessageForUser(messageId, req.userId);
    if (!result.ok) return res.status(404).json({ error: 'Message not found' });
    io.to(`user:${req.userId}`).emit('dmMessageDeleted', { messageId: parseInt(messageId) });
    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('New user connected');

    const getAuthenticatedUserId = () => {
        const uid = Number.parseInt(socket.data?.userId, 10);
        return Number.isInteger(uid) ? uid : null;
    };

    socket.on('authenticate', (token, cb) => {
        try {
            if (typeof token !== 'string' || !token) throw new Error('missing_token');
            const user = verifyCurrentUserToken(token, JWT_SECRET, db);
            const uid = user.id;

            socket.leaveAll();
            socket.data.userId = uid;
            socket.data.sessionId = user.active_session_id;
            socket.join(`user:${uid}`);
            const previous = presence.connect(uid, socket);
            if (previous) {
                previous.socket.emit('sessionReplaced', { code: 'session_replaced' });
                previous.socket.disconnect(true);
            }
            logger.auditLog('user_connect', uid, { socketId: socket.id });
            socket.emit('authenticated', { userId: uid });
            broadcastUserPresence(uid);
            broadcastAllChannelPresence();
            if (typeof cb === 'function') cb(null, { userId: uid });
        } catch (error) {
            const previousUserId = getAuthenticatedUserId();
            if (previousUserId) presence.disconnect(previousUserId, socket.id);
            socket.leaveAll();
            delete socket.data.userId;
            delete socket.data.sessionId;
            const reason = error?.code || 'invalid_token';
            socket.emit('authenticationFailed', { reason });
            if (typeof cb === 'function') cb(reason);
        }
    });

    socket.on('adminJoin', (token, cb) => {
        if (!token) {
            if (typeof cb === 'function') cb('no_token');
            return;
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.admin) {
                socket.join('admin');
                if (typeof cb === 'function') cb(null);
            } else {
                if (typeof cb === 'function') cb('not_admin');
            }
        } catch (e) {
            if (typeof cb === 'function') cb('invalid');
        }
    });

    socket.on('joinChannel', (channel) => {
        const uid = getAuthenticatedUserId();
        if (!Number.isInteger(uid) || !isValidChannel(channel) || !canAccessChannel(channel, uid)) {
            socket.emit('channelAccessDenied', { channel, error: 'You do not have access to this channel' });
            return;
        }
        socket.leaveAll();
        socket.join(channel);
        socket.join('user:' + uid);
        console.log('User joined channel:', channel);
        socket.emit('channelJoined', { channel });
        emitChannelPresence(socket, channel);
    });

    socket.on('joinDmConversation', (data) => {
        const userId = getAuthenticatedUserId();
        const peerUserId = data && (data.peerUserId != null) ? parseInt(data.peerUserId) : null;
        if (!userId) {
            socket.emit('privateMessageError', { error: 'Authentication required', code: 'not_authenticated' });
            return;
        }
        if (!peerUserId || userId === peerUserId) return;
        if (!db.areFriends(userId, peerUserId)) return;
        if (socket.dmRoom) socket.leave(socket.dmRoom);
        const room = 'dm:' + [userId, peerUserId].sort((a, b) => a - b).join(':');
        socket.join(room);
        socket.dmRoom = room;
        if (userId != null && !Number.isNaN(userId)) socket.join('user:' + userId);
    });

    socket.on('sendMessage', (data) => {
        console.log('接收到sendMessage事件:', data);
        const { channel, content, image, voice } = data || {};
        const userId = getAuthenticatedUserId();

        const user = db.getUserById(userId);
        if (!user) {
            socket.emit('channelAccessDenied', { channel, error: 'Authentication required' });
            return;
        }
        if (!isValidChannel(channel) || !canAccessChannel(channel, userId)) {
            socket.emit('channelAccessDenied', { channel, error: 'You do not have access to this channel' });
            return;
        }
        if (user.banned) {
            socket.emit('messageError', { error: '账号已被封禁，无法发送消息' });
            return;
        }

        const containsBadWords = badWordsFilter.containsBadWords(content);

        const messageType = data.image ? 'image' : (data.voice ? 'voice' : 'text');
        logger.chatLog(channel, userId, content, messageType, {
            image: data.image,
            voice: data.voice,
            reply_to: data.reply_to,
            is_blocked: containsBadWords
        });

        if (containsBadWords) {
            logger.auditLog('message_blocked', userId, {
                channel,
                content,
                messageType
            });
        }

        const newMessage = db.insertMessage({
            user_id: userId,
            channel,
            content,
            image,
            voice: data.voice,
            reply_to: data.reply_to,
            is_blocked: containsBadWords
        });

        const messageData = {
            id: newMessage.id,
            user_id: userId,
            channel: channel,
            content: content,
            image: image,
            voice: newMessage.voice,
            created_at: newMessage.created_at,
            username: user.username,
            nickname: user.nickname || user.username,
            avatar: user.avatar,
            reply_to: newMessage.reply_to,
            reply_info: null,
            is_blocked: newMessage.is_blocked,
            blocked_at: newMessage.blocked_at
        };

        if (newMessage.reply_to) {
            const repliedMessage = db.getMessageById(newMessage.reply_to);
            if (repliedMessage) {
                const repliedUser = db.getUserById(repliedMessage.user_id);
                messageData.reply_info = {
                    message_id: repliedMessage.id,
                    username: repliedUser?.username || '该账户已注销',
                    nickname: repliedUser?.nickname || repliedUser?.username || '该账户已注销',
                    content: repliedMessage.content,
                    image: repliedMessage.image,
                    is_blocked: repliedMessage.is_blocked
                };
            }
        }

        if (newMessage.is_blocked) {
            socket.emit('messageReceived', messageData);
            socket.emit('messageBlocked', {
                messageId: newMessage.id,
                reason: '消息包含屏蔽词',
                content: content
            });

            setTimeout(() => {
                const msg = db.getMessageById(newMessage.id);
                if (msg && msg.is_blocked) {
                    db.deleteMessage(newMessage.id);
                    io.to(channel).emit('messageDeleted', { messageId: newMessage.id });
                }
            }, 24 * 60 * 60 * 1000);
        } else {
            io.to(channel).emit('messageReceived', messageData);
        }
    });

    socket.on('sendPrivateMessage', (data) => {
        const { toUserId, content, image, voice, reply_to } = data || {};
        const fromId = getAuthenticatedUserId();
        const toId = parseInt(toUserId);
        if (!fromId) {
            socket.emit('privateMessageError', { error: 'Authentication required', code: 'not_authenticated' });
            return;
        }
        if (!toId) return;
        const fromUser = db.getUserById(fromId);
        if (fromUser && fromUser.banned) {
            socket.emit('privateMessageError', { error: '账号已被封禁，无法发送消息' });
            return;
        }
        if (!db.areFriends(fromId, toId)) {
            socket.emit('privateMessageError', { error: '对方不是你的好友，请先添加对方为好友', code: 'not_friends' });
            return;
        }
        if (db.isBlocked(toId, fromId)) {
            socket.emit('privateMessageError', { error: '消息被对方拒收了', code: 'blocked' });
            return;
        }
        const newMessage = db.insertDmMessage({
            from_user_id: fromId,
            to_user_id: toId,
            content,
            image,
            voice,
            reply_to: reply_to != null ? reply_to : undefined
        });
        if (!newMessage) return;
        const messageData = {
            ...newMessage,
            username: fromUser?.username || '该账户已注销',
            nickname: fromUser?.nickname || fromUser?.username || '该账户已注销',
            avatar: fromUser?.avatar || DEFAULT_AVATAR,
            reply_info: null
        };
        if (newMessage.reply_to) {
            const replied = db.getDmMessageById(newMessage.reply_to);
            const repliedFrom = replied ? db.getUserById(replied.from_user_id) : null;
            messageData.reply_info = replied ? {
                content: replied.is_recalled ? '[此消息已撤回]' : (replied.content || '图片消息'),
                username: repliedFrom?.username || '该账户已注销',
                nickname: repliedFrom?.nickname || repliedFrom?.username || '该账户已注销'
            } : null;
        }
        io.to(`user:${fromId}`).emit('privateMessageReceived', messageData);
        io.to(`user:${toId}`).emit('privateMessageReceived', messageData);
    });

    socket.on('recallMessage', (data) => {
        const { messageId, channel } = data || {};
        const uid = getAuthenticatedUserId();

        if (uid == null) {
            socket.emit('recallFailed', { reason: 'not_authenticated' });
            return;
        }
        if (!isValidChannel(channel) || !canAccessChannel(channel, uid)) {
            socket.emit('recallFailed', { reason: 'channel_access_denied' });
            return;
        }

        const message = db.getMessageById(messageId);
        if (!message) {
            console.log(`撤回请求：未找到消息 ${messageId}`);
            socket.emit('recallFailed', { reason: 'not_found' });
            return;
        }
        if (message.channel !== channel) {
            socket.emit('recallFailed', { reason: 'channel_mismatch' });
            return;
        }
        if (message.user_id !== uid) {
            console.log(`撤回请求：非本人消息 message.user_id=${message.user_id} uid=${uid}`);
            socket.emit('recallFailed', { reason: 'not_author' });
            return;
        }

        const messageTime = new Date(message.created_at);
        const now = new Date();
        const timeDiff = (now - messageTime) / (1000 * 60);

        if (timeDiff > 3) {
            console.log(`撤回请求：消息 ${messageId} 已超过3分钟撤回时限 (${timeDiff.toFixed(2)}分钟)`);
            socket.emit('recallFailed', { reason: 'time_limit' });
            return;
        }

        deleteRecallAttachment(message.image);
        deleteRecallAttachment(message.voice);

        const updated = db.updateMessage(messageId, {
            content: '[此消息已撤回]',
            image: null,
            voice: null,
            is_recalled: true,
            recalled_at: new Date().toISOString()
        });
        if (updated) {
            logger.auditLog('message_recall', message.user_id, { messageId, channel, originalContent: message.content });
            const recaller = db.getUserById(message.user_id);
            const recalledByDisplayName = recaller ? (recaller.nickname || recaller.username) : '用户';
            io.to(channel).emit('messageRecalled', {
                messageId,
                channel,
                content: '[此消息已撤回]',
                image: null,
                voice: null,
                is_recalled: true,
                recalled_at: updated.recalled_at,
                originalContent: message.content || null,
                recalledByDisplayName
            });
            setTimeout(() => {
                if (db.deleteMessage(messageId)) {
                    io.to(channel).emit('recalledMessageDeleted', { messageId, channel });
                }
            }, 5 * 60 * 1000);
        } else {
            socket.emit('recallFailed', { reason: 'update_failed' });
        }
    });

    socket.on('recallDmMessage', (data) => {
        const mid = data && data.messageId != null ? parseInt(data.messageId) : NaN;
        if (!Number.isInteger(mid) || mid < 1) {
            socket.emit('recallDmFailed', { reason: 'invalid_id' });
            return;
        }
        const message = db.getDmMessageById(mid);
        if (!message) {
            socket.emit('recallDmFailed', { reason: 'not_found' });
            return;
        }
        const uid = getAuthenticatedUserId();
        if (uid == null || Number.isNaN(uid)) {
            socket.emit('recallDmFailed', { reason: 'not_authenticated' });
            return;
        }
        if (Number(message.from_user_id) !== uid) {
            socket.emit('recallDmFailed', { reason: 'not_author' });
            return;
        }
        const created = new Date(message.created_at).getTime();
        if (Number.isNaN(created) || (Date.now() - created) / (1000 * 60) > 3) {
            socket.emit('recallDmFailed', { reason: 'time_limit' });
            return;
        }
        deleteRecallAttachment(message.image);
        deleteRecallAttachment(message.voice);

        const updated = db.updateDmMessage(mid, {
            content: '[此消息已撤回]',
            image: null,
            voice: null,
            is_recalled: true,
            recalled_at: new Date().toISOString()
        });
        if (!updated) {
            socket.emit('recallDmFailed', { reason: 'update_failed' });
            return;
        }
        logger.auditLog('dm_message_recall', uid, { messageId: mid });
        const recaller = db.getUserById(message.from_user_id);
        const recalledByDisplayName = recaller ? (recaller.nickname || recaller.username) : '用户';
        const payload = { messageId: mid, content: '[此消息已撤回]', image: null, voice: null, is_recalled: true, recalled_at: updated.recalled_at, originalContent: message.content || null, recalledByDisplayName };
        const fromId = Number(message.from_user_id);
        const toId = Number(message.to_user_id);
        io.to('user:' + fromId).emit('dmMessageRecalled', payload);
        io.to('user:' + toId).emit('dmMessageRecalled', payload);
        setTimeout(() => {
            if (db.removeRecalledDmMessageById(mid)) {
                io.to('user:' + fromId).emit('dmRecalledMessageDeleted', { messageId: mid });
                io.to('user:' + toId).emit('dmRecalledMessageDeleted', { messageId: mid });
            }
        }, 5 * 60 * 1000);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        const uid = getAuthenticatedUserId();
        if (uid) {
            logger.auditLog('user_disconnect', uid, { socketId: socket.id });
            if (presence.disconnect(uid, socket.id)) {
                broadcastUserPresence(uid);
                broadcastAllChannelPresence();
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Jchat-JoyChat is running on http://localhost:${PORT}`);
    console.log('Available addresses:');

    const os = require('os');
    const networkInterfaces = os.networkInterfaces();

    for (const ifaceName in networkInterfaces) {
        const interfaces = networkInterfaces[ifaceName];
        for (const iface of interfaces) {
            if (iface.family === 'IPv4') {
                console.log(`  http://${iface.address}:${PORT}`);
            }
        }
    }

    console.log(`Available channels: ${getAllChannels().join(', ')}`);

    const allMessages = [];
    getAllChannels().forEach(channel => {
        const channelMessages = db.getMessagesByChannel(channel);
        allMessages.push(...channelMessages);
    });

    const blockedMessages = allMessages.filter(msg => msg.is_blocked);

    blockedMessages.forEach(msg => {
        const messageTime = new Date(msg.created_at);
        const now = new Date();
        const timeDiff = (now - messageTime) / (1000 * 60 * 60);

        if (timeDiff < 24) {
            const remainingTime = (24 - timeDiff) * 60 * 60 * 1000;

            setTimeout(() => {
                const updatedMsg = db.getMessageById(msg.id);
                if (updatedMsg && updatedMsg.is_blocked) {
                    db.deleteMessage(msg.id);
                    io.to(msg.channel).emit('messageDeleted', { messageId: msg.id });
                }
            }, remainingTime);
        } else {
            db.deleteMessage(msg.id);
            io.to(msg.channel).emit('messageDeleted', { messageId: msg.id });
        }
    });

    console.log(`已为 ${blockedMessages.length} 条被屏蔽消息设置自动删除定时器`);

    const RECALL_PURGE_MS = 5 * 60 * 1000;
    setInterval(() => {
        const channelRemoved = db.purgeRecalledChannelMessagesOlderThan(RECALL_PURGE_MS);
        channelRemoved.forEach(({ id, channel }) => {
            io.to(channel).emit('recalledMessageDeleted', { messageId: id, channel });
        });
        const dmRemoved = db.purgeRecalledDmMessagesOlderThan(RECALL_PURGE_MS);
        dmRemoved.forEach(({ messageId, fromId, toId }) => {
            io.to('user:' + fromId).emit('dmRecalledMessageDeleted', { messageId });
            io.to('user:' + toId).emit('dmRecalledMessageDeleted', { messageId });
        });
    }, 60 * 1000);
});

const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'client', 'dist');
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use('/videos', express.static(path.join(PUBLIC_DIR, 'videos')));
app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));

process.on('SIGINT', () => {
    console.log('Server shutting down...');
    process.exit(0);
});
