const express = require('express');
const http = require('http');
const https = require('https');
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
const { verifyCurrentUserToken } = require('./server/user-session');
const { PresenceRegistry } = require('./server/presence');
const createChannelHelpers = require('./server/channels');
const createMiddleware = require('./server/middleware');
const registerSocketHandlers = require('./server/socket');
const registerRoutes = require('./server/routes');
const DEFAULT_AVATAR = 'images/default.png';
const app = express();
// 可选 HTTPS：设置 SSL_CERT_FILE / SSL_KEY_FILE（PEM 证书与私钥路径）时，用 HTTPS 监听同一端口
const SSL_CERT_FILE = process.env.SSL_CERT_FILE;
const SSL_KEY_FILE = process.env.SSL_KEY_FILE;
const USE_HTTPS = Boolean(SSL_CERT_FILE && SSL_KEY_FILE);
const server = USE_HTTPS
    ? https.createServer({ cert: fs.readFileSync(SSL_CERT_FILE), key: fs.readFileSync(SSL_KEY_FILE) }, app)
    : http.createServer(app);
const PORT = process.env.PORT || 3000;
const PROTOCOL = USE_HTTPS ? 'https' : 'http';

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

const {
    getAvailableChannels, getAllChannels, isValidChannel, isPrivateChannel, canAccessChannel,
    memberSummary, getChannelMemberSummaries, getPublicChannelMembers, getChannelOnlineCount,
    emitChannelPresence, broadcastChannelPresence, broadcastAllChannelPresence, broadcastUserPresence
} = createChannelHelpers({ db, presence, CHANNELS });

const { validateUsername, validatePassword, validateNickname, validateFriendReason, validateDeactivationReason, validateMediaUrl } = require('./server/validation');

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
const { authenticateUser, requireUser, requireAuthenticatedUser, authenticateAdmin } = createMiddleware({ db, jwt, JWT_SECRET, verifyCurrentUserToken });
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
    ['.mp3', ['audio/mpeg', 'audio/mp3']],
    ['.wav', ['audio/wav', 'audio/x-wav', 'audio/x-pn-wav']],
    ['.m4a', ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac']],
    ['.aac', ['audio/aac']]
]);
// 视频预览：只允许浏览器可直接播放的格式（≤100MB）
const VIDEO_UPLOAD_TYPES = new Map([
    ['.mp4', ['video/mp4']],
    ['.webm', ['video/webm']],
    ['.mov', ['video/quicktime']]
]);
// 通用文件：常见安全类型白名单，排除可执行/脚本类（.html/.exe/.js/.bat/.svg 等）
const FILE_UPLOAD_TYPES = new Map([
    ['.pdf', ['application/pdf']],
    ['.doc', ['application/msword']],
    ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
    ['.xls', ['application/vnd.ms-excel']],
    ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
    ['.ppt', ['application/vnd.ms-powerpoint']],
    ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
    ['.txt', ['text/plain']],
    ['.md', ['text/markdown', 'text/plain']],
    ['.csv', ['text/csv']],
    ['.zip', ['application/zip']],
    ['.rar', ['application/vnd.rar', 'application/x-rar-compressed']],
    ['.7z', ['application/x-7z-compressed']],
    ['.tar', ['application/x-tar']],
    ['.gz', ['application/gzip']],
    ['.mp3', ['audio/mpeg', 'audio/mp3']],
    ['.wav', ['audio/wav', 'audio/x-wav', 'audio/x-pn-wav']],
    ['.m4a', ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac']],
    ['.ogg', ['audio/ogg']],
    ['.mkv', ['video/x-matroska']],
    ['.avi', ['video/x-msvideo']]
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

const UPLOAD_LIMITS = {
    files: 1,
    fileSize: 10 * 1024 * 1024,
    fields: 10,
    parts: 11,
    fieldNameSize: 100,
    fieldSize: 64 * 1024
};

function uploadFileFilter(req, file, cb) {
    const typeMaps = { voice: VOICE_UPLOAD_TYPES, video: VIDEO_UPLOAD_TYPES, file: FILE_UPLOAD_TYPES, avatar: IMAGE_UPLOAD_TYPES, image: IMAGE_UPLOAD_TYPES };
    const allowedTypes = typeMaps[file.fieldname] || IMAGE_UPLOAD_TYPES;
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

const upload = multer({ storage, limits: UPLOAD_LIMITS, fileFilter: uploadFileFilter });
// 文件/视频通道允许更大的文件（100MB）
const uploadLarge = multer({ storage, limits: { ...UPLOAD_LIMITS, fileSize: 100 * 1024 * 1024 }, fileFilter: uploadFileFilter });

function makeSecureSingleUpload(uploadInstance, sizeLabel) {
    return function secureUpload(fieldName) {
        const single = uploadInstance.single(fieldName);
        return (req, res, next) => single(req, res, error => {
            if (!error) return next();
            cleanupUploadedFiles(req);
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: `File size exceeds limit (${sizeLabel})` });
            }
            if (error instanceof multer.MulterError || error.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ error: error.code === 'INVALID_FILE_TYPE' ? 'Unsupported file type' : 'Invalid upload payload' });
            }
            console.error('Upload rejected:', error);
            return res.status(400).json({ error: 'Upload failed' });
        });
    };
}
const secureSingleUpload = makeSecureSingleUpload(upload, '10MB');
const secureSingleUploadLarge = makeSecureSingleUpload(uploadLarge, '100MB');

registerRoutes(app, {
    presence, sharp, io,
    authenticateUser, requireUser, requireAuthenticatedUser, authenticateAdmin,
    JWT_SECRET, JWT_EXPIRES_IN, REGISTRATION_ENABLED, VERSION, DEFAULT_AVATAR,
    ADMIN_CREDENTIALS,
    loginRateLimiter, registrationRateLimiter, adminLoginRateLimiter, uploadRateLimiter,
    secureSingleUpload, secureSingleUploadLarge, deleteRecallAttachment, cleanupUploadedFiles, removeUploadedFile,
    IMAGE_UPLOAD_TYPES, VOICE_UPLOAD_TYPES, VIDEO_UPLOAD_TYPES, FILE_UPLOAD_TYPES,
    isValidChannel, isPrivateChannel, canAccessChannel, getAvailableChannels,
    getChannelMemberSummaries, getPublicChannelMembers, broadcastChannelPresence,
    getChannelOnlineCount, broadcastUserPresence, broadcastAllChannelPresence,
    validateUsername, validatePassword, validateNickname, validateFriendReason, validateDeactivationReason, validateMediaUrl,
    isStrongAdminPassword, writeAdminCredentials, ensureAdministratorUser, saveAdminCredentials
});

registerSocketHandlers(io, {
    db, logger, jwt, JWT_SECRET, verifyCurrentUserToken, presence, badWordsFilter,
    deleteRecallAttachment, DEFAULT_AVATAR, validateMediaUrl,
    isValidChannel, canAccessChannel, isPrivateChannel,
    emitChannelPresence, broadcastUserPresence, broadcastAllChannelPresence
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Jchat-JoyChat is running on ${PROTOCOL}://localhost:${PORT}`);
    console.log('Available addresses:');

    const os = require('os');
    const networkInterfaces = os.networkInterfaces();

    for (const ifaceName in networkInterfaces) {
        const interfaces = networkInterfaces[ifaceName];
        for (const iface of interfaces) {
            if (iface.family === 'IPv4') {
                console.log(`  ${PROTOCOL}://${iface.address}:${PORT}`);
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

    // 上传文件过期清理：图片/视频/语音/文件 7 天自动删除（公共频道 + 私聊），消息保留并标记已过期
    const MEDIA_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
    function runMediaExpiry() {
        try {
            const cutoff = new Date(Date.now() - MEDIA_EXPIRY_MS).toISOString();
            const { messages: expired, dmMessages: expiredDm } = db.listExpiredMediaMessages(cutoff);
            expired.forEach(m => {
                deleteRecallAttachment(m.image);
                deleteRecallAttachment(m.video);
                deleteRecallAttachment(m.voice);
                deleteRecallAttachment(m.file);
                db.markMessageExpired(m.id);
                io.to(m.channel).emit('messageMediaExpired', { messageId: m.id, channel: m.channel });
            });
            expiredDm.forEach(m => {
                deleteRecallAttachment(m.image);
                deleteRecallAttachment(m.video);
                deleteRecallAttachment(m.voice);
                deleteRecallAttachment(m.file);
                db.markDmMessageExpired(m.id);
                io.to('user:' + m.from_user_id).emit('dmMessageMediaExpired', { messageId: m.id });
                io.to('user:' + m.to_user_id).emit('dmMessageMediaExpired', { messageId: m.id });
            });
            if (expired.length || expiredDm.length) {
                console.log(`Media expiry: cleaned ${expired.length} channel + ${expiredDm.length} dm messages`);
            }
        } catch (err) {
            console.error('Media expiry job failed:', err.message);
        }
    }
    runMediaExpiry();
    setInterval(runMediaExpiry, 6 * 60 * 60 * 1000);
});

const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'client', 'dist');
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));

process.on('SIGINT', () => {
    console.log('Server shutting down...');
    process.exit(0);
});
