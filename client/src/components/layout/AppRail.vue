<template>
  <nav class="rail" :class="{ collapsed, open }">
    <div class="brand">
      <div class="brand-mark" @click="onBrandClick" :title="collapsed ? '展开侧边栏' : '回到主页'">J</div>
      <div class="brand-text">
        <div class="brand-name">JoyChat</div>
        <div class="brand-sub">团队协作 · 端到端加密</div>
      </div>
      <button class="collapse-btn" @click="collapse" aria-label="收起侧边栏">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button class="collapsed-search" @click="expand" aria-label="搜索">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
    </div>

    <div class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      搜索消息或频道
    </div>

    <div class="rail-scroll">
      <div class="section-label">频道</div>
      <div v-for="c in channels" :key="c" class="chan" :class="{ 'is-active': c === activeChannel }" @click="selectChannel(c)" :title="'#' + c">
        <span class="hash">#</span><span class="label">{{ c }}</span>
      </div>
      <div class="section-label">私聊</div>
      <div v-for="f in friends" :key="f.id" class="dm" :class="{ 'is-active': f.id === activePeerId }" @click="selectDm(f.id)" :title="f.nickname || f.username">
        <span class="avatar-click" @click.stop="openUserCard(f.id, $event)">
          <Avatar :name="f.nickname || f.username" :src="f.avatar" :presence="getLivePresence(f.id, f.presence_status)" />
        </span>
        <span class="name">{{ f.nickname || f.username }}</span>
      </div>
    </div>

    <div class="me">
      <span class="avatar-click" @click="router.push('/profile')" title="编辑个人资料">
        <Avatar :name="me.nickname || me.username" :src="me.avatar" :presence="me.presence_status" />
      </span>
      <div class="meta">
        <div class="name">{{ me.nickname || me.username }}</div>
        <div class="sub">{{ statusLabel(me.presence_status) }}</div>
      </div>
      <button class="dots" @click="statusOpen = !statusOpen" aria-label="设置在线状态">⋯</button>
      <div v-if="statusOpen" class="status-menu">
        <div v-for="s in STATUS_OPTIONS" :key="s.value" class="status-opt" @click="setStatus(s.value)">
          <span class="dot" :class="'dot-' + s.value"></span> {{ s.label }}
          <span v-if="s.note" class="note">{{ s.note }}</span>
        </div>
        <div class="status-divider"></div>
        <div class="status-opt logout" @click="confirmLogout">退出登录</div>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="logoutOpen" class="modal-overlay" @click.self="logoutOpen = false">
        <div class="modal-card">
          <div class="modal-title">退出登录</div>
          <div class="modal-text">确定要退出登录吗？</div>
          <div class="modal-actions">
            <button class="modal-btn" @click="logoutOpen = false">取消</button>
            <button class="modal-btn danger" @click="doLogout">退出登录</button>
          </div>
        </div>
      </div>
    </Teleport>
  </nav>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../../api/http.js';
import { getUser, updateUser, clearLogin } from '../../stores/auth.js';
import { getLivePresence } from '../../stores/presence.js';
import { openUserCard } from '../../stores/userCard.js';
import { disconnectSocket } from '../../api/socket.js';
import Avatar from '../Avatar.vue';

const props = defineProps({ collapsed: Boolean, activeChannel: String, activePeerId: Number });
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm', 'select-home']);

const router = useRouter();
const channels = ref([]);
const friends = ref([]);
const open = ref(false);
const statusOpen = ref(false);
const logoutOpen = ref(false);
const autoAway = ref(false);
const me = ref(getUser() || {});

const STATUS_OPTIONS = [
  { value: 'online', label: '在线' },
  { value: 'away', label: '离开' },
  { value: 'busy', label: '请勿打扰' },
  { value: 'invisible', label: '隐身', note: '仅自己可见' }
];
const STATUS_LABELS = { online: '在线', away: '离开', busy: '请勿打扰', invisible: '隐身', offline: '离线' };
function statusLabel(s) { return STATUS_LABELS[s] || '在线'; }

function collapse() { emit('update:collapsed', true); }
function expand() { emit('update:collapsed', false); open.value = false; }
function onBrandClick() {
  if (props.collapsed) { expand(); }
  else { emit('select-home'); }
}

function selectChannel(name) { open.value = false; emit('select-channel', name); }
function selectDm(peerId) { open.value = false; emit('select-dm', peerId); }

async function applyStatus(value) {
  const old = me.value.presence_status;
  me.value = { ...me.value, presence_status: value };
  try {
    await http.put(`/api/profile/${me.value.id}`, { presence_status: value });
    updateUser({ ...getUser(), presence_status: value });
  } catch {
    me.value = { ...me.value, presence_status: old };
  }
}

function setStatus(value) {
  statusOpen.value = false;
  autoAway.value = false;
  applyStatus(value);
}

function confirmLogout() { statusOpen.value = false; logoutOpen.value = true; }
function doLogout() { disconnectSocket(); clearLogin(); router.push('/login'); }

// 无操作 30 分钟后自动切到「离开」（仅当当前为在线时）；检测到活动自动切回「在线」
const IDLE_MS = 30 * 60 * 1000;
let idleTimer = null;
function onIdle() {
  if (me.value.presence_status === 'online') {
    autoAway.value = true;
    applyStatus('away');
  }
}
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(onIdle, IDLE_MS);
  if (autoAway.value && me.value.presence_status === 'away') {
    autoAway.value = false;
    applyStatus('online');
  }
}

defineExpose({ openDrawer: () => { open.value = true; } });

const IDLE_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'];
function bindIdle() {
  IDLE_EVENTS.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));
  resetIdle();
}
function unbindIdle() {
  IDLE_EVENTS.forEach(e => window.removeEventListener(e, resetIdle));
  clearTimeout(idleTimer);
}

onMounted(async () => {
  try {
    const [chs, frs] = await Promise.all([
      http.get('/api/channels'),
      http.get('/api/friends')
    ]);
    channels.value = chs.channels || chs || [];
    friends.value = frs.friends || frs || [];
  } catch { /* 列表加载失败不阻塞界面 */ }
  bindIdle();
});
onBeforeUnmount(unbindIdle);
</script>

<style scoped>
.rail {
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--rail);
  border-right: 1px solid var(--border);
}

.brand { display: flex; align-items: center; gap: 10px; padding: 16px 18px 12px; }
.brand-mark {
  flex: none; width: 30px; height: 30px; border-radius: 9px; background: var(--accent);
  display: grid; place-items: center; color: #fff; font-family: var(--font-display); font-weight: 700; font-size: 16px;
  cursor: pointer;
}
.brand-text { min-width: 0; flex: 1; }
.brand-name { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap; }
.brand-sub { font-size: 11px; color: var(--faint); margin-top: 1px; white-space: nowrap; }
.collapse-btn {
  flex: none; border: 0; background: transparent; color: var(--faint);
  width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; cursor: pointer;
}
.collapsed-search {
  flex: none; display: none; border: 0; background: transparent; color: var(--faint);
  width: 28px; height: 28px; border-radius: 8px; place-items: center; cursor: pointer;
}
.collapse-btn:hover, .collapsed-search:hover { background: var(--hover); color: var(--text); }

.search {
  margin: 0 14px 12px; display: flex; align-items: center; gap: 8px;
  padding: 8px 11px; background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; color: var(--faint); font-size: 13px; white-space: nowrap;
}
.search svg { flex: none; opacity: 0.7; }

.rail-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 10px 12px; }
.section-label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: var(--faint);
  text-transform: uppercase; padding: 8px 8px 6px; white-space: nowrap;
}
.chan { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 9px; color: var(--muted); font-size: 14px; cursor: pointer; }
.chan:hover { background: var(--hover); color: var(--text); }
.chan.is-active { background: var(--active); color: var(--accent-strong); font-weight: 500; }
.chan .hash { opacity: 0.7; font-family: var(--mono); font-size: 13px; flex: none; }
.chan .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 9px; cursor: pointer; }
.dm:hover { background: var(--hover); }
.dm.is-active { background: var(--hover); }
.dm .name { font-size: 14px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar-click { cursor: pointer; display: inline-flex; }

.me {
  position: relative; display: flex; align-items: center; gap: 10px;
  margin: 10px 12px 14px; padding: 10px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 12px;
}
.me .meta { min-width: 0; flex: 1; }
.me .name { font-size: 13px; font-weight: 600; white-space: nowrap; }
.me .sub { font-size: 11px; color: var(--muted); white-space: nowrap; }
.me .dots {
  flex: none; margin-left: auto; border: 0; background: transparent; color: var(--faint);
  width: 26px; height: 26px; border-radius: 7px; cursor: pointer; font-size: 16px; line-height: 1;
}
.me .dots:hover { background: var(--hover); color: var(--text); }

.status-menu {
  position: absolute; bottom: calc(100% + 8px); left: 12px; right: 12px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow); padding: 6px; z-index: 30;
}
.status-opt { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; font-size: 13px; color: var(--text); cursor: pointer; }
.status-opt:hover { background: var(--hover); }
.status-opt .note { margin-left: auto; font-size: 11px; color: var(--faint); }
.status-divider { height: 1px; margin: 6px 4px; background: var(--border); }
.status-opt.logout { color: var(--red); }
.status-opt.logout:hover { background: color-mix(in srgb, var(--red) 10%, transparent); }

.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  display: grid; place-items: center;
  background: rgba(20, 18, 14, 0.4);
  backdrop-filter: blur(2px);
}
.modal-card {
  width: 300px; padding: 24px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.modal-title { font-weight: 600; font-size: 16px; }
.modal-text { color: var(--muted); font-size: 14px; margin-top: 8px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.modal-btn {
  padding: 8px 16px; border-radius: 9px; border: 1px solid var(--border);
  background: var(--panel); color: var(--text); font-size: 13px; cursor: pointer;
}
.modal-btn:hover { background: var(--hover); }
.modal-btn.danger { background: var(--red); border-color: var(--red); color: #fff; }
.modal-btn.danger:hover { background: color-mix(in srgb, var(--red) 85%, #000); }
.dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; }
.dot-online { background: var(--green); }
.dot-away { background: linear-gradient(to right, var(--yellow) 50%, #fff 50%); }
.dot-busy { background: linear-gradient(to right, var(--red) 50%, #fff 50%); }
.dot-invisible { background: var(--yellow); }

/* collapsed —— 全部用 CSS 切换显示，DOM 不重建，避免闪动 */
.rail.collapsed .brand { flex-direction: column; align-items: center; gap: 4px; padding: 16px 0 12px; }
.rail.collapsed .brand-text { display: none; }
.rail.collapsed .collapse-btn { display: none; }
.rail.collapsed .collapsed-search { display: grid; }
.rail.collapsed .search { display: none; }
.rail.collapsed .section-label { display: none; }
.rail.collapsed .rail-scroll { padding: 0 8px 12px; }
.rail.collapsed .chan { justify-content: center; padding: 11px 0; }
.rail.collapsed .chan .label { display: none; }
.rail.collapsed .chan .hash { font-size: 15px; }
.rail.collapsed .dm { justify-content: center; padding: 9px 0; }
.rail.collapsed .dm .name { display: none; }
.rail.collapsed .me { justify-content: center; padding: 10px; margin: 10px 8px 14px; }
.rail.collapsed .me .meta, .rail.collapsed .me .dots { display: none; }
</style>
