<template>
  <router-view v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </router-view>
  <UserCard />
</template>

<script setup>
import UserCard from './components/UserCard.vue';
</script>

<style>
.page-enter-active, .page-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.page-enter-from { opacity: 0; transform: translateY(8px); }
.page-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
