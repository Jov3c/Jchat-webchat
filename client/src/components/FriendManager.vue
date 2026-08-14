<template>
  <Teleport to="body">
    <Transition name="fm">
      <div class="fm-overlay" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div class="fm-card">
          <div class="fm-head">
            <span class="fm-title">好友管理</span>
            <button class="fm-close" @click="$emit('close')" aria-label="关闭">×</button>
          </div>

          <form class="fm-add" @submit.prevent="addFriend">
            <input v-model="addAccount" placeholder="对方账号" />
            <button type="submit" class="fm-add-btn">添加</button>
          </form>
          <p v-if="addMsg" class="ok">{{ addMsg }}</p>
          <p v-if="addError" class="err">{{ addError }}</p>

          <div class="fm-section">
            <span class="fm-section-title">好友申请</span>
            <span v-if="requests.length" class="fm-badge">{{ requests.length }}</span>
          </div>
          <div v-if="!requests.length" class="fm-empty">暂无申请</div>
          <div v-for="r in requests" :key="r.id" class="fm-row">
            <span class="fm-name">{{ r.from_user.nickname || r.from_user.username }}</span>
            <div class="fm-actions">
              <button class="fm-ok" @click="respond(r.id, 'accept')">接受</button>
              <button class="fm-no" @click="respond(r.id, 'reject')">拒绝</button>
            </div>
          </div>

          <div class="fm-section"><span class="fm-section-title">好友</span></div>
          <div v-if="!friends.length" class="fm-empty">暂无好友</div>
          <div v-for="f in friends" :key="f.id" class="fm-row">
            <span class="fm-name">{{ f.nickname || f.username }}</span>
            <button class="fm-del" @click="removeFriend(f.id)">删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';

const emit = defineEmits(['close', 'changed']);

const addAccount = ref('');
const addMsg = ref('');
const addError = ref('');
const requests = ref([]);
const friends = ref([]);

onMounted(() => { loadRequests(); loadFriends(); });

async function loadRequests() {
  try {
    const data = await http.get('/api/friends/requests');
    requests.value = data.requests || data || [];
  } catch { requests.value = []; }
}

async function loadFriends() {
  try {
    const data = await http.get('/api/friends');
    friends.value = data.friends || data || [];
  } catch { friends.value = []; }
}

async function addFriend() {
  addError.value = '';
  addMsg.value = '';
  const to = addAccount.value.trim();
  if (!to) { addError.value = '请输入账号'; return; }
  try {
    await http.post('/api/friends/request', { to, message: '' });
    addMsg.value = '好友申请已发送';
    addAccount.value = '';
    emit('changed');
  } catch (e) {
    addError.value = e.message || '发送失败';
  }
}

async function respond(id, action) {
  try {
    await http.post(`/api/friends/request/${id}/respond`, { action });
    await loadRequests();
    if (action === 'accept') await loadFriends();
    emit('changed');
  } catch (e) {
    addError.value = e.message || '操作失败';
  }
}

async function removeFriend(id) {
  try {
    await http.del(`/api/friends/${id}`);
    await loadFriends();
    emit('changed');
  } catch (e) {
    addError.value = e.message || '删除失败';
  }
}
</script>

<style scoped>
.fm-overlay { position: fixed; inset: 0; z-index: 96; background: rgba(20, 18, 14, 0.25); display: grid; place-items: center; }
.fm-card {
  width: 340px; max-height: 70vh; overflow-y: auto; padding: 18px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.fm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.fm-title { font-weight: 600; font-size: 15px; }
.fm-close { border: 0; background: transparent; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.fm-close:hover { color: var(--text); }
.fm-add { display: flex; gap: 8px; margin-bottom: 6px; }
.fm-add input { flex: 1; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px; }
.fm-add-btn { padding: 9px 14px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
.fm-add-btn:hover { background: var(--accent-strong); }
.fm-section { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; }
.fm-section-title { font-size: 12px; font-weight: 600; color: var(--faint); }
.fm-badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--red); color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.fm-empty { color: var(--muted); font-size: 13px; padding: 6px 0; }
.fm-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; }
.fm-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.fm-actions { display: flex; gap: 6px; flex-shrink: 0; }
.fm-ok { padding: 5px 10px; border: 0; border-radius: 7px; background: var(--accent); color: #fff; font-size: 12px; cursor: pointer; }
.fm-no { padding: 5px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); font-size: 12px; cursor: pointer; }
.fm-del { padding: 5px 10px; border: 1px solid var(--red); border-radius: 7px; background: transparent; color: var(--red); font-size: 12px; cursor: pointer; }
.fm-del:hover { background: var(--red); color: #fff; }
.ok { color: var(--green); font-size: 12px; }
.err { color: var(--red); font-size: 12px; }

.fm-enter-active, .fm-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.fm-enter-from, .fm-leave-to { opacity: 0; transform: translateY(4px); }
</style>
