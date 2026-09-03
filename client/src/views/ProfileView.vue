<template>
  <div class="profile-page">
    <header class="page-head">
      <button class="back" @click="router.back()" aria-label="返回">← 返回</button>
      <h1>个人资料</h1>
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
        <h2>通知设置</h2>
        <label class="toggle-row">
          <span>桌面通知</span>
          <button type="button" class="switch" :class="{ on: notifyEnabled }" @click="toggleNotify" aria-label="桌面通知开关"><span class="knob"></span></button>
        </label>
        <label class="toggle-row">
          <span>提示音</span>
          <button type="button" class="switch" :class="{ on: soundEnabled }" @click="toggleSound" aria-label="提示音开关"><span class="knob"></span></button>
        </label>
      </section>

      <section class="card">
        <h2>恢复码</h2>
        <p class="muted">忘记密码时，恢复码是找回私聊的唯一钥匙，请妥善保管。</p>
        <p class="muted">{{ recoveryConfigured ? '当前账号已设置恢复码。' : '当前账号还没有恢复码。' }}</p>
        <template v-if="!showRecoveryForm">
          <button class="ghost" @click="openRecoveryForm">{{ recoveryConfigured ? '重新生成恢复码' : '生成恢复码' }}</button>
        </template>
        <template v-else>
          <PasswordInput v-model="recoveryPassword" placeholder="输入当前密码确认" autocomplete="current-password" />
          <div class="add-form">
            <button class="primary sm" :disabled="recoveryBusy" @click="createRecovery">确认生成</button>
            <button class="ghost" @click="showRecoveryForm = false">取消</button>
          </div>
        </template>
        <p v-if="recoveryError" class="error">{{ recoveryError }}</p>
        <div v-if="newRecoveryCode" class="recovery-result">
          <p class="warn">请抄下来妥善保存，此码只显示这一次；重新生成后旧码立即作废。</p>
          <code class="recovery-code">{{ formatRecovery(newRecoveryCode) }}</code>
          <button class="ghost" @click="copyRecovery">复制</button>
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
import { isNotifyEnabled, setNotifyEnabled, isSoundEnabled, setSoundEnabled } from '../utils/notify.js';
import { generateRecoveryKey, useKeys } from '../stores/keys.js';
import Avatar from '../components/Avatar.vue';
import PasswordInput from '../components/PasswordInput.vue';

const router = useRouter();

const me = ref({ ...(getUser() || {}) });

const profileError = ref('');
const profileMsg = ref('');
const saving = ref(false);

const notifyEnabled = ref(isNotifyEnabled());
const soundEnabled = ref(isSoundEnabled());
function toggleNotify() { notifyEnabled.value = !notifyEnabled.value; setNotifyEnabled(notifyEnabled.value); }
function toggleSound() { soundEnabled.value = !soundEnabled.value; setSoundEnabled(soundEnabled.value); }

const showRecoveryForm = ref(false);
const recoveryPassword = ref('');
const recoveryBusy = ref(false);
const recoveryError = ref('');
const newRecoveryCode = ref('');
const recoveryConfigured = ref(false);

function openRecoveryForm() {
  showRecoveryForm.value = true;
  recoveryPassword.value = '';
  recoveryError.value = '';
  newRecoveryCode.value = '';
}
function formatRecovery(code) { return code.replace(/(.{4})/g, '$1 ').trim(); }
function copyRecovery() {
  try { navigator.clipboard.writeText(newRecoveryCode.value); } catch { /* 忽略 */ }
}
async function createRecovery() {
  recoveryError.value = '';
  if (!recoveryPassword.value) { recoveryError.value = '请输入当前密码'; return; }
  recoveryBusy.value = true;
  try {
    await http.post('/api/profile/verify-password', { password: recoveryPassword.value });
    const keys = useKeys();
    if (!keys.ready) { recoveryError.value = '密钥未就绪，请重新登录后重试'; return; }
    const recovery = await generateRecoveryKey();
    if (!recovery) { recoveryError.value = '生成恢复码失败'; return; }
    await http.put('/api/profile/recovery', { recovery_key: recovery.recovery_key, recovery_code: recovery.code });
    newRecoveryCode.value = recovery.code;
    recoveryConfigured.value = true;
    showRecoveryForm.value = false;
    recoveryPassword.value = '';
  } catch (e) {
    recoveryError.value = e.message || '生成恢复码失败';
  } finally {
    recoveryBusy.value = false;
  }
}

onMounted(() => {
  loadProfile();
});

async function loadProfile() {
  if (!me.value.id) return;
  try {
    const data = await http.get(`/api/profile/${me.value.id}`);
    if (data && data.id != null) me.value = { ...me.value, ...data };
    recoveryConfigured.value = !!data.has_recovery;
  } catch (e) {
    profileError.value = e.message || '加载资料失败';
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
.muted { color: var(--muted); font-size: 13px; }
.warn { color: var(--red); font-size: 13px; line-height: 1.6; }
.recovery-result { display: flex; flex-direction: column; gap: 10px; }
.recovery-code { font-family: var(--mono); font-size: 17px; letter-spacing: 1px; padding: 12px; background: var(--bg); border-radius: var(--radius-sm); text-align: center; user-select: all; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.switch {
  width: 42px; height: 24px; border-radius: 999px; border: 0;
  background: var(--border); cursor: pointer; position: relative; transition: background 0.15s ease;
}
.switch.on { background: var(--accent); }
.switch .knob {
  position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 999px;
  background: #fff; transition: left 0.15s ease;
}
.switch.on .knob { left: 21px; }
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
