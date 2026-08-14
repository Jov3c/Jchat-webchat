<template>
  <Teleport to="body">
    <Transition name="cman">
      <div class="cman-overlay" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div class="cman-card">
          <div class="cman-head">
            <span class="cman-title">频道管理</span>
            <button class="cman-close" @click="$emit('close')" aria-label="关闭">×</button>
          </div>

          <form class="cman-add" @submit.prevent="create">
            <input v-model="name" placeholder="新频道名称" />
            <button type="submit" class="cman-btn">创建</button>
          </form>
          <p v-if="error" class="cman-error">{{ error }}</p>
          <p v-if="msg" class="cman-ok">{{ msg }}</p>

          <div class="cman-section">
            <span class="cman-label">频道邀请</span>
            <span v-if="invites.length" class="cman-badge">{{ invites.length }}</span>
          </div>
          <div v-if="!invites.length" class="cman-empty">暂无邀请</div>
          <div v-for="inv in invites" :key="inv.id" class="cman-invite">
            <span class="cman-name">#{{ inv.channel }} · {{ inv.inviter.nickname || inv.inviter.username }} 邀请你</span>
            <div class="cman-actions">
              <button class="cman-accept" @click="respond(inv.id, 'accept')">接受</button>
              <button class="cman-reject" @click="respond(inv.id, 'reject')">拒绝</button>
            </div>
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

const name = ref('');
const invites = ref([]);
const error = ref('');
const msg = ref('');

onMounted(loadInvites);

async function loadInvites() {
  try {
    const data = await http.get('/api/channel/invites');
    invites.value = data.invites || data || [];
  } catch { invites.value = []; }
}

async function create() {
  const n = name.value.trim();
  if (!n) { error.value = '请输入频道名称'; return; }
  error.value = '';
  try {
    await http.post('/api/channels', { name: n });
    name.value = '';
    msg.value = '频道已创建';
    emit('changed');
  } catch (e) {
    error.value = e.message || '创建失败';
  }
}

async function respond(id, action) {
  error.value = '';
  try {
    await http.post(`/api/channel/invites/${id}/respond`, { action });
    await loadInvites();
    emit('changed');
  } catch (e) {
    error.value = e.message || '操作失败';
  }
}
</script>

<style scoped>
.cman-overlay { position: fixed; inset: 0; z-index: 96; background: rgba(20, 18, 14, 0.25); display: grid; place-items: center; }
.cman-card {
  width: 340px; max-height: 70vh; overflow-y: auto; padding: 18px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.cman-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cman-title { font-weight: 600; font-size: 15px; }
.cman-close { border: 0; background: transparent; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.cman-close:hover { color: var(--text); }
.cman-add { display: flex; gap: 8px; margin-bottom: 4px; }
.cman-add input { flex: 1; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px; }
.cman-btn { padding: 9px 14px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
.cman-btn:hover { background: var(--accent-strong); }
.cman-section { display: flex; align-items: center; gap: 8px; margin: 14px 0 6px; }
.cman-label { font-size: 12px; font-weight: 600; color: var(--faint); }
.cman-badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--red); color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.cman-empty { color: var(--muted); font-size: 13px; padding: 6px 0; }
.cman-invite { display: flex; align-items: center; gap: 8px; padding: 7px 0; }
.cman-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.cman-actions { display: flex; gap: 6px; flex-shrink: 0; }
.cman-accept { padding: 5px 10px; border: 0; border-radius: 7px; background: var(--accent); color: #fff; font-size: 12px; cursor: pointer; }
.cman-reject { padding: 5px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); font-size: 12px; cursor: pointer; }
.cman-error { color: var(--red); font-size: 12px; margin-top: 4px; }
.cman-ok { color: var(--green); font-size: 12px; margin-top: 4px; }

.cman-enter-active, .cman-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.cman-enter-from, .cman-leave-to { opacity: 0; transform: translateY(4px); }
</style>
