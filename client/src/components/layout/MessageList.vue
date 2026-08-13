<template>
  <div class="messages">
    <div v-if="!messages.length" class="empty">暂无消息</div>
    <MessageBubble v-for="m in messages" :key="m.id" :message="m" :mine="isMine(m)" />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { http } from '../../api/http.js';
import { connectSocket } from '../../api/socket.js';
import { getUser } from '../../stores/auth.js';
import MessageBubble from '../MessageBubble.vue';

const props = defineProps({ channel: String, peerId: Number });
const messages = ref([]);
const currentUserId = getUser()?.id;

function isMine(m) {
  if (props.peerId != null) return m.from_user_id === currentUserId;
  return m.user_id === currentUserId;
}

async function load() {
  messages.value = [];
  if (props.peerId != null) {
    const data = await http.get(`/api/dm/${props.peerId}/messages`);
    messages.value = data.messages || data || [];
  } else if (props.channel) {
    const data = await http.get(`/api/messages/${props.channel}`);
    messages.value = data.messages || data || [];
  }
}

watch(() => [props.channel, props.peerId], load, { immediate: true });

const socket = connectSocket();
socket.on('messageReceived', (m) => {
  if (m.channel === props.channel) messages.value.push(m);
});
socket.on('privateMessageReceived', (m) => {
  if (m.from_user_id === props.peerId || m.to_user_id === props.peerId) messages.value.push(m);
});
socket.on('messageRecalled', ({ messageId }) => {
  const i = messages.value.findIndex((x) => x.id === messageId);
  if (i >= 0) messages.value[i] = { ...messages.value[i], is_recalled: 1, content: '消息已撤回' };
});
</script>

<style scoped>
.messages { flex: 1; overflow-y: auto; padding: 16px 0; display: flex; flex-direction: column; }
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
</style>
