<template>
  <div class="rail-right">
    <div class="rail-head">成员 <span class="count" v-if="members.length">· {{ members.length }}</span></div>
    <div class="rail-scroll">
      <div v-if="!members.length" class="empty">暂无成员</div>
      <div v-for="m in members" :key="m.id" class="member">
        <span class="avatar-click" @click="goProfile(m.id, $event)">
          <Avatar :src="m.avatar" :name="m.nickname || m.username" :presence="getLivePresence(m.id, m.presence_status)" :size="30" />
        </span>
        <span class="name">{{ m.nickname || m.username }}<span v-if="m.id === meId" class="you">你</span></span>
      </div>
    </div>
    <div class="hint">
      <b>私聊端到端加密</b><br>服务器只存密文，钥匙只在你设备上。
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { http } from '../../api/http.js';
import { getUser } from '../../stores/auth.js';
import { getLivePresence } from '../../stores/presence.js';
import { openUserCard } from '../../stores/userCard.js';
import Avatar from '../Avatar.vue';

const props = defineProps({ channel: String });
const members = ref([]);
const meId = getUser()?.id;

function goProfile(id, event) {
  openUserCard(id, event);
}

watch(() => props.channel, async (c) => {
  if (!c) { members.value = []; return; }
  try {
    const data = await http.get(`/api/channel/${c}/members`);
    members.value = data.members || data || [];
  } catch { members.value = []; }
}, { immediate: true });
</script>

<style scoped>
.rail-right { display: flex; flex-direction: column; min-height: 0; background: var(--rail); }
.rail-head { padding: 16px 18px 10px; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.rail-head .count { color: var(--faint); font-weight: 400; }
.rail-scroll { flex: 1; overflow-y: auto; padding: 0 10px 12px; }
.member { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-radius: 9px; }
.member:hover { background: var(--hover); }
.avatar-click { cursor: pointer; display: inline-flex; }
.member .name { font-size: 13px; color: var(--muted); }
.member .you { font-size: 11px; color: var(--accent-strong); font-weight: 500; margin-left: 4px; }
.empty { color: var(--muted); text-align: center; margin-top: 16px; font-size: 13px; }
.hint {
  margin: 16px 14px; padding: 12px 14px; background: var(--panel); border: 1px solid var(--border);
  border-radius: 12px; font-size: 12px; color: var(--muted); line-height: 1.6;
}
.hint b { color: var(--text); }
</style>
