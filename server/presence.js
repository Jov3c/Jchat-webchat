const VALID_PRESENCE_STATUSES = new Set(['online', 'busy', 'away', 'invisible']);

function normalizePresenceStatus(value) {
    return VALID_PRESENCE_STATUSES.has(value) ? value : 'online';
}

class PresenceRegistry {
    constructor() {
        this.connections = new Map();
    }

    connect(userId, socket) {
        const id = Number(userId);
        const previous = this.connections.get(id) || null;
        if (previous?.socketId === socket.id) return null;
        this.connections.set(id, { socketId: socket.id, socket });
        return previous;
    }

    disconnect(userId, socketId) {
        const id = Number(userId);
        const current = this.connections.get(id);
        if (!current || current.socketId !== socketId) return false;
        this.connections.delete(id);
        return true;
    }

    isConnected(userId) {
        return this.connections.has(Number(userId));
    }

    effectiveStatus(viewerId, targetUser) {
        if (!targetUser || !this.isConnected(targetUser.id)) return 'offline';
        const status = normalizePresenceStatus(targetUser.presence_status);
        if (status === 'invisible' && Number(viewerId) !== Number(targetUser.id)) return 'offline';
        return status;
    }

    countChannelOnline(channelData, users) {
        const memberIds = channelData ? new Set((channelData.members || []).map(Number)) : null;
        return users.reduce((count, user) => {
            if (memberIds && !memberIds.has(Number(user.id))) return count;
            if (!this.isConnected(user.id)) return count;
            return normalizePresenceStatus(user.presence_status) === 'invisible' ? count : count + 1;
        }, 0);
    }
}

module.exports = { PresenceRegistry, VALID_PRESENCE_STATUSES, normalizePresenceStatus };
