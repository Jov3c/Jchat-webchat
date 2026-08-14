import { reactive } from 'vue';
import { http } from '../api/http.js';

// 点击他人头像 → 悬浮资料卡（不跳转）
const state = reactive({ open: false, userId: null, x: 0, y: 0, user: null, loading: false });

export function openUserCard(userId, event) {
  const rect = event.currentTarget.getBoundingClientRect();
  state.open = true;
  state.userId = userId;
  state.x = Math.min(rect.left, window.innerWidth - 300);
  state.y = rect.bottom + 8;
  state.user = null;
  state.loading = true;
  http.get(`/api/profile/${userId}`)
    .then(user => { if (state.userId === userId) { state.user = user; state.loading = false; } })
    .catch(() => { if (state.userId === userId) state.loading = false; });
}

export function closeUserCard() { state.open = false; }
export function useUserCard() { return state; }
