<template>
  <Teleport to="body">
    <div class="toast-wrap">
      <TransitionGroup name="toast">
        <div v-for="t in state.list" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToasts } from '../stores/toast.js';
const state = useToasts();
</script>

<style scoped>
.toast-wrap {
  position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
  z-index: 300; display: flex; flex-direction: column; gap: 8px; align-items: center;
  pointer-events: none; max-width: 90vw;
}
.toast {
  background: rgba(30, 30, 30, 0.88); color: #fff; padding: 9px 18px;
  border-radius: 9px; font-size: 13px; box-shadow: var(--shadow);
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.toast.success { background: rgba(55, 142, 70, 0.94); }
.toast.warn { background: rgba(200, 60, 60, 0.94); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
