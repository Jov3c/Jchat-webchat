<template>
  <Teleport to="body">
    <div v-if="sessionReplaced" class="sr-overlay">
      <div class="sr-card">
        <div class="sr-title">账号在别处登录</div>
        <div class="sr-text">您的账号已在其他设备登录，当前会话已失效。</div>
        <div class="sr-actions">
          <button class="sr-ok" @click="goLogin">确定</button>
          <button class="sr-relogin" @click="goLogin">重新登录</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { clearLogin } from '../stores/auth.js';
import { useSessionReplaced } from '../stores/session.js';

const sessionReplaced = useSessionReplaced();

function goLogin() {
  clearLogin();
  location.href = '/login';
}
</script>

<style scoped>
.sr-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: grid; place-items: center;
  background: rgba(20, 18, 14, 0.5);
  backdrop-filter: blur(4px);
}
.sr-card {
  width: 320px; padding: 26px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
  text-align: center;
}
.sr-title { font-weight: 600; font-size: 16px; }
.sr-text { color: var(--muted); font-size: 14px; margin-top: 10px; line-height: 1.6; }
.sr-actions { display: flex; gap: 10px; margin-top: 20px; }
.sr-ok, .sr-relogin { flex: 1; padding: 9px; border-radius: 9px; font-size: 14px; cursor: pointer; }
.sr-ok { border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.sr-ok:hover { background: var(--hover); }
.sr-relogin { border: 0; background: var(--accent); color: #fff; font-weight: 600; }
.sr-relogin:hover { background: var(--accent-strong); }
</style>
