<template>
  <div class="auth-wrap">
    <form class="card" @submit.prevent="submit">
      <h1>JoyChat</h1>
      <p class="sub">注册新账号</p>
      <input v-model="account" placeholder="账号（登录用，创建后不可改）" autocomplete="username" />
      <input v-model="nickname" placeholder="用户名（显示名，之后可改）" />
      <PasswordInput v-model="password" placeholder="密码（至少 6 位，含字母和数字）" autocomplete="new-password" />
      <PasswordInput v-model="confirm" placeholder="再次输入密码" autocomplete="new-password" />
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">注册</button>
      <router-link to="/login">已有账号？登录</router-link>
    </form>

    <div v-if="showRecoveryModal" class="recovery-overlay">
      <div class="recovery-modal">
        <h2>保存你的恢复码</h2>
        <p class="recovery-warn">忘记密码时，恢复码是找回私聊的唯一钥匙。<b>请抄下来妥善保存，它只显示这一次。</b></p>
        <code class="recovery-code">{{ formatRecovery(recoveryCode) }}</code>
        <div class="recovery-actions">
          <button type="button" class="ghost" @click="copyRecovery">复制恢复码</button>
          <button type="button" class="primary" @click="confirmRecovery">我已保存，进入 JoyChat</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http.js';
import { storeLogin } from '../stores/auth.js';
import { setupKeys, generateRecoveryKey } from '../stores/keys.js';
import PasswordInput from '../components/PasswordInput.vue';

const router = useRouter();
const account = ref(''); const nickname = ref(''); const password = ref(''); const confirm = ref('');
const error = ref(''); const loading = ref(false);
const recoveryCode = ref('');
const showRecoveryModal = ref(false);

function validate() {
  const u = account.value.trim();
  if (u.length < 2 || u.length > 20) return '账号需 2-20 个字符';
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return '账号只能包含字母、数字和下划线';
  const n = nickname.value.trim();
  if (!n) return '请填写用户名';
  if (n.length > 20) return '用户名最多 20 个字符';
  if (password.value.length < 6 || password.value.length > 128) return '密码需 6-128 位';
  if (!/[a-zA-Z]/.test(password.value)) return '密码须包含字母';
  if (!/[0-9]/.test(password.value)) return '密码须包含数字';
  if (password.value !== confirm.value) return '两次输入的密码不一致';
  return '';
}

async function submit() {
  error.value = validate(); if (error.value) return;
  loading.value = true;
  try {
    const data = await http.post('/api/register', {
      username: account.value.trim(),
      nickname: nickname.value.trim(),
      password: password.value
    });
    storeLogin(data);
    const keysReady = await setupKeys(password.value, data);
    if (keysReady.ready) {
      const recovery = await generateRecoveryKey();
      if (recovery) {
        try {
          await http.put('/api/profile/recovery', { recovery_key: recovery.recovery_key, recovery_code: recovery.code });
          recoveryCode.value = recovery.code;
          showRecoveryModal.value = true;
        } catch { /* 生成失败不阻断注册，稍后可补 */ }
      }
    }
    if (!showRecoveryModal.value) router.push('/');
  } catch (e) {
    error.value = e.message || '注册失败';
  } finally {
    loading.value = false;
  }
}

function formatRecovery(code) { return code.replace(/(.{4})/g, '$1 ').trim(); }
async function copyRecovery() {
  try { await navigator.clipboard.writeText(recoveryCode.value); } catch { /* 忽略 */ }
}
function confirmRecovery() { showRecoveryModal.value = false; router.push('/'); }
</script>

<style scoped>
.auth-wrap { height: 100vh; display: grid; place-items: center; background: var(--bg); }
.card { display: flex; flex-direction: column; gap: 12px; width: 340px; padding: 32px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.card h1 { font-family: var(--font-display); font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 0.2px; }
.sub { text-align: center; color: var(--muted); }
input { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.primary { padding: 10px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.error { color: var(--red); font-size: 13px; }

.recovery-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: rgba(0,0,0,.45); }
.recovery-modal { width: min(420px, 90vw); padding: 28px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 14px; }
.recovery-modal h2 { font-size: 18px; }
.recovery-warn { color: var(--muted); font-size: 13px; line-height: 1.6; }
.recovery-code { font-family: var(--mono); font-size: 18px; letter-spacing: 1px; padding: 12px; background: var(--bg); border-radius: var(--radius-sm); text-align: center; user-select: all; }
.recovery-actions { display: flex; gap: 10px; }
.recovery-actions .ghost, .recovery-actions .primary { flex: 1; padding: 10px; border-radius: var(--radius-sm); font-size: 14px; }
.ghost { background: var(--bg); border: 1px solid var(--border); color: var(--text); cursor: pointer; }
.ghost:hover { background: var(--hover); }
</style>
