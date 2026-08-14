<template>
  <div class="profile-wrap">
    <div class="profile-card">
      <button class="back" @click="router.back()">← 返回</button>
      <div class="profile-avatar">
        <Avatar :src="user.avatar" :name="user.nickname || user.username" :presence="user.effective_status" :size="72" />
      </div>
      <div class="profile-name">{{ user.nickname || user.username || '未知用户' }}</div>
      <div v-if="user.username" class="profile-username">@{{ user.username }}</div>
      <div v-if="user.bio" class="profile-bio">{{ user.bio }}</div>
      <div class="profile-meta">
        <span v-if="user.gender">性别：{{ genderLabel(user.gender) }}</span>
        <span v-if="user.created_at">注册于 {{ joinedDate }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '../api/http.js';
import Avatar from '../components/Avatar.vue';

const route = useRoute();
const router = useRouter();
const user = ref({});

onMounted(async () => {
  try {
    user.value = await http.get(`/api/profile/${route.params.id}`);
  } catch { user.value = {}; }
});

function genderLabel(g) { return g === 'male' ? '男' : g === 'female' ? '女' : '其他'; }
const joinedDate = computed(() => {
  const d = new Date(user.value.created_at);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
});
</script>

<style scoped>
.profile-wrap { height: 100vh; display: grid; place-items: center; background: var(--bg); padding: 20px; }
.profile-card {
  position: relative; width: 360px; padding: 32px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
}
.back { position: absolute; left: 16px; top: 16px; border: 0; background: transparent; color: var(--muted); font-size: 13px; cursor: pointer; }
.back:hover { color: var(--text); }
.profile-avatar { margin-top: 8px; }
.profile-name { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
.profile-username { color: var(--muted); font-size: 14px; }
.profile-bio { color: var(--text); font-size: 14px; line-height: 1.6; margin-top: 8px; white-space: pre-wrap; }
.profile-meta { display: flex; gap: 16px; margin-top: 12px; color: var(--faint); font-size: 12px; }
</style>
