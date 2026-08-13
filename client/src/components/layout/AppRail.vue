<template>
  <nav class="rail" :class="{ open }">
    <header class="rail-head">
      <button class="brand-mark" @click="expand" aria-label="展开侧边栏">J</button>
      <button v-if="!collapsed" class="collapse-btn" @click="collapse">«</button>
      <button v-if="collapsed" class="collapsed-search" @click="expand" aria-label="搜索">🔍</button>
    </header>
    <div v-if="!collapsed" class="rail-body">
      <!-- 频道/私聊列表，Task 8 填充 -->
    </div>
  </nav>
</template>

<script setup>
import { ref } from 'vue';
const props = defineProps({ collapsed: Boolean });
const emit = defineEmits(['update:collapsed', 'select-channel', 'select-dm']);
const open = ref(false);
function collapse() { emit('update:collapsed', true); }
function expand() { emit('update:collapsed', false); open.value = false; }
function toggle() { open.value = !open.value; } // 移动端抽屉
</script>
