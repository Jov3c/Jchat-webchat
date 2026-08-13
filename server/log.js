const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.JCHAT_LOG_DIR ? path.resolve(process.env.JCHAT_LOG_DIR) : path.join(__dirname, 'logs');
const SENSITIVE_FIELD = /(password|token|authorization|secret|(?:api)?key|credential|cookie|(?:original)?content)/i;
const CHAT_CONTENT_ENABLED = process.env.JCHAT_LOG_CHAT_CONTENT === 'true';
const configuredRetention = Number.parseInt(process.env.JCHAT_LOG_RETENTION_DAYS, 10);
const LOG_RETENTION_DAYS = Number.isInteger(configuredRetention) && configuredRetention >= 1 && configuredRetention <= 3650 ? configuredRetention : 30;
let pruneScheduledForDate = null;

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        try {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        } catch (e) {
            console.error('[log] Unable to create log directory:', e.message);
        }
    }
}

function getDateSuffix() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getAuditLogPath() { return path.join(LOG_DIR, `audit-${getDateSuffix()}.log`); }
function getChatLogPath() { return path.join(LOG_DIR, `chat-${getDateSuffix()}.log`); }
function getErrorLogPath() { return path.join(LOG_DIR, `error-${getDateSuffix()}.log`); }

function redactSensitive(value, seen = new WeakSet()) {
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => redactSensitive(item, seen));
    const output = {};
    for (const [field, nestedValue] of Object.entries(value)) {
        output[field] = SENSITIVE_FIELD.test(field) ? '[REDACTED]' : redactSensitive(nestedValue, seen);
    }
    return output;
}

function pruneOldLogs(now = new Date()) {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = new Date(now);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - LOG_RETENTION_DAYS);
    try {
        for (const name of fs.readdirSync(LOG_DIR)) {
            const match = /^(?:audit|chat|error)-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
            if (!match) continue;
            const dated = new Date(`${match[1]}T00:00:00.000Z`);
            if (!Number.isNaN(dated.getTime()) && dated < cutoff) fs.unlinkSync(path.join(LOG_DIR, name));
        }
    } catch (error) {
        console.error('[log] Failed to prune retained logs:', error.message);
    }
}

function schedulePrune() {
    const today = new Date().toISOString().slice(0, 10);
    if (pruneScheduledForDate === today) return;
    pruneScheduledForDate = today;
    const timer = setImmediate(() => pruneOldLogs());
    timer.unref?.();
}

function writeLog(filePath, logData) {
    ensureLogDir();
    schedulePrune();
    try {
        fs.appendFileSync(filePath, JSON.stringify(logData) + '\n', 'utf8');
    } catch (err) {
        console.error('[log] Failed to write log:', err.message);
    }
}

function auditLog(action, userId, details = {}) {
    writeLog(getAuditLogPath(), { timestamp: new Date().toISOString(), action, userId, details: redactSensitive(details) });
}

function chatLog(channel, userId, content, messageType, details = {}) {
    const body = content == null ? '' : String(content);
    const logData = {
        timestamp: new Date().toISOString(),
        channel,
        userId,
        contentLength: Buffer.byteLength(body, 'utf8'),
        contentLogged: CHAT_CONTENT_ENABLED,
        messageType,
        details: redactSensitive(details)
    };
    if (CHAT_CONTENT_ENABLED) logData.content = body;
    writeLog(getChatLogPath(), logData);
}

function errorLog(error, context = {}) {
    const safeError = redactSensitive({ name: error?.name || 'Error', message: error?.message || String(error) });
    const safeContext = redactSensitive(context);
    writeLog(getErrorLogPath(), { timestamp: new Date().toISOString(), error: safeError, context: safeContext });
    console.error('Error:', safeError);
    console.error('Context:', safeContext);
}

module.exports = {
    auditLog,
    chatLog,
    errorLog,
    redactSensitive,
    pruneOldLogs,
    getDateSuffix,
    getAuditLogPath,
    getChatLogPath,
    getErrorLogPath
};
