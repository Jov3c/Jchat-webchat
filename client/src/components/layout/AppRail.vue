<template>
  <nav class="rail" :class="{ collapsed, open }">
    <div class="brand">
      <div class="brand-mark" @click="expand" title="展开侧边栏">J</div>
      <div v-if="!collapsed" class="brand-text">
        <div class="brand-name">JoyChat</div>
        <div class="brand-sub">团队协作 · 端到端加密</div>
      </div>
      <button v-if="!collapsed" class="collapse-btn" @click="collapse" aria-label="收起侧边栏">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <button v-if="collapsed" class="collapsed-search" @click="expand" aria-label="搜索">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
    </div>

    <div v-if="!collapsed" class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      搜索消息或频道
    </div>

    <div class="rail-scroll">
      <template v-if="!collapsed">
        <div class="section-label">频道</div>
        <div v-for="c in channels" :key="c" class="chan" :class="{ 'is-active': c === activeChannel }" @click="selectChannel(c)">
          <span class="hash">#</span><span class="label">{{ c }}</span>
        </div>
        <div class="section-label">私聊</div>
        <div v-for="f in friends" :key="f.id" class="dm" :class="{ 'is-active': f.id === activePeerId }" @click="selectDm(f.id)">
          <Avatar :name="f.nickname || f.username" :src="f.avatar" :presence="f.presence_status" />
          <span class="name">{{ f.nickname || f.username }}</span>
        </div>
      </template>
      <template v-else>
        <div v-for="c in channels" :key="c" class="chan" :class="{ 'is-active': c === activeChannel }" @click="selectChannel(c)" title="#{{ c }}">
          <span class="hash">#</span>
        </div>
        <div v-for="f in friends" :key="f.id" class="dm" :class="{ 'is-active': f.id === activePeerId }" @click="selectDm(f.id)" :title="f.nickname || f.username">
          <Avatar :name="f.nickname || f.username" :src="f.avatar" />
        </div>
      </template>
    </div>

    <div class="me">
      <Avatar :name="me.nickname || me.username" :src="me.avatar" :presence="me.presence_status" />
      <div v-if="!collapsed" class="meta">
        <div class="name">{{ me.nickname || me.username }}</div>
        <div class="sub">{{ statusLabel(me.presence_status) }}</div>
      </div>
      <button v-if="!collapsed" class="dots" @click="statusOpen = !statusOpen" aria-label="设置在线状态">⋯</button>
      <div v-if="!collapsed && statusOpen" class="status-menu">
        <div v-for="s in STATUS_OPTIONS" :key="s.value" class="status-opt" @click="setStatus(s.value)">
          <span class="dot" :class="'dot-' + s.value"></span> {{ s.label }}
          <span v-if="s.note" class="note">{{ s.note }}</span>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { http } from '../../api/http.js';
import { getUser, updateUser } from '../../stores/auth.js';
import Avatar from '../Avatar.vue';

const props = defineProps({ collapsed: Boolean, activeChannel: String, activePeerId: Number });
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm']);

const channels = ref([]);
const friends = ref([]);
const open = ref(false);
const statusOpen = ref(false);
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

function selectChannel(name) { open.value = false; emit('select-channel', name); }
function selectDm(peerId) { open.value = false; emit('select-dm', peerId); }

async function setStatus(value) {
  statusOpen.value = false;
  const old = me.value.presence_status;
  me.value = { ...me.value, presence_status: value };
  try {
    await http.put(`/api/profile/${me.value.id}`, { presence_status: value });
    updateUser({ ...getUser(), presence_status: value });
  } catch {
    me.value = { ...me.value, presence_status: old };
  }
}

defineExpose({ openDrawer: () => { open.value = true; } });

onMounted(async () => {
  try {
    const [chs, frs] = await Promise.all([
      http.get('/api/channels'),
      http.get('/api/friends')
    ]);
    channels.value = chs.channels || chs || [];
    friends.value = frs.friends || frs || [];
  } catch { /* 列表加载失败不阻塞界面 */ }
});
</script>

<style scoped>
.rail {
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
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
.brand-name { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: 0.2px; }
.brand-sub { font-size: 11px; color: var(--faint); margin-top: 1px; }
.collapse-btn, .collapsed-search {
  flex: none; border: 0; background: transparent; color: var(--faint);
  width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; cursor: pointer;
}
.collapse-btn:hover, .collapsed-search:hover { background: var(--hover); color: var(--text); }

.search {
  margin: 0 14px 12px; display: flex; align-items: center; gap: 8px;
  padding: 8px 11px; background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; color: var(--faint); font-size: 13px;
}
.search svg { flex: none; opacity: 0.7; }

.rail-scroll { flex: 1; overflow-y: auto; padding: 0 10px 12px; }
.section-label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: var(--faint);
  text-transform: uppercase; padding: 8px 8px 6px;
}
.chan { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 9px; color: var(--muted); font-size: 14px; cursor: pointer; }
.chan:hover { background: var(--hover); color: var(--text); }
.chan.is-active { background: var(--active); color: var(--accent-strong); font-weight: 500; }
.chan .hash { opacity: 0.7; font-family: var(--mono); font-size: 13px; }
.chan .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 9px; cursor: pointer; }
.dm:hover { background: var(--hover); }
.dm.is-active { background: var(--hover); }
.dm .name { font-size: 14px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.me {
  position: relative; display: flex; align-items: center; gap: 10px;
  margin: 10px 12px 14px; padding: 10px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 12px;
}
.me .meta { min-width: 0; flex: 1; }
.me .name { font-size: 13px; font-weight: 600; }
.me .sub { font-size: 11px; color: var(--muted); }
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
.dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; }
.dot-online { background: var(--green); }
.dot-away { background: var(--yellow); }
.dot-busy { background: var(--red); }
.dot-invisible { background: var(--yellow); }

/* collapsed */
.rail.collapsed .brand { flex-direction: column; align-items: center; gap: 4px; padding: 16px 0 12px; }
.rail.collapsed .rail-scroll { padding: 0 8px 12px; }
.rail.collapsed .chan { justify-content: center; padding: 11px 0; }
.rail.collapsed .chan .hash { font-size: 15px; }
.rail.collapsed .dm { justify-content: center; padding: 9px 0; }
.rail.collapsed .me { justify-content: center; padding: 10px; margin: 10px 8px 14px; }
</style>
