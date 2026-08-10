const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../server/db');

const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = process.env.JCHAT_UPLOADS_DIR || path.join(ROOT, 'public', 'uploads');
const ADMIN_CREDENTIALS_FILE = process.env.JCHAT_ADMIN_CREDENTIALS_FILE || path.join(ROOT, 'server', 'data', 'admin_credentials.json');
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function isStrongAdminPassword(password) {
    return typeof password === 'string' && password.length >= 12 && password !== 'admin123';
}

function writeAdminCredentials(passwordHash) {
    const dataDir = path.dirname(ADMIN_CREDENTIALS_FILE);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tempFile = path.join(dataDir, `.admin_credentials.${process.pid}.${Date.now()}.tmp`);
    try {
        fs.writeFileSync(tempFile, JSON.stringify({ username: ADMIN_USERNAME, passwordHash }, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tempFile, ADMIN_CREDENTIALS_FILE);
        try { fs.chmodSync(ADMIN_CREDENTIALS_FILE, 0o600); } catch (_) {}
    } finally {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    }
}

function clearUploads() {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
        if (name === '.gitkeep') continue;
        const file = path.join(UPLOADS_DIR, name);
        if (fs.statSync(file).isFile()) fs.unlinkSync(file);
    }
}

async function main() {
    if (process.env.NODE_ENV === 'production' && !isStrongAdminPassword(DEFAULT_PASSWORD)) {
        throw new Error('ADMIN_PASSWORD must be at least 12 characters when resetting production data');
    }
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    db.resetAllMessages();
    for (const user of db.getUsers().slice()) db.deleteUser(user.id);
    db.insertUser({
        username: ADMIN_USERNAME,
        password: passwordHash,
        email: null,
        nickname: '管理员'
    });
    for (const name of Object.keys(db.channels)) delete db.channels[name];
    db.saveData();
    writeAdminCredentials(passwordHash);
    clearUploads();
    console.log(`SQLite 数据已重置，默认账号：${ADMIN_USERNAME} / ${DEFAULT_PASSWORD}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
