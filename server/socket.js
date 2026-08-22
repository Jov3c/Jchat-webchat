// Socket.IO 实时通信：认证、频道/私聊、消息收发、撤回、在线状态
function registerSocketHandlers(io, ctx) {
    const {
        db, logger, jwt, JWT_SECRET, verifyCurrentUserToken, presence, badWordsFilter,
        deleteRecallAttachment, DEFAULT_AVATAR, validateMediaUrl,
        isValidChannel, canAccessChannel, isPrivateChannel,
        emitChannelPresence, broadcastUserPresence, broadcastAllChannelPresence
    } = ctx;

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
            const { channel, content, image, voice, file, file_name } = data || {};
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

            // 清洗媒体附件 URL：拒绝 javascript: 等危险协议，防止存储型 XSS
            const media = { image, voice, file };
            for (const key of ['image', 'voice', 'file']) {
                const checked = validateMediaUrl(media[key]);
                if (!checked.ok) {
                    socket.emit('messageError', { error: '媒体地址不合法，消息已拒绝' });
                    return;
                }
                media[key] = checked.value;
            }

            const containsBadWords = badWordsFilter.containsBadWords(content);

            const messageType = media.image ? 'image' : (media.voice ? 'voice' : 'text');
            logger.chatLog(channel, userId, content, messageType, {
                image: media.image,
                voice: media.voice,
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
                image: media.image,
                voice: media.voice,
                file: media.file,
                file_name: data.file_name,
                reply_to: data.reply_to,
                is_blocked: containsBadWords
            });

            const messageData = {
                id: newMessage.id,
                user_id: userId,
                channel: channel,
                content: content,
                image: media.image,
                voice: media.voice,
                file: media.file,
                file_name: newMessage.file_name,
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
                // 广播到各成员的 user 房间，保证不在该频道的人也能收到未读提示
                const memberIds = isPrivateChannel(channel)
                    ? (db.channels[channel]?.members || [])
                    : db.getUsers().map(u => u.id);
                for (const id of memberIds) io.to('user:' + id).emit('messageReceived', messageData);
            }
        });

        socket.on('sendPrivateMessage', (data) => {
            const { toUserId, content, image, voice, file, file_name, reply_to } = data || {};
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

            // 清洗媒体附件 URL：拒绝 javascript: 等危险协议，防止存储型 XSS
            const dmMedia = { image, voice, file };
            for (const key of ['image', 'voice', 'file']) {
                const checked = validateMediaUrl(dmMedia[key]);
                if (!checked.ok) {
                    socket.emit('privateMessageError', { error: '媒体地址不合法，消息已拒绝' });
                    return;
                }
                dmMedia[key] = checked.value;
            }

            const newMessage = db.insertDmMessage({
                from_user_id: fromId,
                to_user_id: toId,
                content,
                image: dmMedia.image,
                voice: dmMedia.voice,
                file: dmMedia.file,
                file_name,
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
}

module.exports = registerSocketHandlers;
