import { reactive } from 'vue';

// 轻量提示（顶部弹出，自动消失）
const state = reactive({ list: [] });
let id = 0;

export function showToast(message, type = 'info') {
  const t = { id: ++id, message, type };
  state.list.push(t);
  setTimeout(() => {
    const i = state.list.findIndex(x => x.id === t.id);
    if (i >= 0) state.list.splice(i, 1);
  }, 2200);
}

export function useToasts() { return state; }
