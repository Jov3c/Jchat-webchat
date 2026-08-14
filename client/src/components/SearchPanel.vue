<template>
  <Teleport to="body">
    <Transition name="sp">
      <div class="sp-overlay" @click.self="$emit('close')" @contextmenu.prevent="$emit('close')">
        <div class="sp-card">
          <div class="sp-head">
            <span class="sp-title">搜索消息</span>
            <button class="sp-close" @click="$emit('close')" aria-label="关闭">×</button>
          </div>
          <input ref="input" v-model="q" placeholder="输入关键词搜索" @input="doSearch" />
          <div class="sp-results">
            <div v-if="!q" class="sp-empty">输入关键词搜索当前会话的历史消息</div>
            <div v-else-if="loading" class="sp-empty">搜索中…</div>
            <div v-else-if="!results.length" class="sp-empty">无结果</div>
            <div v-for="r in results" :key="r.id" class="sp-item">
              <div class="sp-meta">
                <span class="sp-who">{{ r.nickname || r.username }}</span>
                <span class="sp-when">{{ time(r.created_at) }}</span>
              </div>
              <div class="sp-content">{{ r.content }}</div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { http } from '../api/http.js';

const props = defineProps({ channel: String, peerId: Number });
const emit = defineEmits(['close']);

const q = ref('');
const results = ref([]);
const loading = ref(false);
const input = ref(null);

onMounted(() => input.value?.focus());

function time(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

let timer = null;
function doSearch() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const query = q.value.trim();
    if (!query) { results.value = []; return; }
    loading.value = true;
    try {
      let data;
      if (props.peerId != null) {
        data = await http.get(`/api/dm/${props.peerId}/search?q=${encodeURIComponent(query)}`);
      } else {
        data = await http.get(`/api/messages/${encodeURIComponent(props.channel)}/search?q=${encodeURIComponent(query)}`);
      }
      results.value = data.results || [];
    } catch {
      results.value = [];
    } finally {
      loading.value = false;
    }
  }, 250);
}
</script>

<style scoped>
.sp-overlay { position: fixed; inset: 0; z-index: 97; background: rgba(20, 18, 14, 0.25); display: grid; place-items: start center; padding-top: 80px; }
.sp-card {
  width: 420px; max-height: 60vh; overflow-y: auto; padding: 16px; background: var(--panel);
  border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
}
.sp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sp-title { font-weight: 600; font-size: 15px; }
.sp-close { border: 0; background: transparent; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
.sp-close:hover { color: var(--text); }
.sp-card input { width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 14px; }
.sp-results { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
.sp-empty { color: var(--muted); font-size: 13px; padding: 12px 4px; text-align: center; }
.sp-item { padding: 8px 10px; border-radius: 9px; }
.sp-item:hover { background: var(--hover); }
.sp-meta { display: flex; align-items: baseline; gap: 8px; }
.sp-who { font-weight: 600; font-size: 13px; }
.sp-when { font-size: 11px; color: var(--faint); }
.sp-content { font-size: 13px; color: var(--text); margin-top: 2px; white-space: pre-wrap; overflow-wrap: break-word; }

.sp-enter-active, .sp-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.sp-enter-from, .sp-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
