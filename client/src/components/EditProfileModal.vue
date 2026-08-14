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
            <label class="em-upload">
              更换头像
              <input type="file" accept="image/*" @change="onAvatarChange" class="em-file" />
            </label>
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

          <div class="em-divider"></div>
          <div class="em-pw-title">修改密码</div>
          <label class="em-field">
            <span>当前密码</span>
            <input v-model="curPw" type="password" placeholder="当前密码" />
          </label>
          <label class="em-field">
            <span>新密码</span>
            <input v-model="newPw" type="password" placeholder="新密码（至少 6 位，含字母和数字）" />
          </label>
          <label class="em-field">
            <span>确认新密码</span>
            <input v-model="confirmPw" type="password" placeholder="再次输入新密码" />
          </label>
          <p v-if="pwError" class="em-error">{{ pwError }}</p>
          <p v-if="pwMsg" class="em-ok">{{ pwMsg }}</p>
          <button class="em-change-pw" @click="changePassword" :disabled="pwSaving">修改密码</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';
import { getUser, updateUser, getToken } from '../stores/auth.js';
import { rewrapKeys } from '../stores/keys.js';
import Avatar from './Avatar.vue';

const emit = defineEmits(['close', 'saved']);

const form = ref({ ...(getUser() || {}) });
const error = ref('');
const msg = ref('');
const saving = ref(false);
const nickInput = ref(null);

const curPw = ref('');
const newPw = ref('');
const confirmPw = ref('');
const pwError = ref('');
const pwMsg = ref('');
const pwSaving = ref(false);

onMounted(() => { nickInput.value?.focus(); });

function close() { emit('close'); }

async function changePassword() {
  pwError.value = '';
  pwMsg.value = '';
  if (newPw.value.length < 6 || newPw.value.length > 128) { pwError.value = '新密码需 6-128 位'; return; }
  if (!/[a-zA-Z]/.test(newPw.value) || !/[0-9]/.test(newPw.value)) { pwError.value = '新密码须包含字母和数字'; return; }
  if (newPw.value !== confirmPw.value) { pwError.value = '两次输入的新密码不一致'; return; }
  pwSaving.value = true;
  try {
    const rewrap = await rewrapKeys(newPw.value);
    const body = { currentPassword: curPw.value, newPassword: newPw.value };
    if (rewrap) {
      body.salt = rewrap.salt;
      body.encrypted_private_key = rewrap.encrypted_private_key;
    }
    await http.post('/api/change-password', body);
    pwMsg.value = '密码已修改';
    curPw.value = ''; newPw.value = ''; confirmPw.value = '';
  } catch (e) {
    pwError.value = e.message || '修改失败';
  } finally {
    pwSaving.value = false;
  }
}

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
.em-upload { position: relative; display: inline-block; overflow: hidden; padding: 6px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); font-size: 13px; cursor: pointer; }
.em-upload:hover { background: var(--hover); }
.em-file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
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
.em-divider { height: 1px; background: var(--border); margin: 16px 0 12px; }
.em-pw-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
.em-change-pw { width: 100%; padding: 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); font-size: 13px; cursor: pointer; }
.em-change-pw:hover { background: var(--hover); }
.em-change-pw:disabled { opacity: 0.6; cursor: default; }

.em-enter-active, .em-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.em-enter-from, .em-leave-to { opacity: 0; transform: scale(0.96); }
</style>
