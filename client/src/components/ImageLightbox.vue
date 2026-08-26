<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="url" class="lightbox" @click="closeImage()">
        <img :src="url" alt="图片预览" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useImageViewer, closeImage } from '../stores/imageViewer.js';
const url = useImageViewer();
</script>

<style scoped>
.lightbox {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(0, 0, 0, 0.88);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; cursor: zoom-out;
}
.lightbox img { max-width: 100%; max-height: 100%; border-radius: 6px; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
