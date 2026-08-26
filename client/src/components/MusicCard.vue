<template>
  <div class="music-card" :class="{ clickable: info.ok }" @click="open">
    <img v-if="info.pic" class="mc-art" :src="info.pic + '?param=180y180'" alt="" loading="lazy" />
    <div v-else class="mc-art mc-art-empty">♪</div>
    <div class="mc-txt">
      <div class="mc-name">{{ info.name || (info.error || '这首歌读不到了') }}</div>
      <div v-if="info.artist" class="mc-artist">
        {{ info.artist }}<span v-if="info.sec"> · {{ fmt(info.sec) }}</span>
      </div>
    </div>
    <div v-if="info.ok" class="mc-go">▶</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';
import { openSong } from '../utils/music.js';

const props = defineProps({ id: String });
const info = ref({});

onMounted(async () => {
  try {
    const data = await http.get('/api/music?id=' + encodeURIComponent(props.id));
    info.value = data && data.ok ? data : { error: '这首歌读不到了' };
  } catch {
    info.value = { error: '这首歌读不到了' };
  }
});

function open() {
  if (info.value.ok) openSong(props.id);
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
</script>

<style scoped>
.music-card {
  display: flex; align-items: center; gap: 10px;
  margin-top: 8px; max-width: 340px;
  padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--rail); cursor: default;
}
.music-card.clickable { cursor: pointer; }
.music-card.clickable:hover { background: var(--hover); }
.mc-art { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex: none; }
.mc-art-empty {
  display: grid; place-items: center; font-size: 22px;
  background: var(--accent-soft); color: var(--accent-strong);
}
.mc-txt { min-width: 0; flex: 1; }
.mc-name {
  font-size: 13px; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mc-artist { font-size: 12px; color: var(--muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-go {
  width: 26px; height: 26px; border-radius: 50%; flex: none;
  display: grid; place-items: center; font-size: 11px;
  background: var(--accent); color: #fff;
}
</style>
