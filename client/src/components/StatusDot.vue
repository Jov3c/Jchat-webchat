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
.presence-away { background: var(--yellow); }
.presence-busy { background: var(--red); }
.presence-busy::before {
  content: ''; position: absolute; inset: 5px 2px; background: #fff; border-radius: 2px;
}
</style>
