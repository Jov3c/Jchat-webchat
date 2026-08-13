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
