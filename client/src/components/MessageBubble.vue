<template>
  <div class="msg" :class="{ mine }">
    <Avatar :src="message.avatar" :name="message.nickname" />
    <div class="body">
      <div class="meta"><span class="nick">{{ message.nickname }}</span><span class="time">{{ time }}</span></div>
      <div v-if="message.image" class="media"><img :src="message.image" alt="图片" /></div>
      <div v-if="message.voice" class="media"><audio :src="message.voice" controls /></div>
      <p v-if="message.content" class="content">{{ message.content }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Avatar from './Avatar.vue';

const props = defineProps({ message: Object, mine: Boolean });
const time = computed(() => new Date(props.message.created_at).toLocaleTimeString());
</script>

<style scoped>
.msg { display: flex; gap: 10px; padding: 8px 16px; }
.msg.mine { flex-direction: row-reverse; }
.body { max-width: 70%; }
.meta { display: flex; gap: 8px; align-items: baseline; }
.nick { font-weight: 600; }
.time { color: var(--muted); font-size: 12px; }
.media img { max-width: 240px; border-radius: var(--radius-sm); }
.content { white-space: pre-wrap; }
</style>
