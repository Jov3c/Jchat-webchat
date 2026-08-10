const currentUser = checkLogin();
if (!currentUser) {
    window.location.href = 'login.html';
}

const JchatAuth = window.JchatAuthStorage;
const JchatUI = window.JchatUI;

function jchatIcon(name) {
    return JchatUI && typeof JchatUI.icon === 'function' ? JchatUI.icon(name) : '';
}

function prepareJchatMessageEntry(messageElement) {
    const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    messageElement.style.opacity = reduceMotion ? '1' : '0';
    messageElement.style.transform = reduceMotion ? 'none' : 'translateY(10px)';
    if (reduceMotion) messageElement.style.transition = 'none';
    return !reduceMotion;
}

function revealJchatMessageEntry(messageElement, shouldAnimate) {
    if (!shouldAnimate) return;
    window.setTimeout(() => {
        messageElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        messageElement.style.opacity = '1';
        messageElement.style.transform = 'translateY(0)';
    }, 10);
}

function resolveSocketUrl() {
    const configuredApiOrigin = typeof window.API_ORIGIN === 'string' ? window.API_ORIGIN.trim() : '';
    if (configuredApiOrigin) return configuredApiOrigin;
    const configuredPort = window.JCHAT_API_PORT;
    if (configuredPort !== undefined && configuredPort !== null && String(configuredPort).trim()) {
        return `${window.location.protocol}//${window.location.hostname}:${String(configuredPort).trim()}`;
    }
    if (window.location.port === '3001') {
        return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
    return window.location.origin;
}

const socketUrl = resolveSocketUrl();

const socket = io(socketUrl, {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

console.log('Socket.io连接配置:', {
    url: socketUrl
});

socket.on('connect', () => {
    console.log('Socket.io连接成功');
    try {
        socket.emit('authenticate', JchatAuth.getAuthToken());
        refreshFriendsAndRequests();
    } catch (e) {
        console.warn('socket authenticate failed', e);
    }
});

socket.on('disconnect', () => {
    console.log('Socket.io连接断开');
    showNotification('网络连接已断开，正在尝试重新连接...', 'warning');
});

socket.on('connect_error', (error) => {
    console.error('Socket.io连接错误:', error);
    showNotification('连接服务器时出错', 'error');
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`Socket.io重新连接成功，尝试次数: ${attemptNumber}`);
    showNotification('网络连接已恢复', 'success');
    socket.emit('authenticate', JchatAuth.getAuthToken());
    refreshFriendsAndRequests();
});

socket.on('reconnect_failed', () => {
    console.error('Socket.io重新连接失败');
    showNotification('无法重新连接到服务器，请刷新页面', 'error');
});

socket.on('userBanned', () => {
    setMessageInputBanned(true);
    showNotification('账号已被封禁，无法发送消息', 'error');
});

socket.on('userUnbanned', () => {
    setMessageInputBanned(false);
    showNotification('账号已解封，可以继续发送消息', 'success');
});

socket.on('userDeleted', () => {
    showNotification('您的账号已被管理员删除', 'error');
    clearLoginAndRedirect();
});

socket.on('sessionReplaced', () => {
    showNotification('账号已在其他页面登录', 'warning');
    window.setTimeout(clearLoginAndRedirect, 900);
});

socket.on('authenticationFailed', (data) => {
    if (data && data.reason === 'session_replaced') {
        showNotification('账号已在其他页面登录', 'warning');
        window.setTimeout(clearLoginAndRedirect, 900);
    }
});

socket.on('channelPresenceUpdated', (data) => {
    if (!data || viewMode !== 'channel' || data.channel !== currentChannel) return;
    if (anatomyDetailOnlineCount) anatomyDetailOnlineCount.textContent = `在线 ${data.onlineCount || 0} 人`;
});

socket.on('presenceUpdated', (data) => {
    if (!data || !viewedProfileUser || Number(data.userId) !== Number(viewedProfileUser.id)) return;
    viewedProfileUser.effective_status = data.status;
    renderProfilePresence(data.status);
});

socket.on('deactivationRequestUpdated', function () {
    if (typeof loadDeactivationRequestStatus === 'function') loadDeactivationRequestStatus();
});

socket.on('channelInvited', handleChannelInvited);

socket.on('messageError', (data) => {
    if (data && data.error && data.error.includes('封禁')) setMessageInputBanned(true);
    if (data && data.error) showNotification(data.error, 'error');
});

socket.on('privateMessageError', (data) => {
    if (data && data.error && data.error.includes('封禁')) setMessageInputBanned(true);
    if (data && data.code === 'not_friends') {
        if (viewMode === 'dm' && currentDmPeer && currentDmPeer.id) {
            addStaleContact(currentDmPeer);
            renderFriendsList();
        }
        showNotification('对方不是你的好友，请先添加对方为好友', 'error');
    } else if (data && data.code === 'blocked') {
        showNotification('消息被对方拒收了', 'error');
    } else if (data && data.error) {
        showNotification(data.error, 'error');
    }
});

let currentChannel = '';

let viewMode = 'channel';
let currentDmPeer = null;
let friendsCache = [];
let incomingRequestsCache = [];

const PINNED_STORAGE_KEY = 'jchat_pinned_friends';
const DM_ORDER_STORAGE_KEY = 'jchat_dm_order';
const STALE_CONTACTS_KEY = 'jchat_stale_contacts';
const DEFAULT_AVATAR = 'images/default.png';
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function escapeAttribute(value) { return escapeHtml(value); }
function safeMediaUrl(value) {
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    if (!candidate || candidate.includes('..') || /[\u0000-\u001f\u007f]/.test(candidate)) return '';
    if (/^(?:uploads|images)\/[a-zA-Z0-9_./-]+$/.test(candidate)) return candidate;
    try {
        const url = new URL(candidate);
        return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (_) {
        return '';
    }
}
function getAvatarUrl(avatar) { return safeMediaUrl(avatar) || DEFAULT_AVATAR; }
function safeMessageId(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return '';
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? String(parsed) : '';
}

function getPinnedFriendIds() {
    try {
        const raw = localStorage.getItem(PINNED_STORAGE_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw);
        const uid = String(currentUser && currentUser.id);
        return Array.isArray(all[uid]) ? all[uid] : [];
    } catch (e) { return []; }
}

function setPinnedFriendIds(ids) {
    try {
        const uid = String(currentUser && currentUser.id);
        const all = {};
        try {
            const raw = localStorage.getItem(PINNED_STORAGE_KEY);
            if (raw) Object.assign(all, JSON.parse(raw));
        } catch (_) {}
        all[uid] = ids;
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
}

function togglePinFriend(friendId) {
    const id = String(friendId);
    const pinned = getPinnedFriendIds();
    const idx = pinned.indexOf(id);
    if (idx >= 0) {
        pinned.splice(idx, 1);
        setPinnedFriendIds(pinned);
        return false;
    }
    pinned.push(id);
    setPinnedFriendIds(pinned);
    return true;
}

function isPinnedFriend(friendId) {
    return getPinnedFriendIds().indexOf(String(friendId)) >= 0;
}

function getDmOrder() {
    try {
        const raw = localStorage.getItem(DM_ORDER_STORAGE_KEY);
        if (!raw) return {};
        const all = JSON.parse(raw);
        const uid = String(currentUser && currentUser.id);
        return all[uid] && typeof all[uid] === 'object' ? all[uid] : {};
    } catch (e) { return {}; }
}

function updateDmOrder(friendId) {
    try {
        const uid = String(currentUser && currentUser.id);
        const all = {};
        try {
            const raw = localStorage.getItem(DM_ORDER_STORAGE_KEY);
            if (raw) Object.assign(all, JSON.parse(raw));
        } catch (_) {}
        if (!all[uid]) all[uid] = {};
        all[uid][String(friendId)] = Date.now();
        localStorage.setItem(DM_ORDER_STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
}

function getSortedFriendsForList() {
    const pinned = getPinnedFriendIds();
    const order = getDmOrder();
    return friendsCache.slice().sort((a, b) => {
        const aId = String(a.id), bId = String(b.id);
        const aPinned = pinned.indexOf(aId) >= 0, bPinned = pinned.indexOf(bId) >= 0;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        const aTs = order[aId] || 0, bTs = order[bId] || 0;
        return bTs - aTs;
    });
}

function removeFriendFromLocalState(friendId) {
    const id = String(friendId);
    const pinned = getPinnedFriendIds().filter(x => x !== id);
    setPinnedFriendIds(pinned);
    try {
        const raw = localStorage.getItem(DM_ORDER_STORAGE_KEY);
        if (!raw) return;
        const all = JSON.parse(raw);
        const uid = String(currentUser && currentUser.id);
        if (all[uid] && all[uid][id] !== undefined) {
            delete all[uid][id];
            localStorage.setItem(DM_ORDER_STORAGE_KEY, JSON.stringify(all));
        }
    } catch (e) {}
}

function getStaleContacts() {
    try {
        const raw = localStorage.getItem(STALE_CONTACTS_KEY);
        if (!raw) return [];
        const all = JSON.parse(raw);
        const uid = String(currentUser && currentUser.id);
        return Array.isArray(all[uid]) ? all[uid] : [];
    } catch (e) { return []; }
}

function addStaleContact(contact) {
    if (!contact || contact.id == null) return;
    const uid = String(currentUser && currentUser.id);
    const list = getStaleContacts();
    const id = String(contact.id);
    if (list.some(function (c) { return String(c.id) === id; })) return;
    list.push({
        id: contact.id,
        username: contact.username || '',
        nickname: contact.nickname || contact.username || '',
        avatar: getAvatarUrl(contact.avatar)
    });
    try {
        const all = {};
        try {
            const raw = localStorage.getItem(STALE_CONTACTS_KEY);
            if (raw) Object.assign(all, JSON.parse(raw));
        } catch (_) {}
        all[uid] = list;
        localStorage.setItem(STALE_CONTACTS_KEY, JSON.stringify(all));
    } catch (e) {}
}

function removeStaleContact(friendId) {
    const id = String(friendId);
    const list = getStaleContacts().filter(function (c) { return String(c.id) !== id; });
    try {
        const uid = String(currentUser && currentUser.id);
        const all = {};
        try {
            const raw = localStorage.getItem(STALE_CONTACTS_KEY);
            if (raw) Object.assign(all, JSON.parse(raw));
        } catch (_) {}
        all[uid] = list;
        localStorage.setItem(STALE_CONTACTS_KEY, JSON.stringify(all));
    } catch (e) {}
}

let dmUnreadCountByFriendId = {};

let currentReplyTo = null;

let hasMicrophone = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let isRecordingTimeout = false;
const MAX_RECORDING_DURATION = 60;

async function checkMicrophone() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        hasMicrophone = true;
        stream.getTracks().forEach(track => track.stop());
        console.log('麦克风检测成功');
    } catch (error) {
        hasMicrophone = false;
        console.log('麦克风检测失败:', error);
    }
    return hasMicrophone;
}

async function startRecording() {
    try {
        console.log('浏览器API支持情况:');
        console.log('navigator.mediaDevices:', navigator.mediaDevices);
        console.log('navigator.mediaDevices.getUserMedia:', navigator.mediaDevices ? navigator.mediaDevices.getUserMedia : '未定义');
        console.log('window.MediaRecorder:', window.MediaRecorder);

        if (!navigator.mediaDevices) {
            console.error('不支持 navigator.mediaDevices API');
            showNotification('您的浏览器不支持语音录制功能，请升级到最新版本', 'error');
            return;
        }

        if (!navigator.mediaDevices.getUserMedia) {
            console.error('不支持 navigator.mediaDevices.getUserMedia API');
            showNotification('您的浏览器不支持语音录制功能，请升级到最新版本', 'error');
            return;
        }

        if (!window.MediaRecorder) {
            console.error('不支持 window.MediaRecorder API');
            showNotification('您的浏览器不支持语音录制功能，请升级到最新版本', 'error');
            return;
        }

        if (typeof MediaRecorder.isTypeSupported !== 'function') {
            console.warn('浏览器不支持MediaRecorder.isTypeSupported方法，将使用默认MIME类型');
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        let mimeType = 'audio/webm;codecs=opus';
        const supportedMimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg'
        ];

        if (typeof MediaRecorder.isTypeSupported === 'function') {
            for (const type of supportedMimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    console.log('使用支持的MIME类型:', mimeType);
                    break;
                }
            }
        } else {
            console.log('使用默认MIME类型:', mimeType);
        }

        try {
            mediaRecorder = new MediaRecorder(stream, { mimeType });
        } catch (error) {
            console.warn('使用指定MIME类型失败，使用默认设置:', error);
            mediaRecorder = new MediaRecorder(stream);
        }

        mediaRecorder._stream = stream;

        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log('MediaRecorder stop event triggered');
            if (mediaRecorder._stream) {
                mediaRecorder._stream.getTracks().forEach(track => track.stop());
                console.log('释放麦克风资源');
            }
            const voiceBtn = document.getElementById('voiceBtn');
            voiceBtn.classList.remove('recording');
            voiceBtn.innerHTML = jchatIcon('mic');
            voiceBtn.setAttribute('aria-label', '发送语音');
            if (isRecordingTimeout) {
                showNotification('录制已达最大时长60秒，已自动停止', 'info');
                isRecordingTimeout = false;
            }
            if (audioChunks.length > 0) {
                processRecordedAudio();
            }
        };

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder错误:', event.error);
            showNotification('录制过程中发生错误', 'error');
            stopRecording();
        };

        mediaRecorder.start();
        console.log('开始录制语音');

        recordingTimer = setTimeout(() => {
            console.log('录制时长已达60秒，自动停止');
            isRecordingTimeout = true;
            stopRecording();
        }, MAX_RECORDING_DURATION * 1000);

        const voiceBtn = document.getElementById('voiceBtn');
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = jchatIcon('record');
        voiceBtn.setAttribute('aria-label', '正在录音，松开发送');

    } catch (error) {
        console.error('录制语音失败:', error);
        if (error.name === 'NotAllowedError') {
            showNotification('请允许访问麦克风', 'error');
        } else if (error.name === 'NotFoundError') {
            showNotification('未找到麦克风设备', 'error');
        } else if (error.name === 'NotReadableError') {
            showNotification('麦克风被占用', 'error');
        } else {
            showNotification('无法开始录制语音', 'error');
        }
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('停止录制语音');
    }
    if (recordingTimer) {
        clearTimeout(recordingTimer);
        recordingTimer = null;
    }
}

async function isAudioSilent(audioBlob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContext.decodeAudioData(e.target.result, (buffer) => {
                const channelData = buffer.getChannelData(0);

                let sum = 0;
                for (let i = 0; i < channelData.length; i++) {
                    sum += Math.abs(channelData[i]);
                }
                const average = sum / channelData.length;

                const silenceThreshold = 0.01;
                resolve(average < silenceThreshold);
            }, () => {
                resolve(false);
            });
        };
        reader.readAsArrayBuffer(audioBlob);
    });
}

async function processRecordedAudio() {
    try {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

        const isSilent = await isAudioSilent(audioBlob);
        if (isSilent) {
            showNotification('未检测到声音，请重新录制', 'warning');
            return;
        }

        await sendVoiceMessage(audioBlob);

    } catch (error) {
        console.error('处理音频失败:', error);
        showNotification('处理语音消息失败', 'error');
    }
}

async function sendVoiceMessage(audioBlob) {
    try {
        uploadProgress.textContent = '上传中...';

        let fileExtension = 'webm';
        if (audioBlob.type.includes('ogg')) {
            fileExtension = 'ogg';
        }

        const formData = new FormData();
        formData.append('voice', audioBlob, `voice.${fileExtension}`);

        const response = await fetch('/api/upload/voice', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            if (viewMode === 'dm') {
                if (!currentDmPeer?.id) { showNotification('请先从左侧选择好友', 'info'); uploadProgress.textContent = ''; return; }
                updateDmOrder(currentDmPeer.id);
                socket.emit('sendPrivateMessage', { fromUserId: currentUser.id, toUserId: currentDmPeer.id, content: null, image: null, voice: data.voice, reply_to: currentReplyTo || undefined });
                renderFriendsList();
            } else {
                socket.emit('sendMessage', { userId: currentUser.id, channel: currentChannel, content: null, voice: data.voice, reply_to: currentReplyTo });
            }
            uploadProgress.textContent = '上传成功';
            setTimeout(() => {
                uploadProgress.textContent = '';
            }, 1000);

            cancelReply();
        } else {
            uploadProgress.textContent = '上传失败';
            setTimeout(() => {
                uploadProgress.textContent = '';
            }, 1000);
        }
    } catch (error) {
        console.error('发送语音消息失败:', error);
        showNotification('发送语音消息失败', 'error');
        uploadProgress.textContent = '上传失败';
        setTimeout(() => {
            uploadProgress.textContent = '';
        }, 1000);
    }
}

function migrateNotificationChannelNames(channels, fallback = []) {
    const source = Array.isArray(channels) ? channels : fallback;
    const migrated = source.map(channel => {
        if (channel === 'General') return '公共频道1';
        if (channel === 'Technology') return '公共频道2';
        return channel;
    });
    return Array.from(new Set(migrated));
}

let notificationSettings = {
    soundEnabled: true,
    selectedChannels: ['公共频道1', '公共频道2'],
    mutedChannels: [],
    mutedDms: [],
    clearedChannels: [],
    clearedDms: []
};

function loadNotificationSettings() {
    console.log('=== loadNotificationSettings 函数被调用 ===');
    console.log('当前时间:', new Date().toISOString());

    const savedSettings = localStorage.getItem('notificationSettings');
    console.log('从本地存储获取的设置:', savedSettings);

    if (savedSettings) {
        try {
            notificationSettings = JSON.parse(savedSettings);
            console.log('成功从本地存储加载设置:', JSON.stringify(notificationSettings));

            if (notificationSettings.soundEnabled === undefined) {
                console.log('soundEnabled 未定义，设置默认值为 true');
                notificationSettings.soundEnabled = true;
            }

            if (!Array.isArray(notificationSettings.selectedChannels)) {
                console.log('selectedChannels 不是数组，设置默认值');
                notificationSettings.selectedChannels = ['公共频道1', '公共频道2'];
            }
            notificationSettings.selectedChannels = migrateNotificationChannelNames(notificationSettings.selectedChannels);
            notificationSettings.mutedChannels = migrateNotificationChannelNames(notificationSettings.mutedChannels);
            if (!Array.isArray(notificationSettings.mutedDms)) notificationSettings.mutedDms = [];
            notificationSettings.clearedChannels = migrateNotificationChannelNames(notificationSettings.clearedChannels);
            if (!Array.isArray(notificationSettings.clearedDms)) notificationSettings.clearedDms = [];

            saveNotificationSettings();
        } catch (error) {
            console.error('加载通知设置失败:', error);
            console.log('使用默认设置');
            notificationSettings = {
                soundEnabled: true,
                selectedChannels: ['公共频道1', '公共频道2'],
                mutedChannels: [], mutedDms: [], clearedChannels: [], clearedDms: []
            };
            saveNotificationSettings();
        }
    } else {
        console.log('本地存储中没有设置，使用默认值并保存');
        notificationSettings = {
            soundEnabled: true,
            selectedChannels: ['公共频道1', '公共频道2'],
            mutedChannels: [], mutedDms: [], clearedChannels: [], clearedDms: []
        };
        saveNotificationSettings();
    }

    updateNotificationSettingsUI();

    console.log('当前 notificationSettings:', JSON.stringify(notificationSettings));
}

function playNotificationBeep() {
    try {
        const C = typeof AudioContext !== 'undefined' ? AudioContext : (window.webkitAudioContext || window.AudioContext);
        if (!C) return;
        const ctx = new C();
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => playNotificationBeepInner(ctx)).catch(function () {});
            return;
        }
        playNotificationBeepInner(ctx);
    } catch (e) {
        console.warn('提示音播放失败:', e);
    }
}

function playNotificationBeepInner(ctx) {
    try {
        var t0 = ctx.currentTime;
        var gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.9, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.12);
        gain.gain.setValueAtTime(0, t0 + 0.15);
        gain.gain.linearRampToValueAtTime(0.9, t0 + 0.17);
        gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.27);
        var osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, t0);
        osc1.frequency.setValueAtTime(880, t0 + 0.12);
        osc1.connect(gain);
        osc1.start(t0);
        osc1.stop(t0 + 0.12);
        var osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1109, t0 + 0.15);
        osc2.connect(gain);
        osc2.start(t0 + 0.15);
        osc2.stop(t0 + 0.27);
    } catch (e) {
        console.warn('提示音播放失败:', e);
    }
}

function playNotificationSound() {
    if (!notificationSettings.soundEnabled) return;
    try {
        playNotificationBeep();
    } catch (error) {
        console.warn('播放提示音时发生错误:', error);
    }
}

function preloadAudioAndRequestPermission() {
}

function showBrowserNotification(title, message) {
    if (!('Notification' in window)) {
        console.log('浏览器不支持通知功能');
        return;
    }

    if (Notification.permission === 'granted') {
        new Notification(title, {
            body: message,
            icon: 'images/logo.png',
            requireInteraction: false,
            tag: 'chat-notification'
        });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, {
                    body: message,
                    icon: 'images/icon.png',
                    requireInteraction: false,
                    tag: 'chat-notification'
                });
            }
        });
    }
}

function saveNotificationSettings() {
    localStorage.setItem('notificationSettings', JSON.stringify(notificationSettings));
}

function updateNotificationSettingsUI() {
    const channelCheckboxes = document.querySelectorAll('.channel-notification-item input[type="checkbox"]');
    channelCheckboxes.forEach(checkbox => {
        checkbox.checked = notificationSettings.selectedChannels.includes(checkbox.value);
    });
}

const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const MESSAGE_INPUT_PLACEHOLDER = '输入消息...';

function setMessageInputBanned(banned) {
    if (!messageInput || !sendBtn) return;
    messageInput.disabled = banned;
    messageInput.placeholder = banned ? '账号已被封禁，无法发送消息' : MESSAGE_INPUT_PLACEHOLDER;
    sendBtn.style.display = banned ? 'none' : '';
    if (banned) messageInput.value = '';
}

const imageUpload = document.getElementById('imageUpload');
const uploadProgress = document.getElementById('uploadProgress');
const channelItems = document.querySelectorAll('.channel-item');
const chatContainerEl = document.querySelector('.chat-container');
const mobileListPanel = document.getElementById('mobileListPanel');
const channelListPanelMain = document.getElementById('channelListPanelMain');
const friendsListPanelMain = document.getElementById('friendsListPanelMain');
const friendsListMain = document.getElementById('friendsListMain');
const friendsEmptyStateMain = document.getElementById('friendsEmptyStateMain');
const modeChannelBtnMain = document.getElementById('modeChannelBtnMain');
const modeDmBtnMain = document.getElementById('modeDmBtnMain');
const dmUnreadBadgeMain = document.getElementById('dmUnreadBadgeMain');
const currentChannelName = document.getElementById('currentChannelName');
const currentChannelIcon = document.getElementById('currentChannelIcon');
const currentChannelAvatar = document.getElementById('currentChannelAvatar');
const settingsBtn = document.getElementById('settingsBtn');
const settingsBtnMobile = document.getElementById('settingsBtnMobile');
const addChannelBtn = document.getElementById('addChannelBtn');
const closeSettings = document.getElementById('closeSettings');
const settingsPanel = document.getElementById('settingsPanel');
const userAvatar = document.getElementById('userAvatar');
const userAvatarMobile = document.getElementById('userAvatarMobile')
const username = document.getElementById('username');
const usernameMobile = document.getElementById('usernameMobile')
const userBio = document.getElementById('userBio');
const userBioMobile = document.getElementById('userBioMobile');
const logoutBtn = document.getElementById('logoutBtn');
const avatarInput = document.getElementById('avatarInput');
const avatarPreview = document.getElementById('avatarPreview');
const settingsUsername = document.getElementById('settingsUsername');
const settingsNickname = document.getElementById('settingsNickname');
const settingsBio = document.getElementById('settingsBio');
const settingsGender = document.getElementById('settingsGender');
const settingsEmail = document.getElementById('settingsEmail');
const settingsPresenceStatus = document.getElementById('settingsPresenceStatus');
const saveSettings = document.getElementById('saveSettings');
const emojiBtn = document.getElementById('emojiBtn');
const stickerPicker = document.getElementById('stickerPicker');
const stickerGrid = document.getElementById('stickerGrid');
const stickerUpload = document.getElementById('stickerUpload');
const stickerPageLabel = document.getElementById('stickerPageLabel');
const stickerPrevPage = document.getElementById('stickerPrevPage');
const stickerNextPage = document.getElementById('stickerNextPage');
const nav = document.getElementById('mobileNav');
const mobileBackBtn = document.getElementById('mobileBackBtn');
const mobileMeBtn = document.getElementById('mobileMeBtn');
const mobileProfilePage = document.getElementById('mobileProfilePage');
const mobileProfilePageClose = document.getElementById('mobileProfilePageClose');
const mobileProfileSettingsBtn = document.getElementById('mobileProfileSettingsBtn');
const mobileProfileAddFriendBtn = document.getElementById('mobileProfileAddFriendBtn');
const mobileProfileLogoutBtn = document.getElementById('mobileProfileLogoutBtn');
const mobileProfileAvatar = document.getElementById('mobileProfileAvatar');
const mobileProfileName = document.getElementById('mobileProfileName');
const mobileProfileBio = document.getElementById('mobileProfileBio');
const mobileProfileFriendBadge = document.getElementById('mobileProfileFriendBadge');
const mobileMeBtnAvatar = document.getElementById('mobileMeBtnAvatar');

const changePasswordBtn = document.getElementById('changePasswordBtn');
const blacklistListBtn = document.getElementById('blacklistListBtn');
const blacklistPanel = document.getElementById('blacklistPanel');
const deactivationRequestBtn = document.getElementById('deactivationRequestBtn');
const deactivationRequestStatus = document.getElementById('deactivationRequestStatus');
const deactivationRequestModal = document.getElementById('deactivationRequestModal');
const deactivationReason = document.getElementById('deactivationReason');
const deactivationReasonCount = document.getElementById('deactivationReasonCount');
const closeDeactivationRequestModal = document.getElementById('closeDeactivationRequestModal');
const cancelDeactivationRequest = document.getElementById('cancelDeactivationRequest');
const submitDeactivationRequest = document.getElementById('submitDeactivationRequest');
const closeBlacklistPanelBtn = document.getElementById('closeBlacklistPanel');
const blacklistListEmpty = document.getElementById('blacklistListEmpty');
const blacklistList = document.getElementById('blacklistList');
const passwordChangePanel = document.getElementById('passwordChangePanel');
const closePasswordPanel = document.getElementById('closePasswordPanel');
const cancelPasswordChange = document.getElementById('cancelPasswordChange');
const passwordChangeForm = document.getElementById('passwordChangeForm');
const currentPassword = document.getElementById('currentPassword');
const newPassword = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');

const modeChannelBtn = document.getElementById('modeChannelBtn');
const modeDmBtn = document.getElementById('modeDmBtn');
const modeChannelBtnMobile = document.getElementById('modeChannelBtnMobile');
const modeDmBtnMobile = document.getElementById('modeDmBtnMobile');
const leftListTitle = document.getElementById('leftListTitle');
const channelListPanel = document.getElementById('channelListPanel');
const friendsListPanel = document.getElementById('friendsListPanel');
const friendsList = document.getElementById('friendsList');
const friendsEmptyState = document.getElementById('friendsEmptyState');
const channelListPanelMobile = document.getElementById('channelListPanelMobile');
const friendsListPanelMobile = document.getElementById('friendsListPanelMobile');
const friendsListMobile = document.getElementById('friendsListMobile');
const friendsEmptyStateMobile = document.getElementById('friendsEmptyStateMobile');
const addFriendBtn = document.getElementById('addFriendBtn');
const addFriendBtnMobile = document.getElementById('addFriendBtnMobile');
const friendRequestBadge = document.getElementById('friendRequestBadge');
const friendRequestBadgeMobile = document.getElementById('friendRequestBadgeMobile');
const friendModal = document.getElementById('friendModal');
const closeFriendModal = document.getElementById('closeFriendModal');
const friendIdentifierInput = document.getElementById('friendIdentifierInput');
const sendFriendRequestBtn = document.getElementById('sendFriendRequestBtn');
const friendRequestsList = document.getElementById('friendRequestsList');
const friendModalFriendsList = document.getElementById('friendModalFriendsList');
const friendModalFriendsEmpty = document.getElementById('friendModalFriendsEmpty');
const friendAddNextBtn = document.getElementById('friendAddNextBtn');
const friendAddBackBtn = document.getElementById('friendAddBackBtn');
const friendReasonInput = document.getElementById('friendReasonInput');
const friendReasonCountEl = document.getElementById('friendReasonCount');
const friendAddStep1 = document.getElementById('friendAddStep1');
const friendAddStep2 = document.getElementById('friendAddStep2');
const friendAddStep2NameEl = document.getElementById('friendAddStep2Name');
const friendRequestsEmpty = document.getElementById('friendRequestsEmpty');
const channelMenuBtn = document.getElementById('channelMenuBtn');
const channelSearchBtn = document.getElementById('channelSearchBtn');
const channelInviteBtn = document.getElementById('channelInviteBtn');
const anatomyTopSearchBtn = document.getElementById('anatomyTopSearchBtn');
const anatomyTopSearchInput = document.getElementById('anatomyTopSearchInput');
const anatomyTopSearchResults = document.getElementById('anatomyTopSearchResults');
const anatomyDetailsInviteBtn = document.getElementById('anatomyDetailsInviteBtn');
const anatomyDetailsMenuBtn = document.getElementById('anatomyDetailsMenuBtn');
const anatomyDetailChannelName = document.getElementById('anatomyDetailChannelName');
const anatomyWorkspace = document.getElementById('anatomyWorkspace');
const anatomyChannelDetails = document.getElementById('anatomyChannelDetails');
const anatomyDetailOnlineCount = document.getElementById('anatomyDetailOnlineCount');
const anatomyBentoChannelName = document.getElementById('anatomyBentoChannelName');
const anatomyDetailAvatar = document.getElementById('anatomyDetailAvatar');
const anatomyDetailMemberName = document.getElementById('anatomyDetailMemberName');
const profilePresenceStatus = document.getElementById('profilePresenceStatus');
const channelMenuPanel = document.getElementById('channelMenuPanel');
const closeChannelMenu = document.getElementById('closeChannelMenu');
const channelMenuTitle = document.getElementById('channelMenuTitle');
const channelMuteSwitch = document.getElementById('channelMuteSwitch');
const channelClearHistoryBtn = document.getElementById('channelClearHistoryBtn');
const channelMenuBlockRow = document.getElementById('channelMenuBlockRow');
const channelBlockBtn = document.getElementById('channelBlockBtn');
const channelMenuDeleteFriendRow = document.getElementById('channelMenuDeleteFriendRow');
const channelDeleteFriendBtn = document.getElementById('channelDeleteFriendBtn');

console.log('密码更改相关DOM元素获取结果:');
console.log('changePasswordBtn:', changePasswordBtn);
console.log('passwordChangePanel:', passwordChangePanel);
console.log('closePasswordPanel:', closePasswordPanel);
console.log('cancelPasswordChange:', cancelPasswordChange);
console.log('passwordChangeForm:', passwordChangeForm);

console.log('DOM元素获取结果:');
console.log('settingsPanel:', settingsPanel);
console.log('closeSettings:', closeSettings);
console.log('settingsBtn:', settingsBtn);

const jchatPanelControllers = new Map();

function hydrateJchatIcons(scope = document) {
    if (!JchatUI) return;
    scope.querySelectorAll('[data-jc-icon]').forEach((slot) => {
        slot.innerHTML = jchatIcon(slot.dataset.jcIcon);
    });
}

function openPanelAsFloatingCard(panel, trigger, title, className) {
    if (!panel || !trigger || !JchatUI) return null;
    const active = jchatPanelControllers.get(panel);
    if (active) {
        active.card.focus();
        return active;
    }

    const placeholder = document.createComment(`jchat-panel:${panel.id || title}`);
    panel.parentNode.insertBefore(placeholder, panel);
    panel.classList.remove('open', 'show');
    panel.classList.add('jc-floating-panel-source');

    let controller;
    controller = JchatUI.createFloatingCard({
        trigger,
        title,
        content: panel,
        className: `jc-panel-card ${className || ''}`.trim(),
        onClose() {
            panel.classList.remove('jc-floating-panel-source');
            if (placeholder.parentNode) placeholder.replaceWith(panel);
            jchatPanelControllers.delete(panel);
        }
    });
    jchatPanelControllers.set(panel, controller);
    return controller;
}

function closeFloatingPanel(panel) {
    const controller = panel && jchatPanelControllers.get(panel);
    if (controller) controller.close();
    else if (panel) panel.classList.remove('open', 'show');
}

function openSettingsCard(trigger = settingsBtn) {
    if (!settingsPanel || !trigger) return;
    loadDeactivationRequestStatus();
    openPanelAsFloatingCard(settingsPanel, trigger, '设置', 'jc-settings-card');
}

function getRenderedSearchMessages() {
    if (!messagesContainer) return [];
    return Array.from(messagesContainer.querySelectorAll('.message')).map((element) => {
        let text = element.querySelector('.message-text')?.textContent?.trim() || '';
        if (!text && element.querySelector('.message-image')) text = '图片消息';
        if (!text && element.querySelector('.message-voice')) text = '语音消息';
        return {
            author: element.querySelector('.message-username')?.textContent?.trim() || '系统消息',
            text,
            time: element.dataset.messageTime || element.querySelector('.message-time')?.textContent?.trim() || '',
            element
        };
    });
}

async function getGlobalSearchMessages() {
    const response = await fetch('/api/channels', { headers: getAuthHeaders() });
    if (!response.ok) throw new Error('无法读取频道列表');
    const data = await response.json();
    const channels = Array.isArray(data.channels) ? data.channels : [];
    const groups = await Promise.all(channels.map(async (channel) => {
        const messagesResponse = await fetch(`/api/messages/${encodeURIComponent(channel)}`, { headers: getAuthHeaders() });
        if (!messagesResponse.ok) return [{ author: channel, text: channel, time: '', channel, isChannel: true }];
        const channelMessages = await messagesResponse.json();
        return [
            { author: channel, text: channel, time: '', channel, isChannel: true },
            ...(Array.isArray(channelMessages) ? channelMessages : []).map((message) => ({
                author: message.nickname || message.username || '系统消息',
                text: message.content || (message.image ? '图片消息' : message.voice ? '语音消息' : ''),
                time: message.created_at || '',
                channel,
                messageId: message.id
            }))
        ];
    }));
    return groups.flat();
}

function initGlobalHeaderSearch() {
    if (!anatomyTopSearchInput || !anatomyTopSearchResults || !JchatUI) return;
    let indexedMessages = [];
    let indexPromise = null;
    let requestVersion = 0;

    function closeResults() {
        anatomyTopSearchResults.hidden = true;
        anatomyTopSearchBtn?.classList.remove('is-searching');
    }

    function openResult(result) {
        closeResults();
        anatomyTopSearchInput.value = '';
        if (!result.channel) return;
        const channelItem = Array.from(document.querySelectorAll('.channel-item')).find((item) => item.dataset.channel === result.channel);
        if (channelItem) switchChannel(channelItem);
    }

    function renderResults(items, query) {
        anatomyTopSearchResults.replaceChildren();
        const search = JchatUI.getSearchResults(items, query, 12);
        if (!search.total) {
            const empty = document.createElement('p');
            empty.className = 'anatomy-top-search__empty';
            empty.textContent = '没有找到匹配结果';
            anatomyTopSearchResults.appendChild(empty);
        } else {
            search.items.forEach((result) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'jc-search-result anatomy-top-search__result';
                const meta = document.createElement('span');
                meta.className = 'jc-search-result__meta';
                meta.textContent = result.channel ? `${result.channel} · ${result.author}` : result.author;
                const excerpt = document.createElement('span');
                excerpt.className = 'jc-search-result__text';
                excerpt.textContent = result.text || '非文本消息';
                button.append(meta, excerpt);
                let activated = false;
                const activateResult = (event) => {
                    event.preventDefault();
                    if (activated) return;
                    activated = true;
                    openResult(result);
                };
                button.addEventListener('pointerdown', activateResult);
                button.addEventListener('click', activateResult);
                anatomyTopSearchResults.appendChild(button);
            });
        }
        anatomyTopSearchResults.hidden = false;
        anatomyTopSearchBtn?.classList.add('is-searching');
    }

    async function runSearch() {
        const query = anatomyTopSearchInput.value.trim();
        const version = ++requestVersion;
        if (!query) {
            closeResults();
            return;
        }
        anatomyTopSearchResults.innerHTML = '<p class="anatomy-top-search__empty">正在搜索…</p>';
        anatomyTopSearchResults.hidden = false;
        anatomyTopSearchBtn?.classList.add('is-searching');
        try {
            indexPromise ||= getGlobalSearchMessages();
            indexedMessages = await indexPromise;
            if (version === requestVersion) renderResults(indexedMessages, query);
        } catch (error) {
            indexPromise = null;
            if (version !== requestVersion) return;
            anatomyTopSearchResults.innerHTML = '<p class="anatomy-top-search__empty">全局搜索暂时不可用</p>';
        }
    }

    anatomyTopSearchInput.addEventListener('input', runSearch);
    anatomyTopSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeResults();
            anatomyTopSearchInput.blur();
        }
    });
    document.addEventListener('click', (event) => {
        if (!anatomyTopSearchBtn?.contains(event.target)) closeResults();
    });
}

function openChannelSearchCard(trigger = channelSearchBtn) {
    if (!trigger || !JchatUI) return;
    const isGlobal = !((viewMode === 'channel' && currentChannel) || (viewMode === 'dm' && currentDmPeer?.id));
    let messages = isGlobal ? [] : getRenderedSearchMessages();
    const content = document.createElement('div');
    content.className = 'jc-channel-search';

    const field = document.createElement('label');
    field.className = 'jc-search-field';
    field.innerHTML = `${jchatIcon('search')}<span class="jc-visually-hidden">搜索消息</span>`;
    const input = document.createElement('input');
    input.className = 'jc-search-input';
    input.type = 'search';
    input.placeholder = '搜索作者、消息或时间';
    input.autocomplete = 'off';
    field.appendChild(input);

    const status = document.createElement('p');
    status.className = 'jc-search-status';
    status.setAttribute('aria-live', 'polite');
    const results = document.createElement('div');
    results.className = 'jc-search-results';
    content.append(field, status, results);

    let controller;
    function renderResults() {
        const search = JchatUI.getSearchResults(messages, input.value, 50);
        results.replaceChildren();
        status.textContent = search.total ? `找到 ${search.total} 条结果` : '没有找到匹配结果';

        search.items.forEach((result) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'jc-search-result';
            const meta = document.createElement('span');
            meta.className = 'jc-search-result__meta';
            meta.textContent = result.channel ? `${result.channel} · ${result.author}${result.time ? ` · ${result.time}` : ''}` : (result.time ? `${result.author} · ${result.time}` : result.author);
            const excerpt = document.createElement('span');
            excerpt.className = 'jc-search-result__text';
            excerpt.textContent = result.text || '非文本消息';
            button.append(meta, excerpt);
            button.addEventListener('click', () => {
                controller.close();
                if (!result.element && result.channel) {
                    const channelItem = Array.from(document.querySelectorAll('.channel-item')).find((item) => item.dataset.channel === result.channel);
                    channelItem?.click();
                    return;
                }
                const target = result.element;
                if (!target) return;
                requestAnimationFrame(() => {
                    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
                    target.classList.add('jc-search-hit');
                    window.setTimeout(() => target.classList.remove('jc-search-hit'), 1400);
                });
            });
            results.appendChild(button);
        });
    }

    input.addEventListener('input', renderResults);
    controller = JchatUI.createFloatingCard({
        trigger,
        title: isGlobal ? '全局搜索' : '搜索当前会话',
        content,
        className: 'jc-search-card jc-profile-surface',
        autofocusSelector: '.jc-search-input'
    });
    if (isGlobal) {
        status.textContent = '正在索引你可访问的频道…';
        getGlobalSearchMessages().then((items) => {
            messages = items;
            renderResults();
        }).catch((error) => {
            status.textContent = error.message || '全局搜索暂时不可用';
        });
    } else {
        renderResults();
    }
}

function appendChannel(name) {
    const key = String(name || '').trim();
    if (!key) return null;
    const existing = Array.from(document.querySelectorAll('.channel-item')).find(item => item.dataset.channel === key);
    if (existing) return existing;
    const panels = [channelListPanel, channelListPanelMobile, channelListPanelMain].filter(Boolean);
    let firstItem = null;
    panels.forEach((panel, index) => {
        const item = document.createElement('div');
        item.className = 'channel-item';
        item.dataset.channel = key;
        const icon = document.createElement('span');
        icon.className = 'channel-icon';
        icon.innerHTML = jchatIcon('channel');
        const label = document.createElement('span');
        label.className = 'channel-name';
        label.textContent = name;
        item.append(icon, label);
        panel.appendChild(item);
        if (index === 0) firstItem = item;
    });
    return firstItem;
}

async function loadPersistedChannels() {
    try {
        const response = await fetch('/api/channels', { headers: getAuthHeaders() });
        if (!response.ok) return null;
        const data = await response.json();
        const channels = Array.isArray(data.channels) ? data.channels : [];
        [channelListPanel, channelListPanelMobile, channelListPanelMain]
            .filter(Boolean)
            .forEach(panel => panel.replaceChildren());
        channels.forEach(appendChannel);
        return channels;
    } catch (error) {
        console.warn('Unable to load channels:', error);
        return null;
    }
}

async function handleChannelInvited(data) {
    const channel = typeof data?.channel === 'string' ? data.channel : '';
    if (!channel || channel !== channel.trim() || channel.length > 28 || /[\r\n<>]/.test(channel) || isPublicChannelName(channel)) {
        return false;
    }

    const channels = await loadPersistedChannels();
    if (!Array.isArray(channels) || !channels.includes(channel)) return false;

    showNotification(`你已受邀加入频道「${channel}」`, 'info', 4500);
    return true;
}

function openAddChannelCard(trigger = addChannelBtn) {
    if (!trigger || !JchatUI) return;
    const form = document.createElement('form');
    form.className = 'jc-channel-form';
    form.innerHTML = '<label for="jcChannelName">频道名称</label><input id="jcChannelName" class="jc-card-input" name="channelName" maxlength="28" required placeholder="例如：产品讨论"><p>新频道会保留在本次会话中。</p><button type="submit" class="btn-primary">添加频道</button>';
    let controller;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = String(new FormData(form).get('channelName') || '').trim();
        if (!name) return;
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            const response = await fetch('/api/channels', {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || '添加频道失败');
            const item = appendChannel(data.name);
            controller.close();
            item?.click();
            showNotification(`已添加频道「${data.name}」`, 'success');
        } catch (error) {
            showNotification(error.message || '添加频道失败', 'error');
        } finally {
            submitButton.disabled = false;
        }
    });
    controller = JchatUI.createFloatingCard({
        trigger,
        title: '添加频道',
        content: form,
        className: 'jc-add-channel-card jc-profile-surface',
        autofocusSelector: '.jc-card-input'
    });
}

function isPublicChannelName(channel) {
    return channel === '公共频道1' || channel === '公共频道2';
}

function mergeChannelInviteUsernames(checkedUsernames, manualUsername) {
    const values = Array.isArray(checkedUsernames) ? checkedUsernames : [];
    const manual = String(manualUsername || '').trim();
    return [...new Set([...values.filter(value => typeof value === 'string' && value), ...(manual ? [manual] : [])])];
}

function buildChannelInviteRequest(channel, usernames) {
    return {
        url: `/api/channel/${encodeURIComponent(channel)}/members`,
        options: {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames })
        }
    };
}

function canManageChannelMembers(channel, fetchImpl = fetch) {
    if (!channel || isPublicChannelName(channel)) return Promise.resolve(false);
    return fetchImpl(`/api/channel/${encodeURIComponent(channel)}/members`, { headers: getAuthHeaders() })
        .then(response => response.ok)
        .catch(() => false);
}

let channelInviteVisibilityRequest = 0;

function refreshChannelInviteControl() {
    if (!channelInviteBtn && !anatomyDetailsInviteBtn) return;
    const requestId = ++channelInviteVisibilityRequest;
    const channel = currentChannel;
    if (channelInviteBtn) channelInviteBtn.style.display = 'none';
    if (anatomyDetailsInviteBtn) {
        anatomyDetailsInviteBtn.hidden = true;
        anatomyDetailsInviteBtn.disabled = true;
    }
    if (viewMode !== 'channel' || !channel || isPublicChannelName(channel)) return;

    canManageChannelMembers(channel).then(canManage => {
        if (requestId !== channelInviteVisibilityRequest || currentChannel !== channel || viewMode !== 'channel') return;
        if (channelInviteBtn) channelInviteBtn.style.display = canManage ? '' : 'none';
        if (anatomyDetailsInviteBtn) {
            anatomyDetailsInviteBtn.hidden = !canManage;
            anatomyDetailsInviteBtn.disabled = !canManage;
        }
    });
}

function openChannelInviteCard(trigger = channelInviteBtn) {
    if (!trigger || !JchatUI || !currentChannel || isPublicChannelName(currentChannel)) return;
    const channel = currentChannel;
    const form = document.createElement('form');
    form.className = 'jc-channel-invite-form';

    const intro = document.createElement('p');
    intro.className = 'jc-invite-intro';
    intro.textContent = '从好友中选择，也可以按完整用户名邀请其他成员。';

    const friendGroup = document.createElement('fieldset');
    friendGroup.className = 'jc-invite-friend-group';
    const legend = document.createElement('legend');
    legend.textContent = '选择好友';
    const friendList = document.createElement('div');
    friendList.className = 'jc-invite-friend-list';
    friendGroup.append(legend, friendList);

    const friends = getSortedFriendsForList();
    if (!friends.length) {
        const empty = document.createElement('p');
        empty.className = 'jc-invite-empty';
        empty.textContent = '好友列表为空，可在下方输入用户名。';
        friendList.appendChild(empty);
    } else {
        friends.forEach(friend => {
            const option = document.createElement('label');
            option.className = 'jc-invite-friend-option';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'inviteFriend';
            checkbox.value = friend.username;
            const avatar = document.createElement('img');
            avatar.className = 'jc-invite-friend-avatar';
            avatar.src = getAvatarUrl(friend.avatar);
            avatar.alt = '';
            const identity = document.createElement('span');
            identity.className = 'jc-invite-friend-identity';
            const displayName = document.createElement('span');
            displayName.className = 'jc-invite-friend-name';
            displayName.textContent = friend.nickname || friend.username;
            const username = document.createElement('span');
            username.className = 'jc-invite-friend-username';
            username.textContent = `@${friend.username}`;
            identity.append(displayName, username);
            option.append(checkbox, avatar, identity);
            friendList.appendChild(option);
        });
    }

    const manualLabel = document.createElement('label');
    manualLabel.className = 'jc-invite-username-label';
    manualLabel.htmlFor = 'jcInviteUsername';
    manualLabel.textContent = '按用户名邀请';
    const manualInput = document.createElement('input');
    manualInput.id = 'jcInviteUsername';
    manualInput.className = 'jc-invite-username-input';
    manualInput.type = 'text';
    manualInput.autocomplete = 'off';
    manualInput.placeholder = '输入完整用户名';
    manualInput.maxLength = 24;

    const status = document.createElement('p');
    status.className = 'jc-invite-status';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'btn-primary jc-invite-submit';
    submitButton.textContent = '发送邀请';

    form.append(intro, friendGroup, manualLabel, manualInput, status, submitButton);

    function setStatus(message, state = 'error') {
        status.textContent = message;
        status.dataset.state = state;
    }

    let controller;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const selected = Array.from(form.querySelectorAll('input[name="inviteFriend"]:checked'))
            .map(input => input.value);
        const usernames = mergeChannelInviteUsernames(selected, manualInput.value);
        if (!usernames.length) {
            setStatus('请选择好友或输入用户名。');
            manualInput.focus();
            return;
        }

        submitButton.disabled = true;
        setStatus('正在发送邀请…', 'pending');
        try {
            const request = buildChannelInviteRequest(channel, usernames);
            const response = await fetch(request.url, request.options);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = response.status === 403
                    ? '只有频道创建者可以邀请成员。'
                    : response.status === 401
                        ? '登录状态已失效，请重新登录。'
                        : (data.error || '邀请失败，请稍后重试。');
                setStatus(message);
                showNotification(message, 'error');
                return;
            }

            const invited = Array.isArray(data.invited) ? data.invited : [];
            const notFound = Array.isArray(data.notFound) ? data.notFound : [];
            if (!invited.length) {
                const message = notFound.length
                    ? `未找到用户：${notFound.join('、')}`
                    : '所选用户已在频道中。';
                setStatus(message);
                showNotification(message, 'error');
                return;
            }

            const invitedNames = invited.map(user => user.username).join('、');
            const missingNotice = notFound.length ? `；未找到：${notFound.join('、')}` : '';
            const message = `已邀请 ${invitedNames}${missingNotice}`;
            setStatus(message, 'success');
            form.reset();
            showNotification(message, 'success');
            controller.close();
        } catch (error) {
            const message = error.message || '网络错误，请稍后重试。';
            setStatus(message);
            showNotification(message, 'error');
        } finally {
            submitButton.disabled = false;
        }
    });

    controller = JchatUI.createFloatingCard({
        trigger,
        title: '邀请成员',
        content: form,
        className: 'jc-channel-invite-card jc-profile-surface',
        autofocusSelector: '.jc-invite-username-input'
    });
}

function initSelectionLenses() {
    document.querySelectorAll('.mode-toggle').forEach((toggle) => {
        if (toggle.dataset.jcLensReady === 'true') return;
        toggle.dataset.jcLensReady = 'true';
        const lens = document.createElement('span');
        lens.className = 'jc-selection-lens';
        lens.setAttribute('aria-hidden', 'true');
        toggle.prepend(lens);
        const update = () => {
            const active = toggle.querySelector('.mode-btn.active');
            if (!active) return;
            lens.style.width = `${active.offsetWidth}px`;
            lens.style.height = `${active.offsetHeight}px`;
            lens.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        };
        toggle.addEventListener('click', (event) => {
            if (event.target.closest('.mode-btn')) requestAnimationFrame(update);
        });
        window.addEventListener('resize', update, { passive: true });
        requestAnimationFrame(update);
    });
}

function initJchatInterface() {
    if (document.documentElement.dataset.jchatUiReady === 'true') return;
    document.documentElement.dataset.jchatUiReady = 'true';
    hydrateJchatIcons();
    initSelectionLenses();
    addChannelBtn?.addEventListener('click', () => openAddChannelCard(addChannelBtn));
    channelSearchBtn?.addEventListener('click', () => openChannelSearchCard(channelSearchBtn));
    channelInviteBtn?.addEventListener('click', () => openChannelInviteCard(channelInviteBtn));
    initGlobalHeaderSearch();
    anatomyDetailsInviteBtn?.addEventListener('click', () => openChannelInviteCard(anatomyDetailsInviteBtn));
    anatomyDetailsMenuBtn?.addEventListener('click', () => openChannelMenu(anatomyDetailsMenuBtn));
    settingsBtnMobile?.addEventListener('click', () => openSettingsCard(settingsBtnMobile));
    syncAnatomyWorkspaceContext();
}

function showNotification(message, type = 'info', duration = 3000) {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    const messageElement = document.createElement('p');
    messageElement.className = 'message';
    messageElement.textContent = String(message ?? '');
    notification.appendChild(messageElement);

    container.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
}

function getAuthHeaders() {
    const token = JchatAuth.getAuthToken();
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

function clearLoginAndRedirect() {
    JchatAuth.clearLogin();
    socket.disconnect();
    window.location.href = 'login.html';
}

function syncCurrentUserFromServer() {
    if (!currentUser || currentUser.id == null) return Promise.resolve();
    return fetch('/api/profile/' + currentUser.id, { headers: getAuthHeaders() })
        .then(function (r) {
            if (r.status === 401 || r.status === 404) {
                clearLoginAndRedirect();
                return null;
            }
            return r.ok ? r.json() : null;
        })
        .then(function (data) {
            if (!data) return;
            if (data.code === 'user_deleted') {
                clearLoginAndRedirect();
                return;
            }
            if (data.username != null) currentUser.username = data.username;
            if (data.nickname != null) currentUser.nickname = data.nickname;
            if (data.avatar != null) currentUser.avatar = data.avatar;
            if (data.bio != null) currentUser.bio = data.bio;
            if (data.gender != null) currentUser.gender = data.gender;
            if (data.email != null) currentUser.email = data.email;
            if (data.presence_status) currentUser.presence_status = data.presence_status;
            if (typeof data.allow_add_friend_from_profile === 'boolean') currentUser.allow_add_friend_from_profile = data.allow_add_friend_from_profile;
            try { JchatAuth.updateStoredUser(currentUser); } catch (e) {}
            updateUserInfo();
        })
        .catch(function () {});
}

async function apiRequest(url, options = {}) {
    const headers = { ...(options.headers || {}), ...getAuthHeaders() };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.code === 'user_deleted') {
        clearLoginAndRedirect();
        throw new Error('登录已失效');
    }
    if (!res.ok) throw new Error(data?.error || '请求失败');
    return data;
}

function renderFriendsList() {
    const sorted = getSortedFriendsForList();
    const stale = getStaleContacts().filter(function (s) {
        return !friendsCache.some(function (f) { return parseInt(f.id) === parseInt(s.id); });
    });
    const hasAny = sorted.length > 0 || stale.length > 0;
    [{ list: friendsList, empty: friendsEmptyState }, { list: friendsListMobile, empty: friendsEmptyStateMobile }, { list: friendsListMain, empty: friendsEmptyStateMain }].forEach(t => {
        if (!t.list || !t.empty) return;
        t.list.innerHTML = '';
        if (!hasAny) { t.empty.hidden = false; return; }
        t.empty.hidden = true;
        sorted.forEach(friend => {
            const item = document.createElement('div');
            item.className = 'friend-item';
            item.dataset.friendId = safeMessageId(friend.id);
            const unread = (dmUnreadCountByFriendId[String(friend.id)] || 0);
            const unreadHtml = unread > 0 ? '<span class="dm-unread-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '';
            const pinHtml = isPinnedFriend(friend.id) ? '<span class="friend-pin-icon" title="已置顶" aria-label="已置顶">' + jchatIcon('check') + '</span>' : '';
            item.innerHTML = '<img class="friend-avatar" src="' + escapeAttribute(getAvatarUrl(friend.avatar)) + '" alt="avatar"><span class="friend-name">' + escapeHtml(friend.nickname || friend.username) + '</span>' + pinHtml + unreadHtml;
            t.list.appendChild(item);
        });
        stale.forEach(function (s) {
            const item = document.createElement('div');
            item.className = 'friend-item friend-item-stale';
            item.dataset.staleId = safeMessageId(s.id);
            item.innerHTML = '<img class="friend-avatar" src="' + escapeAttribute(getAvatarUrl(s.avatar)) + '" alt="avatar"><span class="friend-name">' + escapeHtml(s.nickname || s.username) + '</span><span class="friend-stale-tag">已解除</span><button type="button" class="btn-readd-friend" data-stale-id="' + safeMessageId(s.id) + '">重新添加</button>';
            t.list.appendChild(item);
        });
    });
    setDmUnreadBadgeVisible(getTotalDmUnread() > 0);
    renderFriendHubFriends();
}

function renderFriendHubFriends() {
    if (!friendModalFriendsList || !friendModalFriendsEmpty) return;
    friendModalFriendsList.replaceChildren();
    const sorted = getSortedFriendsForList();
    friendModalFriendsEmpty.hidden = sorted.length > 0;
    sorted.forEach((friend) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'friend-item friend-hub-item';
        button.dataset.friendId = friend.id;
        const avatar = document.createElement('img');
        avatar.className = 'friend-avatar';
        avatar.src = getAvatarUrl(friend.avatar);
        avatar.alt = '';
        const name = document.createElement('span');
        name.className = 'friend-name';
        name.textContent = friend.nickname || friend.username;
        const action = document.createElement('span');
        action.className = 'friend-hub-item__action';
        action.textContent = '发消息';
        button.append(avatar, name, action);
        button.addEventListener('click', () => {
            closeFriendModalUI();
            setViewMode('dm');
            selectDmPeerById(friend.id);
        });
        friendModalFriendsList.appendChild(button);
    });
}

function setFriendRequestBadgeVisible(visible) {
    if (friendRequestBadge) friendRequestBadge.hidden = !visible;
    if (friendRequestBadgeMobile) friendRequestBadgeMobile.hidden = !visible;
    if (mobileProfileFriendBadge) mobileProfileFriendBadge.hidden = !visible;
}

function getTotalDmUnread() {
    return Object.values(dmUnreadCountByFriendId).reduce(function (s, n) { return s + (n || 0); }, 0);
}

function setDmUnreadBadgeVisible(visible) {
    var dmBadge = document.getElementById('dmUnreadBadge');
    var dmBadgeMobile = document.getElementById('dmUnreadBadgeMobile');
    if (dmBadge) dmBadge.hidden = !visible;
    if (dmBadgeMobile) dmBadgeMobile.hidden = !visible;
    if (dmUnreadBadgeMain) dmUnreadBadgeMain.hidden = !visible;
}

function renderFriendRequests() {
    if (!friendRequestsList || !friendRequestsEmpty) return;
    friendRequestsList.innerHTML = '';
    if (!incomingRequestsCache.length) { friendRequestsEmpty.hidden = false; return; }
    friendRequestsEmpty.hidden = true;
    incomingRequestsCache.forEach(req => {
        const row = document.createElement('div');
        row.className = 'friend-item';
        row.dataset.requestId = safeMessageId(req.id);
        var name = (req.from_user && (req.from_user.nickname || req.from_user.username)) ? String(req.from_user.nickname || req.from_user.username) : '该账户已注销';
        var msg = (req.message != null && String(req.message).trim()) ? String(req.message).trim() : '';
        row.innerHTML = '<img class="friend-avatar" src="' + escapeAttribute(getAvatarUrl(req.from_user && req.from_user.avatar ? req.from_user.avatar : '')) + '" alt="avatar"><div class="friend-item-body"><span class="friend-name"></span></div><div class="friend-item-actions"><button class="btn-secondary req-reject" type="button" style="padding:6px 10px;">拒绝</button><button class="btn-primary req-accept" type="button" style="padding:6px 10px;">同意</button></div>';
        var bodyEl = row.querySelector('.friend-item-body');
        var nameEl = row.querySelector('.friend-name');
        if (nameEl) nameEl.textContent = name;
        if (bodyEl && msg) {
            row.classList.add('friend-item-has-reason');
            var reasonEl = document.createElement('div');
            reasonEl.className = 'friend-request-reason';
            reasonEl.textContent = msg;
            bodyEl.appendChild(reasonEl);
        }
        friendRequestsList.appendChild(row);
    });
}

async function refreshFriendsAndRequests() {
    try {
        const [friendsRes, reqRes] = await Promise.all([
            apiRequest('/api/friends?userId=' + encodeURIComponent(currentUser.id)),
            apiRequest('/api/friends/requests?userId=' + encodeURIComponent(currentUser.id))
        ]);
        friendsCache = friendsRes.friends || [];
        incomingRequestsCache = reqRes.requests || [];
        friendsCache.forEach(function (f) { removeStaleContact(f.id); });
        setFriendRequestBadgeVisible(incomingRequestsCache.length > 0);
        renderFriendsList();
        renderFriendRequests();
        if (viewMode === 'dm') {
            ensureDmEmptyState();
            if (currentDmPeer && currentDmPeer._stale && friendsCache.some(function (f) { return parseInt(f.id) === parseInt(currentDmPeer.id); })) {
                selectDmPeerById(currentDmPeer.id);
            }
        }
    } catch (e) { console.error(e); }
}

function ensureDmEmptyState() {
    if (viewMode !== 'dm') return;
    const messageInputContainer = document.querySelector('.message-input-container');
    const hasFriendsOrStale = friendsCache.length > 0 || getStaleContacts().filter(function (s) { return !friendsCache.some(function (f) { return parseInt(f.id) === parseInt(s.id); }); }).length > 0;
    if (!hasFriendsOrStale) {
        if (messageInputContainer) messageInputContainer.style.display = 'none';
        if (currentChannelAvatar) { currentChannelAvatar.style.display = 'none'; currentChannelAvatar.onclick = null; }
        if (currentChannelIcon) { currentChannelIcon.style.display = ''; currentChannelIcon.innerHTML = jchatIcon('people'); }
        currentChannelName.textContent = '私聊';
        messagesContainer.innerHTML = '<div class="jc-empty-state"><div class="jc-empty-state-icon">' + jchatIcon('people') + '</div><div>请添加好友以开始私聊</div></div>';
        return;
    }
    if (currentDmPeer && currentDmPeer._stale) {
        if (messageInputContainer) messageInputContainer.style.display = 'none';
        var name = currentDmPeer.nickname || currentDmPeer.username || '对方';
        messagesContainer.innerHTML = '<div class="stale-dm-card"><div class="stale-dm-icon">' + jchatIcon('info') + '</div><p class="stale-dm-text">对方已与你解除好友关系</p><p class="stale-dm-hint">你可以重新添加对方为好友后继续聊天</p><div class="stale-dm-actions"><button type="button" class="btn-readd-in-chat" data-stale-id="' + currentDmPeer.id + '">重新添加好友</button><button type="button" class="btn-remove-stale-in-chat" data-stale-id="' + currentDmPeer.id + '">删除好友</button></div></div>';
        var readdBtn = messagesContainer.querySelector('.btn-readd-in-chat');
        if (readdBtn) readdBtn.addEventListener('click', function () { sendReaddRequest(this.dataset.staleId); });
        var removeBtn = messagesContainer.querySelector('.btn-remove-stale-in-chat');
        if (removeBtn) removeBtn.addEventListener('click', function () {
            var id = this.dataset.staleId;
            if (!id) return;
            var name = currentDmPeer && (currentDmPeer.nickname || currentDmPeer.username) || '该联系人';
            showStaleDeleteConfirm(name, function () {
                apiRequest('/api/friends/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id }) })
                    .then(function () {
                        removeStaleContact(id);
                        currentDmPeer = null;
                        renderFriendsList();
                        ensureDmEmptyState();
                        showNotification('已删除', 'success');
                    })
                    .catch(function (e) {
                        showNotification(e.message || '删除失败', 'error');
                    });
            });
        });
        updateChannelMenuBtnVisibility();
        return;
    }
    if (!currentDmPeer) {
        if (messageInputContainer) messageInputContainer.style.display = 'none';
        if (currentChannelAvatar) { currentChannelAvatar.style.display = 'none'; currentChannelAvatar.onclick = null; }
        if (currentChannelIcon) { currentChannelIcon.style.display = ''; currentChannelIcon.innerHTML = jchatIcon('people'); }
        currentChannelName.textContent = '请选择好友';
        messagesContainer.innerHTML = '<div style="text-align:center;padding:80px 30px;color:#6e6e73;font-size:18px;font-weight:600;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;"><div>从左侧选择好友开始聊天</div></div>';
    }
    updateChannelMenuBtnVisibility();
}

function syncChannelDetailsVisibility() {
    const shouldShow = viewMode === 'channel' && Boolean(currentChannel);
    if (anatomyChannelDetails) anatomyChannelDetails.hidden = !shouldShow;
    if (anatomyWorkspace) anatomyWorkspace.classList.toggle('has-channel-details', shouldShow);
    if (!shouldShow && anatomyDetailOnlineCount) anatomyDetailOnlineCount.textContent = '在线 0 人';
}

function syncAnatomyWorkspaceContext() {
    const selectedLabel = currentChannelName?.textContent?.trim() || '请选择频道';
    if (anatomyDetailChannelName) anatomyDetailChannelName.textContent = selectedLabel;
    if (anatomyBentoChannelName) anatomyBentoChannelName.textContent = selectedLabel;
    syncChannelDetailsVisibility();
}

function updateChannelMenuBtnVisibility() {
    var show = (viewMode === 'channel' && currentChannel) || (viewMode === 'dm' && currentDmPeer && currentDmPeer.id && !currentDmPeer._stale);
    if (channelMenuBtn) channelMenuBtn.style.display = show ? '' : 'none';
    if (channelSearchBtn) channelSearchBtn.style.display = show ? '' : 'none';
    if (anatomyDetailsMenuBtn) anatomyDetailsMenuBtn.disabled = !show;
    syncAnatomyWorkspaceContext();
    refreshChannelInviteControl();
}

function setViewMode(nextMode) {
    viewMode = nextMode;
    currentReplyTo = null;
    if (viewMode === 'channel') {
        if (leftListTitle) leftListTitle.textContent = '频道';
        if (modeChannelBtn) modeChannelBtn.classList.add('active');
        if (modeDmBtn) modeDmBtn.classList.remove('active');
        if (modeChannelBtnMobile) modeChannelBtnMobile.classList.add('active');
        if (modeDmBtnMobile) modeDmBtnMobile.classList.remove('active');
        if (modeChannelBtnMain) modeChannelBtnMain.classList.add('active');
        if (modeDmBtnMain) modeDmBtnMain.classList.remove('active');
        if (channelListPanel) { channelListPanel.classList.remove('is-hidden'); channelListPanel.setAttribute('aria-hidden', 'false'); }
        if (friendsListPanel) { friendsListPanel.classList.add('is-hidden'); friendsListPanel.setAttribute('aria-hidden', 'true'); }
        if (channelListPanelMobile) channelListPanelMobile.classList.remove('is-hidden');
        if (friendsListPanelMobile) friendsListPanelMobile.classList.add('is-hidden');
        if (channelListPanelMain) { channelListPanelMain.classList.remove('is-hidden'); channelListPanelMain.setAttribute('aria-hidden', 'false'); }
        if (friendsListPanelMain) { friendsListPanelMain.classList.add('is-hidden'); friendsListPanelMain.setAttribute('aria-hidden', 'true'); }
        currentDmPeer = null;
        currentChannel = null;
        var activeChannelItem = document.querySelector('.channel-item.active');
        if (activeChannelItem) activeChannelItem.classList.remove('active');
        if (currentChannelAvatar) { currentChannelAvatar.style.display = 'none'; currentChannelAvatar.onclick = null; }
        if (currentChannelIcon) currentChannelIcon.style.display = '';
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && chatContainerEl) chatContainerEl.classList.remove('mobile-has-selection');
        initPage();
        updateChannelMenuBtnVisibility();
        return;
    }
    currentDmPeer = null;
    if (leftListTitle) leftListTitle.textContent = '好友';
    if (modeChannelBtn) modeChannelBtn.classList.remove('active');
    if (modeDmBtn) modeDmBtn.classList.add('active');
    if (modeChannelBtnMobile) modeChannelBtnMobile.classList.remove('active');
    if (modeDmBtnMobile) modeDmBtnMobile.classList.add('active');
    if (modeChannelBtnMain) modeChannelBtnMain.classList.remove('active');
    if (modeDmBtnMain) modeDmBtnMain.classList.add('active');
    if (channelListPanel) { channelListPanel.classList.add('is-hidden'); channelListPanel.setAttribute('aria-hidden', 'true'); }
    if (friendsListPanel) { friendsListPanel.classList.remove('is-hidden'); friendsListPanel.setAttribute('aria-hidden', 'false'); }
    if (channelListPanelMobile) channelListPanelMobile.classList.add('is-hidden');
    if (friendsListPanelMobile) friendsListPanelMobile.classList.remove('is-hidden');
    if (channelListPanelMain) { channelListPanelMain.classList.add('is-hidden'); channelListPanelMain.setAttribute('aria-hidden', 'true'); }
    if (friendsListPanelMain) { friendsListPanelMain.classList.remove('is-hidden'); friendsListPanelMain.setAttribute('aria-hidden', 'false'); }
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && chatContainerEl) chatContainerEl.classList.remove('mobile-has-selection');
    ensureDmEmptyState();
    updateChannelMenuBtnVisibility();
}

function initPage() {
    closeFloatingPanel(settingsPanel);
    updateUserInfo();
    preloadAudioAndRequestPermission();
    if (!messagesContainer) return;
    var isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile && chatContainerEl) {
        chatContainerEl.classList.remove('mobile-has-selection');
        messagesContainer.innerHTML = '';
        var messageInputContainer = document.querySelector('.message-input-container');
        if (messageInputContainer) messageInputContainer.style.display = 'none';
        loadNotificationSettings();
        updateChannelMenuBtnVisibility();
        if (typeof setupNotificationEventListeners === 'function') setupNotificationEventListeners();
        if (typeof setupVoiceButtonEventListeners === 'function') setupVoiceButtonEventListeners();
        return;
    }
    messagesContainer.innerHTML = `
        <div style="
            text-align: center;
            padding: 80px 30px;
            color: #6e6e73;
            font-size: 24px;
            font-weight: 600;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 10px;
            background: linear-gradient(135deg, rgba(240,242,245,0.5) 0%, rgba(255,255,255,1) 100%);
        ">
            <div style="
                max-width: 400px;
                line-height: 1.6;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
<div style="font-size: 34px; color: #333; font-weight: 700; letter-spacing: -0.5px;">欢迎使用 Jchat</div>
                <div style="margin-top: 10px; font-size: 18px; color: #8e8e93; font-weight: 400;">请从左侧选择一个频道开始聊天</div>
            </div>
        </div>
    `;

    if (currentChannelAvatar) currentChannelAvatar.style.display = 'none';
    if (currentChannelIcon) { currentChannelIcon.style.display = ''; currentChannelIcon.textContent = ''; }
    if (currentChannelName) currentChannelName.textContent = '请选择频道';
    var messageInputContainer = document.querySelector('.message-input-container');
    if (messageInputContainer) messageInputContainer.style.display = 'none';
    loadNotificationSettings();
    updateChannelMenuBtnVisibility();
    if (typeof setupNotificationEventListeners === 'function') setupNotificationEventListeners();
    if (typeof setupVoiceButtonEventListeners === 'function') setupVoiceButtonEventListeners();
}

function setupNotificationEventListeners() {
    const channelCheckboxes = document.querySelectorAll('.channel-notification-item input[type="checkbox"]');
    channelCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const channel = e.target.value;
            if (e.target.checked) {
                if (!notificationSettings.selectedChannels.includes(channel)) {
                    notificationSettings.selectedChannels.push(channel);
                }
            } else {
                notificationSettings.selectedChannels = notificationSettings.selectedChannels.filter(c => c !== channel);
            }
            saveNotificationSettings();
        });
    });
}

function setupVoiceButtonEventListeners() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (!voiceBtn) return;

    voiceBtn.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        try {
            await startRecording();
        } catch (error) {
            console.error('录制失败:', error);
            showNotification('无法开始录制，请检查麦克风权限', 'error');
        }
    });

    voiceBtn.addEventListener('mouseup', () => {
        stopRecording();
    });

    voiceBtn.addEventListener('mouseleave', () => {
        stopRecording();
    });

    voiceBtn.addEventListener('touchstart', async (e) => {
        e.preventDefault();
        try {
            await startRecording();
        } catch (error) {
            console.error('录制失败:', error);
            showNotification('无法开始录制，请检查麦克风权限', 'error');
        }
    });

    voiceBtn.addEventListener('touchend', () => {
        stopRecording();
    });
}

function updateUserInfo() {
    if (!currentUser) {
        console.error('currentUser is not defined');
        return;
    }
    var displayName = currentUser.nickname || currentUser.username || (currentUser.id != null ? '用户 ' + currentUser.id : '用户');
    if (username) username.textContent = displayName;
    if (usernameMobile) usernameMobile.textContent = displayName;
    if (anatomyDetailMemberName) anatomyDetailMemberName.textContent = displayName;

    if (userBio) {
        userBio.textContent = currentUser.bio ? currentUser.bio : '这个人很懒，什么也没留下';
    }

    if (userBioMobile) {
        userBioMobile.textContent = currentUser.bio ? currentUser.bio : '这个人很懒，什么也没留下';
    }

    if (userAvatar) {
        const avatarUrl = getAvatarUrl(currentUser.avatar);
        userAvatar.src = avatarUrl;
    }

    if (anatomyDetailAvatar) {
        anatomyDetailAvatar.src = getAvatarUrl(currentUser.avatar);
    }

    if (userAvatarMobile) {
        const avatarUrl = getAvatarUrl(currentUser.avatar);
        userAvatarMobile.src = avatarUrl;
    }

    if (mobileProfileAvatar) {
        mobileProfileAvatar.src = getAvatarUrl(currentUser.avatar);
    }
    if (mobileMeBtnAvatar) {
        mobileMeBtnAvatar.src = getAvatarUrl(currentUser.avatar);
    }
    if (mobileProfileName) mobileProfileName.textContent = displayName;
    if (mobileProfileBio) mobileProfileBio.textContent = currentUser.bio ? currentUser.bio : '这个人很懒，什么也没留下';

    if (settingsUsername) {
        settingsUsername.value = currentUser.username;
    }
    if (settingsNickname) {
        settingsNickname.value = currentUser.nickname || currentUser.username;
    }
    if (settingsBio) {
        settingsBio.value = currentUser.bio || '';
    }
    if (settingsGender) {
        settingsGender.value = currentUser.gender || 'other';
    }
    if (settingsEmail) {
        settingsEmail.value = currentUser.email || '';
    }
    if (settingsPresenceStatus) {
        settingsPresenceStatus.value = currentUser.presence_status || 'online';
    }
    var settingsAllowAddFriendFromProfile = document.getElementById('settingsAllowAddFriendFromProfile');
    if (settingsAllowAddFriendFromProfile) {
        settingsAllowAddFriendFromProfile.checked = currentUser.allow_add_friend_from_profile === true || currentUser.allow_add_friend_from_profile === 'true';
    }
    if (avatarPreview) {
        const avatarUrl = getAvatarUrl(currentUser.avatar);
        avatarPreview.src = avatarUrl;
    }

    console.log('User info updated:', {
        username: currentUser.username,
        bio: currentUser.bio,
        avatar: currentUser.avatar,
        gender: currentUser.gender
    });
}

function addMessageToDOM(message) {
    const isCurrentUser = message.user_id === currentUser.id;

    if (message.is_recalled) {
        var row = document.createElement('div');
        row.className = 'recall-hint-row';
        row.setAttribute('data-recall-for', message.id);
        var notice = document.createElement('div');
        notice.className = 'recall-notice recall-notice-center';
        var displayName = message.nickname || message.username || '用户';
        notice.textContent = isCurrentUser ? '你撤回了一条消息' : (displayName + ' 撤回了一条消息');
        row.appendChild(notice);
        messagesContainer.appendChild(row);
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'sent' : 'received'}`;
    const messageId = safeMessageId(message.id);
    const messageUserId = safeMessageId(message.user_id);
    messageElement.dataset.messageId = messageId;

    const now = new Date();
    const messageTime = new Date(message.created_at);
    if (!Number.isNaN(messageTime.getTime())) messageElement.dataset.messageTime = messageTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const timeDiff = (now - messageTime) / (1000 * 60);

    console.log('撤回按钮条件检查:', {
        messageId: message.id,
        isCurrentUser,
        timeDiff: timeDiff.toFixed(2),
        isRecalled: message.is_recalled,
        shouldShowRecallBtn: isCurrentUser && timeDiff <= 2 && !message.is_recalled
    });

    const messageAvatar = getAvatarUrl(message.avatar);
    const messageName = escapeHtml(message.nickname || message.username || message.user?.nickname || message.user?.username || '用户');
    let messageContent = `
        <div class="avatar-container">
            <img src="${escapeAttribute(messageAvatar)}" alt="Avatar" class="avatar"${messageUserId ? ` onclick="openUserProfile(${messageUserId})"` : ''}>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-username">${messageName}</span>
            </div>
    `;

    if (message.reply_info) {
        const repliedContent = message.reply_info.content || '图片消息';
        const repliedName = escapeHtml(message.reply_info.nickname || message.reply_info.username || '用户');
        messageContent += `<div class="message-reply" style="
            background-color: rgba(0, 113, 227, 0.05);
            border-left: 3px solid #0071e3;
            padding: 6px 10px;
            border-radius: 8px;
            margin-bottom: 6px;
            font-size: 13px;
        ">
            <span style="font-weight: bold; color: #0071e3;">@${repliedName}</span>: ${escapeHtml(repliedContent.length > 30 ? repliedContent.substring(0, 30) + '...' : repliedContent)}
        </div>`;
    }

    const actionButtons = [];

    if (message.content) {
        messageContent += `<div class="message-text">${escapeHtml(message.content)}</div>`;
    }

    const imageUrl = safeMediaUrl(message.image);
    if (imageUrl && !message.is_recalled) {
        messageContent += `<img src="${escapeAttribute(imageUrl)}" alt="Chat image" class="message-image" onclick="viewImage(this)">`;
        actionButtons.push(`<button class="sticker-collect-btn" data-sticker-src="${escapeAttribute(imageUrl)}" aria-label="收藏表情包" title="收藏表情包">${jchatIcon('bookmark')}</button>`);
    }

    const voiceUrl = safeMediaUrl(message.voice);
    if (voiceUrl && !message.is_recalled) {
        const audioType = voiceUrl.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm;codecs=opus';
        messageContent += `<div class="message-voice bubble">
            <div class="custom-audio-player" data-message-id="${messageId}">
                <audio id="audio-${messageId}" class="voice-player" preload="metadata">
                    <source src="${escapeAttribute(voiceUrl)}" type="${audioType}">
                    您的浏览器不支持音频播放
                </audio>
                <div class="audio-controls">
                    <button class="play-btn" data-audio-id="${messageId}" aria-label="播放语音" title="播放语音">
                        <span class="play-icon">${jchatIcon('play')}</span>
                        <span class="pause-icon">${jchatIcon('pause')}</span>
                    </button>
                    <div class="time-display">
                        <span class="current-time">0:00</span>
                    </div>
                </div>
            </div>
        </div>`;
    }

    actionButtons.push(`<button class="reply-btn" data-message-id="${messageId}" style="
        background: none;
        border: none;
        color: #0071e3;
        font-size: 14px;
        cursor: pointer;
        margin-top: 5px;
        padding: 2px 6px;
        border-radius: 10px;
        transition: all 0.3s ease;
        opacity: 0.7;
    " aria-label="回复" title="回复">${jchatIcon('edit')}</button>`);

if (isCurrentUser && timeDiff <= 2 && !message.is_recalled) {
            actionButtons.push(`<button class="recall-btn" data-message-id="${messageId}" data-channel="${escapeAttribute(message.channel)}" style="
            background: none;
            border: none;
            color: #ff3b30;
            font-size: 14px;
            cursor: pointer;
            margin-top: 5px;
            padding: 2px 6px;
            border-radius: 10px;
            transition: all 0.3s ease;
            opacity: 0.7;
            margin-left: 5px;
        " aria-label="撤回" title="撤回">${jchatIcon('delete')}</button>`);
    }

    if (actionButtons.length > 0) {
        messageContent += `<div class="message-actions">${actionButtons.join('')}</div>`;
    }

    messageContent += '</div>';
    messageElement.innerHTML = messageContent;

    const animateMessageEntry = prepareJchatMessageEntry(messageElement);

    messagesContainer.appendChild(messageElement);

    try {
        const content = message.content;
        const bvid = window.BiliRenderer?.extractBV(content);

        if (content && !message.is_recalled && bvid) {

            let params = {};
            const urlMatch = content.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                try {

                    const cleanUrl = urlMatch[0].replace(/[）〉】]$/g, '');
                    const urlObj = new URL(cleanUrl);

                    urlObj.searchParams.forEach((v, k) => {

                        const supported = ['p', 't', 'autoplay', 'danmaku', 'muted'];
                        if (supported.includes(k)) {
                            params[k] = isNaN(Number(v)) ? v : Number(v);
                        }
                    });
                } catch (e) {  }
            }

            const contentEl = messageElement.querySelector('.message-content');
            if (contentEl) {
                let textEl = contentEl.querySelector('.message-text') || (() => {
                    const div = document.createElement('div');
                    div.className = 'message-text';
                    const actions = contentEl.querySelector('.message-actions');
                    actions ? contentEl.insertBefore(div, actions) : contentEl.appendChild(div);
                    return div;
                })();

                const biliContainer = document.createElement('div');
                biliContainer.className = 'bili-video';
                biliContainer.style.marginTop = '8px';

                const element = window.BiliRenderer.getElement(bvid, params);
                if (element) {
                    biliContainer.appendChild(element);
                    textEl.appendChild(biliContainer);
                }
            }
        }
    } catch (e) {
        console.error('B站渲染插件异常:', e);
    }

    revealJchatMessageEntry(messageElement, animateMessageEntry);

    scrollToBottom();
}

function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}

function replyToMessage(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const username = messageElement.querySelector('.message-username').textContent;
    const content = messageElement.querySelector('.message-text')?.textContent || '图片消息';

    currentReplyTo = messageId;

    let replyIndicator = document.getElementById('replyIndicator');
    if (!replyIndicator) {
        replyIndicator = document.createElement('div');
        replyIndicator.id = 'replyIndicator';
        replyIndicator.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background-color: #f0f0f0;
            border-radius: 8px 8px 0 0;
            font-size: 14px;
            color: #666;
            margin-bottom: -10px;
        `;

        messageInput.parentElement.insertBefore(replyIndicator, messageInput);
    }

    replyIndicator.innerHTML = `
        <span>回复 <strong>${username}</strong>: ${content.length > 20 ? content.substring(0, 20) + '...' : content}</span>
        <button id="cancelReply" style="
            background: none;
            border: none;
            color: #0071e3;
            font-size: 14px;
            cursor: pointer;
            padding: 2px 6px;
        ">取消</button>
    `;

    document.getElementById('cancelReply').addEventListener('click', cancelReply);

    messageInput.focus();
}

function cancelReply() {
    currentReplyTo = null;
    const replyIndicator = document.getElementById('replyIndicator');
    if (replyIndicator) {
        replyIndicator.remove();
    }
}

async function sendMessage() {
    const content = messageInput.value.trim();

    if (!content) {
        console.log('消息内容为空，不发送');
        return;
    }

    console.log('发送消息:', content);
    console.log('当前用户:', currentUser);
    console.log('当前用户ID:', currentUser?.id);
    console.log('当前频道:', currentChannel);
    console.log('当前回复的消息ID:', currentReplyTo);

    console.log('Socket连接状态:', socket.connected);

    if (!socket.connected) {
        console.error('Socket连接已断开，无法发送消息');
        showNotification('网络连接已断开，请刷新页面重试', 'error');
        return;
    }

    if (!currentUser?.id) {
        console.error('用户信息缺失，无法发送消息');
        showNotification('用户信息异常，请重新登录', 'error');
        return;
    }

    if (viewMode === 'dm') {
        if (!currentDmPeer?.id) {
            showNotification('请先从左侧选择好友', 'info');
            return;
        }
        updateDmOrder(currentDmPeer.id);
        socket.emit('sendPrivateMessage', {
            fromUserId: currentUser.id,
            toUserId: currentDmPeer.id,
            content: content,
            image: null,
            voice: null,
            reply_to: currentReplyTo || undefined
        });
        cancelReply();
        renderFriendsList();
    } else {
        socket.emit('sendMessage', {
            userId: currentUser.id,
            channel: currentChannel,
            content: content,
            image: null,
            reply_to: currentReplyTo
        });
    }

    console.log('消息已发送到服务器');

    messageInput.value = '';
    adjustTextareaHeight();

    cancelReply();

}

async function uploadImage(file) {
    uploadProgress.textContent = '上传中...';

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('/api/upload/image', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            if (viewMode === 'dm') {
                if (!currentDmPeer?.id) { showNotification('请先从左侧选择好友', 'info'); uploadProgress.textContent = ''; return; }
                updateDmOrder(currentDmPeer.id);
                socket.emit('sendPrivateMessage', { fromUserId: currentUser.id, toUserId: currentDmPeer.id, content: null, image: data.image, voice: null, reply_to: currentReplyTo || undefined });
                renderFriendsList();
            } else {
                socket.emit('sendMessage', { userId: currentUser.id, channel: currentChannel, content: null, image: data.image, reply_to: currentReplyTo });
            }
            uploadProgress.textContent = '上传成功';
            setTimeout(() => { uploadProgress.textContent = ''; }, 1000);
            cancelReply();
        } else {
            uploadProgress.textContent = '上传失败';
        }
    } catch (error) {
        uploadProgress.textContent = '上传失败';
    }
}

function showCustomConfirm(message, onConfirm, onCancel) {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : logoutBtn;
    const content = document.createElement('div');
    content.className = 'jc-confirm-card__content';
    const copy = document.createElement('p');
    copy.className = 'jc-confirm-card__copy';
    copy.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'jc-confirm-card__actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'jc-confirm-card__cancel';
    cancelBtn.textContent = '取消';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'jc-confirm-card__confirm';
    confirmBtn.textContent = '确定';
    actions.append(cancelBtn, confirmBtn);
    content.append(copy, actions);

    let settled = false;
    const controller = JchatUI.createFloatingCard({
        trigger,
        title: '确认操作',
        content,
        className: 'jc-confirm-card',
        autofocusSelector: '.jc-confirm-card__cancel',
        onClose() {
            if (!settled) onCancel?.();
        }
    });
    cancelBtn.addEventListener('click', () => {
        settled = true;
        controller.close();
        onCancel?.();
    });
    confirmBtn.addEventListener('click', () => {
        settled = true;
        controller.close();
        onConfirm?.();
    });
}

function showStaleDeleteConfirm(contactName, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(2px);';
    const popup = document.createElement('div');
    popup.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:90%;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,0.2);';
    const title = document.createElement('h3');
    title.textContent = '删除联系人（互删）';
    title.style.cssText = 'margin:0 0 12px 0;font-size:18px;font-weight:600;color:#333;text-align:center;';
    const desc = document.createElement('p');
    desc.textContent = '确定删除「' + (contactName || '该联系人') + '」？删除后将从列表中移除并清空与该联系人的聊天记录。';
    desc.style.cssText = 'margin:0 0 20px 0;font-size:15px;color:#666;line-height:1.5;text-align:center;';
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'flex:1;padding:12px;border:1px solid #ddd;background:#fff;color:#666;border-radius:8px;font-size:15px;cursor:pointer;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确定删除';
    confirmBtn.style.cssText = 'flex:1;padding:12px;border:none;background:#ff3b30;color:#fff;border-radius:8px;font-size:15px;cursor:pointer;font-weight:500;';
    function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', handleKeyDown);
    }
    function handleKeyDown(e) {
        if (e.key === 'Escape') { close(); if (onCancel) onCancel(); }
    }
    cancelBtn.addEventListener('click', function () { close(); if (onCancel) onCancel(); });
    confirmBtn.addEventListener('click', function () { close(); if (onConfirm) onConfirm(); });
    document.addEventListener('keydown', handleKeyDown);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { close(); if (onCancel) onCancel(); } });
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    popup.appendChild(title);
    popup.appendChild(desc);
    popup.appendChild(btnRow);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    cancelBtn.focus();
}

function showDeleteFriendConfirm(friendName, friendId, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'delete-friend-title');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(2px);';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:90%;max-width:360px;box-shadow:0 10px 30px rgba(0,0,0,0.2);';

    const title = document.createElement('h3');
    title.id = 'delete-friend-title';
    title.textContent = '删除联系人';
    title.style.cssText = 'margin:0 0 12px 0;font-size:18px;font-weight:600;color:#333;text-align:center;';

    const desc = document.createElement('p');
    desc.textContent = '删除「' + (friendName || '该好友') + '」后，将从双方通讯录中移除，且无法恢复。';
    desc.style.cssText = 'margin:0 0 20px 0;font-size:15px;color:#666;line-height:1.5;text-align:center;';

    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:24px;cursor:pointer;font-size:14px;color:#333;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'width:18px;height:18px;accent-color:#ff3b30;';
    const labelText = document.createElement('span');
    labelText.textContent = '同时清空与该好友的聊天记录';
    label.appendChild(checkbox);
    label.appendChild(labelText);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'flex:1;padding:12px;border:1px solid #ddd;background:#fff;color:#666;border-radius:8px;font-size:15px;cursor:pointer;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确定删除';
    confirmBtn.style.cssText = 'flex:1;padding:12px;border:none;background:#ff3b30;color:#fff;border-radius:8px;font-size:15px;cursor:pointer;font-weight:500;';

    function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape') { close(); if (onCancel) onCancel(); }
    }

    cancelBtn.addEventListener('click', function () { close(); if (onCancel) onCancel(); });
    confirmBtn.addEventListener('click', function () {
        close();
        onConfirm(checkbox.checked);
    });

    document.addEventListener('keydown', handleKeyDown);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { close(); if (onCancel) onCancel(); } });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    popup.appendChild(title);
    popup.appendChild(desc);
    popup.appendChild(label);
    popup.appendChild(btnRow);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    cancelBtn.focus();
}

var RECALL_HINT_TTL_MS = 5 * 60 * 1000;

function removeRecallHint(messageId, isDm) {
    if (!messagesContainer) return;
    var type = isDm ? 'dm' : 'channel';
    var row = messagesContainer.querySelector('.recall-hint-row[data-recall-for="' + messageId + '"][data-message-type="' + type + '"]');
    if (row) row.remove();
}

function applyRecallToDom(messageId, isDm, recallData) {
    if (!messagesContainer) return;
    recallData = recallData || {};
    var sel = isDm
        ? '[data-message-id="' + messageId + '"][data-message-type="dm"]'
        : '[data-message-id="' + messageId + '"]:not([data-message-type="dm"])';
    var el = messagesContainer.querySelector(sel);
    if (!el) return;
    var isSelf = el.classList.contains('sent');
    var nextSibling = el.nextSibling;
    el.remove();

    var originalContent = recallData.originalContent;
    var recalledByDisplayName = recallData.recalledByDisplayName || '对方';
    var recalledAt = recallData.recalled_at;
    var hasContent = originalContent && typeof originalContent === 'string' && originalContent.trim() !== '';

    var row = document.createElement('div');
    row.className = 'recall-hint-row';
    row.setAttribute('data-recall-for', messageId);
    row.setAttribute('data-message-type', isDm ? 'dm' : 'channel');
    var notice = document.createElement('div');
    notice.className = 'recall-notice recall-notice-center';
    if (isSelf) {
        notice.innerHTML = '你撤回了一条消息 <span class="recall-reedit">重新编辑</span>';
        var reeditSpan = notice.querySelector('.recall-reedit');
        reeditSpan.addEventListener('click', function () {
            if (messageInput) {
                messageInput.value = hasContent ? originalContent : '';
                messageInput.focus();
                adjustTextareaHeight && adjustTextareaHeight();
            }
        });
    } else {
        notice.textContent = recalledByDisplayName + ' 撤回了一条消息';
    }
    row.appendChild(notice);
    messagesContainer.insertBefore(row, nextSibling);

    var delay = RECALL_HINT_TTL_MS;
    if (recalledAt) {
        var elapsed = Date.now() - new Date(recalledAt).getTime();
        delay = Math.max(0, Math.min(RECALL_HINT_TTL_MS - elapsed, RECALL_HINT_TTL_MS));
    }
    if (delay > 0) {
        setTimeout(function () { removeRecallHint(messageId, isDm); }, delay);
    }
}

function recallMessage(messageId, channel) {
    showCustomConfirm('确定要撤回这条消息吗？撤回后无法恢复。', () => {
        socket.emit('recallMessage', { messageId: Number(messageId), channel: String(channel) });
    });
}

function recallDmMessage(messageId) {
    showCustomConfirm('确定要撤回这条消息吗？撤回后无法恢复。', () => {
        socket.emit('recallDmMessage', { messageId: Number(messageId) });
    });
}

function viewImage(img) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        cursor: pointer;
    `;

    const modalImg = document.createElement('img');
    modalImg.src = img.src;
    modalImg.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        border-radius: 10px;
    `;

    modal.appendChild(modalImg);
    document.body.appendChild(modal);

    modal.onclick = () => {
        document.body.removeChild(modal);
    };
}

function updateCurrentUser(updates) {
    Object.assign(currentUser, updates);
    JchatAuth.updateStoredUser(currentUser);
}

let viewedProfileUser = null;

const PRESENCE_LABELS = {
    online: '在线',
    busy: '忙碌',
    away: '离开',
    invisible: '隐身',
    offline: '离线'
};

function renderProfilePresence(status) {
    if (!profilePresenceStatus) return;
    const normalized = Object.hasOwn(PRESENCE_LABELS, status) ? status : 'offline';
    profilePresenceStatus.dataset.status = normalized;
    const label = profilePresenceStatus.querySelector('.presence-label');
    if (label) label.textContent = PRESENCE_LABELS[normalized];
}

async function openUserProfile(userId) {
    try {
        const response = await fetch(`/api/profile/${userId}`, { headers: getAuthHeaders() });
        const user = await response.json();

        if (user) {
            viewedProfileUser = user;
            document.getElementById('profileAvatar').src = getAvatarUrl(user.avatar);

            const profileUsername = document.getElementById('profileUsername');
            if (user.username === "jiafee") {
                profileUsername.replaceChildren();
                profileUsername.append(document.createTextNode(user.nickname || user.username || '用户'));
                const badge = document.createElement('img');
                badge.src = 'images/blue.png';
                badge.className = 'user-badge';
                badge.alt = '';
                profileUsername.append(' ', badge);
            } else {
                profileUsername.textContent = user.nickname || user.username;
            }

            renderProfilePresence(user.effective_status || 'offline');

            document.getElementById('profileBio').textContent = user.bio || '该用户未设置个性签名';
            document.getElementById('profileGender').textContent = `性别: ${user.gender === 'male' ? '男' : user.gender === 'female' ? '女' : '其他'}`;
            document.getElementById('profileEmail').textContent = `邮箱: ${user.email || '该用户未设置邮箱'}`;
            document.getElementById('profileJoined').textContent = `加入时间: ${formatDate(user.created_at)}`;

            var area = document.getElementById('profileAddFriendArea');
            var btn = document.getElementById('profileAddFriendBtn');
            var hint = document.getElementById('profileAddFriendHint');
            if (area && btn && hint) {
                area.style.display = 'none';
                hint.style.display = 'none';
                btn.style.display = '';
                btn.disabled = false;
                btn.textContent = '添加好友';
                var isSelf = currentUser && parseInt(user.id) === parseInt(currentUser.id);
                if (isSelf) {
                    area.style.display = 'none';
                } else {
                    area.style.display = 'block';
                    var allowAdd = user.allow_add_friend_from_profile === true || user.allow_add_friend_from_profile === 'true';
                    if (!allowAdd) {
                        area.style.display = 'none';
                    } else {
                        var isFriend = (friendsCache || []).some(function (f) { return parseInt(f.id) === parseInt(user.id); });
                        if (isFriend) {
                            btn.style.display = 'none';
                            hint.style.display = 'block';
                            hint.textContent = '已是好友';
                        } else {
                            hint.style.display = 'none';
                        }
                    }
                }
            } else {
                if (area) area.style.display = 'none';
            }

            document.getElementById('userProfileModal').classList.add('show');
        }
    } catch (error) {
        console.error('获取用户资料失败:', error);
    }
}

function closeUserProfile() {
    document.getElementById('userProfileModal').classList.remove('show');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function adjustTextareaHeight(textarea = null) {
    const targetTextarea = textarea || messageInput;
    targetTextarea.style.height = 'auto';
    targetTextarea.style.height = Math.min(targetTextarea.scrollHeight, 150) + 'px';
}

messageInput.addEventListener('input', () => adjustTextareaHeight(messageInput));

if (settingsBio) {
    settingsBio.addEventListener('input', () => adjustTextareaHeight(settingsBio));
}

imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        await uploadImage(file);
        imageUpload.value = '';
    }
});

adjustTextareaHeight();

messagesContainer.addEventListener('click', (e) => {
    const collectButton = e.target.closest('.sticker-collect-btn');
    if (collectButton) {
        collectSticker(collectButton.dataset.stickerSrc || collectButton.closest('.message')?.querySelector('.message-image')?.src);
    } else if (e.target.classList.contains('recall-btn')) {
        const messageId = parseInt(e.target.dataset.messageId);
        const channel = e.target.dataset.channel;
        if (channel === '__dm__' || e.target.closest('[data-message-type="dm"]')) {
            recallDmMessage(messageId);
        } else {
            recallMessage(messageId, channel);
        }
    } else if (e.target.classList.contains('reply-btn')) {
        const messageId = parseInt(e.target.dataset.messageId);
        replyToMessage(messageId);
    }
});

var messageContextMenu = null;
function closeMessageContextMenu() {
    if (messageContextMenu && messageContextMenu.parentNode) {
        messageContextMenu.parentNode.removeChild(messageContextMenu);
        messageContextMenu = null;
    }
    document.removeEventListener('click', closeMessageContextMenu);
    document.removeEventListener('scroll', closeMessageContextMenu, true);
}

function positionMessageContextMenu(row, bubble, menuRect, viewport) {
    var refRect = bubble ? bubble.getBoundingClientRect() : row.getBoundingClientRect();
    var gap = 8;
    var isSent = row.classList.contains('sent');
    var preferredSide = isSent ? 'left' : 'right';
    var top = refRect.top + (refRect.height - menuRect.height) / 2;
    var left = preferredSide === 'left'
        ? refRect.left - menuRect.width - gap
        : refRect.right + gap;

    if (left < gap || left + menuRect.width > viewport.width - gap) {
        left = refRect.left + (refRect.width - menuRect.width) / 2;
        top = refRect.top - menuRect.height - gap;
    }
    if (top < gap) top = Math.min(viewport.height - menuRect.height - gap, refRect.bottom + gap);
    left = Math.max(gap, Math.min(left, viewport.width - menuRect.width - gap));
    top = Math.max(gap, Math.min(top, viewport.height - menuRect.height - gap));

    return { left: left, top: top };
}

messagesContainer.addEventListener('contextmenu', (e) => {
    var row = e.target.closest('.message');
    if (!row) return;
    var messageId = row.getAttribute('data-message-id');
    if (!messageId) return;
    messageId = parseInt(messageId, 10);
    if (isNaN(messageId)) return;
    e.preventDefault();
    closeMessageContextMenu();
    var isDm = row.getAttribute('data-message-type') === 'dm';
    var recallBtn = row.querySelector('.recall-btn');
    var canRecall = !!recallBtn;
    var channel = isDm ? '__dm__' : (recallBtn ? (recallBtn.getAttribute('data-channel') || currentChannel) : currentChannel);

    messageContextMenu = document.createElement('div');
    messageContextMenu.className = 'message-context-menu message-context-menu-bar';
    messageContextMenu.innerHTML = '<div class="message-context-menu-item" data-action="reply">回复</div>' +
        (canRecall ? '<div class="message-context-menu-item" data-action="recall">撤回</div>' : '');
    document.body.appendChild(messageContextMenu);
    var barRect = messageContextMenu.getBoundingClientRect();
    var bubble = row.querySelector('.message-text, .message-image, .message-voice');
    var position = positionMessageContextMenu(row, bubble, barRect, {
        width: window.innerWidth,
        height: window.innerHeight
    });
    messageContextMenu.style.left = position.left + 'px';
    messageContextMenu.style.top = position.top + 'px';

    messageContextMenu.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var item = ev.target.closest('.message-context-menu-item');
        if (!item) return;
        var action = item.getAttribute('data-action');
        closeMessageContextMenu();
        if (action === 'reply') replyToMessage(messageId);
        else if (action === 'recall') {
            if (isDm) recallDmMessage(messageId); else recallMessage(messageId, channel);
        }
    });
    document.addEventListener('click', closeMessageContextMenu);
    document.addEventListener('scroll', closeMessageContextMenu, true);
});

messageInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            await uploadImage(file);
        }
    }

    setTimeout(adjustTextareaHeight, 0);
});

function showPasswordPrompt(channelName, channelId, onSuccess) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
        backdrop-filter: blur(2px);
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        width: 90%;
        max-width: 400px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        animation: popupFadeIn 0.3s ease;
    `;

    const title = document.createElement('h3');
    title.textContent = `进入 ${channelName}`;
    title.style.cssText = `
        font-size: 18px;
        color: #333;
        margin: 0 0 16px 0;
        text-align: center;
    `;

    const messageText = document.createElement('p');
    messageText.textContent = '该频道需要密码才能进入，请输入密码：';
    messageText.style.cssText = `
        font-size: 14px;
        color: #666;
        margin: 0 0 20px 0;
        line-height: 1.5;
        text-align: center;
    `;

    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.placeholder = '请输入频道密码';
    passwordInput.style.cssText = `
        width: 100%;
        padding: 12px;
        border: 1px solid #ccc;
        border-radius: 8px;
        font-size: 16px;
        margin-bottom: 16px;
        box-sizing: border-box;
    `;

    const errorMessage = document.createElement('div');
    errorMessage.style.cssText = `
        color: #ff3b30;
        font-size: 14px;
        margin-bottom: 16px;
        text-align: center;
        min-height: 20px;
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
        gap: 12px;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = `
        flex: 1;
        padding: 10px 16px;
        border: 1px solid #ccc;
        background: white;
        color: #666;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s ease;
    `;

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '进入频道';
    confirmBtn.style.cssText = `
        flex: 1;
        padding: 10px 16px;
        border: none;
        background: #0071e3;
        color: white;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.3s ease;
    `;

    cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = '#f2f2f7';
    });

    cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = 'white';
    });

    confirmBtn.addEventListener('mouseenter', () => {
        confirmBtn.style.background = '#0057b7';
        confirmBtn.style.transform = 'translateY(-1px)';
        confirmBtn.style.boxShadow = '0 4px 12px rgba(0, 113, 227, 0.4)';
    });

    confirmBtn.addEventListener('mouseleave', () => {
        confirmBtn.style.background = '#0071e3';
        confirmBtn.style.transform = 'translateY(0)';
        confirmBtn.style.boxShadow = 'none';
    });

    async function verifyPassword() {
        const password = passwordInput.value.trim();
        if (!password) {
            errorMessage.textContent = '请输入密码';
            return;
        }

        try {
            const response = await fetch('/api/channel/verify-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channel: channelId,
                    password: password,
                    userId: currentUser.id
                })
            });

            const data = await response.json();

            if (data.success) {
                document.body.removeChild(overlay);
                if (onSuccess) onSuccess();
            } else {
                errorMessage.textContent = '密码错误，请重试';
            }
        } catch (error) {
            errorMessage.textContent = '验证失败，请稍后重试';
        }
    }

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    confirmBtn.addEventListener('click', verifyPassword);

    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            verifyPassword();
        }
    });

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(overlay);
        }
    };

    overlay.addEventListener('keydown', handleKeyDown);
    passwordInput.focus();

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    popup.appendChild(title);
    popup.appendChild(messageText);
    popup.appendChild(passwordInput);
    popup.appendChild(errorMessage);
    popup.appendChild(buttonContainer);
    overlay.appendChild(popup);

    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.textContent = `
        @keyframes popupFadeIn {
            from {
                opacity: 0;
                transform: scale(0.9) translateY(-20px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }
    `;
    document.head.appendChild(style);

    setTimeout(() => {
        document.head.removeChild(style);
    }, 300);
}

async function checkChannelAccess(channel) {
    try {
        const response = await fetch(`/api/channel/${channel}/access/${currentUser.id}`);
        const data = await response.json();
        return data.hasAccess;
    } catch (error) {
        return false;
    }
}

function handleChannelItemClick(e) {
    const item = e.target.closest('.channel-item');
    if (!item) return;
    switchChannel(item);
}
document.addEventListener('click', function (e) {
    if (e.target.closest('.channel-item')) handleChannelItemClick(e);
});

function switchChannel(item) {
    const activeChannel = document.querySelector('.channel-item.active');
    if (activeChannel) {
        activeChannel.classList.remove('active');
    }

    item.classList.add('active');

    currentChannel = item.dataset.channel;

    if (currentChannelAvatar) currentChannelAvatar.style.display = 'none';
    if (currentChannelIcon) { currentChannelIcon.style.display = ''; currentChannelIcon.innerHTML = jchatIcon('channel'); }
    currentChannelName.textContent = item.querySelector('.channel-name').textContent;

    socket.emit('authenticate', JchatAuth.getAuthToken());
    socket.emit('joinChannel', currentChannel);

    messagesContainer.innerHTML = '';

    const messageInputContainer = document.querySelector('.message-input-container');

    messageInputContainer.style.display = 'flex';

    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && chatContainerEl) {
        chatContainerEl.classList.add('mobile-has-selection');
    }

    loadMessages(currentChannel);

    updateChannelMenuBtnVisibility();
}

function formatLockUntil(iso) {
    if (!iso) return '';
    try {
        var d = new Date(iso);
        return d.toLocaleString('zh-CN');
    } catch (e) { return ''; }
}

async function loadDeactivationRequestStatus() {
    if (!deactivationRequestStatus || !deactivationRequestBtn) return;
    try {
        const res = await fetch('/api/account/deactivation-request', { headers: getAuthHeaders() });
        const data = await res.json().catch(function () { return {}; });
        const request = data.request || null;
        const lockUntil = data.lock_until || null;
        deactivationRequestStatus.style.display = 'none';
        deactivationRequestStatus.className = 'deactivation-status';
        deactivationRequestStatus.textContent = '';
        if (lockUntil) {
            deactivationRequestStatus.textContent = '您今日申请次数已用尽，请于 ' + formatLockUntil(lockUntil) + ' 后再试。';
            deactivationRequestStatus.style.display = 'block';
            deactivationRequestBtn.disabled = true;
            return;
        }
        if (request) {
            if (request.status === 'pending') {
                deactivationRequestStatus.textContent = '您的注销申请正在审核中，请等待管理员处理。';
                deactivationRequestStatus.style.display = 'block';
                deactivationRequestBtn.disabled = true;
            } else if (request.status === 'approved') {
                deactivationRequestStatus.textContent = '您的注销申请已通过，账号已注销。';
                deactivationRequestStatus.style.display = 'block';
                deactivationRequestStatus.classList.add('deactivation-status-done');
                deactivationRequestBtn.disabled = true;
            } else if (request.status === 'rejected') {
                deactivationRequestStatus.textContent = '您的注销申请已被拒绝，可重新申请。';
                deactivationRequestStatus.style.display = 'block';
                deactivationRequestStatus.classList.add('deactivation-status-done');
                deactivationRequestBtn.disabled = false;
            }
        } else {
            deactivationRequestStatus.textContent = '';
            deactivationRequestBtn.disabled = false;
        }
    } catch (e) {
        deactivationRequestStatus.style.display = 'none';
        deactivationRequestStatus.textContent = '';
        deactivationRequestBtn.disabled = false;
    }
}

settingsBtn.addEventListener('click', () => openSettingsCard(settingsBtn));

if (closeSettings) {
    closeSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFloatingPanel(settingsPanel);
    });
}

window.addEventListener('click', (e) => {
    if (e.target === settingsPanel) {
        settingsPanel.classList.remove('open');
    }
    if (channelMenuPanel && e.target === channelMenuPanel) {
        channelMenuPanel.classList.remove('open');
    }

    const profileModal = document.getElementById('userProfileModal');
    if (e.target === profileModal) {
        closeUserProfile();
    }

});

const closeProfileModal = document.getElementById('closeProfileModal');
if (closeProfileModal) {
    closeProfileModal.addEventListener('click', closeUserProfile);
}

var profileAddFriendBtn = document.getElementById('profileAddFriendBtn');
if (profileAddFriendBtn) {
    profileAddFriendBtn.addEventListener('click', function () {
        if (!viewedProfileUser || !currentUser) return;
        openFriendModalUI({
            to: String(viewedProfileUser.id),
            displayName: viewedProfileUser.nickname || viewedProfileUser.username
        });
    });
}

var settingsAllowAddFriendFromProfileEl = document.getElementById('settingsAllowAddFriendFromProfile');
if (settingsAllowAddFriendFromProfileEl) {
    settingsAllowAddFriendFromProfileEl.addEventListener('change', async function () {
        var el = this;
        var checked = el.checked;
        try {
            var res = await fetch('/api/profile/' + currentUser.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ allow_add_friend_from_profile: checked })
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.ok) {
                updateCurrentUser({ allow_add_friend_from_profile: checked });
            } else {
                el.checked = !checked;
                showNotification(data.error || '保存失败', 'error');
            }
        } catch (e) {
            el.checked = !checked;
            showNotification(e.message || '网络错误', 'error');
        }
    });
}

if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', () => {
        closeFloatingPanel(settingsPanel);
        passwordChangePanel.classList.add('open');
    });
}

function closePasswordChangePanel() {
    passwordChangePanel.classList.remove('open');
    openSettingsCard(settingsBtn);
}

if (closePasswordPanel) {
    closePasswordPanel.addEventListener('click', (e) => {
        e.stopPropagation();
        closePasswordChangePanel();
    });
}

if (cancelPasswordChange) {
    cancelPasswordChange.addEventListener('click', () => {
        closePasswordChangePanel();
    });
}

async function loadBlacklistList() {
    if (!blacklistList || !blacklistListEmpty) return;
    blacklistList.innerHTML = '';
    blacklistListEmpty.hidden = true;
    try {
        var data = await apiRequest('/api/block/list');
        var users = (data && data.users) || [];
        if (users.length === 0) {
            blacklistListEmpty.hidden = false;
            return;
        }
        users.forEach(function (u) {
            var row = document.createElement('div');
            row.className = 'friend-item blacklist-item';
            row.dataset.blockedId = safeMessageId(u.id);
            row.innerHTML = '<img class="friend-avatar" src="' + escapeAttribute(getAvatarUrl(u.avatar)) + '" alt="avatar"><span class="friend-name">' + escapeHtml(u.nickname || u.username) + '</span><button type="button" class="btn-unblock btn-secondary">解除拉黑</button>';
            blacklistList.appendChild(row);
        });
        blacklistList.querySelectorAll('.btn-unblock').forEach(function (btn) {
            btn.addEventListener('click', async function (e) {
                e.stopPropagation();
                var id = e.target.closest('[data-blocked-id]').dataset.blockedId;
                try {
                    await apiRequest('/api/block/' + id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                    showNotification('已解除拉黑', 'success');
                    loadBlacklistList();
                } catch (err) {
                    showNotification(err.message || '操作失败', 'error');
                }
            });
        });
    } catch (e) {
        blacklistListEmpty.hidden = false;
        showNotification(e.message || '加载黑名单失败', 'error');
    }
}

function closeBlacklistPanel() {
    if (blacklistPanel) blacklistPanel.classList.remove('open');
    openSettingsCard(settingsBtn);
}

if (blacklistListBtn && blacklistPanel) {
    blacklistListBtn.addEventListener('click', function () {
        closeFloatingPanel(settingsPanel);
        if (blacklistPanel) blacklistPanel.classList.add('open');
        loadBlacklistList();
    });
}
if (closeBlacklistPanelBtn) {
    closeBlacklistPanelBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeBlacklistPanel();
    });
}

function closeDeactivationRequestModalFn() {
    if (deactivationRequestModal) deactivationRequestModal.classList.remove('show');
    if (deactivationReason) deactivationReason.value = '';
    if (deactivationReasonCount) deactivationReasonCount.textContent = '0 / 200';
}
if (deactivationRequestBtn) {
    deactivationRequestBtn.addEventListener('click', function () {
        if (deactivationRequestModal) deactivationRequestModal.classList.add('show');
        if (deactivationReason) deactivationReason.value = '';
        if (deactivationReasonCount) deactivationReasonCount.textContent = '0 / 200';
    });
}
if (deactivationReason && deactivationReasonCount) {
    deactivationReason.addEventListener('input', function () {
        var len = (deactivationReason.value || '').length;
        deactivationReasonCount.textContent = len + ' / 200';
    });
}
if (closeDeactivationRequestModal) closeDeactivationRequestModal.addEventListener('click', closeDeactivationRequestModalFn);
if (cancelDeactivationRequest) cancelDeactivationRequest.addEventListener('click', closeDeactivationRequestModalFn);
if (submitDeactivationRequest && deactivationReason) {
    submitDeactivationRequest.addEventListener('click', async function () {
        var reason = (deactivationReason.value || '').trim();
        if (!reason) {
            showNotification('请填写注销理由', 'error');
            return;
        }
        if (reason.length > 200) {
            showNotification('注销理由最多 200 字', 'error');
            return;
        }
        submitDeactivationRequest.disabled = true;
        try {
            var res = await fetch('/api/account/deactivation-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ reason: reason })
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.ok && data.success) {
                showNotification('注销申请已提交，请等待管理员审核', 'success');
                closeDeactivationRequestModalFn();
                loadDeactivationRequestStatus();
            } else {
                showNotification(data.error || '提交失败', 'error');
                if (res.status === 429) loadDeactivationRequestStatus();
            }
        } catch (e) {
            showNotification(e.message || '网络错误', 'error');
        }
        submitDeactivationRequest.disabled = false;
    });
}

function openChannelMenu(trigger = channelMenuBtn) {
    if (!channelMenuPanel) return;
    if (viewMode === 'channel') {
        channelMenuTitle.textContent = currentChannel ? (document.querySelector('.channel-item[data-channel="' + currentChannel + '"]')?.querySelector('.channel-name')?.textContent || currentChannel) : '聊天设置';
        if (channelMuteSwitch) {
            channelMuteSwitch.checked = Array.isArray(notificationSettings.mutedChannels) && notificationSettings.mutedChannels.includes(currentChannel);
        }
    } else {
        channelMenuTitle.textContent = currentDmPeer ? (currentDmPeer.nickname || currentDmPeer.username || '私聊') : '聊天设置';
        if (channelMuteSwitch) {
            var key = getDmKey(currentDmPeer ? currentDmPeer.id : '');
            channelMuteSwitch.checked = Array.isArray(notificationSettings.mutedDms) && notificationSettings.mutedDms.includes(key);
        }
    }
    if (channelClearHistoryBtn) {
        channelClearHistoryBtn.disabled = !currentChannel && !(currentDmPeer && currentDmPeer.id);
    }
    if (channelMenuDeleteFriendRow) {
        channelMenuDeleteFriendRow.style.display = (viewMode === 'dm' && currentDmPeer && currentDmPeer.id) ? '' : 'none';
    }
    if (channelMenuBlockRow) {
        channelMenuBlockRow.style.display = (viewMode === 'dm' && currentDmPeer && currentDmPeer.id && !(currentDmPeer && currentDmPeer._stale)) ? '' : 'none';
    }
    if (viewMode === 'dm' && currentDmPeer && currentDmPeer.id && channelBlockBtn) {
        fetch('/api/block/list', { headers: getAuthHeaders() })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var blockedIds = (data && data.blockedIds) || [];
                var isBlocked = blockedIds.some(function (id) { return parseInt(id) === parseInt(currentDmPeer.id); });
                channelBlockBtn.textContent = isBlocked ? '移出黑名单' : '加入黑名单';
            })
            .catch(function () { channelBlockBtn.textContent = '加入黑名单'; });
    }
    openPanelAsFloatingCard(channelMenuPanel, trigger, viewMode === 'channel' ? '频道详情' : '聊天详情', 'jc-channel-detail-card jc-profile-surface');
}

function closeChannelMenuPanel() {
    closeFloatingPanel(channelMenuPanel);
}

if (channelMenuBtn) {
    channelMenuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openChannelMenu();
    });
}
if (closeChannelMenu) {
    closeChannelMenu.addEventListener('click', function (e) {
        e.stopPropagation();
        closeChannelMenuPanel();
    });
}
if (channelMuteSwitch) {
    channelMuteSwitch.addEventListener('change', function () {
        if (viewMode === 'channel' && currentChannel) {
            var list = notificationSettings.mutedChannels || [];
            if (channelMuteSwitch.checked) {
                if (!list.includes(currentChannel)) list.push(currentChannel);
            } else {
                list = list.filter(function (c) { return c !== currentChannel; });
            }
            notificationSettings.mutedChannels = list;
        } else if (viewMode === 'dm' && currentDmPeer && currentDmPeer.id) {
            var key = getDmKey(currentDmPeer.id);
            var dmList = notificationSettings.mutedDms || [];
            if (channelMuteSwitch.checked) {
                if (!dmList.includes(key)) dmList.push(key);
            } else {
                dmList = dmList.filter(function (k) { return k !== key; });
            }
            notificationSettings.mutedDms = dmList;
        }
        saveNotificationSettings();
    });
}
var CLEAR_SYNC_PREFIX = 'jchat_clear_';
var pendingClearQueue = [];

function clearChannelHistoryThenSync(channel) {
    if (!channel || !currentUser || !currentUser.id) return;
    messagesContainer.innerHTML = '';
    try {
        localStorage.removeItem(CLEAR_SYNC_PREFIX + 'channel_' + channel);
        localStorage.setItem(CLEAR_SYNC_PREFIX + 'channel_' + channel, Date.now().toString());
    } catch (e) {}
    fetch('/api/channel/' + encodeURIComponent(channel) + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data && data.success) return;
            pendingClearQueue.push({ type: 'channel', id: channel });
            if (!window._clearRetryTimer) window._clearRetryTimer = setInterval(retryPendingClear, 5000);
        })
        .catch(function () {
            pendingClearQueue.push({ type: 'channel', id: channel });
            if (!window._clearRetryTimer) window._clearRetryTimer = setInterval(retryPendingClear, 5000);
        });
}

function clearDmHistoryThenSync(peerUserId) {
    if (!peerUserId || !currentUser || !currentUser.id) return;
    messagesContainer.innerHTML = '';
    var dmKey = getDmKey(peerUserId);
    try {
        localStorage.removeItem(CLEAR_SYNC_PREFIX + 'dm_' + dmKey);
        localStorage.setItem(CLEAR_SYNC_PREFIX + 'dm_' + dmKey, Date.now().toString());
    } catch (e) {}
    fetch('/api/dm/' + encodeURIComponent(peerUserId) + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data && data.success) return;
            pendingClearQueue.push({ type: 'dm', id: String(peerUserId) });
            if (!window._clearRetryTimer) window._clearRetryTimer = setInterval(retryPendingClear, 5000);
        })
        .catch(function () {
            pendingClearQueue.push({ type: 'dm', id: String(peerUserId) });
            if (!window._clearRetryTimer) window._clearRetryTimer = setInterval(retryPendingClear, 5000);
        });
}

function retryPendingClear() {
    if (pendingClearQueue.length === 0) {
        if (window._clearRetryTimer) clearInterval(window._clearRetryTimer);
        window._clearRetryTimer = null;
        return;
    }
    var item = pendingClearQueue.shift();
    if (item.type === 'channel') {
        fetch('/api/channel/' + encodeURIComponent(item.id) + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (!(data && data.success)) pendingClearQueue.push(item); })
            .catch(function () { pendingClearQueue.push(item); });
    } else {
        fetch('/api/dm/' + encodeURIComponent(item.id) + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (!(data && data.success)) pendingClearQueue.push(item); })
            .catch(function () { pendingClearQueue.push(item); });
    }
}

window.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf(CLEAR_SYNC_PREFIX) !== 0) return;
    if (viewMode === 'channel' && currentChannel && e.key === CLEAR_SYNC_PREFIX + 'channel_' + currentChannel) {
        messagesContainer.innerHTML = '';
    }
    if (viewMode === 'dm' && currentDmPeer && currentDmPeer.id) {
        var dmKey = getDmKey(currentDmPeer.id);
        if (e.key === CLEAR_SYNC_PREFIX + 'dm_' + dmKey) messagesContainer.innerHTML = '';
    }
});

if (channelClearHistoryBtn) {
    channelClearHistoryBtn.addEventListener('click', function () {
        if (viewMode === 'channel' && currentChannel) {
            showCustomConfirm('确定要清空当前聊天记录吗？清空后刷新、切频道、多标签均不会恢复。', function () {
                clearChannelHistoryThenSync(currentChannel);
                closeChannelMenuPanel();
                showNotification('已清空', 'success');
            });
        } else if (viewMode === 'dm' && currentDmPeer && currentDmPeer.id) {
            showCustomConfirm('确定要清空当前聊天记录吗？清空后刷新、切频道、多标签均不会恢复。', function () {
                clearDmHistoryThenSync(currentDmPeer.id);
                closeChannelMenuPanel();
                showNotification('已清空', 'success');
            });
        }
    });
}
if (channelBlockBtn) {
    channelBlockBtn.addEventListener('click', async function () {
        if (viewMode !== 'dm' || !currentDmPeer || !currentDmPeer.id) return;
        var peerId = currentDmPeer.id;
        var isBlockedNow = channelBlockBtn.textContent === '移出黑名单';
        try {
            if (isBlockedNow) {
                await apiRequest('/api/block/' + peerId, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                showNotification('已移出黑名单', 'success');
                channelBlockBtn.textContent = '加入黑名单';
            } else {
                await apiRequest('/api/block/' + peerId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                showNotification('已加入黑名单', 'success');
                channelBlockBtn.textContent = '移出黑名单';
            }
            closeChannelMenuPanel();
        } catch (e) {
            showNotification(e.message || '操作失败', 'error');
        }
    });
}
if (channelDeleteFriendBtn) {
    channelDeleteFriendBtn.addEventListener('click', function () {
        if (viewMode !== 'dm' || !currentDmPeer || !currentDmPeer.id) return;
        var name = currentDmPeer.nickname || currentDmPeer.username || '该好友';
        var fid = currentDmPeer.id;
        showDeleteFriendConfirm(name, fid, async function (clearChatToo) {
            try {
                if (clearChatToo) {
                    var clearRes = await fetch('/api/dm/' + encodeURIComponent(fid) + '/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({}) });
                    var clearData = await clearRes.json().catch(function () { return {}; });
                    if (clearData && clearData.success) {
                        messagesContainer.innerHTML = '';
                        var dmKey = getDmKey(fid);
                        try {
                            localStorage.removeItem(CLEAR_SYNC_PREFIX + 'dm_' + dmKey);
                            localStorage.setItem(CLEAR_SYNC_PREFIX + 'dm_' + dmKey, Date.now().toString());
                        } catch (err) {}
                    }
                }
                await apiRequest('/api/friends/' + fid, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id }) });
                removeFriendFromLocalState(fid);
                currentDmPeer = null;
                closeChannelMenuPanel();
                await refreshFriendsAndRequests();
                ensureDmEmptyState();
                showNotification('已删除联系人', 'success');
            } catch (e) {
                showNotification(e.message || '删除失败', 'error');
            }
        });
    });
}

window.addEventListener('click', (e) => {
    if (e.target === passwordChangePanel) closePasswordChangePanel();
    if (blacklistPanel && e.target === blacklistPanel) closeBlacklistPanel();
    if (deactivationRequestModal && e.target === deactivationRequestModal) closeDeactivationRequestModalFn();
});

if (passwordChangeForm) {
    passwordChangeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const currentPass = currentPassword.value.trim();
        const newPass = newPassword.value.trim();
        const confirmPass = confirmPassword.value.trim();

        if (!currentPass) {
            showNotification('请输入当前密码', 'error');
            return;
        }

        if (!newPass) {
            showNotification('请输入新密码', 'error');
            return;
        }
        if (newPass.length < 8) {
            showNotification('新密码至少 8 位', 'error');
            return;
        }
        if (!/[a-zA-Z]/.test(newPass)) {
            showNotification('新密码须包含字母', 'error');
            return;
        }
        if (!/[0-9]/.test(newPass)) {
            showNotification('新密码须包含数字', 'error');
            return;
        }

        if (newPass !== confirmPass) {
            showNotification('新密码和确认密码不一致', 'error');
            return;
        }

        showCustomConfirm('确定要更改密码吗？', async () => {
            try {
                const response = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${JchatAuth.getAuthToken()}`
                    },
                    body: JSON.stringify({
                        currentPassword: currentPass,
                        newPassword: newPass
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    showNotification('密码更改成功', 'success');

                    passwordChangeForm.reset();

                    closePasswordChangePanel();
                } else {
                    showNotification(data.error || data.message || '密码更改失败，请检查当前密码是否正确', 'error');
                }
            } catch (error) {
                console.error('密码更改失败:', error);
                showNotification('网络错误，请稍后重试', 'error');
            }
        });
    });
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch (_) {
    } finally {
        clearLoginAndRedirect();
    }
}

if (mobileBackBtn) {
    mobileBackBtn.addEventListener('click', function () {
        if (!window.matchMedia || !window.matchMedia('(max-width: 768px)').matches || !chatContainerEl) return;
        if (!chatContainerEl.classList.contains('mobile-has-selection')) return;
        chatContainerEl.classList.remove('mobile-has-selection');
        var messageInputContainer = document.querySelector('.message-input-container');
        if (messageInputContainer) messageInputContainer.style.display = 'none';
        currentChannel = null;
        currentDmPeer = null;
        var activeChannelItem = document.querySelector('.channel-item.active');
        if (activeChannelItem) activeChannelItem.classList.remove('active');
        document.querySelectorAll('.friend-item.active').forEach(function (el) { el.classList.remove('active'); });
        if (currentChannelAvatar) { currentChannelAvatar.style.display = 'none'; currentChannelAvatar.onclick = null; }
        if (currentChannelIcon) { currentChannelIcon.style.display = ''; currentChannelIcon.textContent = ''; }
        if (currentChannelName) currentChannelName.textContent = viewMode === 'channel' ? '请选择频道' : '请选择好友';
        updateChannelMenuBtnVisibility();
    });
}

function openMobileProfilePage() {
    if (mobileProfilePage) {
        mobileProfilePage.classList.add('open');
        mobileProfilePage.removeAttribute('aria-hidden');
    }
}
function closeMobileProfilePage() {
    if (mobileProfilePage) {
        mobileProfilePage.classList.remove('open');
        mobileProfilePage.setAttribute('aria-hidden', 'true');
    }
}

if (mobileMeBtn) {
    mobileMeBtn.addEventListener('click', function () {
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) openMobileProfilePage();
    });
}
if (mobileProfilePageClose) {
    mobileProfilePageClose.addEventListener('click', closeMobileProfilePage);
}
if (mobileProfileSettingsBtn) {
    mobileProfileSettingsBtn.addEventListener('click', function () {
        closeMobileProfilePage();
        openSettingsCard(mobileProfileSettingsBtn);
    });
}
if (mobileProfileAddFriendBtn) {
    mobileProfileAddFriendBtn.addEventListener('click', function () {
        closeMobileProfilePage();
        openFriendModalUI();
    });
}
if (mobileProfileLogoutBtn) {
    mobileProfileLogoutBtn.addEventListener('click', function () {
        closeMobileProfilePage();
        showCustomConfirm('确定要退出登录吗？', function () { logout(); });
    });
}
if (mobileProfilePage) {
    mobileProfilePage.addEventListener('click', function (e) {
        if (e.target === mobileProfilePage) closeMobileProfilePage();
    });
}

logoutBtn.addEventListener('click', () => {
    showCustomConfirm('确定要退出登录吗？', () => {
        logout();
    });
});

avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            avatarPreview.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

saveSettings.addEventListener('click', async () => {
    const bio = settingsBio.value.trim();
    const gender = settingsGender.value;
    const email = settingsEmail.value.trim() || null;
    const nickname = settingsNickname.value.trim();
    const presence_status = settingsPresenceStatus ? settingsPresenceStatus.value : 'online';
    const settingsAllowAddFriendFromProfileEl = document.getElementById('settingsAllowAddFriendFromProfile');
    const allow_add_friend_from_profile = settingsAllowAddFriendFromProfileEl ? settingsAllowAddFriendFromProfileEl.checked : true;

    const avatarFile = avatarInput.files[0];
    let avatarUrl = currentUser.avatar;

    if (avatarFile) {
        const formData = new FormData();
        formData.append('avatar', avatarFile);

        try {
            const response = await fetch('/api/upload/avatar', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData
            });

            const data = await response.json().catch(() => ({}));
            if (data.success) {
                avatarUrl = data.avatar;
            } else {
                showNotification(data.error || '头像上传失败', 'error');
            }
        } catch (error) {
            console.error('上传头像失败:', error);
            showNotification(error.message || '上传头像失败', 'error');
        }
    }

    try {
        const response = await fetch(`/api/profile/${currentUser.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ bio, gender, email, nickname, presence_status, allow_add_friend_from_profile })
        });

        if (response.ok) {
            updateCurrentUser({ bio, gender, email, nickname, avatar: avatarUrl, presence_status, allow_add_friend_from_profile });
            updateUserInfo();

            const saveMsg = document.createElement('div');
            saveMsg.textContent = '设置已保存';
            saveMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #34c759;
                color: white;
                padding: 12px 20px;
                border-radius: 10px;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(52, 199, 89, 0.3);
                z-index: 10000;
            `;
            document.body.appendChild(saveMsg);

            setTimeout(() => {
                document.body.removeChild(saveMsg);
            }, 2000);
        }
    } catch (error) {
        console.error('保存设置失败:', error);
    }
});

socket.on('messageReceived', (message) => {
    console.log('=== messageReceived 事件被触发 ===');
    console.log('当前时间:', new Date().toISOString());
    console.log('收到的消息:', JSON.stringify(message));
    console.log('当前频道:', currentChannel);
    console.log('是否为当前频道:', message.channel === currentChannel);

    if (message.is_blocked) {
        console.log('消息包含屏蔽词，准备存储到本地');
        if (parseInt(message.user_id) === parseInt(currentUser.id)) {
            saveBlockedMessage(message);
        }
    }

    if (message.channel === currentChannel) {
        console.log('消息在当前频道，添加到DOM');
        addMessageToDOM(message);

        setTimeout(reinitAudioPlayers, 100);
    } else {
        console.log('消息不在当前频道，检查是否需要通知');
    }

    const shouldNotify = message.channel !== currentChannel && notificationSettings.selectedChannels.includes(message.channel);
    const channelMuted = Array.isArray(notificationSettings.mutedChannels) && notificationSettings.mutedChannels.includes(message.channel);
    if (parseInt(message.user_id) !== parseInt(currentUser.id) && !channelMuted) {
        playNotificationSound();
    }

    if (shouldNotify) {
        console.log('满足浏览器通知条件，准备发送通知');
        const title = `${message.nickname || message.username} 在 ${message.channel}`;
        const content = message.content || (message.image ? '发送了一张图片' : '发送了一条消息');
        console.log('通知内容:', { title, content });

        console.log('调用 showBrowserNotification 函数');
        showBrowserNotification(title, content);
    }

    console.log('消息接收事件详情:', {
        channel: message.channel,
        currentChannel: currentChannel,
        isCurrentChannel: message.channel === currentChannel,
        isSelectedChannel: notificationSettings.selectedChannels.includes(message.channel),
        notificationSettings: { ...notificationSettings }
    });
});

socket.on('messageBlocked', (data) => {
    console.log('=== messageBlocked 事件被触发 ===');
    console.log('收到的屏蔽消息数据:', data);
});

function saveBlockedMessage(message) {
    try {
        const blockedMessagesJson = localStorage.getItem('blockedMessages');
        const blockedMessages = blockedMessagesJson ? JSON.parse(blockedMessagesJson) : [];

        const blockedMessageWithExpiry = {
            ...message,
            storedAt: new Date().toISOString()
        };

        blockedMessages.push(blockedMessageWithExpiry);

        localStorage.setItem('blockedMessages', JSON.stringify(blockedMessages));

        console.log('被屏蔽消息已存储到本地:', blockedMessageWithExpiry);

        scheduleBlockedMessageDeletion(message.id, 24 * 60 * 60 * 1000);

    } catch (error) {
        console.error('存储被屏蔽消息失败:', error);
    }
}

function scheduleBlockedMessageDeletion(messageId, delay) {
    setTimeout(() => {
        try {
            const blockedMessagesJson = localStorage.getItem('blockedMessages');
            if (!blockedMessagesJson) return;

            let blockedMessages = JSON.parse(blockedMessagesJson);

            blockedMessages = blockedMessages.filter(msg => msg.id !== messageId);

            localStorage.setItem('blockedMessages', JSON.stringify(blockedMessages));

            console.log(`被屏蔽消息 ${messageId} 已自动删除`);

        } catch (error) {
            console.error('自动删除被屏蔽消息失败:', error);
        }
    }, delay);
}

function cleanupExpiredBlockedMessages() {
    try {
        const blockedMessagesJson = localStorage.getItem('blockedMessages');
        if (!blockedMessagesJson) return;

        let blockedMessages = JSON.parse(blockedMessagesJson);
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const unexpiredMessages = blockedMessages.filter(msg => {
            if (!msg.storedAt) return false;
            const storedTime = new Date(msg.storedAt);
            return storedTime > oneDayAgo;
        });

        if (unexpiredMessages.length !== blockedMessages.length) {
            localStorage.setItem('blockedMessages', JSON.stringify(unexpiredMessages));
            console.log(`已清理 ${blockedMessages.length - unexpiredMessages.length} 条过期的被屏蔽消息`);
        }

    } catch (error) {
        console.error('清理过期被屏蔽消息失败:', error);
    }
}

cleanupExpiredBlockedMessages();

socket.on('messageRecalled', (data) => {
    if (data.channel === currentChannel) {
        applyRecallToDom(data.messageId, false, { originalContent: data.originalContent, recalledByDisplayName: data.recalledByDisplayName, recalled_at: data.recalled_at });
    }
});
socket.on('recalledMessageDeleted', (data) => {
    if (data.channel === currentChannel) {
        removeRecallHint(data.messageId, false);
    }
});

socket.on('messageDeleted', (data) => {
    if (currentChannel) {
        const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageElement) {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateY(10px)';
            messageElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

            setTimeout(() => {
                messageElement.remove();
            }, 300);
        }
    }
});

socket.on('friendRequestReceived', function (data) {
    setFriendRequestBadgeVisible(true);
    showNotification('您有一条新的好友申请', 'info', 4000);
    refreshFriendsAndRequests();
});
socket.on('friendRequestUpdated', async () => { await refreshFriendsAndRequests(); });
socket.on('friendsChanged', async () => { await refreshFriendsAndRequests(); });
socket.on('friendRemovedYou', async function (data) {
    if (data && data.user) {
        addStaleContact(data.user);
        await refreshFriendsAndRequests();
    }
});
function getDmKey(peerUserId) {
    if (!currentUser || !peerUserId) return '';
    const a = parseInt(currentUser.id, 10);
    const b = parseInt(peerUserId, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return '';
    return [a, b].sort((x, y) => x - y).join('_');
}
socket.on('privateMessageReceived', (message) => {
    const fromId = parseInt(message.from_user_id);
    const toId = parseInt(message.to_user_id);
    const myId = parseInt(currentUser.id);
    const otherId = fromId === myId ? toId : fromId;
    updateDmOrder(otherId);
    const dmKey = getDmKey(String(otherId));
    const dmMuted = Array.isArray(notificationSettings.mutedDms) && notificationSettings.mutedDms.includes(dmKey);
    const peerId = currentDmPeer ? parseInt(currentDmPeer.id) : null;
    const isCurrentConversation = peerId != null && ((fromId === myId && toId === peerId) || (fromId === peerId && toId === myId));
    const isFromOther = fromId !== myId;

    if (isFromOther && !dmMuted) {
        if (!isCurrentConversation) {
            dmUnreadCountByFriendId[String(otherId)] = (dmUnreadCountByFriendId[String(otherId)] || 0) + 1;
            var fromName = message.nickname || message.username || '好友';
            showNotification(fromName + ' 发来一条私聊消息', 'info', 4000);
            if (document.hidden) {
                showBrowserNotification(fromName + ' 发来私聊', message.content ? (message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '')) : (message.image ? '[图片]' : '[消息]'));
            }
            renderFriendsList();
        }
        playNotificationSound();
    }

    renderFriendsList();

    if (viewMode !== 'dm') return;
    if (!peerId) return;
    if (isCurrentConversation) {
        try {
            addDmMessageToDOM(message);
            setTimeout(reinitAudioPlayers, 100);
            scrollToBottom();
        } catch (err) {
            console.error('addDmMessageToDOM 错误:', err);
        }
    }
});
socket.on('dmMessageDeleted', (data) => {
    const el = document.querySelector('[data-message-id="' + data.messageId + '"][data-message-type="dm"]');
    if (el) { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'opacity 0.3s ease, transform 0.3s ease'; setTimeout(function () { el.remove(); }, 300); }
});
socket.on('recallFailed', (data) => {
    const msg = { not_found: '消息不存在', channel_mismatch: '无法撤回', not_author: '只能撤回自己的消息', time_limit: '超过 2 分钟无法撤回', update_failed: '撤回失败' }[data?.reason] || '撤回失败';
    showNotification(msg, 'error');
});
socket.on('recallDmFailed', (data) => {
    const msg = { invalid_id: '消息无效', not_found: '消息不存在', not_authenticated: '请刷新页面后重试', not_author: '只能撤回自己的消息', time_limit: '超过 2 分钟无法撤回', update_failed: '撤回失败' }[data?.reason] || '撤回失败';
    showNotification(msg, 'error');
});
socket.on('dmMessageRecalled', (data) => {
    if (data && data.messageId != null) {
        applyRecallToDom(data.messageId, true, { originalContent: data.originalContent, recalledByDisplayName: data.recalledByDisplayName, recalled_at: data.recalled_at });
    }
});
socket.on('dmRecalledMessageDeleted', (data) => {
    if (data && data.messageId != null) {
        removeRecallHint(data.messageId, true);
    }
});
socket.on('dmConversationCleared', (data) => {
    if (viewMode === 'dm' && currentDmPeer?.id && parseInt(currentDmPeer.id) === parseInt(data.peerUserId)) { messagesContainer.innerHTML = ''; ensureDmEmptyState(); }
});

function initCustomAudioPlayers() {
    document.querySelectorAll('.custom-audio-player').forEach(player => {
        const audioId = player.dataset.messageId;
        const audio = document.getElementById(`audio-${audioId}`);
        const playBtn = player.querySelector('.play-btn');
        const currentTimeDisplay = player.querySelector('.current-time');
        if (!audio || !playBtn || !currentTimeDisplay) return;

        audio.addEventListener('timeupdate', () => {
            const currentSeconds = Math.floor(audio.currentTime);
            const minutes = Math.floor(currentSeconds / 60);
            const seconds = currentSeconds % 60;
            currentTimeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        });

        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play();
                playBtn.classList.add('playing');
                playBtn.setAttribute('aria-label', '暂停语音');
                playBtn.title = '暂停语音';
            } else {
                audio.pause();
                playBtn.classList.remove('playing');
                playBtn.setAttribute('aria-label', '播放语音');
                playBtn.title = '播放语音';
            }
        });

        audio.addEventListener('ended', () => {
            playBtn.classList.remove('playing');
            playBtn.setAttribute('aria-label', '播放语音');
            playBtn.title = '播放语音';
            audio.currentTime = 0;
            currentTimeDisplay.textContent = '0:00';
        });
    });
}

function initLegacyEmojiPicker() {
    const emojis = [
        '😊', '😂', '❤️', '👍', '🔥', '🎉', '🤔', '😢',
        '😉', '😆', '😍', '👏', '🤣', '🤯', '😎', '😏',
        '😀', '😃', '😄', '😁', '😅', '😆', '😇', '🙂',
        '🙃', '😉', '😊', '😋', '😎', '😍', '😘', '🥰',
        '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪',
        '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
        '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖',
        '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡'
    ];

    emojis.forEach(emoji => {
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji;
        emojiSpan.title = emoji;
        emojiSpan.addEventListener('click', () => {
            insertEmoji(emoji);
        });
        emojiGrid.appendChild(emojiSpan);
    });

    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('show');
    });

    window.addEventListener('click', () => {
        emojiPicker.classList.remove('show');
    });

    emojiPicker.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

function insertEmoji(emoji) {
    const startPos = messageInput.selectionStart;
    const endPos = messageInput.selectionEnd;
    const textBefore = messageInput.value.substring(0, startPos);
    const textAfter = messageInput.value.substring(endPos);

    messageInput.value = textBefore + emoji + textAfter;

    messageInput.focus();
    messageInput.setSelectionRange(startPos + emoji.length, startPos + emoji.length);

    adjustTextareaHeight();

    emojiPicker.classList.remove('show');
}

const STICKER_STORAGE_KEY = 'jchat_stickers_v1';
const STICKER_PAGE_SIZE = 12;
let stickerTab = 'recent';
let stickerPageIndex = 0;
function stickerStorage() { try { return JSON.parse(localStorage.getItem(STICKER_STORAGE_KEY) || '{}'); } catch { return {}; } }
function saveSticker(sticker, bucket = 'mine') { const store = stickerStorage(); const key = String(currentUser?.id || 'guest'); store[key] ||= { mine: [], favorite: [], recent: [] }; store[key][bucket] ||= []; if (!store[key][bucket].some(item => item.src === sticker.src)) store[key][bucket].unshift({ id: sticker.id || `${Date.now()}-${Math.random()}`, src: sticker.src, name: sticker.name || '表情包' }); localStorage.setItem(STICKER_STORAGE_KEY, JSON.stringify(store)); }
function collectSticker(src) { saveSticker({ src, name: '收藏的表情包' }, 'favorite'); showNotification('已收藏表情包', 'success'); }
function renderStickerPage() { if (!stickerGrid) return; const store = stickerStorage(); const items = store[String(currentUser?.id || 'guest')]?.[stickerTab] || []; const pages = Math.max(1, Math.ceil(items.length / STICKER_PAGE_SIZE)); stickerPageIndex = Math.max(0, Math.min(stickerPageIndex, pages - 1)); stickerGrid.innerHTML = ''; if (!items.length) { const empty = document.createElement('p'); empty.className = 'sticker-empty'; empty.textContent = stickerTab === 'mine' ? '添加图片，建立你的表情包' : stickerTab === 'favorite' ? '收藏聊天里的表情包' : '最近还没有使用记录'; stickerGrid.appendChild(empty); } items.slice(stickerPageIndex * STICKER_PAGE_SIZE, (stickerPageIndex + 1) * STICKER_PAGE_SIZE).forEach(sticker => { const button = document.createElement('button'); button.type = 'button'; button.className = 'sticker-item'; button.title = sticker.name || '发送表情包'; const image = document.createElement('img'); image.src = sticker.src; image.alt = sticker.name || '表情包'; button.appendChild(image); button.addEventListener('click', () => sendSticker(sticker)); stickerGrid.appendChild(button); }); if (stickerPageLabel) stickerPageLabel.textContent = `${stickerPageIndex + 1} / ${pages}`; if (stickerPrevPage) stickerPrevPage.disabled = stickerPageIndex === 0; if (stickerNextPage) stickerNextPage.disabled = stickerPageIndex >= pages - 1; }
function emitStickerMessage(image) { if (viewMode === 'dm') { if (!currentDmPeer?.id) return showNotification('请先选择好友', 'info'); socket.emit('sendPrivateMessage', { fromUserId: currentUser.id, toUserId: currentDmPeer.id, content: null, image, voice: null, reply_to: currentReplyTo || undefined }); } else socket.emit('sendMessage', { userId: currentUser.id, channel: currentChannel, content: null, image, reply_to: currentReplyTo }); saveSticker({ src: typeof image === 'string' ? image : '', name: '最近使用' }, 'recent'); cancelReply(); }
async function sendSticker(sticker) { stickerPicker?.classList.remove('show'); if (sticker.src.startsWith('data:')) { const response = await fetch(sticker.src); const blob = await response.blob(); const form = new FormData(); form.append('image', blob, sticker.name || 'sticker.png'); const upload = await fetch('/api/upload/image', { method: 'POST', headers: getAuthHeaders(), body: form }); const data = await upload.json(); if (data.success) emitStickerMessage(data.image); } else emitStickerMessage(sticker.src); }
function initEmojiPicker() { if (!emojiBtn || !stickerPicker) return; renderStickerPage(); emojiBtn.addEventListener('click', event => { event.stopPropagation(); stickerPicker.classList.toggle('show'); renderStickerPage(); }); document.querySelectorAll('[data-sticker-tab]').forEach(tab => tab.addEventListener('click', () => { stickerTab = tab.dataset.stickerTab; stickerPageIndex = 0; document.querySelectorAll('.sticker-tab').forEach(item => item.classList.toggle('active', item === tab)); renderStickerPage(); })); stickerPrevPage?.addEventListener('click', () => { stickerPageIndex -= 1; renderStickerPage(); }); stickerNextPage?.addEventListener('click', () => { stickerPageIndex += 1; renderStickerPage(); }); stickerUpload?.addEventListener('change', event => Array.from(event.target.files || []).forEach(file => { const reader = new FileReader(); reader.onload = () => { saveSticker({ src: reader.result, name: file.name }); stickerTab = 'mine'; renderStickerPage(); }; reader.readAsDataURL(file); })); window.addEventListener('click', () => stickerPicker.classList.remove('show')); stickerPicker.addEventListener('click', event => event.stopPropagation()); }

function initCustomFooter() {
    const footerText = document.getElementById('jchatFooterText');
    if (!footerText) return;
    const key = 'jchat_footer_text_v1';
    const saved = localStorage.getItem(key);
    if (saved) footerText.textContent = saved;
    footerText.addEventListener('blur', () => {
        const value = footerText.textContent.trim().slice(0, 120);
        footerText.textContent = value || 'Jchat · 保持好奇，轻盈交流';
        localStorage.setItem(key, footerText.textContent);
    });
}

initJchatInterface();
initCustomFooter();
loadPersistedChannels();
initPage();
syncCurrentUserFromServer();
refreshFriendsAndRequests();
setViewMode('channel');
setupFriendsAndDmEventListeners();

initEmojiPicker();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomAudioPlayers);
} else {
    initCustomAudioPlayers();
}

function reinitAudioPlayers() {
    document.querySelectorAll('.play-btn').forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });
    initCustomAudioPlayers();
}

async function loadMessages(channel) {
    messagesContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #6e6e73;"><span class="loading-messages">加载消息中...</span></div>';
    try {
        const response = await fetch(`/api/messages/${encodeURIComponent(channel)}`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (!response.ok) {
            const msg = (data && data.error) ? data.error : ('加载失败 ' + response.status);
            messagesContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #ff3b30;">' + msg + '</div>';
            return;
        }

        const messages = Array.isArray(data) ? data : [];
        messagesContainer.innerHTML = '';

        messages.forEach(message => {
            if (message.is_blocked && parseInt(message.user_id) !== parseInt(currentUser.id)) {
                return;
            }
            addMessageToDOM(message);
        });

        reinitAudioPlayers();

        scrollToBottom();
    } catch (error) {
        console.error('loadMessages error', error);
        messagesContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #ff3b30;">加载消息失败</div>';
    }
}

function addDmMessageToDOM(message) {
    const senderId = message.from_user_id ?? message.user_id;
    const senderIsCurrentUser = parseInt(senderId, 10) === parseInt(currentUser?.id, 10);
    const senderFallback = senderIsCurrentUser ? currentUser : currentDmPeer;
    const mapped = {
        id: message.id,
        user_id: senderId,
        channel: '__dm__',
        content: message.content,
        image: message.image,
        voice: message.voice,
        created_at: message.created_at,
        username: message.username || message.user?.username || senderFallback?.username || '用户',
        nickname: message.nickname || message.user?.nickname || senderFallback?.nickname || senderFallback?.username || '用户',
        avatar: message.avatar || message.user?.avatar || senderFallback?.avatar,
        is_recalled: !!message.is_recalled,
        reply_info: message.reply_info || null
    };
    var isCurrentUser = parseInt(mapped.user_id) === parseInt(currentUser.id);
    if (mapped.is_recalled) {
        var row = document.createElement('div');
        row.className = 'recall-hint-row';
        row.setAttribute('data-recall-for', mapped.id);
        row.setAttribute('data-message-type', 'dm');
        var notice = document.createElement('div');
        notice.className = 'recall-notice recall-notice-center';
        var displayName = mapped.nickname || mapped.username || '用户';
        notice.textContent = isCurrentUser ? '你撤回了一条消息' : (displayName + ' 撤回了一条消息');
        row.appendChild(notice);
        messagesContainer.appendChild(row);
        return;
    }
    const messageElement = document.createElement('div');
    messageElement.className = 'message ' + (isCurrentUser ? 'sent' : 'received');
    const mappedId = safeMessageId(mapped.id);
    const mappedUserId = safeMessageId(mapped.user_id);
    messageElement.dataset.messageId = mappedId;
    messageElement.dataset.messageType = 'dm';
    var mappedTime = new Date(mapped.created_at);
    if (!Number.isNaN(mappedTime.getTime())) messageElement.dataset.messageTime = mappedTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const messageAvatar = getAvatarUrl(mapped.avatar);
    const mappedName = escapeHtml(mapped.nickname || mapped.username || '用户');
    var profileClick = mappedUserId ? ' onclick="openUserProfile(' + mappedUserId + ')"' : '';
    var html = '<div class="avatar-container"><img src="' + escapeAttribute(messageAvatar) + '" alt="Avatar" class="avatar"' + profileClick + '></div><div class="message-content"><div class="message-header"><span class="message-username">' + mappedName + '</span></div>';
    if (mapped.reply_info) {
        var rc = (mapped.reply_info.content || '图片消息').length > 30 ? (mapped.reply_info.content || '').substring(0, 30) + '...' : (mapped.reply_info.content || '图片消息');
        html += '<div class="message-reply" style="background-color: rgba(0, 113, 227, 0.05); border-left: 3px solid #0071e3; padding: 6px 10px; border-radius: 8px; margin-bottom: 6px; font-size: 13px;"><span style="font-weight: bold; color: #0071e3;">@' + escapeHtml(mapped.reply_info.nickname || mapped.reply_info.username || '用户') + '</span>: ' + escapeHtml(rc) + '</div>';
    }
    if (mapped.content) html += '<div class="message-text">' + escapeHtml(mapped.content) + '</div>';
    var mappedImageUrl = safeMediaUrl(mapped.image);
    if (mappedImageUrl && !mapped.is_recalled) html += '<img src="' + escapeAttribute(mappedImageUrl) + '" alt="Chat image" class="message-image" onclick="viewImage(this)"><button class="sticker-collect-btn" data-sticker-src="' + escapeAttribute(mappedImageUrl) + '" aria-label="收藏表情包" title="收藏表情包">' + jchatIcon('bookmark') + '</button>';
    var mappedVoiceUrl = safeMediaUrl(mapped.voice);
    if (mappedVoiceUrl && !mapped.is_recalled) {
        var audioType = mappedVoiceUrl.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm;codecs=opus';
        html += '<div class="message-voice bubble"><div class="custom-audio-player" data-message-id="' + mappedId + '"><audio id="audio-' + mappedId + '" class="voice-player" preload="metadata"><source src="' + escapeAttribute(mappedVoiceUrl) + '" type="' + audioType + '"></audio><div class="audio-controls"><button class="play-btn" data-audio-id="' + mappedId + '" aria-label="播放语音" title="播放语音"><span class="play-icon">' + jchatIcon('play') + '</span><span class="pause-icon">' + jchatIcon('pause') + '</span></button><div class="time-display"><span class="current-time">0:00</span></div></div></div></div>';
    }
    var now = new Date(), msgTime = new Date(mapped.created_at), timeDiff = (now - msgTime) / (1000 * 60);
    html += '<div class="message-actions">';
    html += '<button class="reply-btn" data-message-id="' + mappedId + '" aria-label="回复" title="回复" style="background: none; border: none; color: #0071e3; font-size: 14px; cursor: pointer; margin-top: 5px; padding: 2px 6px; border-radius: 10px; transition: all 0.3s ease; opacity: 0.7;">' + jchatIcon('edit') + '</button>';
    if (isCurrentUser && timeDiff <= 2 && !mapped.is_recalled) {
        html += '<button class="recall-btn" data-message-id="' + mappedId + '" data-channel="__dm__" aria-label="撤回" title="撤回" style="background: none; border: none; color: #ff3b30; font-size: 14px; cursor: pointer; margin-top: 5px; padding: 2px 6px; border-radius: 10px; transition: all 0.3s ease; opacity: 0.7; margin-left: 5px;">' + jchatIcon('delete') + '</button>';
    }
    html += '</div></div>';
    messageElement.innerHTML = html;
    const animateMessageEntry = prepareJchatMessageEntry(messageElement);
    messagesContainer.appendChild(messageElement);
    try {
        var content = mapped.content;
        var bvid = window.BiliRenderer && window.BiliRenderer.extractBV(content);
        if (content && !mapped.is_recalled && bvid) {
            var params = {};
            var urlMatch = content.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                try {
                    var cleanUrl = urlMatch[0].replace(/[）〉】]$/g, '');
                    var urlObj = new URL(cleanUrl);
                    urlObj.searchParams.forEach(function (v, k) {
                        var supported = ['p', 't', 'autoplay', 'danmaku', 'muted'];
                        if (supported.indexOf(k) !== -1) params[k] = isNaN(Number(v)) ? v : Number(v);
                    });
                } catch (e) { }
            }
            var contentEl = messageElement.querySelector('.message-content');
            if (contentEl) {
                var textEl = contentEl.querySelector('.message-text');
                if (textEl) {
                    var biliContainer = document.createElement('div');
                    biliContainer.className = 'bili-video';
                    biliContainer.style.marginTop = '8px';
                    var element = window.BiliRenderer.getElement(bvid, params);
                    if (element) {
                        biliContainer.appendChild(element);
                        textEl.appendChild(biliContainer);
                    }
                }
            }
        }
    } catch (e) {
        console.error('B站渲染(私聊)异常:', e);
    }
    revealJchatMessageEntry(messageElement, animateMessageEntry);
}

async function loadDmMessages(peerUserId) {
    messagesContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #6e6e73;"><span class="loading-messages">加载消息中...</span></div>';
    try {
        var data = await apiRequest('/api/dm/' + peerUserId + '/messages?userId=' + encodeURIComponent(currentUser.id));
        var messages = data.messages || [];
        messagesContainer.innerHTML = '';
        messages.forEach(function (m) { addDmMessageToDOM(m); });
        reinitAudioPlayers();
        scrollToBottom();
    } catch (e) {
        messagesContainer.innerHTML = '<div style="text-align: center; padding: 50px; color: #ff3b30;">' + (e.message || '加载消息失败') + '</div>';
    }
}

function selectDmPeerById(peerId) {
    var found = friendsCache.find(function (f) { return parseInt(f.id) === parseInt(peerId); });
    if (!found) return;
    dmUnreadCountByFriendId[String(peerId)] = 0;
    currentDmPeer = found;
    if (currentChannelAvatar) {
        currentChannelAvatar.src = getAvatarUrl(found.avatar);
        currentChannelAvatar.alt = found.nickname || found.username;
        currentChannelAvatar.style.display = '';
        currentChannelAvatar.style.cursor = 'pointer';
        currentChannelAvatar.onclick = function () { openUserProfile(found.id); };
    }
    if (currentChannelIcon) currentChannelIcon.style.display = 'none';
    currentChannelName.textContent = found.nickname || found.username;
    var messageInputContainer = document.querySelector('.message-input-container');
    if (messageInputContainer) messageInputContainer.style.display = 'flex';
    messagesContainer.innerHTML = '';
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && chatContainerEl) chatContainerEl.classList.add('mobile-has-selection');
    socket.emit('joinDmConversation', { userId: currentUser.id, peerUserId: found.id });
    loadDmMessages(found.id);
    renderFriendsList();
    updateChannelMenuBtnVisibility();
}

function selectStalePeerById(peerId) {
    var found = getStaleContacts().find(function (s) { return parseInt(s.id) === parseInt(peerId); });
    if (!found) return;
    currentDmPeer = { id: found.id, username: found.username, nickname: found.nickname, avatar: found.avatar, _stale: true };
    if (currentChannelAvatar) {
        currentChannelAvatar.src = getAvatarUrl(found.avatar);
        currentChannelAvatar.alt = found.nickname || found.username;
        currentChannelAvatar.style.display = '';
        currentChannelAvatar.style.cursor = 'default';
        currentChannelAvatar.onclick = null;
    }
    if (currentChannelIcon) currentChannelIcon.style.display = 'none';
    currentChannelName.textContent = (found.nickname || found.username) + ' (已解除)';
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && chatContainerEl) chatContainerEl.classList.add('mobile-has-selection');
    ensureDmEmptyState();
    updateChannelMenuBtnVisibility();
}

async function sendReaddRequest(staleId) {
    var stale = getStaleContacts().find(function (s) { return parseInt(s.id) === parseInt(staleId); });
    if (!stale) { showNotification('请刷新后重试', 'error'); return; }
    var to = stale.username || String(stale.id);
    try {
        await apiRequest('/api/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id, to: to }) });
        showNotification('已发送好友申请', 'success');
        await refreshFriendsAndRequests();
        if (friendsCache.some(function (f) { return parseInt(f.id) === parseInt(staleId); })) {
            setViewMode('dm');
            selectDmPeerById(staleId);
        } else {
            messagesContainer.innerHTML = '<div class="stale-dm-card"><div class="stale-dm-icon">' + jchatIcon('mail') + '</div><p class="stale-dm-text">已发送好友申请</p><p class="stale-dm-hint">等待对方同意后将自动进入聊天</p></div>';
        }
    } catch (e) {
        showNotification(e.message || '发送申请失败', 'error');
    }
}

var friendAddCurrentTo = null;

function updateFriendReasonCount() {
    var el = friendReasonCountEl;
    var input = friendReasonInput;
    if (!el || !input) return;
    var len = (input.value || '').length;
    el.textContent = len + ' / 200';
}

function showFriendAddStep1() {
    friendAddCurrentTo = null;
    if (friendAddStep1) {
        friendAddStep1.classList.add('friend-add-step-active');
        friendAddStep1.classList.remove('friend-add-step-left');
    }
    if (friendAddStep2) {
        friendAddStep2.classList.remove('friend-add-step-active');
        friendAddStep2.classList.add('friend-add-step-right');
    }
}

function showFriendAddStep2(to, displayName) {
    friendAddCurrentTo = to;
    if (friendAddStep2NameEl) friendAddStep2NameEl.textContent = displayName || to || '';
    if (friendReasonInput) { friendReasonInput.value = ''; updateFriendReasonCount(); }
    if (friendAddStep1) {
        friendAddStep1.classList.remove('friend-add-step-active');
        friendAddStep1.classList.add('friend-add-step-left');
    }
    if (friendAddStep2) {
        friendAddStep2.classList.add('friend-add-step-active');
        friendAddStep2.classList.remove('friend-add-step-right');
    }
}

function openFriendModalUI(prefill) {
    if (!friendModal) return;
    renderFriendHubFriends();
    if (friendIdentifierInput) friendIdentifierInput.value = '';
    if (friendReasonInput) { friendReasonInput.value = ''; updateFriendReasonCount(); }
    friendAddCurrentTo = null;
    if (friendAddStep1) {
        friendAddStep1.classList.add('friend-add-step-active');
        friendAddStep1.classList.remove('friend-add-step-left');
    }
    if (friendAddStep2) {
        friendAddStep2.classList.remove('friend-add-step-active');
        friendAddStep2.classList.add('friend-add-step-right');
    }
    if (prefill && (prefill.to != null || prefill.id != null)) {
        var to = prefill.to != null ? String(prefill.to) : String(prefill.id);
        var displayName = prefill.displayName || prefill.nickname || prefill.username || to;
        if (friendIdentifierInput) friendIdentifierInput.value = to;
        showFriendAddStep2(to, displayName);
    } else {
        showFriendAddStep1();
    }
    friendModal.classList.add('show');
}

function closeFriendModalUI() { if (friendModal) friendModal.classList.remove('show'); }

function setupFriendsAndDmEventListeners() {
    var LONG_PRESS_MS = 650, longPressTimer = null, longPressTriggered = false;
    function bindLongPress(containerEl, selector, onLongPress) {
        if (!containerEl) return;
        var clear = function () { if (longPressTimer) clearTimeout(longPressTimer); longPressTimer = null; };
        containerEl.addEventListener('pointerdown', function (e) {
            var target = e.target.closest && e.target.closest(selector);
            if (!target) return;
            longPressTriggered = false;
            clear();
            longPressTimer = setTimeout(function () { longPressTriggered = true; onLongPress(target); }, LONG_PRESS_MS);
        });
        containerEl.addEventListener('pointerup', clear);
        containerEl.addEventListener('pointercancel', clear);
        containerEl.addEventListener('click', function (e) { if (!longPressTriggered) return; var target = e.target.closest && e.target.closest(selector); if (target) { e.preventDefault(); e.stopPropagation(); } }, true);
    }
    if (modeChannelBtn) modeChannelBtn.addEventListener('click', function () { setViewMode('channel'); });
    if (modeDmBtn) modeDmBtn.addEventListener('click', function () { setViewMode('dm'); });
    if (modeChannelBtnMobile) modeChannelBtnMobile.addEventListener('click', function (e) { e.stopPropagation(); setViewMode('channel'); });
    if (modeDmBtnMobile) modeDmBtnMobile.addEventListener('click', function (e) { e.stopPropagation(); setViewMode('dm'); });
    if (modeChannelBtnMain) modeChannelBtnMain.addEventListener('click', function (e) { e.stopPropagation(); setViewMode('channel'); });
    if (modeDmBtnMain) modeDmBtnMain.addEventListener('click', function (e) { e.stopPropagation(); setViewMode('dm'); });
    if (addFriendBtn) addFriendBtn.addEventListener('click', openFriendModalUI);
    if (addFriendBtnMobile) addFriendBtnMobile.addEventListener('click', function (e) { e.stopPropagation(); openFriendModalUI(); });
    if (closeFriendModal) closeFriendModal.addEventListener('click', closeFriendModalUI);
    window.addEventListener('click', function (e) { if (e.target === friendModal) closeFriendModalUI(); });
    if (friendAddNextBtn) friendAddNextBtn.addEventListener('click', function () {
        var to = friendIdentifierInput && friendIdentifierInput.value && friendIdentifierInput.value.trim();
        if (!to) { showNotification('请输入好友标识', 'warning'); return; }
        showFriendAddStep2(to, to);
    });
    if (friendAddBackBtn) friendAddBackBtn.addEventListener('click', function () { showFriendAddStep1(); });
    if (friendReasonInput) friendReasonInput.addEventListener('input', updateFriendReasonCount);
    if (sendFriendRequestBtn) sendFriendRequestBtn.addEventListener('click', async function () {
        var to = friendAddCurrentTo || (friendIdentifierInput && friendIdentifierInput.value && friendIdentifierInput.value.trim());
        if (!to) { showNotification('请先填写好友标识', 'warning'); return; }
        var message = friendReasonInput ? friendReasonInput.value.trim() : '';
        if (message.length > 200) { showNotification('添加理由最多 200 字', 'warning'); return; }
        try {
            await apiRequest('/api/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: to, message: message || undefined }) });
            showNotification('好友申请已发送', 'success');
            closeFriendModalUI();
            showFriendAddStep1();
if (friendIdentifierInput) friendIdentifierInput.value = '';
    if (friendReasonInput) { friendReasonInput.value = ''; updateFriendReasonCount(); }
    await refreshFriendsAndRequests();
        } catch (e) { showNotification(e.message || '发送申请失败', 'error'); }
    });
    if (friendRequestsList) friendRequestsList.addEventListener('click', async function (e) {
        var row = e.target.closest && e.target.closest('[data-request-id]');
        if (!row) return;
        var requestId = row.dataset.requestId, accept = e.target.classList.contains('req-accept'), reject = e.target.classList.contains('req-reject');
        if (!accept && !reject) return;
        var req = incomingRequestsCache.find(function (r) { return String(r.id) === String(requestId); });
        var acceptedFromId = accept && req && req.from_user ? req.from_user.id : null;
        try {
            await apiRequest('/api/friends/request/' + requestId + '/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id, action: accept ? 'accept' : 'reject' }) });
            showNotification(accept ? '已添加好友' : '已拒绝申请', 'success');
            await refreshFriendsAndRequests();
            if (accept && acceptedFromId) {
                closeFriendModalUI();
                setViewMode('dm');
                selectDmPeerById(acceptedFromId);
                if (socket.connected && currentUser && currentUser.id) {
                    socket.emit('sendPrivateMessage', {
                        fromUserId: currentUser.id,
                        toUserId: acceptedFromId,
                        content: '我通过了你的好友申请，快来和我聊天吧！',
                        image: null,
                        voice: null,
                        reply_to: undefined
                    });
                }
            }
        } catch (err) { showNotification(err.message || '操作失败', 'error'); }
    });
    var handleFriendClick = function (e) {
        var readdBtn = e.target.closest && e.target.closest('.btn-readd-friend');
        if (readdBtn) {
            e.preventDefault();
            e.stopPropagation();
            sendReaddRequest(readdBtn.dataset.staleId);
            return;
        }
        var staleItem = e.target.closest && e.target.closest('[data-stale-id]');
        if (staleItem) {
            setViewMode('dm');
            selectStalePeerById(staleItem.dataset.staleId);
            if (nav && nav.getAttribute('hidden') === null) nav.setAttribute('hidden', 'hidden');
            return;
        }
        var item = e.target.closest && e.target.closest('[data-friend-id]');
        if (!item) return;
        var fid = item.dataset.friendId;
        setViewMode('dm');
        selectDmPeerById(fid);
        if (nav && nav.getAttribute('hidden') === null) nav.setAttribute('hidden', 'hidden');
    };
    if (friendsList) friendsList.addEventListener('click', handleFriendClick);
    if (friendsListMobile) friendsListMobile.addEventListener('click', handleFriendClick);
    if (friendsListMain) friendsListMain.addEventListener('click', handleFriendClick);
    bindLongPress(friendsList, '[data-friend-id]', function (el) {
        var fid = el.dataset.friendId;
        var nowPinned = togglePinFriend(fid);
        showNotification(nowPinned ? '已置顶' : '已取消置顶', 'success');
        renderFriendsList();
    });
    bindLongPress(friendsListMobile, '[data-friend-id]', function (el) {
        var fid = el.dataset.friendId;
        var nowPinned = togglePinFriend(fid);
        showNotification(nowPinned ? '已置顶' : '已取消置顶', 'success');
        renderFriendsList();
    });
    bindLongPress(messagesContainer, '[data-message-type="dm"]', function (el) {
        if (viewMode !== 'dm') return;
        var mid = el.dataset.messageId;
        showCustomConfirm('确定要删除这条聊天记录吗？', async function () {
            try {
                await apiRequest('/api/dm/messages/' + mid, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id }) });
                el.remove();
            } catch (e) { showNotification(e.message || '删除失败', 'error'); }
        });
    });
}

function showMore() {
    if (nav) {
        nav.getAttribute('hidden') != undefined ? nav.removeAttribute('hidden') : nav.setAttribute('hidden', 'hidden');
    }
}

window.viewImage = viewImage;
window.recallMessage = recallMessage;
window.recallDmMessage = recallDmMessage;
window.showCustomConfirm = showCustomConfirm;
