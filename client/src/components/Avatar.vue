<template>
  <span class="avatar-wrap">
    <span class="avatar" :style="{ width: size + 'px', height: size + 'px', background: bg }">
      <img v-if="hasImg" :src="src" :alt="name" />
      <span v-else class="initial" :style="{ fontSize: Math.round(size * 0.42) + 'px' }">{{ initial }}</span>
    </span>
    <StatusDot v-if="presence" :presence="statusToPresence(presence)" />
  </span>
</template>

<script setup>
import { computed } from 'vue';
import StatusDot from './StatusDot.vue';
import { statusToPresence } from '../stores/presence.js';

const props = defineProps({
  src: String,
  name: String,
  presence: { type: String, default: null },
  size: { type: Number, default: 28 }
});

const initial = computed(() => {
  const n = (props.name || '').trim();
  if (!n) return '?';
  return n.charAt(0).toUpperCase();
});

const DEFAULT_AVATAR = 'images/default.png';
const hasImg = computed(() => !!props.src && props.src !== DEFAULT_AVATAR);

const PALETTE = ['#8FA87C', '#B08A7A', '#D9A066', '#7E97A8', '#C08A8A', '#8AA8B0', '#B0A06E', '#A88AB0'];
function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
const bg = computed(() => PALETTE[hash(props.name || '') % PALETTE.length]);
</script>

<style scoped>
.avatar-wrap { position: relative; display: inline-block; flex: none; }
.avatar {
  border-radius: 50%; display: grid; place-items: center; flex: none;
  color: #fff; font-weight: 600; overflow: hidden;
}
.avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.initial { line-height: 1; }
</style>
