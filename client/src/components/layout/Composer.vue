<template>
  <div class="composer">
    <textarea
      v-model="text"
      class="input"
      placeholder="输入消息…"
      rows="1"
      @keydown.enter.exact.prevent="send"
    ></textarea>
    <button class="send" @click="send" :disabled="!text.trim()">发送</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { getSocket } from '../../api/socket.js';

const props = defineProps({ channel: String, peerId: Number });
const text = ref('');

function send() {
  const value = text.value.trim(); if (!value) return;
  const socket = getSocket();
  if (props.peerId != null) {
    socket.emit('sendPrivateMessage', { toUserId: props.peerId, content: value });
  } else if (props.channel) {
    socket.emit('sendMessage', { channel: props.channel, content: value });
  }
  text.value = '';
}
</script>

<style scoped>
.composer { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.input { flex: 1; resize: none; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; background: var(--panel); min-height: 40px; }
.input:focus { outline: none; border-color: var(--accent); }
.send { padding: 8px 16px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.send:disabled { opacity: 0.5; cursor: default; }
.send:hover:not(:disabled) { background: var(--accent-strong); }
</style>
