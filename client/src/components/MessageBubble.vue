<template>
  <div class="msg" :class="{ mine, mentioned: mentionsMe }">
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
      <div v-if="message.file" class="file-card">
        <a :href="message.file" target="_blank" download>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
          <span class="file-name">{{ message.file_name || '文件' }}</span>
        </a>
      </div>
      <div v-if="message.content" class="text">
        <template v-for="(part, i) in contentParts" :key="i">
          <span v-if="part.type === 'mention'" class="mention">@{{ part.text }}</span>
          <template v-else>{{ part.text }}</template>
        </template>
      </div>
      <div v-if="isChannelMsg" class="react">
        <span v-for="r in reactions" :key="r.emoji" class="react-pill" :class="{ on: reacted(r) }" @click="toggleReaction(r.emoji)">
          {{ r.emoji }} <span class="count">{{ r.count }}</span>
        </span>
        <span class="react-add" @click.stop="pickerOpen = !pickerOpen">+</span>
        <span v-if="pickerOpen" class="react-picker">
          <button v-for="e in REACTIONS" :key="e" class="react-opt" @click.stop="toggleReaction(e)">{{ e }}</button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { http } from '../api/http.js';
import { getUser } from '../stores/auth.js';
import { openUserCard } from '../stores/userCard.js';
import Avatar from './Avatar.vue';

const props = defineProps({ message: Object, mine: Boolean });

const senderId = computed(() => props.message.user_id ?? props.message.from_user_id);
const myUsername = getUser()?.username;
const myId = getUser()?.id;

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const pickerOpen = ref(false);

const isChannelMsg = computed(() => props.message.user_id != null);
const reactions = computed(() => props.message.reactions || []);
function reacted(r) { return r.userIds?.includes(myId); }

async function toggleReaction(emoji) {
  pickerOpen.value = false;
  if (!isChannelMsg.value) return;
  try {
    await http.post(`/api/messages/${props.message.id}/reaction`, { emoji });
  } catch { /* 忽略 */ }
}

// 该消息是否 @ 提及了当前用户
const mentionsMe = computed(() => {
  if (!myUsername) return false;
  const re = new RegExp('@' + myUsername + '(?![a-zA-Z0-9_])');
  return re.test(props.message.content || '');
});

function goProfile(event) {
  if (senderId.value == null) return;
  openUserCard(senderId.value, event);
}

const time = computed(() => {
  const d = new Date(props.message.created_at);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
});

// 将消息正文按 @提及 拆分为 text / mention 片段
const contentParts = computed(() => {
  const text = props.message.content || '';
  const parts = [];
  let lastIndex = 0;
  const regex = /@([a-zA-Z0-9_]{2,20})/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    parts.push({ type: 'mention', text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex) });
  return parts;
});
</script>

<style scoped>
.msg { display: flex; gap: 12px; padding: 8px 10px; border-radius: 12px; position: relative; }
.msg:hover { background: var(--accent-ghost); }
.msg.mentioned { background: var(--accent-soft); }
.msg :deep(.avatar-wrap) { margin-top: 2px; }
.msg.mine { flex-direction: row-reverse; }
.msg.mine .head { flex-direction: row-reverse; }
.msg.mine .text, .msg.mine .reply-quote { text-align: right; }
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
.mention { color: var(--accent-strong); background: var(--accent-soft); border-radius: 5px; padding: 1px 5px; font-weight: 500; }
.react { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
.react-pill {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 9px;
  border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: var(--panel); cursor: pointer;
}
.react-pill.on { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--accent-strong); background: var(--accent-soft); }
.react-pill .count { font-variant-numeric: tabular-nums; }
.react-add {
  display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border: 1px dashed var(--border); border-radius: 999px; color: var(--muted); font-size: 13px; cursor: pointer; position: relative;
}
.react-add:hover { color: var(--accent-strong); border-color: var(--accent); }
.react-picker {
  display: inline-flex; gap: 2px; padding: 4px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--panel); box-shadow: var(--shadow);
}
.react-opt { border: 0; background: transparent; font-size: 16px; cursor: pointer; padding: 2px 5px; border-radius: 6px; }
.react-opt:hover { background: var(--hover); }
.img-card { margin-top: 8px; max-width: 360px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.img-card img { width: 100%; display: block; }
.media { margin-top: 8px; }
.media audio { max-width: 300px; }
.file-card { margin-top: 8px; }
.file-card a { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 9px; color: var(--text); font-size: 13px; text-decoration: none; background: var(--rail); }
.file-card a:hover { background: var(--hover); }
.file-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
