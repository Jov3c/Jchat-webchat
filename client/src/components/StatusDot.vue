<template>
  <span class="dot" :class="`presence-${presence}`" aria-hidden="true" />
</template>

<script setup>
defineProps({ presence: { type: String, default: 'offline' } });
</script>

<style scoped>
.dot { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--panel); }
.presence-online { background: var(--green); }
.presence-offline { background: var(--red); }
.presence-invisible { background: var(--yellow); }
.presence-away { background: linear-gradient(to right, var(--yellow) 50%, #fff 50%); }
.presence-busy { background: linear-gradient(to right, var(--red) 50%, #fff 50%); }
</style>
