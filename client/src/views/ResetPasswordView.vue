<template>
  <div class="auth-wrap">
    <form class="card" @submit.prevent="submit">
      <h1>JoyChat</h1>
      <p class="sub">用恢复码重置密码</p>
      <input v-model="username" placeholder="账号" autocomplete="username" />
      <input v-model="recoveryCode" placeholder="恢复码" autocomplete="off" spellcheck="false" />
      <PasswordInput v-model="password" placeholder="新密码（至少 6 位，含字母和数字）" autocomplete="new-password" />
      <PasswordInput v-model="confirm" placeholder="再次输入新密码" autocomplete="new-password" />
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">{{ loading ? '处理中…' : '重置密码' }}</button>
      <router-link to="/login">返回登录</router-link>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http.js';
import PasswordInput from '../components/PasswordInput.vue';
import { unwrapPrivateKeyWithRecovery, randomSalt, deriveKek, wrapPrivateKey, bufToB64 } from '../stores/e2ee.js';

const router = useRouter();
const username = ref(''); const recoveryCode = ref('');
const password = ref(''); const confirm = ref('');
const error = ref(''); const loading = ref(false);

function validate() {
  const u = username.value.trim();
  const code = recoveryCode.value.trim();
  if (!u || !code) return '请填写账号和恢复码';
  if (password.value.length < 6 || password.value.length > 128) return '密码需 6-128 位';
  if (!/[a-zA-Z]/.test(password.value)) return '密码须包含字母';
  if (!/[0-9]/.test(password.value)) return '密码须包含数字';
  if (password.value !== confirm.value) return '两次输入的密码不一致';
  return '';
}

async function submit() {
  error.value = validate();
  if (error.value) return;
  loading.value = true;
  try {
    const verify = await http.post('/api/recovery/verify', {
      username: username.value.trim(),
      recovery_code: recoveryCode.value.trim()
    });
    const privateKey = await unwrapPrivateKeyWithRecovery(verify.recovery_key, recoveryCode.value.trim());
    if (!privateKey) { error.value = '恢复码不正确或账号错误'; return; }
    const salt = randomSalt();
    const kek = await deriveKek(password.value, salt);
    const encrypted_private_key = await wrapPrivateKey(privateKey, kek);
    await http.post('/api/reset-password', {
      username: username.value.trim(),
      recovery_code: recoveryCode.value.trim(),
      new_password: password.value,
      new_salt: bufToB64(salt.buffer),
      new_encrypted_private_key: encrypted_private_key
    });
    router.push('/login');
  } catch (e) {
    error.value = e.message || '重置失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-wrap { height: 100vh; display: grid; place-items: center; background: var(--bg); }
.card { display: flex; flex-direction: column; gap: 14px; width: 320px; padding: 32px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.card h1 { font-family: var(--font-display); font-size: 28px; font-weight: 600; text-align: center; letter-spacing: 0.2px; }
.sub { text-align: center; color: var(--muted); }
input { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.primary { padding: 10px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.primary:disabled { opacity: 0.6; cursor: default; }
.error { color: var(--red); font-size: 13px; }
</style>
