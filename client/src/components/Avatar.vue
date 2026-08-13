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
