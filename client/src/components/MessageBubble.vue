<template>
  <div class="msg">
    <span class="avatar-click" @click="goProfile" :title="message.nickname || message.username">
      <Avatar :src="message.avatar" :name="message.nickname || message.username" :size="38" />
    </span>
    <div class="body">
      <div class="head">
        <span class="who">{{ message.nickname || message.username }}<span v-if="mine" class="you">（你）</span></span>
        <span class="when">{{ time }}</span>
      </div>
      <div v-if="message.reply_info" class="reply-quote">
        <span class="reply-who">{{ message.reply_info.nickname || message.reply_info.username || '用户' }}</span>
        <span class="reply-content">{{ message.reply_info.content || (message.reply_info.image ? '[图片]' : '[消息已撤回]') }}</span>
      </div>
      <div v-if="message.image" class="img-card"><img :src="message.image" alt="图片" /></div>
      <div v-if="message.voice" class="media"><audio :src="message.voice" controls /></div>
      <div v-if="message.content" class="text">{{ message.content }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { openUserCard } from '../stores/userCard.js';
import Avatar from './Avatar.vue';

const props = defineProps({ message: Object, mine: Boolean });

const senderId = computed(() => props.message.user_id ?? props.message.from_user_id);

function goProfile(event) {
  if (senderId.value == null) return;
  openUserCard(senderId.value, event);
}

const time = computed(() => {
  const d = new Date(props.message.created_at);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
});
</script>

<style scoped>
.msg { display: flex; gap: 12px; padding: 8px 10px; border-radius: 12px; position: relative; }
.msg:hover { background: var(--accent-ghost); }
.msg :deep(.avatar-wrap) { margin-top: 2px; }
.avatar-click { cursor: pointer; }
.body { min-width: 0; flex: 1; }
.head { display: flex; align-items: baseline; gap: 8px; }
.who { font-weight: 600; font-size: 14px; }
.you { font-weight: 400; color: var(--faint); font-size: 11px; }
.when { font-size: 11px; color: var(--faint); }
.reply-quote {
  margin-top: 4px; padding: 6px 10px; border-left: 3px solid var(--accent);
  background: var(--rail); border-radius: 6px; font-size: 13px; line-height: 1.5;
}
.reply-who { color: var(--accent-strong); font-weight: 500; margin-right: 6px; }
.reply-content { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; max-width: 100%; vertical-align: bottom; }
.text { font-size: 14px; line-height: 1.6; color: var(--text); margin-top: 2px; white-space: pre-wrap; overflow-wrap: break-word; }
.img-card { margin-top: 8px; max-width: 360px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.img-card img { width: 100%; display: block; }
.media { margin-top: 8px; }
.media audio { max-width: 300px; }
</style>
