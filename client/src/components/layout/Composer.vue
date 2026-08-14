<template>
  <div class="composer">
    <div v-if="replyTo" class="reply-banner">
      <span class="reply-label">回复 {{ replyTo.nickname || replyTo.username }}</span>
      <button class="reply-cancel" @click="emit('clear-reply')" aria-label="取消回复">×</button>
    </div>
    <div class="composer-box">
      <textarea
        v-model="text"
        rows="1"
        :placeholder="placeholder"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <div class="composer-bar">
        <button class="icon-btn" aria-label="表情" title="表情">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="icon-btn" aria-label="附件" title="附件">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 12-7.5 7.5a5.5 5.5 0 0 1-7.8-7.8L13 4.5a3.6 3.6 0 0 1 5.1 5.1L11 17"/></svg>
        </button>
        <span class="spacer"></span>
        <button class="send" @click="send" :disabled="!text.trim()">
          发送
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 14-7-4 14-3-5-7-2z"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { getSocket } from '../../api/socket.js';
import { getFriendPublicKey } from '../../stores/friends.js';
import { useKeys, getOrDeriveMessageKey } from '../../stores/keys.js';
import { encryptMessage } from '../../stores/e2ee.js';

const props = defineProps({ channel: String, peerId: Number, replyTo: Object });
const emit = defineEmits(['clear-reply']);
const text = ref('');

const placeholder = computed(() => {
  if (props.peerId != null) return '发送私聊消息';
  if (props.channel) return `发送到 # ${props.channel}，输入 @ 提及成员`;
  return '发送消息';
});

async function send() {
  const value = text.value.trim(); if (!value) return;
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
  text.value = '';
  emit('clear-reply');
}
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
  border: 1px solid var(--border-strong); border-radius: 14px; background: var(--panel);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.composer-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
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
