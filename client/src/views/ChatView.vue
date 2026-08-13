<template>
  <div class="app" :class="{ collapsed }">
    <AppRail
      ref="railRef"
      v-model:collapsed="collapsed"
      :active-channel="activeChannel"
      :active-peer-id="activePeerId"
      @select-channel="openChannel"
      @select-dm="openDm"
    />
    <main class="main">
      <header class="mobile-bar">
        <button class="hamburger" @click="railRef?.openDrawer()" aria-label="打开频道列表">☰</button>
        <span class="mobile-title">{{ title }}</span>
      </header>
      <MessageList :channel="activeChannel" :peer-id="activePeerId" />
      <Composer :channel="activeChannel" :peer-id="activePeerId" />
    </main>
    <aside class="aside">
      <MemberList :channel="activeChannel" />
    </aside>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue';
import AppRail from '../components/layout/AppRail.vue';
import MessageList from '../components/layout/MessageList.vue';
import Composer from '../components/layout/Composer.vue';
import MemberList from '../components/layout/MemberList.vue';
import { connectSocket, authenticate } from '../api/socket.js';

const collapsed = ref(false);
const activeChannel = ref(null);
const activePeerId = ref(null);
const railRef = ref(null);

const title = computed(() => {
  if (activeChannel.value) return '#' + activeChannel.value;
  if (activePeerId.value != null) return '私聊';
  return '聊天';
});

function openChannel(name) { activeChannel.value = name; activePeerId.value = null; }
function openDm(peerId) { activePeerId.value = peerId; activeChannel.value = null; }

onMounted(() => {
  const socket = connectSocket();
  authenticate(() => {});
});

watch([activeChannel, activePeerId], ([channel, peerId]) => {
  const socket = connectSocket();
  if (channel != null) socket.emit('joinChannel', channel);
  if (peerId != null) socket.emit('joinDmConversation', { peerUserId: peerId });
});
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
.mobile-bar {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.hamburger { width: 32px; height: 32px; border-radius: var(--radius-sm); font-size: 16px; }
.hamburger:hover { background: var(--hover); }
.mobile-title { font-weight: 600; }
@media (max-width: 860px) {
  .app { grid-template-columns: 1fr; }
  .aside { display: none; }
  .mobile-bar { display: flex; }
  .app .rail, .app.collapsed .rail { position: fixed; inset: 0 auto 0 0; z-index: 20; width: min(280px, 85vw); transform: translateX(-100%); transition: transform 0.2s ease; }
  .app .rail.open, .app.collapsed .rail.open { transform: translateX(0); }
}
</style>
