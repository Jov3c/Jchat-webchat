<template>
  <router-view v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </router-view>
  <UserCard />
  <SessionReplacedModal />
  <Toast />
  <ImageLightbox />
</template>

<script setup>
import UserCard from './components/UserCard.vue';
import SessionReplacedModal from './components/SessionReplacedModal.vue';
import Toast from './components/Toast.vue';
import ImageLightbox from './components/ImageLightbox.vue';
</script>

<style>
.page-enter-active, .page-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.page-enter-from { opacity: 0; transform: translateY(8px); }
.page-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
