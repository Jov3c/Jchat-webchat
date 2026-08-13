const assert = require('node:assert/strict');
const test = require('node:test');

test('presence registry replaces one page without letting the old disconnect remove the new page', () => {
    const { PresenceRegistry } = require('../server/presence');
    const registry = new PresenceRegistry();
    const first = { id: 'socket-one' };
    const second = { id: 'socket-two' };

    assert.equal(registry.connect(1, first), null);
    assert.equal(registry.connect(1, second).socketId, 'socket-one');
    assert.equal(registry.connect(1, second), null);
    assert.equal(registry.disconnect(1, 'socket-one'), false);
    assert.equal(registry.isConnected(1), true);
    assert.equal(registry.disconnect(1, 'socket-two'), true);
    assert.equal(registry.isConnected(1), false);
});

test('channel online count includes visible connected members once and excludes invisible users', () => {
    const { PresenceRegistry } = require('../server/presence');
    const registry = new PresenceRegistry();
    const users = [
        { id: 1, presence_status: 'online' },
        { id: 2, presence_status: 'busy' },
        { id: 3, presence_status: 'away' },
        { id: 4, presence_status: 'invisible' },
        { id: 5, presence_status: 'online' }
    ];
    for (const user of users.slice(0, 4)) registry.connect(user.id, { id: `socket-${user.id}` });

    assert.equal(registry.countChannelOnline(null, users), 3);
    assert.equal(registry.countChannelOnline({ members: [2, 4, 5] }, users), 1);
});

test('effective status never reveals invisible presence to another user', () => {
    const { PresenceRegistry } = require('../server/presence');
    const registry = new PresenceRegistry();
    const invisible = { id: 4, presence_status: 'invisible' };
    registry.connect(4, { id: 'socket-four' });

    assert.equal(registry.effectiveStatus(4, invisible), 'invisible');
    assert.equal(registry.effectiveStatus(8, invisible), 'offline');
    assert.equal(registry.effectiveStatus(8, { id: 5, presence_status: 'busy' }), 'offline');
    registry.connect(5, { id: 'socket-five' });
    assert.equal(registry.effectiveStatus(8, { id: 5, presence_status: 'busy' }), 'busy');
});
