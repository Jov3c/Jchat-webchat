<template>
  <div class="members">
    <h3 class="members-title">成员</h3>
    <div v-if="!members.length" class="empty">暂无成员</div>
    <div v-for="m in members" :key="m.id" class="member">
      <Avatar :src="m.avatar" :name="m.nickname || m.username" :presence="m.presence_status" />
      <span class="member-name">{{ m.nickname || m.username }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { http } from '../../api/http.js';
import Avatar from '../Avatar.vue';

const props = defineProps({ channel: String });
const members = ref([]);

watch(() => props.channel, async (c) => {
  if (!c) { members.value = []; return; }
  try {
    const data = await http.get(`/api/channel/${c}/members`);
    members.value = data.members || data || [];
  } catch { members.value = []; }
}, { immediate: true });
</script>

<style scoped>
.members { display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding: 12px; }
.members-title { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px; }
.member { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); }
.member:hover { background: var(--hover); }
.member-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--muted); text-align: center; margin-top: 16px; }
</style>
