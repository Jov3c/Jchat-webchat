const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

function runNode(script, env = {}) {
    return spawnSync(process.execPath, ['-e', script], {
        cwd: projectRoot,
        env: { ...process.env, ...env },
        encoding: 'utf8'
    });
}

test('DM encryption requires a configured strong key in production and keeps a warned development fallback', () => {
    const missingProductionKey = runNode("require('./server/dm-crypto')", { NODE_ENV: 'production', DM_ENCRYPTION_KEY: '' });
    assert.notEqual(missingProductionKey.status, 0);
    assert.match(missingProductionKey.stderr, /DM_ENCRYPTION_KEY/i);

    const shortProductionKey = runNode("require('./server/dm-crypto')", { NODE_ENV: 'production', DM_ENCRYPTION_KEY: 'too-short' });
    assert.notEqual(shortProductionKey.status, 0);
    assert.match(shortProductionKey.stderr, /DM_ENCRYPTION_KEY/i);

    const developmentFallback = runNode("const c=require('./server/dm-crypto'); const e=c.encrypt('private'); console.log(c.decrypt(e))", { NODE_ENV: 'development', DM_ENCRYPTION_KEY: '' });
    assert.equal(developmentFallback.status, 0);
    assert.equal(developmentFallback.stdout.trim(), 'private');
    assert.match(developmentFallback.stderr, /Jchat development fallback/i);

    for (const key of ['a'.repeat(64), 'a'.repeat(32), 'correct horse battery staple with enough entropy 123']) {
        const result = runNode("const c=require('./server/dm-crypto'); const e=c.encrypt('private'); console.log(e.startsWith('enc:'), c.decrypt(e))", { NODE_ENV: 'production', DM_ENCRYPTION_KEY: key });
        assert.equal(result.status, 0);
        assert.equal(result.stdout.trim(), 'true private');
    }
});

test('private-message encryption leaves legacy plaintext and unreadable enc records compatible', () => {
    const result = runNode("const c=require('./server/dm-crypto'); console.log(c.decrypt('legacy plaintext')); console.log(c.decrypt('enc:not-valid'))", { NODE_ENV: 'production', DM_ENCRYPTION_KEY: 'b'.repeat(64) });
    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['legacy plaintext', 'enc:not-valid']);
});

test('the Jchat development fallback decrypts existing Nexichat development ciphertext without using it for new encryption', () => {
    const legacyCipher = runNode(`
        const crypto = require('crypto');
        const key = crypto.createHash('sha256').update('nexichat-dm-default-dev-key').digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        const data = Buffer.concat([cipher.update('legacy private message', 'utf8'), cipher.final()]);
        process.stdout.write('enc:' + Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64'));
    `, { NODE_ENV: 'development', DM_ENCRYPTION_KEY: '' });
    assert.equal(legacyCipher.status, 0);

    // Pass the ciphertext as an argument to avoid exposing it in a shell command.
    const result = spawnSync(process.execPath, ['-e', "const c=require('./server/dm-crypto'); process.stdout.write(c.decrypt(process.argv[1]))", legacyCipher.stdout], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'development', DM_ENCRYPTION_KEY: '' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'legacy private message');

    const productionResult = spawnSync(process.execPath, ['-e', "const c=require('./server/dm-crypto'); process.stdout.write(c.decrypt(process.argv[1]))", legacyCipher.stdout], {
        cwd: projectRoot,
        env: { ...process.env, NODE_ENV: 'production', DM_ENCRYPTION_KEY: 'c'.repeat(64) },
        encoding: 'utf8'
    });
    assert.equal(productionResult.status, 0);
    assert.equal(productionResult.stdout, legacyCipher.stdout, 'production must never attempt the public legacy development key');
});

test('logs redact sensitive nested details, omit chat bodies by default, and prune expired files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jchat-secret-log-'));
    const previousLogDir = process.env.JCHAT_LOG_DIR;
    const previousRetention = process.env.JCHAT_LOG_RETENTION_DAYS;
    process.env.JCHAT_LOG_DIR = tempDir;
    process.env.JCHAT_LOG_RETENTION_DAYS = '2';
    delete require.cache[require.resolve('../server/log')];
    const logger = require('../server/log');

    try {
        logger.chatLog('private-room', 42, 'do not persist this message', 'text', {
            authorization: 'Bearer secret-token',
            nested: { password: 'hunter2', safe: 'kept' }
        });
        logger.auditLog('login', 42, { token: 'jwt-secret', content: 'audit message body', profile: { apiKey: 'secret-key' } });
        logger.errorLog(new Error('request failed'), { secret: 'value', request: { authorization: 'Bearer another-secret' } });

        const chat = fs.readFileSync(logger.getChatLogPath(), 'utf8');
        const audit = fs.readFileSync(logger.getAuditLogPath(), 'utf8');
        const error = fs.readFileSync(logger.getErrorLogPath(), 'utf8');
        assert.doesNotMatch(chat, /do not persist this message|secret-token|hunter2/);
        assert.match(chat, /contentLength/);
        assert.match(chat, /\[REDACTED\]/);
        assert.doesNotMatch(audit + error, /jwt-secret|secret-key|another-secret|audit message body|"value"/);
        assert.match(audit + error, /\[REDACTED\]/);

        const oldPath = path.join(tempDir, 'chat-2000-01-01.log');
        fs.writeFileSync(oldPath, 'old');
        logger.pruneOldLogs();
        assert.equal(fs.existsSync(oldPath), false);
    } finally {
        delete require.cache[require.resolve('../server/log')];
        if (previousLogDir === undefined) delete process.env.JCHAT_LOG_DIR;
        else process.env.JCHAT_LOG_DIR = previousLogDir;
        if (previousRetention === undefined) delete process.env.JCHAT_LOG_RETENTION_DAYS;
        else process.env.JCHAT_LOG_RETENTION_DAYS = previousRetention;
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
});
