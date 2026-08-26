<template>
  <div class="pw-wrap">
    <input
      class="pw-input"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <button
      type="button"
      class="pw-toggle"
      :aria-label="visible ? '隐藏密码' : '显示密码'"
      :title="visible ? '隐藏密码' : '显示密码'"
      tabindex="-1"
      @click="visible = !visible"
    >
      <svg v-if="!visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  autocomplete: { type: String, default: '' }
});
defineEmits(['update:modelValue']);

const visible = ref(false);
</script>

<style scoped>
.pw-wrap { position: relative; }
.pw-input {
  width: 100%;
  padding: 10px 38px 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.pw-toggle {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; display: grid; place-items: center;
  border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 8px;
}
.pw-toggle:hover { color: var(--text); background: var(--hover); }
.pw-toggle svg { width: 17px; height: 17px; }
</style>
