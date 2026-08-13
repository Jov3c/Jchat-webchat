<template>
  <nav class="rail" :class="{ open }">
    <header class="rail-head">
      <button class="brand-mark" @click="expand" aria-label="展开侧边栏">J</button>
      <button v-if="!collapsed" class="collapse-btn" @click="collapse">«</button>
      <button v-if="collapsed" class="collapsed-search" @click="expand" aria-label="搜索">🔍</button>
    </header>
    <div v-if="!collapsed" class="rail-body">
      <section class="rail-section">
        <h3 class="rail-title">频道</h3>
        <div class="rail-list">
          <ChannelItem
            v-for="c in channels"
            :key="c.name"
            :name="c.name"
            :active="c.name === activeChannel"
            @select="selectChannel(c.name)"
          />
        </div>
      </section>
      <section class="rail-section">
        <h3 class="rail-title">私聊</h3>
        <div class="rail-list">
          <button
            v-for="f in friends"
            :key="f.id"
            class="friend"
            :class="{ active: f.id === activePeerId }"
            @click="selectDm(f.id)"
          >
            <Avatar :src="f.avatar" :name="f.nickname || f.username" :presence="f.presence_status" />
            <span class="friend-name">{{ f.nickname || f.username }}</span>
          </button>
        </div>
      </section>
    </div>
  </nav>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../../api/http.js';
import ChannelItem from '../ChannelItem.vue';
import Avatar from '../Avatar.vue';

const props = defineProps({ collapsed: Boolean, activeChannel: String, activePeerId: Number });
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm']);

const channels = ref([]);
const friends = ref([]);
const open = ref(false);

function collapse() { emit('update:collapsed', true); }
function expand() { emit('update:collapsed', false); open.value = false; }
function toggle() { open.value = !open.value; } // 移动端抽屉

function selectChannel(name) { open.value = false; emit('select-channel', name); }
function selectDm(peerId) { open.value = false; emit('select-dm', peerId); }

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
  background: var(--rail);
  border-right: 1px solid var(--border);
}
.rail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  min-height: 56px;
}
.brand-mark {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent-strong);
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
}
.brand-mark:hover { background: var(--hover); }
.collapse-btn, .collapsed-search { width: 32px; height: 32px; border-radius: var(--radius-sm); }
.collapse-btn:hover, .collapsed-search:hover { background: var(--hover); }
.rail-body { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
.rail-section { margin-bottom: 16px; }
.rail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 12px;
  margin-bottom: 6px;
}
.rail-list { display: flex; flex-direction: column; gap: 2px; }
.friend {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  text-align: left;
}
.friend:hover { background: var(--hover); }
.friend.active { background: var(--hover); }
.friend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
