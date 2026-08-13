<template>
  <div class="auth-wrap">
    <form class="card" @submit.prevent="submit">
      <h1>JoyChat</h1>
      <p class="sub">创建账号</p>
      <input v-model="username" placeholder="用户名" autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">注册</button>
      <router-link to="/login">已有账号？登录</router-link>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http.js';
import { storeLogin } from '../stores/auth.js';

const router = useRouter();
const username = ref(''); const password = ref(''); const error = ref(''); const loading = ref(false);

function validate() {
  const u = username.value.trim();
  if (u.length < 2 || u.length > 20) return '用户名需 2-20 个字符';
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return '用户名只能包含字母、数字和下划线';
  if (password.value.length < 8 || password.value.length > 128) return '密码需 8-128 位';
  if (!/[a-zA-Z]/.test(password.value)) return '密码须包含字母';
  if (!/[0-9]/.test(password.value)) return '密码须包含数字';
  return '';
}

async function submit() {
  error.value = validate(); if (error.value) return;
  loading.value = true;
  try {
    const data = await http.post('/api/register', { username: username.value.trim(), password: password.value });
    storeLogin({ ...data, username: username.value.trim(), nickname: username.value.trim() });
    router.push('/');
  } catch (e) {
    error.value = e.message || '注册失败';
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
.error { color: var(--red); font-size: 13px; }
</style>
