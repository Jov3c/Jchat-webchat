<template>
  <div class="stage">
    <div class="app" :class="{ collapsed }">
      <AppRail
        ref="railRef"
        v-model:collapsed="collapsed"
        :active-channel="activeChannel"
        :active-peer-id="activePeerId"
        @select-channel="openChannel"
        @select-dm="openDm"
        @select-home="goHome"
      />
      <main class="main">
        <div class="mobile-top">
          <button class="icon-btn" @click="railRef?.openDrawer()" aria-label="打开频道列表">☰</button>
          <span class="mobile-title">{{ title }}</span>
          <span class="spacer"></span>
          <button class="icon-btn" aria-label="菜单">⋮</button>
        </div>
        <template v-if="activeChannel || activePeerId != null">
          <header class="main-head">
            <div class="head-title">
              <span v-if="activeChannel" class="hash">#</span>{{ title }}
            </div>
            <div v-if="subtitle" class="head-sub">{{ subtitle }}</div>
            <span class="spacer"></span>
            <button class="icon-btn" aria-label="搜索">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            </button>
            <button class="icon-btn" aria-label="更多">⋮</button>
          </header>
          <MessageList :channel="activeChannel" :peer-id="activePeerId" @reply="replyTo = $event" />
          <Composer :channel="activeChannel" :peer-id="activePeerId" :reply-to="replyTo" @clear-reply="replyTo = null" />
        </template>
        <div v-else class="home">
          <div class="home-mark">J</div>
          <div class="home-title">JoyChat</div>
          <div class="home-sub">从左侧选择一个聊天开始</div>
        </div>
      </main>
      <aside class="aside">
        <MemberList :channel="activeChannel" />
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue';
import AppRail from '../components/layout/AppRail.vue';
import MessageList from '../components/layout/MessageList.vue';
import Composer from '../components/layout/Composer.vue';
import MemberList from '../components/layout/MemberList.vue';
import { connectSocket, authenticate } from '../api/socket.js';
import { applyPresenceUpdate } from '../stores/presence.js';

const collapsed = ref(false);
const activeChannel = ref(null);
const activePeerId = ref(null);
const replyTo = ref(null);
const railRef = ref(null);

const title = computed(() => {
  if (activeChannel.value) return activeChannel.value;
  if (activePeerId.value != null) return '私聊';
  return '聊天';
});
const subtitle = computed(() => {
  if (activeChannel.value) return '频道';
  if (activePeerId.value != null) return '端到端加密私聊';
  return '';
});

function openChannel(name) { activeChannel.value = name; activePeerId.value = null; replyTo.value = null; }
function openDm(peerId) { activePeerId.value = peerId; activeChannel.value = null; replyTo.value = null; }
function goHome() { activeChannel.value = null; activePeerId.value = null; replyTo.value = null; }

onMounted(() => {
  const socket = connectSocket();
  authenticate(() => {});
  socket.on('presenceUpdated', ({ userId, status }) => applyPresenceUpdate(userId, status));
});

watch([activeChannel, activePeerId], ([channel, peerId]) => {
  const socket = connectSocket();
  if (channel != null) socket.emit('joinChannel', channel);
  if (peerId != null) socket.emit('joinDmConversation', { peerUserId: peerId });
});
</script>

<style scoped>
.stage {
  height: 100vh;
  padding: 16px 20px;
  display: flex;
  justify-content: center;
  align-items: stretch;
}
.app {
  width: min(1180px, 100%);
  display: grid;
  grid-template-columns: 264px 1fr 236px;
  grid-template-rows: minmax(0, 1fr);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: grid-template-columns 0.18s ease;
}
.app.collapsed { grid-template-columns: 68px 1fr 236px; }
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--panel);
}
.aside { min-height: 0; background: var(--rail); border-left: 1px solid var(--border); }

.home {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}
.home-mark {
  width: 56px; height: 56px; border-radius: 16px; background: var(--accent);
  display: grid; place-items: center; color: #fff; font-family: var(--font-display); font-weight: 700; font-size: 28px;
}
.home-title { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: 0.2px; }
.home-sub { color: var(--muted); font-size: 14px; }

.main-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}
.head-title { font-weight: 600; font-size: 16px; }
.head-title .hash { color: var(--faint); font-family: var(--mono); margin-right: 3px; }
.head-sub { font-size: 12px; color: var(--muted); }
.spacer { flex: 1; }
.icon-btn {
  border: 0; background: transparent; color: var(--muted);
  width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; cursor: pointer;
}
.icon-btn:hover { background: var(--hover); color: var(--text); }

.mobile-top {
  display: none;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.mobile-title { font-weight: 600; font-size: 15px; }

@media (max-width: 860px) {
  .stage { padding: 0; }
  .app { grid-template-columns: 1fr; border-radius: 0; border: 0; }
  .aside { display: none; }
  .mobile-top { display: flex; }
  .app .rail, .app.collapsed .rail { position: fixed; inset: 0 auto 0 0; z-index: 20; width: min(280px, 85vw); transform: translateX(-100%); transition: transform 0.2s ease; border-radius: 0; }
  .app .rail.open, .app.collapsed .rail.open { transform: translateX(0); }
}
</style>
