const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const chatPath = path.join(projectRoot, 'public', 'js', 'chat.js');
const indexPath = path.join(projectRoot, 'public', 'index.html');
const stylePath = path.join(projectRoot, 'public', 'css', 'style.css');

function extractFunction(source, name) {
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `Expected production helper ${name}`);
    const asyncStart = source.lastIndexOf('async ', functionStart);
    const start = asyncStart === functionStart - 6 ? asyncStart : functionStart;
    const openBrace = source.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = openBrace; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`Could not parse production helper ${name}`);
}

function loadInviteHelpers(overrides = {}) {
    const source = fs.readFileSync(chatPath, 'utf8');
    const names = [
        'isPublicChannelName',
        'mergeChannelInviteUsernames',
        'buildChannelInviteRequest',
        'canManageChannelMembers'
    ];
    const context = vm.createContext({
        encodeURIComponent,
        getAuthHeaders: () => ({ Authorization: 'Bearer verified-token' }),
        ...overrides
    });
    const declarations = names.map(name => extractFunction(source, name)).join('\n');
    vm.runInContext(`${declarations}\nthis.inviteHelpers = { ${names.join(', ')} };`, context);
    return context.inviteHelpers;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadNotificationSettingsState(savedValue) {
    const source = fs.readFileSync(chatPath, 'utf8');
    const declarationStart = source.indexOf('let notificationSettings =');
    const declarationEnd = source.indexOf('};', declarationStart) + 2;
    assert.notEqual(declarationStart, -1, 'Expected production notification state');

    const stored = new Map();
    if (savedValue !== undefined) stored.set('notificationSettings', savedValue);
    const localStorage = {
        getItem(key) {
            return stored.has(key) ? stored.get(key) : null;
        },
        setItem(key, value) {
            stored.set(key, String(value));
        }
    };
    const context = vm.createContext({
        localStorage,
        updateNotificationSettingsUI() {},
        console: { log() {}, error() {} }
    });
    const optionalMigration = source.includes('function migrateNotificationChannelNames(')
        ? extractFunction(source, 'migrateNotificationChannelNames')
        : '';
    vm.runInContext(`
        ${source.slice(declarationStart, declarationEnd)}
        ${optionalMigration}
        ${extractFunction(source, 'saveNotificationSettings')}
        ${extractFunction(source, 'loadNotificationSettings')}
        this.initialSettings = JSON.parse(JSON.stringify(notificationSettings));
        loadNotificationSettings();
        this.loadedSettings = JSON.parse(JSON.stringify(notificationSettings));
    `, context);
    return {
        initial: plain(context.initialSettings),
        loaded: plain(context.loadedSettings),
        persisted: JSON.parse(stored.get('notificationSettings'))
    };
}

function createToastHarness() {
    const timers = [];
    const makeElement = (tagName) => {
        const element = {
            tagName: tagName.toUpperCase(),
            className: '',
            textContent: '',
            children: [],
            parentNode: null,
            classList: {
                add() {},
                remove() {}
            },
            appendChild(child) {
                child.parentNode = this;
                this.children.push(child);
                return child;
            },
            removeChild(child) {
                this.children = this.children.filter(item => item !== child);
                child.parentNode = null;
                return child;
            },
            set innerHTML(_value) {
                throw new Error('Unsafe innerHTML is unavailable in this DOM');
            }
        };
        return element;
    };
    const container = makeElement('div');
    const document = {
        getElementById(id) {
            return id === 'notificationContainer' ? container : null;
        },
        createElement: makeElement
    };
    const context = vm.createContext({
        document,
        setTimeout(callback) {
            timers.push(callback);
            return timers.length;
        }
    });
    const source = fs.readFileSync(chatPath, 'utf8');
    vm.runInContext(`${extractFunction(source, 'showNotification')}\nthis.showNotification = showNotification;`, context);
    return {
        container,
        showNotification: context.showNotification,
        runAllTimers() {
            while (timers.length) timers.shift()();
        }
    };
}

function createChannelInvitedHarness(availableChannels) {
    const source = fs.readFileSync(chatPath, 'utf8');
    const calls = { refreshes: 0, notifications: [], interruptions: 0 };
    const context = vm.createContext({
        currentChannel: '公共频道1',
        viewMode: 'channel',
        loadPersistedChannels: async () => {
            calls.refreshes += 1;
            return availableChannels;
        },
        showNotification: (message, type, duration) => {
            calls.notifications.push({ message, type, duration });
        },
        switchChannel: () => {
            calls.interruptions += 1;
        },
        setViewMode: () => {
            calls.interruptions += 1;
        }
    });
    vm.runInContext(`
        ${extractFunction(source, 'isPublicChannelName')}
        ${extractFunction(source, 'handleChannelInvited')}
        this.handleChannelInvited = handleChannelInvited;
    `, context);
    return { calls, context, handleChannelInvited: context.handleChannelInvited };
}

test('notification state defaults and every fallback use the exact public channel names', () => {
    const expectedChannels = ['公共频道1', '公共频道2'];
    const noSavedSettings = loadNotificationSettingsState(undefined);
    assert.deepEqual(noSavedSettings.initial.selectedChannels, expectedChannels);
    assert.deepEqual(noSavedSettings.loaded.selectedChannels, expectedChannels);
    assert.deepEqual(noSavedSettings.persisted.selectedChannels, expectedChannels);

    for (const savedValue of ['{broken json', JSON.stringify({ selectedChannels: 'not-an-array' })]) {
        const state = loadNotificationSettingsState(savedValue);
        assert.deepEqual(state.loaded.selectedChannels, expectedChannels);
        assert.deepEqual(state.persisted.selectedChannels, expectedChannels);
        assert.doesNotMatch(JSON.stringify(state.persisted), /General|Technology/);
    }
});

test('saved notification channel arrays migrate legacy names, preserve private channels, and remove duplicates', () => {
    const saved = JSON.stringify({
        soundEnabled: false,
        selectedChannels: ['General', '私密频道', '公共频道1', 'Technology'],
        mutedChannels: ['Technology', '公共频道2', 'General'],
        mutedDms: ['friend-id'],
        clearedChannels: ['General', '私密频道', 'Technology'],
        clearedDms: ['other-id']
    });

    const { loaded, persisted } = loadNotificationSettingsState(saved);
    const expected = {
        soundEnabled: false,
        selectedChannels: ['公共频道1', '私密频道', '公共频道2'],
        mutedChannels: ['公共频道2', '公共频道1'],
        mutedDms: ['friend-id'],
        clearedChannels: ['公共频道1', '私密频道', '公共频道2'],
        clearedDms: ['other-id']
    };
    assert.deepEqual(loaded, expected);
    assert.deepEqual(persisted, expected);
    assert.doesNotMatch(JSON.stringify(persisted), /General|Technology/);
});

test('toast renders endpoint and username strings as text without an HTML sink', () => {
    const harness = createToastHarness();
    const hostileMessage = '邀请 <img src=x onerror="globalThis.pwned=true"> 未成功';

    assert.doesNotThrow(() => harness.showNotification(hostileMessage, 'error'));
    assert.equal(harness.container.children.length, 1);
    const toast = harness.container.children[0];
    assert.equal(toast.children.length, 1);
    assert.equal(toast.children[0].tagName, 'P');
    assert.equal(toast.children[0].className, 'message');
    assert.equal(toast.children[0].textContent, hostileMessage);

    harness.runAllTimers();
    assert.equal(harness.container.children.length, 0, 'only transient toast children are removed');
});

test('the persistent global toast container is a polite atomic status region', () => {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const containerTag = indexHtml.match(/<div[^>]*id="notificationContainer"[^>]*>/)?.[0] || '';

    assert.match(containerTag, /role="status"/);
    assert.match(containerTag, /aria-live="polite"/);
    assert.match(containerTag, /aria-atomic="true"/);
});

test('production client registers the named channelInvited handler', () => {
    const chatJs = fs.readFileSync(chatPath, 'utf8');

    assert.match(chatJs, /socket\.on\('channelInvited',\s*handleChannelInvited\)/);
});

test('channelInvited ignores malformed, public, and unsafe channel payloads', async () => {
    const harness = createChannelInvitedHarness(['公共频道1', '公共频道2', '产品讨论']);
    const invalidEvents = [
        null,
        {},
        { channel: '公共频道1' },
        { channel: '  产品讨论  ' },
        { channel: 'bad<channel>' },
        { channel: 'x'.repeat(29) }
    ];

    for (const event of invalidEvents) await harness.handleChannelInvited(event);

    assert.equal(harness.calls.refreshes, 0);
    assert.deepEqual(harness.calls.notifications, []);
    assert.equal(harness.calls.interruptions, 0);
});

test('channelInvited refreshes once, confirms membership, and notifies without interrupting the current session', async () => {
    const confirmed = createChannelInvitedHarness(['公共频道1', '公共频道2', '产品讨论']);

    const handled = await confirmed.handleChannelInvited({
        channel: '产品讨论',
        invitedBy: { id: 999, username: '<img onerror="pwned()">' }
    });

    assert.equal(handled, true);
    assert.equal(confirmed.calls.refreshes, 1);
    assert.deepEqual(confirmed.calls.notifications, [
        { message: '你已受邀加入频道「产品讨论」', type: 'info', duration: 4500 }
    ]);
    assert.equal(confirmed.calls.interruptions, 0);
    assert.equal(confirmed.context.currentChannel, '公共频道1');
    assert.equal(confirmed.context.viewMode, 'channel');

    const unconfirmed = createChannelInvitedHarness(['公共频道1', '公共频道2']);
    assert.equal(await unconfirmed.handleChannelInvited({ channel: '产品讨论' }), false);
    assert.equal(unconfirmed.calls.refreshes, 1);
    assert.deepEqual(unconfirmed.calls.notifications, []);
    assert.equal(unconfirmed.calls.interruptions, 0);
});

test('invite selection merges checked friends with a trimmed exact username and removes duplicates', () => {
    const { mergeChannelInviteUsernames } = loadInviteHelpers();

    assert.deepEqual(
        plain(mergeChannelInviteUsernames(['alice', 'bob', 'alice'], '  alice  ')),
        ['alice', 'bob']
    );
    assert.deepEqual(
        plain(mergeChannelInviteUsernames(['alice'], '  Alice  ')),
        ['alice', 'Alice'],
        'exact usernames remain case-sensitive'
    );
    assert.deepEqual(plain(mergeChannelInviteUsernames([], '   ')), []);
});

test('invite submission builds the authenticated owner API request with an encoded channel name', () => {
    const { buildChannelInviteRequest } = loadInviteHelpers();
    const request = plain(buildChannelInviteRequest('产品/密室', ['alice', 'bob']));

    assert.deepEqual(request, {
        url: '/api/channel/%E4%BA%A7%E5%93%81%2F%E5%AF%86%E5%AE%A4/members',
        options: {
            method: 'POST',
            headers: {
                Authorization: 'Bearer verified-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ usernames: ['alice', 'bob'] })
        }
    });
});

test('owner probing never offers invitations for public channels and accepts only a successful member read', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return { ok: url.includes('owner-room') };
    };
    const { canManageChannelMembers } = loadInviteHelpers();

    assert.equal(await canManageChannelMembers('公共频道1', fetchImpl), false);
    assert.equal(await canManageChannelMembers('公共频道2', fetchImpl), false);
    assert.equal(calls.length, 0, 'public channels must not probe private member APIs');
    assert.equal(await canManageChannelMembers('owner-room', fetchImpl), true);
    assert.equal(await canManageChannelMembers('member-room', fetchImpl), false);
    assert.deepEqual(plain(calls), [
        {
            url: '/api/channel/owner-room/members',
            options: { headers: { Authorization: 'Bearer verified-token' } }
        },
        {
            url: '/api/channel/member-room/members',
            options: { headers: { Authorization: 'Bearer verified-token' } }
        }
    ]);
});

test('channel header exposes an accessible hidden-by-default SVG invite control', () => {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    assert.match(indexHtml, /<button[^>]*id="channelInviteBtn"[^>]*aria-label="邀请成员"[^>]*style="display:\s*none;"[^>]*>/);
    assert.match(indexHtml, /id="channelInviteBtn"[\s\S]*?<span data-jc-icon="people"><\/span>[\s\S]*?<\/button>/);
    assert.doesNotMatch(indexHtml.match(/<button[^>]*id="channelInviteBtn"[\s\S]*?<\/button>/)?.[0] || '', /[×✕✖]|[\u{1F300}-\u{1FAFF}]/u);
});

test('authenticated channel loading replaces empty markup without legacy General or Technology entries', () => {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const chatJs = fs.readFileSync(chatPath, 'utf8');
    const loaderStart = chatJs.indexOf('async function loadPersistedChannels');
    const loaderEnd = chatJs.indexOf('function openAddChannelCard', loaderStart);
    const loaderPath = chatJs.slice(loaderStart, loaderEnd);

    assert.doesNotMatch(indexHtml, /data-channel="(?:General|Technology)"/);
    assert.doesNotMatch(indexHtml, /<div class="channel-item"/);
    assert.match(loaderPath, /fetch\('\/api\/channels',\s*\{\s*headers:\s*getAuthHeaders\(\)\s*\}\)/);
    assert.match(loaderPath, /channelListPanel[\s\S]*?channelListPanelMobile[\s\S]*?channelListPanelMain[\s\S]*?replaceChildren\(\)/);
    assert.match(loaderPath, /data\.channels[\s\S]*?forEach\(appendChannel\)/);
});

test('invite card uses cached friends, live feedback, and the shared accessible floating-card lifecycle', () => {
    const chatJs = fs.readFileSync(chatPath, 'utf8');
    const openStart = chatJs.indexOf('function openChannelInviteCard');
    const openEnd = chatJs.indexOf('function initSelectionLenses', openStart);
    assert.notEqual(openStart, -1, 'Expected invite-card behavior');
    const invitePath = chatJs.slice(openStart, openEnd);

    assert.match(invitePath, /getSortedFriendsForList\(\)/);
    assert.match(invitePath, /mergeChannelInviteUsernames\(/);
    assert.match(invitePath, /buildChannelInviteRequest\(/);
    assert.match(invitePath, /aria-live/);
    assert.match(invitePath, /response\.status\s*===\s*403/);
    assert.match(invitePath, /notFound/);
    assert.match(invitePath, /controller\.close\(\)/);
    assert.match(invitePath, /JchatUI\.createFloatingCard\(\{[\s\S]*?title:\s*'邀请成员'[\s\S]*?autofocusSelector:/);
});

test('invite styling stays in the warm Jchat token system with touch targets and reduced-motion safety', () => {
    const styleCss = fs.readFileSync(stylePath, 'utf8');

    assert.match(styleCss, /\.jc-channel-invite-card\s*\{[^}]*width:\s*min\(420px,/s);
    assert.match(styleCss, /\.jc-invite-friend-option\s*\{[^}]*min-height:\s*44px;/s);
    assert.match(styleCss, /\.jc-invite-username-input[^}]*var\(--jc-glass-border\)/s);
    assert.match(styleCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.jc-invite-friend-option[\s\S]*?transform:\s*none !important;/);
});

test('socket authentication continues to send the page-isolated JWT rather than a user id', () => {
    const chatJs = fs.readFileSync(chatPath, 'utf8');

    assert.match(chatJs, /socket\.emit\('authenticate',\s*JchatAuth\.getAuthToken\(\)\)/);
    assert.doesNotMatch(chatJs, /socket\.emit\('authenticate',\s*(?:parseInt\()?currentUser\.id/);
});
