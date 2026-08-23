<template>
  <div class="sticker-picker">
    <div class="sticker-tabs">
      <button class="sticker-tab" :class="{ on: tab === 'emoji' }" @click="tab = 'emoji'">表情</button>
      <button class="sticker-tab" :class="{ on: tab === 'pack' }" @click="tab = 'pack'">表情包</button>
    </div>

    <div v-if="tab === 'emoji'" class="sticker-emoji-grid">
      <button v-for="e in EMOJIS" :key="e" class="sticker-emoji" :title="e" @click="$emit('select-emoji', e)">{{ e }}</button>
    </div>

    <div v-else class="sticker-pack-grid">
      <div v-for="s in stickers.list" :key="s.id" class="sticker-pack-item" @click="$emit('select-sticker', s.url)">
        <button class="sticker-delete" aria-label="删除表情包" @click.stop="$emit('remove-sticker', s.id)">×</button>
        <img :src="s.url" alt="表情包" />
      </div>
      <button v-if="!stickers.list.length" class="sticker-empty" @click="$emit('upload-sticker')">还没有表情包，点这里上传</button>
      <button class="sticker-upload" aria-label="上传表情包" title="上传表情包" @click="$emit('upload-sticker')">＋</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useStickers } from '../stores/stickers.js';

const EMOJIS = ['😀', '😂', '😊', '😍', '😭', '😡', '👍', '👎', '❤️', '🎉', '🤔', '😴', '🤝', '💪', '🔥', '👏', '🙏', '😎'];
const tab = ref('emoji');
const stickers = useStickers();
</script>

<style scoped>
.sticker-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 300px;
  max-height: 260px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 50;
}
.sticker-tabs { display: flex; border-bottom: 1px solid var(--border); }
.sticker-tab {
  flex: 1; padding: 8px 0; border: 0; background: transparent; color: var(--muted);
  font-size: 13px; cursor: pointer; font-weight: 500;
}
.sticker-tab.on { color: var(--accent-strong); border-bottom: 2px solid var(--accent); background: var(--accent-ghost); }
.sticker-emoji-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; padding: 8px; overflow-y: auto; }
.sticker-emoji {
  font-size: 22px; padding: 6px 2px; border: 0; background: transparent; cursor: pointer; border-radius: 8px; line-height: 1;
}
.sticker-emoji:hover { background: var(--hover); }
.sticker-pack-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 10px; overflow-y: auto; }
.sticker-pack-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; }
.sticker-pack-item img { width: 100%; height: 100%; object-fit: cover; cursor: pointer; border-radius: 8px; }
.sticker-delete {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; line-height: 1;
  border: 0; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; cursor: pointer;
}
.sticker-empty { grid-column: 1 / -1; border: 1px dashed var(--border); background: transparent; color: var(--muted); border-radius: 8px; padding: 12px; font-size: 12px; cursor: pointer; }
.sticker-upload {
  grid-column: 1 / -1; border: 1px dashed var(--border); background: transparent; color: var(--muted);
  border-radius: 8px; padding: 6px 0; font-size: 18px; cursor: pointer;
}
.sticker-upload:hover { color: var(--accent-strong); border-color: var(--accent); }
</style>
