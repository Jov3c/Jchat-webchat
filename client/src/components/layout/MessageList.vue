<template>
  <div class="messages" ref="scrollEl" @scroll="onScroll">
    <div v-if="!messages.length" class="empty">暂无消息</div>
    <template v-for="m in displayMessages" :key="m.id">
      <div v-if="m.showDay" class="day">{{ m.dayLabel }}</div>
      <div class="msg-row" :data-mid="m.id" @contextmenu.prevent="openMenu($event, m)">
        <MessageBubble :message="m" :mine="isMine(m)" />
      </div>
    </template>

    <button v-if="jumpUnreadId" class="jump-unread-btn" @click="scrollToUnread">↑ 第一条未读</button>
    <button v-if="showJump" class="jump-btn" @click="scrollToBottom()">↓ 跳转到最新</button>

    <Teleport to="body">
      <div v-if="menu.open" class="ctx-overlay" @click="closeMenu" @contextmenu.prevent="closeMenu">
        <div class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
          <button class="ctx-item" @click="doReply">回复</button>
          <button v-if="isMine(menu.message) && canRecall(menu.message)" class="ctx-item danger" @click="doRecall">撤回</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { http } from '../../api/http.js';
import { connectSocket } from '../../api/socket.js';
import { getUser } from '../../stores/auth.js';
import { getFirstUnreadId, clearUnread, keyForChannel, keyForDm } from '../../stores/unread.js';
import { getFriendPublicKey } from '../../stores/friends.js';
import { useKeys, getOrDeriveMessageKey } from '../../stores/keys.js';
import { decryptMessage } from '../../stores/e2ee.js';
import MessageBubble from '../MessageBubble.vue';

const props = defineProps({ channel: String, peerId: Number });
const emit = defineEmits(['reply']);

const messages = ref([]);
const currentUserId = getUser()?.id;

const scrollEl = ref(null);
const atBottom = ref(true);
const showJump = ref(false);
const jumpUnreadId = ref(null);
const menu = ref({ open: false, x: 0, y: 0, message: null });

function isMine(m) {
  if (props.peerId != null) return m.from_user_id === currentUserId;
  return m.user_id === currentUserId;
}

function formatDay(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - thatDay) / 86400000);
  const md = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  if (diff === 0) return '今天 · ' + md;
  if (diff === 1) return '昨天 · ' + md;
  return d.getFullYear() + '/' + md;
}

const displayMessages = computed(() => {
  let lastDay = null;
  return messages.value.map(m => {
    const d = new Date(m.created_at);
    const day = Number.isNaN(d.getTime()) ? '' : formatDay(d);
    const showDay = day !== lastDay;
    lastDay = day;
    return { ...m, showDay, dayLabel: day };
  });
});

function isAtBottom() {
  const el = scrollEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(smooth = true) {
  const el = scrollEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  showJump.value = false;
}

function onScroll() {
  atBottom.value = isAtBottom();
  if (atBottom.value) showJump.value = false;
}

function handleNewMessage(m) {
  messages.value.push(m);
  if (isMine(m) || atBottom.value) {
    nextTick(scrollToBottom);
  } else {
    showJump.value = true;
  }
}

function openMenu(event, m) {
  menu.value = { open: true, x: event.clientX, y: event.clientY, message: m };
}
function closeMenu() { menu.value.open = false; }

function canRecall(m) {
  if (!isMine(m)) return false;
  const created = new Date(m.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return (Date.now() - created) / (1000 * 60) <= 3;
}

function doReply() {
  const m = menu.value.message;
  closeMenu();
  emit('reply', m);
}

function doRecall() {
  const m = menu.value.message;
  closeMenu();
  const socket = connectSocket();
  if (props.peerId != null) socket.emit('recallDmMessage', { messageId: m.id });
  else if (props.channel) socket.emit('recallMessage', { messageId: m.id, channel: props.channel });
}

function applyRecall(messageId) {
  const i = messages.value.findIndex(x => x.id === messageId);
  if (i >= 0) messages.value[i] = { ...messages.value[i], is_recalled: 1, content: '消息已撤回', image: null, voice: null };
}

async function decryptDmContent(m) {
  if (typeof m.content !== 'string' || !m.content.startsWith('e2ee:')) return m;
  if (props.peerId == null || !useKeys().ready) {
    return { ...m, content: '[加密消息：密钥未就绪，请重新登录恢复]' };
  }
  const peerPub = getFriendPublicKey(props.peerId);
  if (!peerPub) {
    return { ...m, content: '[加密消息：无法获取对方密钥]' };
  }
  try {
    const key = await getOrDeriveMessageKey(props.peerId, peerPub);
    const plain = await decryptMessage(m.content.slice(5), key);
    if (plain != null) return { ...m, content: plain };
  } catch { /* 解密失败走兜底提示 */ }
  return { ...m, content: '[加密消息：解密失败]' };
}

async function load() {
  messages.value = [];
  showJump.value = false;
  jumpUnreadId.value = null;
  const key = props.peerId != null ? keyForDm(props.peerId) : keyForChannel(props.channel);
  const firstUnread = getFirstUnreadId(key);
  if (props.peerId != null) {
    const data = await http.get(`/api/dm/${props.peerId}/messages`);
    const raw = data.messages || data || [];
    messages.value = await Promise.all(raw.map(decryptDmContent));
  } else if (props.channel) {
    const data = await http.get(`/api/messages/${props.channel}`);
    messages.value = data.messages || data || [];
  }
  clearUnread(key);
  if (firstUnread && messages.value.some(m => m.id === firstUnread)) {
    jumpUnreadId.value = firstUnread;
  }
  nextTick(() => { scrollToBottom(false); atBottom.value = true; });
}

function scrollToUnread() {
  const el = scrollEl.value?.querySelector(`[data-mid="${jumpUnreadId.value}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  jumpUnreadId.value = null;
}

watch(() => [props.channel, props.peerId], load, { immediate: true });

const socket = connectSocket();

function onMessageReceived(m) { if (m.channel === props.channel) handleNewMessage(m); }
function onPrivateMessageReceived(m) {
  if (m.from_user_id === props.peerId || m.to_user_id === props.peerId) {
    decryptDmContent(m).then(handleNewMessage);
  }
}
function onMessageRecalled({ messageId }) { applyRecall(messageId); }
function onDmMessageRecalled({ messageId }) { applyRecall(messageId); }
function onMessageReaction({ messageId, reactions }) {
  const i = messages.value.findIndex(x => x.id === messageId);
  if (i >= 0) messages.value[i] = { ...messages.value[i], reactions };
}
function onMediaExpired(messageId) {
  const i = messages.value.findIndex(x => x.id === messageId);
  if (i >= 0) messages.value[i] = { ...messages.value[i], image: null, video: null, voice: null, file: null, media_expired: 1 };
}
function onMessageMediaExpired({ messageId }) { onMediaExpired(messageId); }
function onDmMessageMediaExpired({ messageId }) { onMediaExpired(messageId); }
function onDocClick() { if (menu.value.open) closeMenu(); }

onMounted(() => {
  document.addEventListener('click', onDocClick);
  socket.on('messageReceived', onMessageReceived);
  socket.on('privateMessageReceived', onPrivateMessageReceived);
  socket.on('messageRecalled', onMessageRecalled);
  socket.on('dmMessageRecalled', onDmMessageRecalled);
  socket.on('messageReaction', onMessageReaction);
  socket.on('messageMediaExpired', onMessageMediaExpired);
  socket.on('dmMessageMediaExpired', onDmMessageMediaExpired);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  socket.off('messageReceived', onMessageReceived);
  socket.off('privateMessageReceived', onPrivateMessageReceived);
  socket.off('messageRecalled', onMessageRecalled);
  socket.off('dmMessageRecalled', onDmMessageRecalled);
  socket.off('messageReaction', onMessageReaction);
  socket.off('messageMediaExpired', onMessageMediaExpired);
  socket.off('dmMessageMediaExpired', onDmMessageMediaExpired);
});
</script>

<style scoped>
.messages { flex: 1; overflow-y: auto; padding: 18px 22px 8px; display: flex; flex-direction: column; position: relative; }
.empty { color: var(--muted); text-align: center; margin-top: 40px; font-size: 14px; }
.msg-row { flex: none; }
.day {
  display: flex; align-items: center; gap: 12px;
  margin: 6px 0 18px; color: var(--faint); font-size: 12px; flex: none;
}
.day::before, .day::after { content: ""; flex: 1; height: 1px; background: var(--border); }

.jump-btn {
  position: sticky; bottom: 8px; align-self: center;
  padding: 6px 14px; border-radius: 999px; background: var(--panel);
  border: 1px solid var(--border); box-shadow: var(--shadow);
  color: var(--accent-strong); font-size: 13px; cursor: pointer;
}
.jump-btn:hover { background: var(--accent-ghost); }
.jump-unread-btn {
  position: sticky; top: 8px; align-self: flex-end; margin-right: 4px;
  padding: 6px 14px; border-radius: 999px; background: var(--accent);
  border: 0; box-shadow: var(--shadow);
  color: #fff; font-size: 13px; cursor: pointer;
}
.jump-unread-btn:hover { background: var(--accent-strong); }

.ctx-overlay { position: fixed; inset: 0; z-index: 90; }
.ctx-menu {
  position: fixed; min-width: 140px; padding: 6px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow);
}
.ctx-item {
  display: block; width: 100%; text-align: left; padding: 8px 12px; border-radius: 8px;
  background: transparent; border: 0; color: var(--text); font-size: 13px; cursor: pointer;
}
.ctx-item:hover { background: var(--hover); }
.ctx-item.danger { color: var(--red); }
.ctx-item.danger:hover { background: color-mix(in srgb, var(--red) 10%, transparent); }
</style>
