const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../server/db');

const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads');
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function clearUploads() {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
        const file = path.join(UPLOADS_DIR, name);
        if (fs.statSync(file).isFile()) fs.unlinkSync(file);
    }
}

async function main() {
    db.resetAllMessages();
    for (const user of db.getUsers().slice()) db.deleteUser(user.id);
    db.insertUser({
        username: 'admin',
        password: await bcrypt.hash(DEFAULT_PASSWORD, 10),
        email: 'admin@example.com',
        nickname: '管理员'
    });
    for (const name of Object.keys(db.channels)) delete db.channels[name];
    db.saveData();
    clearUploads();
    console.log(`SQLite 数据已重置，默认账号：admin / ${DEFAULT_PASSWORD}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
