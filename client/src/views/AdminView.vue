<template>
  <div class="admin-wrap">
    <!-- 管理员登录门 -->
    <form v-if="!adminToken" class="login-card" @submit.prevent="submitLogin">
      <h1>管理后台</h1>
      <p class="sub">管理员登录</p>
      <input v-model="loginUsername" placeholder="用户名" autocomplete="username" />
      <input v-model="loginPassword" type="password" placeholder="密码" autocomplete="current-password" />
      <p v-if="loginError" class="error">{{ loginError }}</p>
      <button class="primary" type="submit" :disabled="loginLoading">{{ loginLoading ? '登录中…' : '登录' }}</button>
    </form>

    <!-- 管理面板 -->
    <div v-else class="panel">
      <header class="panel-head">
        <h1>管理后台</h1>
        <button class="ghost" @click="logout">退出管理</button>
      </header>

      <p v-if="error" class="error">{{ error }}</p>

      <section class="card">
        <h2>用户管理</h2>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>昵称</th>
                <th>邮箱</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>{{ u.username }}</td>
                <td>{{ u.nickname }}</td>
                <td>{{ u.email }}</td>
                <td>
                  <span v-if="u.banned" class="badge banned">已封禁</span>
                  <span v-else class="badge active">正常</span>
                </td>
                <td>{{ formatDate(u.created_at) }}</td>
                <td class="actions">
                  <template v-if="u.banned">
                    <button class="btn" @click="unbanUser(u)">解封</button>
                  </template>
                  <template v-else>
                    <button class="btn warn" @click="banUser(u)">封禁</button>
                  </template>
                  <button class="btn danger" @click="deleteUser(u)">删除</button>
                </td>
              </tr>
              <tr v-if="!users.length">
                <td colspan="6" class="empty">暂无用户</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>注销申请</h2>
        <div v-if="!requests.length" class="empty">暂无注销申请</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>原因</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in requests" :key="r.id">
              <td>{{ r.username }}</td>
              <td>{{ r.reason }}</td>
              <td>
                <span class="badge" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span>
              </td>
              <td>{{ formatDate(r.created_at) }}</td>
              <td class="actions">
                <template v-if="r.status === 'pending'">
                  <button class="btn ok" @click="resolveRequest(r, 'approve')">通过</button>
                  <button class="btn danger" @click="resolveRequest(r, 'reject')">拒绝</button>
                </template>
                <span v-else class="muted">已处理</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>消息重置</h2>
        <p class="muted">清空所有聊天消息，此操作不可撤销。</p>
        <button class="btn danger" @click="resetMessages">重置消息</button>
      </section>

      <section class="card">
        <h2>日志</h2>
        <div class="logs-grid">
          <ul class="log-list">
            <li v-for="f in logFiles" :key="f.filename" class="log-item" @click="loadLog(f.filename)">
              <span class="log-name">{{ f.filename }}</span>
              <span class="log-size">{{ formatSize(f.size) }}</span>
            </li>
            <li v-if="!logFiles.length" class="empty">暂无日志文件</li>
          </ul>
          <div class="log-view">
            <div v-if="activeLog" class="log-view-head">
              <strong>{{ activeLog }}</strong>
              <span v-if="logTotal != null" class="muted">共 {{ logTotal }} 条</span>
            </div>
            <pre v-if="logView !== null" class="log-pre">{{ logView }}</pre>
            <p v-else class="muted">点击左侧日志文件查看内容</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { http } from '../api/http.js';

const adminToken = ref(sessionStorage.getItem('admin_token'));

// 登录门
const loginUsername = ref('');
const loginPassword = ref('');
const loginError = ref('');
const loginLoading = ref(false);

// 全局错误行
const error = ref('');

// 用户
const users = ref([]);
// 注销申请
const requests = ref([]);
// 日志
const logFiles = ref([]);
const activeLog = ref('');
const logView = ref(null);
const logTotal = ref(null);

async function submitLogin() {
  loginError.value = '';
  loginLoading.value = true;
  try {
    const data = await http.post('/api/admin/login', {
      username: loginUsername.value,
      password: loginPassword.value
    });
    adminToken.value = data.token;
    sessionStorage.setItem('admin_token', data.token);
    await loadAll();
  } catch (e) {
    loginError.value = e.message || '登录失败';
  } finally {
    loginLoading.value = false;
  }
}

function logout() {
  sessionStorage.removeItem('admin_token');
  adminToken.value = null;
  users.value = [];
  requests.value = [];
  logFiles.value = [];
  logView.value = null;
  activeLog.value = '';
  error.value = '';
}

function clearError() { error.value = ''; }

async function loadUsers() {
  const data = await http.get('/api/admin/users');
  users.value = Array.isArray(data) ? data : (data.users || []);
}

async function loadRequests() {
  const data = await http.get('/api/admin/deactivation-requests');
  requests.value = data.requests || [];
}

async function loadLogs() {
  const data = await http.get('/api/admin/logs/list');
  logFiles.value = data.logFiles || [];
}

async function loadAll() {
  try {
    clearError();
    await Promise.all([loadUsers(), loadRequests(), loadLogs()]);
  } catch (e) {
    error.value = e.message || '加载失败';
  }
}

async function banUser(u) {
  if (!window.confirm(`确认封禁用户「${u.username}」？`)) return;
  try {
    clearError();
    await http.put(`/api/admin/users/${u.id}/ban`);
    await loadUsers();
  } catch (e) {
    error.value = e.message || '封禁失败';
  }
}

async function unbanUser(u) {
  try {
    clearError();
    await http.put(`/api/admin/users/${u.id}/unban`);
    await loadUsers();
  } catch (e) {
    error.value = e.message || '解封失败';
  }
}

async function deleteUser(u) {
  if (!window.confirm(`确认删除用户「${u.username}」？此操作不可撤销。`)) return;
  try {
    clearError();
    await http.del(`/api/admin/users/${u.id}`);
    await loadUsers();
  } catch (e) {
    error.value = e.message || '删除失败';
  }
}

async function resolveRequest(r, action) {
  try {
    clearError();
    await http.put(`/api/admin/deactivation-requests/${r.id}`, { action });
    await loadRequests();
  } catch (e) {
    error.value = e.message || '操作失败';
  }
}

async function resetMessages() {
  if (!window.confirm('确认重置所有聊天消息？此操作不可撤销。')) return;
  try {
    clearError();
    await http.post('/api/admin/reset-messages');
    error.value = '消息已重置';
  } catch (e) {
    error.value = e.message || '重置失败';
  }
}

async function loadLog(filename) {
  try {
    clearError();
    activeLog.value = filename;
    const data = await http.get('/api/admin/logs/content/' + encodeURIComponent(filename));
    logTotal.value = data.total;
    if (Array.isArray(data.logs)) logView.value = data.logs.join('\n');
    else if (typeof data.logs === 'string') logView.value = data.logs;
    else logView.value = JSON.stringify(data.logs, null, 2);
  } catch (e) {
    error.value = e.message || '加载日志失败';
  }
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return s ? String(s) : '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function statusLabel(s) {
  if (s === 'pending') return '待处理';
  if (s === 'approved') return '已通过';
  if (s === 'rejected') return '已拒绝';
  return s || '—';
}

function statusClass(s) {
  if (s === 'approved') return 'active';
  if (s === 'rejected') return 'banned';
  return 'pending';
}

if (adminToken.value) loadAll();
</script>

<style scoped>
.admin-wrap { min-height: 100vh; background: var(--bg); color: var(--text); }

/* 登录门 */
.login-card {
  min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
  gap: 14px; width: 320px; margin: 0 auto; padding: 32px;
}
.login-card h1 { font-size: 24px; text-align: center; }
.sub { text-align: center; color: var(--muted); }
.login-card input { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel); }
.primary { padding: 10px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.primary:disabled { opacity: 0.6; cursor: not-allowed; }

/* 面板 */
.panel { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; display: flex; flex-direction: column; gap: 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; }
.panel-head h1 { font-size: 22px; }
.ghost { padding: 8px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--muted); }
.ghost:hover { background: var(--hover); }

.card {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px;
  display: flex; flex-direction: column; gap: 14px;
}
.card h2 { font-size: 16px; }

.error { color: var(--red); font-size: 13px; }
.muted { color: var(--muted); font-size: 13px; }
.empty { color: var(--muted); text-align: center; padding: 16px 0; }

/* 表格 */
.table-scroll { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
.table th { color: var(--muted); font-weight: 600; }
.table tbody tr:hover { background: var(--hover); }

.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
.badge.banned { background: rgba(226, 83, 83, 0.12); color: var(--red); }
.badge.active { background: rgba(70, 160, 73, 0.12); color: var(--green); }
.badge.pending { background: rgba(240, 180, 41, 0.15); color: var(--yellow); }

.actions { display: flex; gap: 8px; }
.btn { padding: 5px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; }
.btn:hover { background: var(--hover); }
.btn.warn { color: var(--yellow); }
.btn.ok { color: var(--green); }
.btn.danger { color: var(--red); border-color: rgba(226, 83, 83, 0.4); }

/* 日志 */
.logs-grid { display: grid; grid-template-columns: 260px 1fr; gap: 16px; }
.log-list { list-style: none; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow-y: auto; max-height: 420px; }
.log-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); font-size: 13px; }
.log-item:last-child { border-bottom: none; }
.log-item:hover { background: var(--hover); }
.log-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-size { color: var(--muted); font-size: 12px; flex-shrink: 0; }
.log-view { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.log-view-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.log-pre {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 12px; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 420px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; white-space: pre-wrap; word-break: break-all;
}

@media (max-width: 720px) {
  .logs-grid { grid-template-columns: 1fr; }
}
</style>
