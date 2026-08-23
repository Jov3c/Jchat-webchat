<template>
  <div class="composer">
    <div v-if="replyTo" class="reply-banner">
      <span class="reply-label">回复 {{ replyTo.nickname || replyTo.username }}</span>
      <button class="reply-cancel" @click="emit('clear-reply')" aria-label="取消回复">×</button>
    </div>
    <div class="composer-box">
      <div v-if="mentionOpen && filteredMentions.length" class="mention-pop">
        <div
          v-for="(u, i) in filteredMentions"
          :key="u.id"
          class="mention-item"
          :class="{ active: i === mentionIndex }"
          @mousedown.prevent="selectMention(u)"
        >
          <span class="mention-name">{{ u.nickname }}</span>
          <span class="mention-username">@{{ u.username }}</span>
        </div>
      </div>
      <textarea
        ref="textareaRef"
        v-model="text"
        rows="1"
        :placeholder="placeholder"
        @input="onTextareaInput"
        @keydown="onKeydown"
      ></textarea>
      <div class="composer-bar">
        <button class="icon-btn" :class="{ active: stickerOpen }" aria-label="表情" title="表情" @click="toggleSticker">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="icon-btn" aria-label="附件" title="发送文件" @click="fileInput.click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 12-7.5 7.5a5.5 5.5 0 0 1-7.8-7.8L13 4.5a3.6 3.6 0 0 1 5.1 5.1L11 17"/></svg>
        </button>
        <input ref="fileInput" type="file" style="display: none" @change="onFileChange" />
        <input ref="stickerInput" type="file" accept="image/*" style="display: none" @change="onStickerUpload" />
        <span class="spacer"></span>
        <button class="send" @click="send" :disabled="!text.trim()">
          发送
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 14-7-4 14-3-5-7-2z"/></svg>
        </button>
      </div>
      <StickerPicker
        v-if="stickerOpen"
        @select-emoji="insertEmoji"
        @select-sticker="sendSticker"
        @upload-sticker="stickerInput.click()"
        @remove-sticker="removeSticker"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { http } from '../../api/http.js';
import { getSocket } from '../../api/socket.js';
import { getToken } from '../../stores/auth.js';
import { getFriendPublicKey, useFriends } from '../../stores/friends.js';
import { useKeys, getOrDeriveMessageKey } from '../../stores/keys.js';
import { encryptMessage } from '../../stores/e2ee.js';
import { useStickers, setStickers, addSticker, removeSticker as dropSticker } from '../../stores/stickers.js';
import StickerPicker from '../StickerPicker.vue';

const props = defineProps({ channel: String, peerId: Number, replyTo: Object });
const emit = defineEmits(['clear-reply']);
const text = ref('');

const textareaRef = ref(null);
const fileInput = ref(null);
const stickerInput = ref(null);
const stickerOpen = ref(false);
const mentionOpen = ref(false);
const mentionQuery = ref('');
const mentionIndex = ref(0);
const members = ref([]);
const friendsState = useFriends();
const stickers = useStickers();

const placeholder = computed(() => {
  if (props.peerId != null) return '发送私聊消息';
  if (props.channel) return `发送到 # ${props.channel}，输入 @ 提及成员`;
  return '发送消息';
});

watch(() => props.channel, async (c) => {
  members.value = [];
  if (!c) return;
  try {
    const data = await http.get(`/api/channel/${encodeURIComponent(c)}/members`);
    members.value = data.members || data || [];
  } catch { members.value = []; }
}, { immediate: true });

const mentionCandidates = computed(() => {
  if (props.peerId != null) {
    const f = friendsState.list.find(x => Number(x.id) === Number(props.peerId));
    return f ? [f] : [];
  }
  return members.value;
});

const filteredMentions = computed(() => {
  const q = mentionQuery.value.toLowerCase();
  const list = mentionCandidates.value.map(u => ({ id: u.id, username: u.username, nickname: u.nickname || u.username }));
  if (!q) return list;
  return list.filter(u => u.username.toLowerCase().includes(q) || u.nickname.toLowerCase().includes(q));
});

function onTextareaInput() {
  const el = textareaRef.value;
  const cursor = el ? el.selectionStart : text.value.length;
  const before = text.value.slice(0, cursor);
  const match = before.match(/@([a-zA-Z0-9_]{0,20})$/);
  if (match) {
    mentionQuery.value = match[1];
    mentionIndex.value = 0;
    mentionOpen.value = true;
  } else {
    mentionOpen.value = false;
  }
}

function selectMention(u) {
  const el = textareaRef.value;
  const cursor = el ? el.selectionStart : text.value.length;
  const before = text.value.slice(0, cursor);
  const replaced = before.replace(/@([a-zA-Z0-9_]{0,20})$/, '@' + u.username + ' ');
  text.value = replaced + text.value.slice(cursor);
  mentionOpen.value = false;
  nextTick(() => textareaRef.value?.focus());
}

function onKeydown(e) {
  if (mentionOpen.value && filteredMentions.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex.value = Math.min(mentionIndex.value + 1, filteredMentions.value.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex.value = Math.max(mentionIndex.value - 1, 0); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredMentions.value[mentionIndex.value]); }
    else if (e.key === 'Escape') { mentionOpen.value = false; }
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

async function send() {
  const value = text.value.trim(); if (!value) return;
  text.value = '';
  mentionOpen.value = false;
  emit('clear-reply');
  const socket = getSocket();
  const reply_to = props.replyTo?.id ?? undefined;
  if (props.peerId != null) {
    let content = value;
    const peerPub = getFriendPublicKey(props.peerId);
    if (peerPub && useKeys().ready) {
      const key = await getOrDeriveMessageKey(props.peerId, peerPub);
      content = 'e2ee:' + await encryptMessage(value, key);
    }
    socket.emit('sendPrivateMessage', { toUserId: props.peerId, content, reply_to });
  } else if (props.channel) {
    socket.emit('sendMessage', { channel: props.channel, content: value, reply_to });
  }
}

async function onFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload/file', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '上传失败');
    const socket = getSocket();
    if (props.peerId != null) {
      socket.emit('sendPrivateMessage', { toUserId: props.peerId, content: '', file: data.file, file_name: data.file_name });
    } else if (props.channel) {
      socket.emit('sendMessage', { channel: props.channel, content: '', file: data.file, file_name: data.file_name });
    }
  } catch { /* 上传失败忽略 */ } finally {
    e.target.value = '';
  }
}

// —— 表情选择器 ——
function toggleSticker() {
  stickerOpen.value = !stickerOpen.value;
  if (stickerOpen.value) loadStickers();
}
async function loadStickers() {
  try {
    const data = await http.get('/api/stickers');
    setStickers(data.stickers || []);
  } catch { /* 忽略 */ }
}
function insertEmoji(emoji) {
  text.value += emoji;
  stickerOpen.value = false;
  nextTick(() => textareaRef.value?.focus());
}
async function sendSticker(url) {
  stickerOpen.value = false;
  const socket = getSocket();
  if (props.peerId != null) {
    socket.emit('sendPrivateMessage', { toUserId: props.peerId, content: '', image: url });
  } else if (props.channel) {
    socket.emit('sendMessage', { channel: props.channel, content: '', image: url });
  }
}
async function onStickerUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '上传失败');
    const added = await http.post('/api/stickers', { url: data.image });
    if (added.sticker) addSticker(added.sticker);
  } catch { /* 上传失败忽略 */ } finally {
    e.target.value = '';
  }
}
async function removeSticker(id) {
  try {
    const data = await http.del(`/api/stickers/${id}`);
    if (data.stickers) setStickers(data.stickers);
  } catch { /* 忽略 */ }
}
// 点击外部关闭表情面板
function onDocClick(e) {
  if (stickerOpen.value && !e.target.closest('.composer-box')) stickerOpen.value = false;
}
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
document.addEventListener('click', onDocClick);
</script>

<style scoped>
.composer { padding: 12px 20px 16px; }
.reply-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; margin-bottom: 8px;
  background: var(--accent-ghost); border: 1px solid var(--border); border-radius: 10px;
  font-size: 13px; color: var(--accent-strong);
}
.reply-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-cancel { border: 0; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
.reply-cancel:hover { color: var(--text); }
.composer-box {
  position: relative;
  border: 1px solid var(--border-strong); border-radius: 14px; background: var(--panel);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.composer-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
.mention-pop {
  position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; max-height: 220px; overflow-y: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
  padding: 6px; z-index: 30;
}
.mention-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.mention-item:hover, .mention-item.active { background: var(--hover); }
.mention-name { font-size: 14px; color: var(--text); }
.mention-username { margin-left: auto; font-size: 12px; color: var(--muted); }
.composer-box textarea {
  border: 0; outline: 0; resize: none; background: transparent; color: var(--text);
  font: inherit; font-size: 14px; line-height: 1.5; min-height: 22px; max-height: 140px;
}
.composer-box textarea::placeholder { color: var(--faint); }
.composer-bar { display: flex; align-items: center; gap: 4px; }
.icon-btn { border: 0; background: transparent; color: var(--muted); width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; }
.icon-btn:hover { background: var(--hover); color: var(--text); }
.spacer { flex: 1; }
.send {
  border: 0; background: var(--accent); color: #fff; font: inherit; font-size: 13px; font-weight: 600;
  padding: 7px 16px; border-radius: 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.15s, transform 0.1s;
}
.send:hover:not(:disabled) { background: var(--accent-strong); }
.send:active:not(:disabled) { transform: translateY(1px); }
.send:disabled { opacity: 0.5; cursor: default; }
</style>
