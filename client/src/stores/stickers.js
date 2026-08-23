import { reactive } from 'vue';

// 我的自定义表情包列表：[{ id, url, created_at }]
// 仅自己可见，服务端 /api/stickers 维护
const state = reactive({ list: [] });

export function useStickers() { return state; }
export function setStickers(list) { state.list = list || []; }
export function resetStickers() { state.list = []; }

export function addSticker(sticker) {
  if (!sticker?.url) return;
  // 去掉同 url 的旧项（重复收藏视为替换），然后放到最前
  state.list = [sticker, ...state.list.filter(s => s.url !== sticker.url)];
}

export function removeSticker(id) {
  state.list = state.list.filter(s => Number(s.id) !== Number(id));
}
