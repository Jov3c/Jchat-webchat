<template>
  <div class="profile-page">
    <header class="page-head">
      <button class="back" @click="router.back()" aria-label="返回">← 返回</button>
      <h1>个人资料与好友</h1>
    </header>

    <div class="columns">
      <section class="card">
        <h2>个人资料</h2>
        <div class="avatar-row">
          <Avatar :src="me.avatar" :name="me.nickname || me.username" :presence="me.presence_status" />
          <label class="upload">
            更换头像
            <input type="file" accept="image/*" @change="onAvatarChange" hidden />
          </label>
        </div>
        <label class="field">
          <span>账号（登录用，不可更改）</span>
          <input :value="me.username" disabled />
        </label>
        <label class="field">
          <span>用户名</span>
          <input v-model="me.nickname" placeholder="用户名" />
        </label>
        <label class="field">
          <span>简介</span>
          <textarea v-model="me.bio" rows="3" placeholder="介绍一下自己"></textarea>
        </label>
        <label class="field">
          <span>性别</span>
          <select v-model="me.gender">
            <option value="other">保密</option>
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        </label>
        <p v-if="profileError" class="error">{{ profileError }}</p>
        <p v-if="profileMsg" class="ok">{{ profileMsg }}</p>
        <button class="primary" :disabled="saving" @click="saveProfile">保存</button>
      </section>

      <section class="card">
        <h2>好友申请</h2>
        <p v-if="requestsError" class="error">{{ requestsError }}</p>
        <div v-if="requests.length === 0" class="empty">暂无好友申请</div>
        <div v-for="r in requests" :key="r.id" class="request">
          <Avatar :src="r.from_user?.avatar" :name="r.from_user?.nickname || r.from_user?.username" />
          <div class="request-body">
            <div class="request-name">{{ r.from_user?.nickname || r.from_user?.username }}</div>
            <div class="request-msg">{{ r.message }}</div>
          </div>
          <div class="request-actions">
            <button class="primary sm" @click="respond(r.id, 'accept')">接受</button>
            <button class="ghost sm" @click="respond(r.id, 'reject')">拒绝</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>好友管理</h2>
        <form class="add-form" @submit.prevent="addFriend">
          <input v-model="addUsername" placeholder="对方账号" />
          <button class="primary sm" type="submit">添加好友</button>
        </form>
        <p v-if="addError" class="error">{{ addError }}</p>
        <p v-if="addMsg" class="ok">{{ addMsg }}</p>
        <p v-if="friendsError" class="error">{{ friendsError }}</p>
        <div v-if="friends.length === 0" class="empty">暂无好友</div>
        <div v-for="f in friends" :key="f.id" class="friend">
          <Avatar :src="f.avatar" :name="f.nickname || f.username" />
          <span class="friend-name">{{ f.nickname || f.username }}</span>
          <button class="danger sm" @click="removeFriend(f.id)">删除</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http.js';
import { getUser, updateUser, getToken } from '../stores/auth.js';
import Avatar from '../components/Avatar.vue';

const router = useRouter();

const me = ref({ ...(getUser() || {}) });

const profileError = ref('');
const profileMsg = ref('');
const saving = ref(false);

const requests = ref([]);
const requestsError = ref('');

const addUsername = ref('');
const addMsg = ref('');
const addError = ref('');

const friends = ref([]);
const friendsError = ref('');

onMounted(() => {
  loadProfile();
  loadRequests();
  loadFriends();
});

async function loadProfile() {
  if (!me.value.id) return;
  try {
    const data = await http.get(`/api/profile/${me.value.id}`);
    if (data && data.id != null) me.value = { ...me.value, ...data };
  } catch (e) {
    profileError.value = e.message || '加载资料失败';
  }
}

async function loadRequests() {
  try {
    const data = await http.get('/api/friends/requests');
    requests.value = data.requests || data || [];
  } catch (e) {
    requestsError.value = e.message || '加载好友申请失败';
  }
}

async function loadFriends() {
  try {
    const data = await http.get('/api/friends');
    friends.value = data.friends || data || [];
  } catch (e) {
    friendsError.value = e.message || '加载好友列表失败';
  }
}

async function saveProfile() {
  profileError.value = '';
  profileMsg.value = '';
  if (!me.value.id) {
    profileError.value = '未登录，无法保存';
    return;
  }
  saving.value = true;
  try {
    // 后端只返回 { success: true }，不能用返回值覆盖缓存用户
    await http.put(`/api/profile/${me.value.id}`, {
      nickname: me.value.nickname,
      bio: me.value.bio,
      gender: me.value.gender
    });
    updateUser({ ...(getUser() || {}), nickname: me.value.nickname, bio: me.value.bio, gender: me.value.gender });
    profileMsg.value = '已保存';
  } catch (e) {
    profileError.value = e.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

async function onAvatarChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  profileError.value = '';
  profileMsg.value = '';
  try {
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetch('/api/upload/avatar', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `上传失败 (${res.status})`);
    updateUser({ ...(getUser() || {}), avatar: data.avatar });
    me.value.avatar = data.avatar;
    profileMsg.value = '头像已更新';
  } catch (e) {
    profileError.value = e.message || '头像上传失败';
  } finally {
    e.target.value = '';
  }
}

async function respond(id, action) {
  requestsError.value = '';
  try {
    await http.post(`/api/friends/request/${id}/respond`, { action });
    await loadRequests();
    if (action === 'accept') await loadFriends();
  } catch (e) {
    requestsError.value = e.message || '操作失败';
  }
}

async function addFriend() {
  addError.value = '';
  addMsg.value = '';
  const to = addUsername.value.trim();
  if (!to) {
    addError.value = '请输入用户名';
    return;
  }
  try {
    await http.post('/api/friends/request', { to, message: '' });
    addMsg.value = '好友申请已发送';
    addUsername.value = '';
  } catch (e) {
    addError.value = e.message || '发送失败';
  }
}

async function removeFriend(id) {
  friendsError.value = '';
  try {
    await http.del(`/api/friends/${id}`);
    await loadFriends();
  } catch (e) {
    friendsError.value = e.message || '删除失败';
  }
}
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  padding: 24px;
  background: var(--bg);
}
.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1080px;
  margin: 0 auto 20px;
}
.page-head h1 { font-size: 20px; }
.back {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel);
}
.back:hover { background: var(--hover); }
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  max-width: 1080px;
  margin: 0 auto;
  align-items: start;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.card h2 { font-size: 16px; }
.avatar-row { display: flex; align-items: center; gap: 14px; }
.upload {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
}
.upload:hover { background: var(--hover); }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.field input, .field textarea, .field select {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
}
.field textarea { resize: vertical; }
.field input:disabled { opacity: 0.6; cursor: not-allowed; }
.primary {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.primary:hover { background: var(--accent-strong); }
.primary:disabled { opacity: 0.6; cursor: default; }
.primary.sm { padding: 6px 12px; font-size: 13px; }
.ghost {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  font-size: 13px;
}
.ghost:hover { background: var(--hover); }
.danger {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--red);
  color: var(--red);
  font-size: 13px;
}
.danger:hover { background: var(--red); color: #fff; }
.error { color: var(--red); font-size: 13px; }
.ok { color: var(--green); font-size: 13px; }
.empty { color: var(--muted); font-size: 13px; }
.add-form { display: flex; gap: 8px; }
.add-form input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); }
.request {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.request:last-child { border-bottom: none; }
.request-body { flex: 1; min-width: 0; }
.request-name { font-weight: 600; font-size: 14px; }
.request-msg { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-actions { display: flex; gap: 6px; flex-shrink: 0; }
.friend {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.friend-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
