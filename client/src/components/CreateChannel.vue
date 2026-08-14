<template>
  <Teleport to="body">
    <Transition name="cc">
      <div class="cc-overlay" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div class="cc-card">
          <div class="cc-head">
            <span class="cc-title">创建频道</span>
            <button class="cc-close" @click="$emit('close')" aria-label="关闭">×</button>
          </div>
          <input v-model="name" placeholder="频道名称" @keydown.enter.prevent="create" />
          <p v-if="error" class="err">{{ error }}</p>
          <div class="cc-actions">
            <button class="cc-cancel" @click="$emit('close')">取消</button>
            <button class="cc-ok" @click="create" :disabled="!name.trim()">创建</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';
import { http } from '../api/http.js';

const emit = defineEmits(['close', 'created']);
const name = ref('');
const error = ref('');

async function create() {
  const n = name.value.trim();
  if (!n) return;
  error.value = '';
  try {
    await http.post('/api/channels', { name: n });
    emit('created', n);
  } catch (e) {
    error.value = e.message || '创建失败';
  }
}
</script>

<style scoped>
.cc-overlay { position: fixed; inset: 0; z-index: 96; background: rgba(20, 18, 14, 0.25); display: grid; place-items: center; }
.cc-card {
  width: 300px; padding: 18px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.cc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cc-title { font-weight: 600; font-size: 15px; }
.cc-close { border: 0; background: transparent; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.cc-close:hover { color: var(--text); }
.cc-card input { width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px; }
.cc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.cc-cancel { padding: 7px 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); font-size: 13px; cursor: pointer; }
.cc-ok { padding: 7px 14px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; }
.cc-ok:disabled { opacity: 0.5; cursor: default; }
.err { color: var(--red); font-size: 12px; margin-top: 8px; }

.cc-enter-active, .cc-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.cc-enter-from, .cc-leave-to { opacity: 0; transform: translateY(4px); }
</style>
