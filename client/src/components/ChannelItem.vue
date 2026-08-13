<template>
  <button class="channel" :class="{ active }" @click="$emit('select')">
    <span class="hash">#</span><span class="name">{{ name }}</span>
  </button>
</template>

<script setup>
defineProps({ name: String, active: Boolean });
defineEmits(['select']);
</script>

<style scoped>
.channel { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border-radius: var(--radius-sm); text-align: left; }
.channel:hover { background: var(--hover); }
.channel.active { background: var(--hover); color: var(--accent-strong); }
.hash { color: var(--muted); }
</style>
