<template>
  <Teleport to="body">
    <Transition name="em">
      <div class="em-overlay" @click.self="close" @keydown.esc="close">
        <div class="em-card">
          <div class="em-head">
            <span class="em-title">编辑个人资料</span>
            <button class="em-close" @click="close" aria-label="关闭">×</button>
          </div>

          <div class="em-avatar">
            <Avatar :src="form.avatar" :name="form.nickname || form.username" :size="56" />
            <button type="button" class="em-upload" @click="pickAvatar">更换头像</button>
            <input ref="fileInput" type="file" accept="image/*" @change="onAvatarChange" style="display: none" />
          </div>

          <label class="em-field">
            <span>用户名</span>
            <input v-model="form.nickname" ref="nickInput" placeholder="用户名" />
          </label>
          <label class="em-field">
            <span>简介</span>
            <textarea v-model="form.bio" rows="3" placeholder="介绍一下自己"></textarea>
          </label>
          <label class="em-field">
            <span>性别</span>
            <select v-model="form.gender">
              <option value="other">保密</option>
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </label>

          <p v-if="error" class="em-error">{{ error }}</p>
          <p v-if="msg" class="em-ok">{{ msg }}</p>

          <div class="em-actions">
            <button class="em-cancel" @click="close">取消</button>
            <button class="em-save" @click="save" :disabled="saving">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';
import { getUser, updateUser, getToken } from '../stores/auth.js';
import Avatar from './Avatar.vue';

const emit = defineEmits(['close', 'saved']);

const form = ref({ ...(getUser() || {}) });
const error = ref('');
const msg = ref('');
const saving = ref(false);
const nickInput = ref(null);
const fileInput = ref(null);

onMounted(() => { nickInput.value?.focus(); });

function close() { emit('close'); }
function pickAvatar() { fileInput.value?.click(); }

async function save() {
  error.value = '';
  msg.value = '';
  if (!form.value.id) { error.value = '未登录'; return; }
  saving.value = true;
  try {
    await http.put(`/api/profile/${form.value.id}`, {
      nickname: form.value.nickname,
      bio: form.value.bio,
      gender: form.value.gender
    });
    updateUser({ ...(getUser() || {}), nickname: form.value.nickname, bio: form.value.bio, gender: form.value.gender });
    msg.value = '已保存';
    emit('saved');
    close();
  } catch (e) {
    error.value = e.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

async function onAvatarChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  error.value = '';
  try {
    const f = new FormData();
    f.append('avatar', file);
    const res = await fetch('/api/upload/avatar', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: f
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `上传失败 (${res.status})`);
    updateUser({ ...(getUser() || {}), avatar: data.avatar });
    form.value.avatar = data.avatar;
    msg.value = '头像已更新';
  } catch (err) {
    error.value = err.message || '头像上传失败';
  } finally {
    e.target.value = '';
  }
}
</script>

<style scoped>
.em-overlay {
  position: fixed; inset: 0; z-index: 101;
  display: grid; place-items: center;
  background: rgba(20, 18, 14, 0.45);
  backdrop-filter: blur(2px);
}
.em-card {
  width: 360px; max-height: 85vh; overflow-y: auto; padding: 22px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.em-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.em-title { font-weight: 600; font-size: 16px; }
.em-close { border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px; }
.em-close:hover { color: var(--text); }
.em-avatar { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.em-upload { padding: 6px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); font-size: 13px; cursor: pointer; }
.em-upload:hover { background: var(--hover); }
.em-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.em-field input, .em-field textarea, .em-field select {
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px;
}
.em-field textarea { resize: vertical; }
.em-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
.em-cancel { padding: 8px 16px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); font-size: 13px; cursor: pointer; }
.em-cancel:hover { background: var(--hover); }
.em-save { padding: 8px 18px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
.em-save:disabled { opacity: 0.6; cursor: default; }
.em-error { color: var(--red); font-size: 12px; margin-top: 4px; }
.em-ok { color: var(--green); font-size: 12px; margin-top: 4px; }

.em-enter-active, .em-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.em-enter-from, .em-leave-to { opacity: 0; transform: scale(0.96); }
</style>
