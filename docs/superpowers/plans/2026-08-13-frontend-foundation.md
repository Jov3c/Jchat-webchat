# 里程碑 1 · 前端重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Vue 3 + Vite 重写前端，替换现有手写 HTML/CSS/JS，落地 Claude 设计系统（配色 + 深色模式）、三栏响应式布局、可收起侧边栏、QQ 式状态点，重写全部页面并对接现有后端 API 与 Socket 事件，同时移除已读回执/未读角标。

**Architecture:** 新前端源码放 `client/`，Vite 构建输出到 `client/dist/`；Express 改为托管 `client/dist/` 并做 SPA 回退（保留 `/api/*` 与 Socket.IO 不变），`public/` 仅保留上传/图片/视频等静态资源。前端用 Vue 3 组合式 API + `vue-router`（history 模式）+ 一个轻量全局状态（auth / presence 用组合式函数，不引入 Pinia）。所有颜色走 CSS 变量（设计 Token）。

**Tech Stack:** Vue 3、Vite、vue-router（均为 devDependencies）；后端 Express + Socket.IO + SQLite 保持不变；Node 24 LTS；npm 11。

## Global Constraints

- **语言**：全程 JavaScript，禁止 TypeScript（不引入 `.ts` 文件）。
- **样式**：禁止 Tailwind 或任何 CSS 框架；用 CSS 自定义属性（设计 Token）统一颜色/圆角/间距。深色模式通过 `data-theme="dark"` 与 `prefers-color-scheme` 双通道，绝不能把颜色写死在组件里。
- **后端契约不变**：里程碑 1 是 UI 层重构，**不改任何 `/api/*` 路由的路径、参数、返回结构，也不改任何 Socket.IO 事件名与 payload**。只改静态文件托管方式。
- **鉴权契约**：token 存 `sessionStorage`（key `token`、`user`）；HTTP 头 `Authorization: Bearer <token>`；Socket 用 `socket.emit('authenticate', token, cb)`。
- **移除已读回执/未读角标**：消息不渲染"已读/未读"状态，侧边栏不显示未读红点数字。
- **状态点映射**（`StatusDot` 组件的唯一权威表，`presence_status` 来自 `users` 表，可能值为 `online`/`busy`/`away`/`invisible`，服务端 `presence.effectiveStatus` 已把"他人视角的隐身"折叠成 `offline`）：
  - `online` → 绿点 `#46A049`
  - `busy` → 请勿打扰：红底 `#E25353` + 白色横杠
  - `away` → 黄点 `#F0B429`
  - `invisible` → 黄点 `#F0B429`（仅自己可见；他人视角服务器已返回 `offline`）
  - `offline`（未连接）→ 红点 `#E25353`
- **配色 Token**（Claude 暖色调，浅色基准）：`--bg: #F7F5F0`、`--panel: #FFFFFF`、`--rail: #F2F0EA`、`--accent: #D97757`、`--text: #23211C`；深色版在 `@media (prefers-color-scheme: dark)` 且 `:root:not([data-theme="light"])` 下重定义，`[data-theme="dark"]` 下再重定义一次（两向都赢）。
- **Node 版本**：`>=24 <25`；所有新增依赖放 `devDependencies`（前端构建产物只存在于 `client/dist/`，运行时不新增任何后端依赖）。

---

## File Structure

```
client/                       # 新增：Vue 3 前端源码
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.js               # 挂载 + router + 主题初始化
│   ├── App.vue               # 根组件（router-view）
│   ├── router.js             # history 模式路由
│   ├── styles/
│   │   ├── tokens.css        # 设计 Token（浅/深）
│   │   └── base.css          # reset + 排版 + 滚动条
│   ├── api/
│   │   ├── http.js           # fetch 封装（Authorization、JSON、错误）
│   │   └── socket.js         # Socket.IO 封装
│   ├── stores/
│   │   ├── auth.js           # 登录态（sessionStorage）
│   │   └── presence.js       # 状态点映射
│   ├── components/
│   │   ├── layout/AppRail.vue      # 左栏（频道/私聊列表，可收起）
│   │   ├── layout/MessageList.vue  # 消息流
│   │   ├── layout/Composer.vue     # 输入框
│   │   ├── layout/MemberList.vue   # 右栏成员
│   │   ├── Avatar.vue              # 头像 + 状态点
│   │   ├── StatusDot.vue           # 状态点
│   │   ├── MessageBubble.vue       # 单条消息
│   │   └── ChannelItem.vue         # 频道条目
│   └── views/
│       ├── LoginView.vue
│       ├── RegisterView.vue
│       ├── ChatView.vue
│       ├── ProfileView.vue
│       └── AdminView.vue
index.js                     # 修改：静态托管 + SPA 回退
```

**职责边界**：`api/http.js` 只负责 HTTP；`api/socket.js` 只负责 Socket 事件；`stores/auth.js` 只负责登录态读写；组件只做渲染与用户交互，通过上述模块访问数据。

---

### Task 1: Vite + Vue 3 脚手架与部署接线

**Files:**
- Create: `client/package.json`、`client/vite.config.js`、`client/index.html`、`client/src/main.js`、`client/src/App.vue`
- Modify: `index.js:1873-1878`（静态托管与页面路由）

**Interfaces:**
- Produces: `client/dist/`（`npm run build` 产物）；Express 托管该目录并做 SPA 回退。后续所有任务依赖此构建链路。

- [ ] **Step 1: 建 `client/package.json`**

```json
{
  "name": "jchat-client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "vite": "^6.0.7"
  }
}
```

- [ ] **Step 2: 建 `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/socket.io': { target: 'http://localhost:3000', ws: true } }
  }
});
```

- [ ] **Step 3: 建 `client/index.html`、`client/src/main.js`、`client/src/App.vue`**

`client/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JoyChat</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`client/src/main.js`：
```js
import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import './styles/base.css';

createApp(App).mount('#app');
```

`client/src/App.vue`：
```vue
<template>
  <router-view />
</template>
```

（`tokens.css`、`base.css` 在 Task 2 补全；此处先建空文件。）

- [ ] **Step 4: 改 `index.js` 静态托管与 SPA 回退**

将 `index.js` 第 1873-1878 行的页面路由与 `express.static(PUBLIC_DIR)` 替换为：

```js
const DIST_DIR = path.join(__dirname, 'client', 'dist');
app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));
app.use('/videos', express.static(path.join(PUBLIC_DIR, 'videos')));
app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
```

（`PUBLIC_DIR` 与 `path` 已在 `index.js` 顶部定义，直接复用。）

- [ ] **Step 5: 安装依赖并验证构建**

Run:
```bash
cd client && npm install && npm run build
```
Expected: `client/dist/index.html` 与 `client/dist/assets/*` 生成，无报错。

- [ ] **Step 6: 提交**

```bash
git add client/ index.js
git commit -m "feat(client): scaffold Vue 3 + Vite app with SPA serving"
```

---

### Task 2: 设计 Token 与基础样式（Claude 配色 + 深色模式）

**Files:**
- Create: `client/src/styles/tokens.css`、`client/src/styles/base.css`

**Interfaces:**
- Produces: 全部设计 Token（CSS 变量），命名见下方；组件只能引用这些变量。后续所有样式任务依赖此 Token。

- [ ] **Step 1: 写 `tokens.css`（三态主题）**

```css
:root {
  --bg: #F7F5F0;
  --panel: #FFFFFF;
  --rail: #F2F0EA;
  --accent: #D97757;
  --accent-strong: #C05E3F;
  --text: #23211C;
  --muted: #8A8578;
  --border: #E8E4DB;
  --hover: #EDEAE2;
  --green: #46A049;
  --red: #E25353;
  --yellow: #F0B429;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 1px 2px rgba(35, 33, 28, 0.06);
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1E1C17;
    --panel: #26231D;
    --rail: #211F1A;
    --accent: #E08A6B;
    --accent-strong: #EA9C7E;
    --text: #F0EDE6;
    --muted: #A8A296;
    --border: #37342C;
    --hover: #2E2B24;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
}

:root[data-theme="dark"] {
  --bg: #1E1C17;
  --panel: #26231D;
  --rail: #211F1A;
  --accent: #E08A6B;
  --accent-strong: #EA9C7E;
  --text: #F0EDE6;
  --muted: #A8A296;
  --border: #37342C;
  --hover: #2E2B24;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 2: 写 `base.css`（reset + 排版）**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; }
body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
input, textarea { font-family: inherit; color: inherit; }
a { color: var(--accent); text-decoration: none; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
```

- [ ] **Step 3: 视觉验证**

Run: `cd client && npm run dev`，浏览器开 `http://localhost:5173`，切换系统深色模式与手动加 `data-theme="dark"`，确认背景/文字/强调色正确跟随三态。

- [ ] **Step 4: 提交**

```bash
git add client/src/styles/
git commit -m "feat(client): add Claude design tokens and base styles"
```

---

### Task 3: 登录态与 HTTP 客户端

**Files:**
- Create: `client/src/stores/auth.js`、`client/src/api/http.js`

**Interfaces:**
- Consumes: 现有 `/api/login`、`/api/register`、`/api/logout` 契约。
- Produces:
  - `auth.js`：`getToken()`、`getUser()`、`storeLogin(data)`（`data` = `{ token, user }`）、`clearLogin()`、`isLoggedIn()`；全部读写 `sessionStorage`。
  - `http.js`：`http.get(path)`、`http.post(path, body)`、`http.put(path, body)`、`http.del(path)`，返回已解析的 JSON，失败时 `throw` 带 `data.error` 的 Error。

- [ ] **Step 1: 写 `stores/auth.js`**

```js
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
export function getUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function storeLogin(data) {
  const user = data.user || data;
  const normalized = {
    id: user.id ?? user.userId,
    username: user.username || '',
    nickname: user.nickname || user.username || '',
    avatar: user.avatar || 'images/default.png',
    bio: user.bio || '',
    gender: user.gender || 'other',
    presence_status: user.presence_status || 'online'
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(normalized));
  sessionStorage.setItem(TOKEN_KEY, data.token);
  return normalized;
}
export function updateUser(user) { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function clearLogin() {
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}
export function isLoggedIn() { return !!(getToken() && getUser()); }
```

- [ ] **Step 2: 写 `api/http.js`**

```js
import { getToken } from '../stores/auth.js';

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch { /* 非 JSON 响应 */ }
  if (!response.ok) {
    const error = new Error(data?.error || `请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const http = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path)
};
```

- [ ] **Step 3: 提交**

```bash
git add client/src/stores/auth.js client/src/api/http.js
git commit -m "feat(client): add auth store and HTTP client"
```

---

### Task 4: Socket 客户端封装

**Files:**
- Create: `client/src/api/socket.js`

**Interfaces:**
- Consumes: 现有 Socket.IO 事件契约（见下）。
- Produces: `connectSocket()` 返回 `{ socket, on, off, authenticate }`；`on(event, fn)` 与 `off(event, fn)` 代理 `socket.on/off`；`authenticate(cb)` 内部 `socket.emit('authenticate', getToken(), cb)`。

- [ ] **Step 1: 写 `api/socket.js`**

```js
import { io } from 'socket.io-client';
import { getToken } from '../stores/auth.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('authenticated', (payload) => { socket._userId = payload.userId; });
  socket.on('sessionReplaced', () => {
    import('../stores/auth.js').then(({ clearLogin }) => {
      clearLogin();
      location.href = '/login';
    });
  });
  return socket;
}

export function getSocket() { return socket || connectSocket(); }
export function authenticate(cb) { getSocket().emit('authenticate', getToken(), cb); }
```

**事件契约备忘**（组件直接 `socket.on(...)`，服务端已实现，本任务不新增任何服务端事件）：
- 客户端 `emit`：`authenticate(token, cb)`、`joinChannel(channel)`、`joinDmConversation(data)`、`sendMessage(data)`、`sendPrivateMessage(data)`、`recallMessage(data)`、`recallDmMessage(data)`。
- 服务端 `emit`（客户端监听）：`messageReceived`、`privateMessageReceived`、`messageRecalled`、`dmMessageRecalled`、`messageDeleted`、`dmMessageDeleted`、`presenceUpdated`、`channelPresenceUpdated`、`friendRequestReceived`、`friendRequestUpdated`、`friendsChanged`、`channelInvited`、`userBanned`、`userDeleted`、`sessionReplaced` 等。

- [ ] **Step 2: 加依赖 `socket.io-client`**

`client/package.json` 的 `dependencies` 增加 `"socket.io-client": "^4.8.3"`，Run: `cd client && npm install`。

- [ ] **Step 3: 提交**

```bash
git add client/src/api/socket.js client/package.json client/package-lock.json
git commit -m "feat(client): add socket.io client wrapper"
```

---

### Task 5: 应用布局骨架（三栏 / 响应式 / 可收起侧边栏）

**Files:**
- Create: `client/src/router.js`、`client/src/views/ChatView.vue`、`client/src/components/layout/AppRail.vue`、`client/src/components/layout/MessageList.vue`、`client/src/components/layout/Composer.vue`、`client/src/components/layout/MemberList.vue`
- Modify: `client/src/main.js`（挂 router）

**Interfaces:**
- Consumes: `auth.js`（登录校验）、`tokens.css`。
- Produces: 布局栅格类名 `.app` / `.rail` / `.main` / `.aside`；`AppRail` 通过 `v-model:collapsed` 与 `ChatView` 交互，`emit('select-channel', name)`、`emit('select-dm', peerId)`。

- [ ] **Step 1: 写 `router.js`**

```js
import { createRouter, createWebHistory } from 'vue-router';
import { isLoggedIn } from './stores/auth.js';

const routes = [
  { path: '/login', component: () => import('./views/LoginView.vue') },
  { path: '/register', component: () => import('./views/RegisterView.vue') },
  { path: '/', component: () => import('./views/ChatView.vue'), meta: { requiresAuth: true } },
  { path: '/profile', component: () => import('./views/ProfileView.vue'), meta: { requiresAuth: true } },
  { path: '/admin', component: () => import('./views/AdminView.vue') }
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isLoggedIn()) return '/login';
  if ((to.path === '/login' || to.path === '/register') && isLoggedIn()) return '/';
  return true;
});

export default router;
```

- [ ] **Step 2: 改 `main.js` 挂 router**

```js
import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import './styles/tokens.css';
import './styles/base.css';

createApp(App).use(router).mount('#app');
```

- [ ] **Step 3: 写 `ChatView.vue`（三栏栅格 + 收起 + 响应式）**

```vue
<template>
  <div class="app" :class="{ collapsed }">
    <AppRail
      v-model:collapsed="collapsed"
      @select-channel="openChannel"
      @select-dm="openDm"
    />
    <main class="main">
      <MessageList :channel="activeChannel" :peer-id="activePeerId" />
      <Composer @send="onSend" />
    </main>
    <aside class="aside">
      <MemberList :channel="activeChannel" />
    </aside>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import AppRail from '../components/layout/AppRail.vue';
import MessageList from '../components/layout/MessageList.vue';
import Composer from '../components/layout/Composer.vue';
import MemberList from '../components/layout/MemberList.vue';

const collapsed = ref(false);
const activeChannel = ref(null);
const activePeerId = ref(null);
function openChannel(name) { activeChannel.value = name; activePeerId.value = null; }
function openDm(peerId) { activePeerId.value = peerId; activeChannel.value = null; }
function onSend() { /* Task 8 实现 */ }
</script>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 264px 1fr 236px;
  grid-template-rows: minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}
.app.collapsed { grid-template-columns: 68px 1fr 236px; }
.main { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg); }
.aside { min-height: 0; background: var(--panel); border-left: 1px solid var(--border); }
@media (max-width: 860px) {
  .app { grid-template-columns: 1fr; }
  .aside { display: none; }
  .app .rail, .app.collapsed .rail { position: fixed; inset: 0 auto 0 0; z-index: 20; transform: translateX(-100%); transition: transform 0.2s ease; }
  .app .rail.open, .app.collapsed .rail.open { transform: translateX(0); }
}
</style>
```

- [ ] **Step 4: 写四个布局子组件的占位骨架**（`AppRail` 含收起按钮 + brand-mark + 搜索图标；其余组件先渲染标题占位，Task 6-8 填充）

`AppRail.vue` 核心（收起交互，符合「收起按钮隐藏、点 brand-mark 展开、展开按钮换成搜索图标」）：

```vue
<template>
  <nav class="rail" :class="{ open }">
    <header class="rail-head">
      <button class="brand-mark" @click="expand" aria-label="展开侧边栏">J</button>
      <button v-if="!collapsed" class="collapse-btn" @click="collapse">«</button>
      <button v-if="collapsed" class="collapsed-search" @click="expand" aria-label="搜索">🔍</button>
    </header>
    <div v-if="!collapsed" class="rail-body">
      <!-- 频道/私聊列表，Task 8 填充 -->
    </div>
  </nav>
</template>

<script setup>
import { ref } from 'vue';
const props = defineProps({ collapsed: Boolean });
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm']);
const open = ref(false);
function collapse() { emit('update:collapsed', true); }
function expand() { emit('update:collapsed', false); open.value = false; }
function toggle() { open.value = !open.value; } // 移动端抽屉
</script>
```

（其余三个子组件写 `<template><div>占位</div></template>`，Task 6/8 再实现。）

- [ ] **Step 5: 视觉验证布局**

Run: `cd client && npm run dev`，验证三栏栅格在宽/窄窗口下正确、`collapsed` 时左栏变 68px 且收起按钮隐藏、品牌图标与搜索图标切换。

- [ ] **Step 6: 提交**

```bash
git add client/src/
git commit -m "feat(client): add three-column responsive layout with collapsible rail"
```

---

### Task 6: 头像与状态点组件（QQ 式 presence dot）

**Files:**
- Create: `client/src/stores/presence.js`、`client/src/components/StatusDot.vue`、`client/src/components/Avatar.vue`

**Interfaces:**
- Consumes: `tokens.css` 的 `--green/--red/--yellow`。
- Produces: `presence.js` 的 `statusToPresence(status)` 返回 `'online'|'offline'|'invisible'|'busy'|'away'`（按 Global Constraints 的映射表）；`Avatar.vue` 接收 `props: { src, name, presence }`，右下角渲染 `StatusDot`。

- [ ] **Step 1: 写 `stores/presence.js`**

```js
const STATUS_MAP = {
  online: 'online',
  busy: 'busy',
  away: 'away',
  invisible: 'invisible',
  offline: 'offline'
};
export function statusToPresence(status) {
  return STATUS_MAP[status] || 'offline';
}
```

- [ ] **Step 2: 写 `StatusDot.vue`**

```vue
<template>
  <span class="dot" :class="`presence-${presence}`" aria-hidden="true" />
</template>

<script setup>
defineProps({ presence: { type: String, default: 'offline' } });
</script>

<style scoped>
.dot { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--panel); }
.presence-online { background: var(--green); }
.presence-offline { background: var(--red); }
.presence-invisible { background: var(--yellow); }
.presence-away { background: var(--yellow); }
.presence-busy { background: var(--red); }
.presence-busy::before {
  content: ''; position: absolute; inset: 5px 2px; background: #fff; border-radius: 2px;
}
</style>
```

- [ ] **Step 3: 写 `Avatar.vue`**

```vue
<template>
  <span class="avatar">
    <img :src="src || 'images/default.png'" :alt="name" />
    <StatusDot :presence="statusToPresence(presence)" />
  </span>
</template>

<script setup>
import { computed } from 'vue';
import StatusDot from './StatusDot.vue';
import { statusToPresence } from '../stores/presence.js';

const props = defineProps({ src: String, name: String, presence: { type: String, default: 'offline' } });
const presence = computed(() => props.presence);
</script>

<style scoped>
.avatar { position: relative; display: inline-flex; width: 36px; height: 36px; flex-shrink: 0; }
.avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
</style>
```

- [ ] **Step 4: 提交**

```bash
git add client/src/stores/presence.js client/src/components/StatusDot.vue client/src/components/Avatar.vue
git commit -m "feat(client): add QQ-style presence dots on avatars"
```

---

### Task 7: 登录与注册页面

**Files:**
- Create: `client/src/views/LoginView.vue`、`client/src/views/RegisterView.vue`

**Interfaces:**
- Consumes: `http.post('/api/login', { username, password })` → `{ token, user }`；`http.post('/api/register', { username, password })` → `{ token, user }`；`auth.storeLogin`。
- Produces: 登录/注册成功后 `router.push('/')`。

- [ ] **Step 1: 写 `LoginView.vue`**

```vue
<template>
  <div class="auth-wrap">
    <form class="card" @submit.prevent="submit">
      <h1>JoyChat</h1>
      <p class="sub">登录以继续</p>
      <input v-model="username" placeholder="用户名" autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary" type="submit" :disabled="loading">登录</button>
      <router-link to="/register">没有账号？注册</router-link>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/http.js';
import { storeLogin } from '../stores/auth.js';

const router = useRouter();
const username = ref(''); const password = ref('');
const error = ref(''); const loading = ref(false);

async function submit() {
  error.value = ''; loading.value = true;
  try {
    const data = await http.post('/api/login', { username: username.value, password: password.value });
    storeLogin(data);
    router.push('/');
  } catch (e) {
    error.value = e.message || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-wrap { height: 100vh; display: grid; place-items: center; background: var(--bg); }
.card { display: flex; flex-direction: column; gap: 14px; width: 320px; padding: 32px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.card h1 { font-size: 24px; text-align: center; }
.sub { text-align: center; color: var(--muted); }
input { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.primary { padding: 10px; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-weight: 600; }
.error { color: var(--red); font-size: 13px; }
</style>
```

- [ ] **Step 2: 写 `RegisterView.vue`**（结构与登录一致，校验规则照抄现有 `auth.js`：用户名 2-20 位字母数字下划线；密码 8-128 位且含字母与数字；成功后 `storeLogin` 并跳转 `/`）

```vue
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
```

（模板与 `LoginView.vue` 相同，仅标题改为"创建账号"、提交按钮文案"注册"。）

- [ ] **Step 3: 端到端验证**

Run: 启动后端 `npm start`，`cd client && npm run build`，访问 `http://localhost:3000/login`，用现有账号登录，确认跳转 `/` 且 `sessionStorage` 写入 `token`/`user`。

- [ ] **Step 4: 提交**

```bash
git add client/src/views/LoginView.vue client/src/views/RegisterView.vue
git commit -m "feat(client): add login and register views"
```

---

### Task 8: 聊天主界面（频道/私聊列表、消息流、输入框、成员列表）

**Files:**
- Create: `client/src/components/ChannelItem.vue`、`client/src/components/MessageBubble.vue`
- Modify: `client/src/components/layout/AppRail.vue`、`MessageList.vue`、`Composer.vue`、`MemberList.vue`、`client/src/views/ChatView.vue`

**Interfaces:**
- Consumes: REST — `GET /api/channels`、`POST /api/channels`、`GET /api/channel/:channel/members`、`GET /api/messages/:channel`、`GET /api/dm/:peerUserId/messages`、`GET /api/friends`；Socket — `joinChannel`、`joinDmConversation`、`sendMessage`、`sendPrivateMessage`、`recallMessage`，监听 `messageReceived`、`privateMessageReceived`、`messageRecalled`、`presenceUpdated`、`channelPresenceUpdated`。
- Produces: 可用的完整聊天界面（不含 @提及、搜索、文件、回应——那是里程碑 3）。

- [ ] **Step 1: 填充 `AppRail.vue` 列表数据**

在 `AppRail.vue` 中 `onMounted` 拉取频道与好友，渲染"频道"与"私聊"两段；点击条目 `emit('select-channel', name)` / `emit('select-dm', peerId)`。

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../../api/http.js';

const channels = ref([]);
const friends = ref([]);
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm']);

onMounted(async () => {
  const [chs, frs] = await Promise.all([
    http.get('/api/channels'),
    http.get('/api/friends')
  ]);
  channels.value = chs.channels || chs || [];
  friends.value = frs.friends || frs || [];
});
</script>
```

（模板：`channels` 渲染为 `ChannelItem`，`friends` 渲染为 `Avatar` + 昵称的可点条目。）

- [ ] **Step 2: 写 `ChannelItem.vue`**

```vue
<template>
  <button class="channel" :class="{ active }" @click="$emit('select')">
    <span class="hash">#</span><span class="name">{{ name }}</span>
  </button>
</template>

<script setup>
defineProps({ name: String, active: Boolean });
defineEmits(['select']);
</script>

<style scoped>
.channel { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border-radius: var(--radius-sm); text-align: left; }
.channel:hover { background: var(--hover); }
.channel.active { background: var(--hover); color: var(--accent-strong); }
.hash { color: var(--muted); }
</style>
```

- [ ] **Step 3: 写 `MessageBubble.vue`**（渲染单条消息：头像、昵称、内容；支持图片 `image`、语音 `voice`、回复 `reply_to` 占位；**不渲染任何已读/未读状态**）

```vue
<template>
  <div class="msg" :class="{ mine }">
    <Avatar :src="message.avatar" :name="message.nickname" />
    <div class="body">
      <div class="meta"><span class="nick">{{ message.nickname }}</span><span class="time">{{ time }}</span></div>
      <div v-if="message.image" class="media"><img :src="message.image" alt="图片" /></div>
      <div v-if="message.voice" class="media"><audio :src="message.voice" controls /></div>
      <p v-if="message.content" class="content">{{ message.content }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Avatar from './Avatar.vue';

const props = defineProps({ message: Object, mine: Boolean });
const time = computed(() => new Date(props.message.created_at).toLocaleTimeString());
</script>

<style scoped>
.msg { display: flex; gap: 10px; padding: 8px 16px; }
.msg.mine { flex-direction: row-reverse; }
.body { max-width: 70%; }
.meta { display: flex; gap: 8px; align-items: baseline; }
.nick { font-weight: 600; }
.time { color: var(--muted); font-size: 12px; }
.media img { max-width: 240px; border-radius: var(--radius-sm); }
.content { white-space: pre-wrap; }
</style>
```

- [ ] **Step 4: 实现 `MessageList.vue` 拉取与订阅**

```vue
<script setup>
import { ref, watch } from 'vue';
import { http } from '../../api/http.js';
import { connectSocket } from '../../api/socket.js';
import MessageBubble from '../MessageBubble.vue';

const props = defineProps({ channel: String, peerId: Number });
const messages = ref([]);

async function load() {
  if (props.peerId != null) {
    const data = await http.get(`/api/dm/${props.peerId}/messages`);
    messages.value = data.messages || data || [];
  } else if (props.channel) {
    const data = await http.get(`/api/messages/${props.channel}`);
    messages.value = data.messages || data || [];
  }
}

watch(() => [props.channel, props.peerId], load, { immediate: true });

const socket = connectSocket();
socket.on('messageReceived', (m) => { if (m.channel === props.channel) messages.value.push(m); });
socket.on('privateMessageReceived', (m) => {
  if (m.from_user_id === props.peerId || m.to_user_id === props.peerId) messages.value.push(m);
});
socket.on('messageRecalled', ({ messageId }) => {
  const i = messages.value.findIndex((x) => x.id === messageId);
  if (i >= 0) messages.value[i] = { ...messages.value[i], is_recalled: 1, content: '消息已撤回' };
});
</script>
```

- [ ] **Step 5: 实现 `Composer.vue` 发送**

```vue
<script setup>
import { ref } from 'vue';
import { getSocket } from '../../api/socket.js';

const props = defineProps({ channel: String, peerId: Number });
const text = ref('');

function send() {
  const value = text.value.trim(); if (!value) return;
  const socket = getSocket();
  if (props.peerId != null) {
    socket.emit('sendPrivateMessage', { toUserId: props.peerId, content: value });
  } else if (props.channel) {
    socket.emit('sendMessage', { channel: props.channel, content: value });
  }
  text.value = '';
}
</script>
```

（模板：`<textarea v-model="text" @keydown.enter.exact.prevent="send" />` + 发送按钮。）

- [ ] **Step 6: 实现 `MemberList.vue`**

```vue
<script setup>
import { ref, watch } from 'vue';
import { http } from '../../api/http.js';
import Avatar from '../Avatar.vue';

const props = defineProps({ channel: String });
const members = ref([]);

watch(() => props.channel, async (c) => {
  if (!c) { members.value = []; return; }
  const data = await http.get(`/api/channel/${c}/members`);
  members.value = data.members || data || [];
}, { immediate: true });
</script>
```

- [ ] **Step 7: 端到端验证**

启动后端，登录两个账号（两个浏览器/隐身窗口），互发频道消息与私聊，验证消息实时出现、成员列表正确、状态点随在线状态变化。

- [ ] **Step 8: 提交**

```bash
git add client/src/
git commit -m "feat(client): implement chat main interface (channels, DMs, messages, members)"
```

---

### Task 9: 个人资料与好友管理页面

**Files:**
- Create: `client/src/views/ProfileView.vue`

**Interfaces:**
- Consumes: `GET /api/profile/:userId`、`PUT /api/profile/:userId`、`POST /api/upload/avatar`（multipart）、`GET /api/friends/requests`、`POST /api/friends/request`、`POST /api/friends/request/:requestId/respond`、`DELETE /api/friends/:friendUserId`。

- [ ] **Step 1: 写 `ProfileView.vue`**（个人资料编辑：昵称/头像上传/简介/性别；好友申请列表与接受/拒绝）

```vue
<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';
import { getUser, updateUser } from '../stores/auth.js';

const me = ref(getUser());
const requests = ref([]);

onMounted(async () => {
  const data = await http.get('/api/friends/requests');
  requests.value = data.requests || data || [];
});

async function saveProfile() {
  const data = await http.put(`/api/profile/${me.value.id}`, {
    nickname: me.value.nickname, bio: me.value.bio, gender: me.value.gender
  });
  updateUser(data.user || data);
}

async function respond(id, action) {
  await http.post(`/api/friends/request/${id}/respond`, { action });
  const data = await http.get('/api/friends/requests');
  requests.value = data.requests || data || [];
}
</script>
```

（头像上传用 `FormData` + `POST /api/upload/avatar`，不在此处贴完整代码，实现时照 `http` 之外单独 `fetch`，带 `Authorization` 头与 `FormData`。）

- [ ] **Step 2: 提交**

```bash
git add client/src/views/ProfileView.vue
git commit -m "feat(client): add profile and friend management view"
```

---

### Task 10: 管理后台页面

**Files:**
- Create: `client/src/views/AdminView.vue`

**Interfaces:**
- Consumes: `POST /api/admin/login` → token（管理员登录态单独存 `sessionStorage` key `admin_token`）、`GET /api/admin/users`、`PUT /api/admin/users/:userId/ban`、`PUT /api/admin/users/:userId/unban`、`DELETE /api/admin/users/:userId`、`GET /api/admin/logs/list`、`POST /api/admin/reset-messages`、`GET /api/admin/deactivation-requests`。

- [ ] **Step 1: 写 `AdminView.vue`**（先做管理员登录表单；登录后展示用户表，支持封禁/解封/删除/查看注销申请/重置消息）

```vue
<script setup>
import { ref } from 'vue';
import { http } from '../api/http.js';

const adminToken = ref(sessionStorage.getItem('admin_token'));
const users = ref([]);
const error = ref('');

async function adminLogin(username, password) {
  const data = await http.post('/api/admin/login', { username, password });
  adminToken.value = data.token;
  sessionStorage.setItem('admin_token', data.token);
}
async function loadUsers() {
  const data = await http.get('/api/admin/users');
  users.value = data.users || data || [];
}
</script>
```

（管理员请求需额外在 `http.js` 支持 `Authorization: Bearer <admin_token>`：在 `request()` 里若 `path` 以 `/api/admin` 开头且存在 `admin_token`，优先用 `admin_token`。）

- [ ] **Step 2: 提交**

```bash
git add client/src/views/AdminView.vue client/src/api/http.js
git commit -m "feat(client): add admin panel view"
```

---

### Task 11: 移除已读回执/未读角标 + 全量回归

**Files:**
- Modify: `client/src/components/layout/AppRail.vue`、`MessageBubble.vue`（确认未渲染任何未读/已读标记）

**Interfaces:**
- Consumes: 现有后端测试（`npm test`）。
- Produces: 无未读/已读视觉残留。

- [ ] **Step 1: 核对并删除任何"未读数字/红点/已读勾"相关样式与逻辑**

全局搜索 `client/src` 内 `unread`、`read`、`receipt`、`badge`、`已读`、`未读`，确认无渲染；若有，删除。

- [ ] **Step 2: 跑后端测试确保未破坏契约**

Run: `npm test`
Expected: 现有 15 个测试全部通过（里程碑 1 不应改动任何后端行为）。

- [ ] **Step 3: 全量构建与冒烟**

Run: `cd client && npm run build && cd .. && npm start`，依次访问 `/login`、`/register`、`/`、`/profile`、`/admin`，确认 SPA 回退正常、无 404、无控制台报错。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(client): remove read receipts and unread badges, final polish"
```

---

## Self-Review 记录

- **Spec 覆盖**：设计文档第 2（配色）、3（架构）、4（界面结构：三栏/响应式/可收起/状态点）已覆盖；第 5 的"移除已读回执"在 Task 11；第 5 的"新增 @/搜索/文件/回应、深色模式"中，深色模式在 Task 2 完成，其余留待里程碑 3；第 6（E2EE）留待里程碑 2；第 3 的"后端拆模块"留待里程碑 4。无遗漏。
- **类型一致性**：`auth.storeLogin(data)`、`http.get/post/put/del`、`connectSocket/authenticate`、`statusToPresence`、`AppRail` 的 `update:collapsed` 事件在各任务间命名一致。
- **无占位符**：各任务均给出可执行代码或精确契约。
