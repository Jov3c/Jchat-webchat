// REST 路由：按域注册所有 HTTP 接口
const db = require('./db');
const logger = require('./log');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { createUserSessionToken, verifyCurrentUserToken } = require('./user-session');
const { VALID_PRESENCE_STATUSES } = require('./presence');

// multer/busboy 默认按 latin1 解码 multipart 文件名，中文会变乱码；这里还原为 UTF-8
function decodeOriginalName(name) {
    if (typeof name !== 'string' || !name) return '';
    try {
        const restored = Buffer.from(name, 'latin1').toString('utf8');
        // 若还原后含替换字符，说明本来就是 ASCII，直接用原值
        return restored.includes('�') ? name : restored;
    } catch {
        return name;
    }
}

module.exports = function registerRoutes(app, ctx) {
    const {
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
    } = ctx;

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
        const isPublic = !priv;
        return {
            name,
            alias: db.getChannelAlias(req.userId, name),
            ownerId: priv ? priv.owner_id : null,
            isOwner: priv ? priv.owner_id === uid : false,
            last_message_at: db.getLastChannelMessageAt(name),
            pinned: isPublic ? true : db.isPinned(uid, 'channel', name),
            unread_count: db.getUnreadCount(uid, 'channel', name)
        };
    });
    res.json({ channels });
});

app.post('/api/channels', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 28 || /[\r\n<>]/.test(name)) {
        return res.status(400).json({ error: '频道名称无效' });
    }
    if (isValidChannel(name)) {
        return res.status(409).json({ error: '频道已存在' });
    }
    db.channels[name] = { password: null, members: [req.userId], owner_id: req.userId };
    db.saveData();
    res.status(201).json({ name, ownerId: req.userId, members: [req.userId] });
});

app.post('/api/channel/verify-password', authenticateUser, requireAuthenticatedUser, (req, res) => {
    return res.status(410).json({ error: '已不再支持密码访问频道' });
});

app.put('/api/channel/:channel/alias', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) return res.status(404).json({ error: '频道不存在' });
    if (!canAccessChannel(channel, req.userId)) return res.status(403).json({ error: '无权访问该频道' });
    const alias = typeof req.body?.alias === 'string' ? req.body.alias.trim() : '';
    if (alias.length > 28) return res.status(400).json({ error: '备注最多 28 个字符' });
    db.setChannelAlias(req.userId, channel, alias);
    res.json({ success: true, alias: alias || null });
});

app.put('/api/pin', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { kind, key, pinned } = req.body || {};
    if (!['channel', 'dm'].includes(kind) || key == null || key === '') return res.status(400).json({ error: '置顶参数无效' });
    db.setPin(req.userId, kind, String(key), !!pinned);
    res.json({ success: true, pinned: !!pinned });
});

app.post('/api/read', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { kind, key } = req.body || {};
    if (!['channel', 'dm'].includes(kind) || key == null || key === '') return res.status(400).json({ error: '已读参数无效' });
    db.markRead(req.userId, kind, String(key));
    res.json({ success: true });
});

app.put('/api/profile/keys', authenticateUser, requireUser, (req, res) => {
    const { public_key, encrypted_private_key, salt } = req.body || {};
    const updates = {};
    if (public_key !== undefined) updates.public_key = public_key;
    if (encrypted_private_key !== undefined) updates.encrypted_private_key = encrypted_private_key;
    if (salt !== undefined) updates.salt = salt;
    if (!Object.keys(updates).length) return res.json({ success: true });
    db.updateUser(req.userId, updates);
    res.json({ success: true });
});

app.post('/api/channel/:channel/leave', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isPrivateChannel(channel)) return res.status(400).json({ error: '公共频道无法退出' });
    const channelData = db.channels[channel];
    if (!channelData) return res.status(404).json({ error: '频道不存在' });
    const uid = parseInt(req.userId, 10);
    if (channelData.owner_id === uid) return res.status(400).json({ error: '频道创建者不能退出' });
    const idx = channelData.members.indexOf(uid);
    if (idx === -1) return res.status(400).json({ error: '不是频道成员' });
    channelData.members.splice(idx, 1);
    db.saveData();
    broadcastChannelPresence(channel);
    res.json({ success: true });
});

app.get('/api/channel/:channel/access/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    return res.json({ hasAccess: canAccessChannel(req.params.channel, req.userId) });
});

app.delete('/api/channel/:channel', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isPrivateChannel(channel)) return res.status(400).json({ error: '公共频道无法解散' });
    const channelData = db.channels[channel];
    if (!channelData) return res.status(404).json({ error: '频道不存在' });
    if (channelData.owner_id !== parseInt(req.userId, 10)) return res.status(403).json({ error: '只有创建者可以解散频道' });
    const memberIds = [...channelData.members];
    delete db.channels[channel];
    db.saveData();
    for (const uid of memberIds) io.to(`user:${uid}`).emit('channelRemoved', { channel });
    res.json({ success: true });
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
            return res.status(400).json({ error: '邮箱已被使用' });
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
        res.status(500).json({ error: '服务器错误' });
    }
});

app.post('/api/login', loginRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '请填写账号和密码' });
    }

    try {
        const user = db.getUserByUsername(username);
        if (!user) return res.status(401).json({ error: '账号或密码错误' });
        if (user.banned) return res.status(403).json({ error: '账号已被封禁', code: 'banned' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: '账号或密码错误' });
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
            presence_status: user.presence_status || 'online',
            salt: user.salt || null,
            public_key: user.public_key || null,
            encrypted_private_key: user.encrypted_private_key || null
        });

    } catch (error) {
        res.status(500).json({ error: '服务器错误' });
    }
});
app.post('/api/logout', authenticateUser, requireAuthenticatedUser, (req, res) => {
    db.clearUserSession(req.userId, req.userSessionId);
    res.json({ success: true });
});

app.post('/api/admin/login', adminLoginRateLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '请填写账号和密码' });
    }
    const passwordMatches = username === ADMIN_CREDENTIALS.username && await bcrypt.compare(password, ADMIN_CREDENTIALS.passwordHash);
    if (passwordMatches) {
        const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({ token, admin: true });
    } else {
        res.status(401).json({ error: '管理员账号或密码错误' });
    }
});

app.put('/api/admin/password', authenticateAdmin, async (req, res) => {
    const rawCurrent = req.body.currentPassword;
    const rawNew = req.body.newPassword;
    const currentPassword = typeof rawCurrent === 'string' ? rawCurrent.trim() : '';
    const newPassword = typeof rawNew === 'string' ? rawNew.trim() : '';

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: '请填写当前密码和新密码' });
    }
    if (!isStrongAdminPassword(newPassword)) {
        return res.status(400).json({ error: '管理员密码至少 12 位，且不能使用默认密码' });
    }

    if (!await bcrypt.compare(currentPassword, ADMIN_CREDENTIALS.passwordHash)) {
        return res.status(401).json({
            error: '当前密码不正确'
        });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const previousHash = ADMIN_CREDENTIALS.passwordHash;
    ADMIN_CREDENTIALS.passwordHash = passwordHash;
    if (!saveAdminCredentials()) {
        ADMIN_CREDENTIALS.passwordHash = previousHash;
        return res.status(500).json({ error: '保存管理员密码失败' });
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
    if (!userId) return res.status(400).json({ error: '用户 ID 无效' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.username === ADMIN_CREDENTIALS.username) return res.status(403).json({ error: '不能封禁管理员账号' });
    const updated = db.updateUser(userId, { banned: true });
    if (!updated) return res.status(500).json({ error: '更新失败' });
    io.to(`user:${userId}`).emit('userBanned');
    res.json({ success: true, message: '用户已封禁', user: { id: updated.id, username: updated.username, banned: true } });
});

app.put('/api/admin/users/:userId/unban', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: '用户 ID 无效' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const updated = db.updateUser(userId, { banned: false });
    if (!updated) return res.status(500).json({ error: '更新失败' });
    io.to(`user:${userId}`).emit('userUnbanned');
    res.json({ success: true, message: '用户已解封', user: { id: updated.id, username: updated.username, banned: false } });
});

app.delete('/api/admin/users/:userId', authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!userId) return res.status(400).json({ error: '用户 ID 无效' });
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.username === ADMIN_CREDENTIALS.username) return res.status(403).json({ error: '不能删除管理员账号' });
    const ok = db.deleteUser(userId);
    if (!ok) return res.status(500).json({ error: '删除失败' });
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
        if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '操作必须是 approve 或 reject' });
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
        return res.status(404).json({ error: '私密频道不存在' });
    }
    const channelData = db.channels[channel];
    if (channelData.owner_id !== req.userId) {
        return res.status(403).json({ error: '只有频道创建者可以邀请成员' });
    }
    if (!Array.isArray(req.body?.usernames) || req.body.usernames.some(username => typeof username !== 'string')) {
        return res.status(400).json({ error: '用户列表格式不正确' });
    }

    const usernames = [...new Set(req.body.usernames.filter(username => username.length > 0))];
    const needConsent = channelData.members.length > 10;
    const memberIds = new Set(channelData.members);
    const invited = [];
    const notFound = [];
    const autoAdded = [];
    const pendingInvites = [];

    for (const username of usernames) {
        const user = db.getUserByUsername(username);
        if (!user) {
            notFound.push(username);
            continue;
        }
        if (memberIds.has(user.id)) continue;
        invited.push({ id: user.id, username: user.username });
        if (needConsent) pendingInvites.push(user);
        else { memberIds.add(user.id); autoAdded.push(user); }
    }

    if (autoAdded.length) {
        channelData.members = [...memberIds];
        db.saveData();
        broadcastChannelPresence(channel);
    }
    const owner = db.getUserById(req.userId);
    const inviter = { id: owner.id, username: owner.username };
    for (const user of autoAdded) io.to(`user:${user.id}`).emit('channelInvited', { channel, invitedBy: inviter });
    for (const user of pendingInvites) {
        db.createChannelInvite(channel, user.id, req.userId);
        io.to(`user:${user.id}`).emit('channelInvitePending', { channel, invitedBy: inviter });
    }

    res.json({ success: true, invited, notFound, members: getChannelMemberSummaries(channel, req.userId) });
});

app.get('/api/channel/invites', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const invites = db.getPendingChannelInvites(req.userId).map(inv => {
        const inviter = db.getUserById(inv.inviter_user_id);
        return {
            id: inv.id,
            channel: inv.channel,
            inviter: inviter ? { id: inviter.id, username: inviter.username, nickname: inviter.nickname || inviter.username } : { username: '该账户已注销' },
            created_at: inv.created_at
        };
    });
    res.json({ invites });
});

app.post('/api/channel/invites/:id/respond', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { id } = req.params;
    const { action } = req.body || {};
    const result = db.respondChannelInvite(id, req.userId, action);
    if (!result.ok) {
        const map = { not_found: '邀请不存在', not_authorized: '无权限操作', already_resolved: '已处理', invalid_action: '无效操作' };
        return res.status(400).json({ error: map[result.error] || '操作失败' });
    }
    if (action === 'accept') {
        const channel = result.invite.channel;
        if (isPrivateChannel(channel)) {
            const cd = db.channels[channel];
            if (cd && !cd.members.includes(parseInt(result.invite.invited_user_id, 10))) {
                cd.members.push(parseInt(result.invite.invited_user_id, 10));
                db.saveData();
                broadcastChannelPresence(channel);
            }
        }
    }
    res.json({ success: true });
});

app.get('/api/channel/:channel/members', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) {
        return res.status(404).json({ error: '频道不存在' });
    }
    if (isPrivateChannel(channel)) {
        const uid = parseInt(req.userId, 10);
        if (!db.channels[channel].members.includes(uid)) {
            return res.status(403).json({ error: '不是频道成员' });
        }
        return res.json({ members: getChannelMemberSummaries(channel, req.userId) });
    }
    res.json({ members: getPublicChannelMembers(req.userId) });
});

app.delete('/api/channel/:channel/members/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel, userId } = req.params;
    const parsedUserId = Number.parseInt(userId, 10);

    if (!isPrivateChannel(channel)) {
        return res.status(404).json({ error: '私密频道不存在' });
    }
    const channelData = db.channels[channel];
    if (channelData.owner_id !== req.userId) {
        return res.status(403).json({ error: '只有频道创建者可以移除成员' });
    }
    if (parsedUserId === channelData.owner_id) {
        return res.status(400).json({ error: '频道创建者不能被移除', code: 'owner_cannot_be_removed' });
    }
    const memberIndex = channelData.members.indexOf(parsedUserId);
    if (memberIndex !== -1) {
        channelData.members.splice(memberIndex, 1);
        db.saveData();
        broadcastChannelPresence(channel);
        res.json({ success: true, message: 'User removed from channel' });
    } else {
        res.status(404).json({ error: '用户不在该频道' });
    }
});

app.put('/api/channel/:channel/password', authenticateAdmin, (req, res) => {
    const { channel } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
        return res.status(400).json({ error: '请填写新密码' });
    }

    if (!isPrivateChannel(channel)) {
        return res.status(400).json({ error: '不是私密频道' });
    }

    db.channels[channel].password = newPassword;
    db.saveData();
    res.json({ success: true, message: 'Channel password updated successfully' });
});
app.get('/api/profile/:userId', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { userId } = req.params;
    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
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
        return res.status(400).json({ error: '在线状态无效', code: 'invalid_presence_status' });
    }
    if (email !== undefined && email !== null && email !== '') {
        const existingUser = db.getUserByEmail(email);
        if (existingUser && existingUser.id !== userId) {
            return res.status(400).json({ error: '邮箱已被使用' });
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
    if (!updatedUser) return res.status(404).json({ error: '用户不存在' });
    if (presence_status !== undefined) {
        broadcastUserPresence(userId);
        broadcastAllChannelPresence();
    }
    res.json({ success: true });
});
app.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword, salt, encrypted_private_key } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '需要登录令牌' });
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.ok) {
        return res.status(400).json({ error: passwordCheck.error, success: false });
    }

    try {
        const user = verifyCurrentUserToken(token, JWT_SECRET, db);
        const userId = user.id;
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(401).json({ error: '当前密码错误', success: false });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const updates = { password: hashedPassword };
        if (salt !== undefined) updates.salt = salt;
        if (encrypted_private_key !== undefined) updates.encrypted_private_key = encrypted_private_key;
        const updatedUser = db.updateUser(userId, updates);
        if (!updatedUser) {
            return res.status(500).json({ error: '修改密码失败', success: false });
        }

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: '令牌无效', success: false });
        }
        res.status(500).json({ error: '服务器错误', success: false });
    }
});

app.post('/api/upload/avatar', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '请选择文件' });
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
            const optimizedPath = path.join(ROOT, 'public', 'uploads', 'optimized-' + req.file.filename);
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
            const destPath = path.join(ROOT, 'public', 'uploads', safeName);
            createdAvatarPath = destPath;
            fs.renameSync(req.file.path, destPath);
            avatarUrl = 'uploads/' + safeName;
        }

        const updatedUser = db.updateUser(req.userId, { avatar: avatarUrl });
        if (!updatedUser) {
            removeUploadedFile({ path: createdAvatarPath });
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({ success: true, avatar: avatarUrl });
    } catch (error) {
        console.error('Avatar upload error:', error);
        cleanupUploadedFiles(req);
        removeUploadedFile({ path: createdAvatarPath });
        res.status(500).json({ error: error.message || '图片处理失败' });
    }
});

app.post('/api/upload/image', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('image'), async (req, res) => {
    if (!req.file) {
        console.error('Upload failed: No file provided');
        return res.status(400).json({ error: '请选择文件' });
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
            const optimizedPath = path.join(ROOT, 'public', 'uploads', 'chat-' + req.file.filename);
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
            const destPath = path.join(ROOT, 'public', 'uploads', safeName);
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
            res.status(413).json({ error: '文件大小超过限制（10MB）' });
        } else {
            res.status(500).json({ error: '图片处理失败' });
        }
    }
});

app.post('/api/upload/file', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUploadLarge('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    try {
        const originalName = decodeOriginalName(req.file.originalname) || 'file';
        const safeName = 'file-' + req.file.filename;
        const destPath = path.join(ROOT, 'public', 'uploads', safeName);
        fs.renameSync(req.file.path, destPath);
        res.json({ success: true, file: 'uploads/' + safeName, file_name: originalName });
    } catch (error) {
        console.error('File upload failed:', error);
        cleanupUploadedFiles(req);
        res.status(500).json({ error: '文件上传失败' });
    }
});

app.post('/api/upload/video', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUploadLarge('video'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择视频' });
    try {
        const originalName = decodeOriginalName(req.file.originalname) || 'video';
        const safeName = 'video-' + req.file.filename;
        const destPath = path.join(ROOT, 'public', 'uploads', safeName);
        fs.renameSync(req.file.path, destPath);
        res.json({ success: true, video: 'uploads/' + safeName, video_name: originalName });
    } catch (error) {
        console.error('Video upload failed:', error);
        cleanupUploadedFiles(req);
        res.status(500).json({ error: '视频上传失败' });
    }
});

// 音乐卡片：按网易云歌曲 ID 抓取歌名/封面/时长（带内存缓存，避免重复请求外部接口）
const musicCache = new Map();
app.get('/api/music', async (req, res) => {
    const id = String(req.query.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: '缺少歌曲 ID' });
    if (musicCache.has(id)) return res.json(musicCache.get(id));
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const remote = await fetch(`https://music.163.com/api/song/detail?ids=%5B${id}%5D`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' },
            signal: controller.signal
        });
        clearTimeout(timer);
        const data = await remote.json();
        const song = (data.songs || [null])[0];
        let info;
        if (!song) {
            info = { ok: false, error: '未找到' };
        } else {
            info = {
                ok: true, id,
                name: song.name,
                artist: (song.artists || []).map(a => a.name).join('/'),
                album: song.album && song.album.name,
                pic: song.album && song.album.picUrl,
                sec: Math.floor((song.duration || 0) / 1000)
            };
        }
        musicCache.set(id, info);
        res.json(info);
    } catch (err) {
        res.status(502).json({ ok: false, error: '网络请求失败' });
    }
});

app.get('/api/admin/logs/list', authenticateAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    const logDir = path.join(ROOT, 'server', 'logs');

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
        res.status(500).json({ error: '获取日志列表失败：' + error.message });
    }
});

app.get('/api/admin/logs/content/:filename', authenticateAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    const { filename } = req.params;
    const { search = '', page = 1, limit = 50, type = '' } = req.query;

    if (!filename.match(/^[a-zA-Z0-9\-_\.]+$/)) {
        return res.status(400).json({ error: '文件名无效' });
    }

    const logPath = path.join(ROOT, 'server', 'logs', filename);

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
        res.status(500).json({ error: '读取日志失败：' + error.message });
    }
});

app.post('/api/upload/voice', authenticateUser, requireAuthenticatedUser, uploadRateLimiter, secureSingleUpload('voice'), async (req, res) => {
    if (!req.file) {
        console.error('Voice upload failed: No file provided');
        return res.status(400).json({ error: '请选择文件' });
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
            return res.status(400).json({ error: '不支持的文件类型' });
        }

        voicePath = path.join(ROOT, 'public', 'uploads', 'voice-' + req.file.filename);

        fs.renameSync(req.file.path, voicePath);

        const voiceUrl = 'uploads/voice-' + req.file.filename;
        console.log('Voice upload completed successfully:', voiceUrl);
        res.json({ success: true, voice: voiceUrl });
    } catch (error) {
        console.error('Voice upload failed:', error);
        cleanupUploadedFiles(req);
        removeUploadedFile({ path: voicePath });
        if (error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: '文件大小超过限制（10MB）' });
        } else {
            res.status(500).json({ error: '语音上传失败' });
        }
    }
});

app.post('/api/channel/:channel/clear', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    if (!isValidChannel(channel)) return res.status(400).json({ error: '频道无效' });
    const userId = parseInt(req.userId, 10);
    if (!userId) return res.status(401).json({ error: '未授权' });
    if (!canAccessChannel(channel, userId)) return res.status(403).json({ error: '无权访问该频道' });
    try {
        const last_clear_at = db.setChannelClearTime(userId, channel);
        res.json({ success: true, last_clear_at });
    } catch (e) {
        res.status(500).json({ success: false, error: '清空失败' });
    }
});

app.get('/api/messages/:channel', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;

    if (!isValidChannel(channel)) {
        return res.status(400).json({ error: '频道无效' });
    }
    if (!canAccessChannel(channel, req.userId)) {
        return res.status(403).json({ error: '无权访问该频道' });
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
            reply_info: null,
            reactions: db.getReactions(msg.id)
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

app.post('/api/messages/:messageId/reaction', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { messageId } = req.params;
    const { emoji } = req.body || {};
    const message = db.getMessageById(messageId);
    if (!message) return res.status(404).json({ error: '消息不存在' });
    if (!canAccessChannel(message.channel, req.userId)) return res.status(403).json({ error: '无权访问' });
    const reactions = db.toggleReaction(messageId, req.userId, emoji);
    io.to(message.channel).emit('messageReaction', { messageId: parseInt(messageId), reactions });
    res.json({ success: true, reactions });
});

app.get('/api/friends', authenticateUser, requireUser, (req, res) => {
    const uid = parseInt(req.userId, 10);
    const list = db.getFriends(req.userId).map(friend => {
        const user = db.getUserById(friend.id);
        return {
            ...friend,
            presence_status: user ? presence.effectiveStatus(req.userId, user) : 'offline',
            last_message_at: db.getLastDmMessageAt(uid, friend.id),
            pinned: db.isPinned(uid, 'dm', String(friend.id)),
            unread_count: db.getUnreadCount(uid, 'dm', String(friend.id)),
            public_key: user?.public_key || null
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
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
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
        return res.status(400).json({ error: map[result.error] || '创建好友申请失败' });
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
        return res.status(400).json({ error: map[result.error] || '处理好友申请失败' });
    }
    io.to(`user:${result.request.from_user_id}`).emit('friendRequestUpdated', { requestId: result.request.id, status: result.request.status });
    io.to(`user:${result.request.to_user_id}`).emit('friendRequestUpdated', { requestId: result.request.id, status: result.request.status });
    res.json({ success: true, request: result.request });
});

app.delete('/api/friends/:friendUserId', authenticateUser, requireUser, (req, res) => {
    const friendUserId = parseInt(req.params.friendUserId);
    if (!friendUserId) return res.status(400).json({ error: '好友 ID 无效' });
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
    if (!peerUserId) return res.status(400).json({ error: '私聊对象无效' });
    if (!db.areFriends(req.userId, peerUserId)) return res.status(403).json({ error: '你们还不是好友' });
    const dmKey = [parseInt(req.userId, 10), peerUserId].sort((a, b) => a - b).join('_');
    try {
        const last_clear_at = db.setDmClearTime(req.userId, dmKey);
        res.json({ success: true, last_clear_at });
    } catch (e) {
        res.status(500).json({ success: false, error: '清空失败' });
    }
});

app.get('/api/dm/:peerUserId/messages', authenticateUser, requireUser, (req, res) => {
    const peerUserId = parseInt(req.params.peerUserId);
    if (!peerUserId) return res.status(400).json({ error: '私聊对象无效' });
    if (!db.areFriends(req.userId, peerUserId)) return res.status(403).json({ error: '你们还不是好友' });
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

app.get('/api/messages/:channel/search', authenticateUser, requireAuthenticatedUser, (req, res) => {
    const { channel } = req.params;
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ results: [] });
    if (!isValidChannel(channel) || !canAccessChannel(channel, req.userId)) return res.status(403).json({ error: '无权访问' });
    const results = db.getMessagesByChannel(channel)
        .filter(m => !m.is_blocked && (m.content || '').toLowerCase().includes(q))
        .slice(-50)
        .map(m => {
            const user = db.getUserById(m.user_id);
            return { ...m, username: user?.username || '该账户已注销', nickname: user?.nickname || user?.username || '该账户已注销', avatar: user?.avatar || DEFAULT_AVATAR };
        });
    res.json({ results });
});

app.get('/api/dm/:peerUserId/search', authenticateUser, requireUser, (req, res) => {
    const peerUserId = parseInt(req.params.peerUserId);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ results: [] });
    if (!peerUserId || !db.areFriends(req.userId, peerUserId)) return res.status(403).json({ error: '你们还不是好友' });
    const results = db.getDmMessagesBetween(req.userId, peerUserId, req.userId)
        .filter(m => (m.content || '').toLowerCase().includes(q))
        .slice(-50)
        .map(m => {
            const sender = db.getUserById(m.from_user_id);
            return { ...m, username: sender?.username || '该账户已注销', nickname: sender?.nickname || sender?.username || '该账户已注销', avatar: sender?.avatar || DEFAULT_AVATAR };
        });
    res.json({ results });
});

app.delete('/api/dm/messages/:messageId', authenticateUser, requireUser, (req, res) => {
    const { messageId } = req.params;
    const result = db.deleteDmMessageForUser(messageId, req.userId);
    if (!result.ok) return res.status(404).json({ error: '消息不存在' });
    io.to(`user:${req.userId}`).emit('dmMessageDeleted', { messageId: parseInt(messageId) });
    res.json({ success: true });
});

// 自定义表情包（仅自己可见）
app.get('/api/stickers', authenticateUser, requireUser, (req, res) => {
    res.json({ stickers: db.getStickers(req.userId) });
});

app.post('/api/stickers', authenticateUser, requireUser, (req, res) => {
    const checked = validateMediaUrl(req.body?.url);
    if (!checked.ok) return res.status(400).json({ error: '表情包地址不合法' });
    const sticker = db.addSticker(req.userId, checked.value);
    if (!sticker) return res.status(400).json({ error: '添加表情包失败' });
    res.status(201).json({ sticker, stickers: db.getStickers(req.userId) });
});

app.delete('/api/stickers/:stickerId', authenticateUser, requireUser, (req, res) => {
    const ok = db.deleteSticker(req.params.stickerId, req.userId);
    if (!ok) return res.status(404).json({ error: '表情包不存在' });
    res.json({ success: true, stickers: db.getStickers(req.userId) });
});
};
