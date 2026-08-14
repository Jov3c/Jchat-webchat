// 频道辅助函数：访问控制、成员摘要、在线状态广播
function createChannelHelpers({ db, presence, CHANNELS }) {
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

    return {
        getAvailableChannels, getAllChannels, isValidChannel, isPrivateChannel, canAccessChannel,
        memberSummary, getChannelMemberSummaries, getPublicChannelMembers, getChannelOnlineCount,
        emitChannelPresence, broadcastChannelPresence, broadcastAllChannelPresence, broadcastUserPresence
    };
}

module.exports = createChannelHelpers;
